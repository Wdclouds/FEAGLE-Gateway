import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { getTaskCtx } from './control.js';

export interface PiToolCall {
  name: string;
  args?: unknown;
}

export interface PiResult {
  ok: boolean;
  text: string;              // 最终 assistant 文本
  tools: PiToolCall[];       // 本轮工具调用
  error?: string;
  durationMs: number;
}

interface PiEvent {
  type: string;
  [k: string]: unknown;
}

/** 高危命令硬拦截清单：检测到即 abort + 微信告警（当前 pi RPC 无法预审批，只能事后阻断） */
const HARD_BLOCK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /rm\s+(-[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\s+/i, label: '递归强制删除' },
  { re: /mkfs(\.|\s)/i, label: '格式化磁盘' },
  { re: /dd\s+.+of=\/dev\//i, label: '裸写磁盘设备' },
  { re: />\s*\/dev\/sd[a-z]/i, label: '覆写磁盘设备' },
  { re: /(shutdown|reboot|halt|poweroff)(\s|$)/i, label: '关机重启' },
  { re: /curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh/i, label: '管道执行远程脚本' },
  { re: /chmod\s+-R\s+777\s+\//i, label: '全盘777' },
  { re: /:\(\)\{.*\};\s*:/i, label: 'fork炸弹' },
];

/** 一次性免死金牌（通道 B）：命令精确匹配 + 60s 有效期，用后即焚 */
const grants = new Map<string, number>(); // normalized cmd -> expireAt
export function grantOnce(cmd: string, ttlMs = 60_000): void {
  grants.set(normalizeCmd(cmd), Date.now() + ttlMs);
}
function normalizeCmd(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ');
}
function consumeGrant(cmd: string): boolean {
  const now = Date.now();
  for (const [g, exp] of grants) {
    if (exp < now) { grants.delete(g); continue; }
    if (g === normalizeCmd(cmd)) { grants.delete(g); return true; } // 用后即焚
  }
  return false;
}

/**
 * 全局单例 Pi RPC 管理器 —— 765MB 内存保卫战：
 * - 全局唯一子进程，切换 cwd/session 复用（进程存在时 cwd 不切换，任务级 workspace 由 prompt 指定路径）
 * - 闲置 3 分钟自动 SIGTERM 回收 ~200MB
 * - V8 堆硬限 256MB
 */
export class SinglePiManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private rl: readline.Interface | null = null;
  private pending: {
    resolve: (r: PiResult) => void;
    startedAt: number;
    text: string;
    tools: PiToolCall[];
    error?: string;
  } | null = null;
  private cwd = config.pi.defaultCwd;
  private pendingWorkspace: string | null = null; // /cd 后下一次冷启动生效
  private procStartAt = 0;

  /** /cd 用：空闲时立即杀掉进程，让下个任务以新 cwd 冷启动；忙时返回 false */
  killIfIdle(): boolean {
    if (this.pending || !this.proc) return !this.pending; // 无进程视为成功
    this.proc.kill('SIGTERM');
    this.proc = null;
    this.rl?.close();
    this.rl = null;
    this.emit('recycled');
    return true;
  }

  busy(): boolean {
    return this.pending !== null;
  }

  procInfo(): { alive: boolean; pid?: number; uptimeMs: number; cwd: string } {
    return {
      alive: !!this.proc,
      pid: this.proc?.pid,
      uptimeMs: this.proc ? Date.now() - this.procStartAt : 0,
      cwd: this.cwd,
    };
  }

  /** 确保子进程存在（无则拉起）。BUSY 期间调用无效。 */
  ensureProcess(): void {
    this.resetIdleTimer();
    if (this.proc) return;

    // 任务级 workspace 覆盖（/cd 切换后，冷启动的新进程在新目录工作）
    if (this.pendingWorkspace) {
      this.cwd = this.pendingWorkspace;
      this.pendingWorkspace = null;
    }

    // 干净环境：洗掉宿主 shell 的 LD_LIBRARY_PATH 污染（trae 运行时会弄坏 node 动态链接）
    const env: Record<string, string> = {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/root',
      LANG: 'C.UTF-8',
      NODE_OPTIONS: `--max-old-space-size=${config.pi.maxOldSpace}`,
      HTTP_PROXY: config.proxyUrl,
      HTTPS_PROXY: config.proxyUrl,
      NO_PROXY: '127.0.0.1,localhost,100.70.137.52',
    };

    this.proc = spawn(config.pi.bin, ['--mode', 'rpc'], {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.procStartAt = Date.now();

    this.proc.on('exit', () => {
      this.proc = null;
      this.rl?.close();
      this.rl = null;
      if (this.pending) {
        this.pending.resolve({
          ok: false, text: '', tools: this.pending.tools,
          error: 'Pi 进程意外退出', durationMs: Date.now() - this.pending.startedAt,
        });
        this.pending = null;
      }
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));

    this.proc.stderr!.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s) this.emit('log', s.slice(0, 300));
    });
  }

  private handleLine(line: string): void {
    let evt: PiEvent;
    try {
      evt = JSON.parse(line);
    } catch {
      return; // 非 JSONL 行忽略
    }
    switch (evt.type) {
      case 'message_end': {
        const msg = evt.message as { role?: string; content?: unknown } | undefined;
        if (msg?.role === 'assistant' && this.pending) {
          const c = msg.content;
          const text =
            typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
                : '';
          if (text) this.pending.text = text; // 保留最后一条 assistant 消息
        }
        break;
      }
      case 'tool_execution_start': {
        const call = (evt as any).tool || (evt as any).call || evt;
        const name: string = call.name || 'tool';
        const argsRaw = call.args ?? call.input ?? call.arguments;
        if (this.pending) this.pending.tools.push({ name, args: argsRaw });
        this.emit('tool', { name, args: argsRaw });
        // Shell 类工具：allow_shell=0 的人设直接拒绝；高危清单命中 → 金牌放行或熔断
        if (name === 'bash' || name === 'shell') {
          const cmd = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? '');
          const ctx = getTaskCtx();
          if (ctx && !ctx.persona.allow_shell) {
            this.emit('hazard', { label: `人设 ${ctx.persona.id} 禁止 Shell`, cmd: cmd.slice(0, 200) });
            this.abort();
            return;
          }
          if (consumeGrant(cmd)) {
            this.emit('granted', { cmd: cmd.slice(0, 200) });
            break; // 一次性金牌：放行本次
          }
          for (const p of HARD_BLOCK_PATTERNS) {
            if (p.re.test(cmd)) {
              this.emit('hazard', { label: p.label, cmd: cmd.slice(0, 200) });
              this.abort();
              return;
            }
          }
        }
        break;
      }
      case 'agent_end':
      case 'agent_settled': {
        this.resetIdleTimer();
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p.resolve({
            ok: true,
            text: p.text,
            tools: p.tools,
            error: p.error,
            durationMs: Date.now() - p.startedAt,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /** 发送主任务（prompt）。resolve 于 agent_settled。超时自动 abort。workspace 仅在冷启动进程时生效。 */
  prompt(message: string, timeoutMs = config.pi.promptTimeoutMs, workspace?: string): Promise<PiResult> {
    if (this.pending) {
      return Promise.resolve({
        ok: false, text: '', tools: [], error: 'BUSY: 已有任务在执行', durationMs: 0,
      });
    }
    this.pendingWorkspace = workspace || null;
    this.ensureProcess();
    if (!this.proc) {
      return Promise.resolve({ ok: false, text: '', tools: [], error: 'Pi 进程拉起失败', durationMs: 0 });
    }
    return new Promise<PiResult>((resolve) => {
      this.pending = { resolve, startedAt: Date.now(), text: '', tools: [] };
      this.send({ type: 'prompt', message });
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending.error = `任务超时 (${Math.round(timeoutMs / 60000)}min)，已中断`;
          this.abort();
          // abort 会触发 agent_end → resolve；双保险：
          setTimeout(() => {
            if (this.pending) {
              const p = this.pending;
              this.pending = null;
              p.resolve({ ok: false, text: p.text, tools: p.tools, error: p.error, durationMs: Date.now() - p.startedAt });
            }
          }, 3000);
        }
      }, timeoutMs);
      // resolve 后清理计时器
      const origResolve = resolve;
      const wrapped = (r: PiResult) => { clearTimeout(timer); origResolve(r); };
      this.pending!.resolve = wrapped as any;
    });
  }

  /** 追加引导（任务运行中插话） */
  steer(message: string): boolean {
    if (!this.proc || !this.pending) return false;
    this.send({ type: 'steer', message });
    return true;
  }

  abort(): void {
    if (this.proc) this.send({ type: 'abort' });
  }

  /** 浓缩上下文（/save 前调用，获取压缩后的会话摘要） */
  compact(): boolean {
    if (!this.proc || this.pending) return false;
    this.send({ type: 'compact' });
    return true;
  }

  /** 新会话（/new） */
  newSession(): void {
    this.ensureProcess();
    this.send({ type: 'new_session' });
  }

  private send(cmd: Record<string, unknown>): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(cmd) + '\n');
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // 闲置 3 分钟且非 BUSY → 杀进程释放内存
    this.idleTimer = setTimeout(() => {
      if (!this.pending && this.proc) {
        this.proc.kill('SIGTERM');
        this.proc = null;
        this.emit('recycled');
      }
    }, config.pi.idleTimeoutMs);
    this.idleTimer.unref?.();
  }
}

export const piManager = new SinglePiManager();

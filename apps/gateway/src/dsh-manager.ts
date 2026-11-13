import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDshSession, setDshSession } from './db.js';
import { getTaskCtx, requestApproval } from './control.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export interface AgentToolCall {
  name: string;
  args?: unknown;
}

export interface AgentResult {
  ok: boolean;
  text: string;
  tools: AgentToolCall[];
  error?: string;
  durationMs: number;
  modelUsed?: string;
}

export interface AcpMcpEnvEntry {
  name: string;
  value: string;
}

export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: AcpMcpEnvEntry[];
}

export interface PromptOptions {
  chatId: string;
  workspace?: string;
  timeoutMs?: number;
}

/** 高危命令硬拦截清单：检测到即拒批/中断 + 微信告警 */
export const HARD_BLOCK_PATTERNS: Array<{ re: RegExp; label: string }> = [
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
  const target = normalizeCmd(cmd);
  for (const [g, exp] of grants) {
    if (exp < now) {
      grants.delete(g);
      continue;
    }
    if (g === target) {
      grants.delete(g);
      return true;
    }
  }
  return false;
}

export function matchHardBlock(cmd: string): { label: string } | null {
  for (const p of HARD_BLOCK_PATTERNS) {
    if (p.re.test(cmd)) return { label: p.label };
  }
  return null;
}

export function extractCommandText(rawInput: unknown): string {
  if (typeof rawInput === 'string') return rawInput;
  if (rawInput && typeof rawInput === 'object') {
    const obj = rawInput as Record<string, unknown>;
    if (typeof obj.command === 'string') return obj.command;
    if (typeof obj.cmd === 'string') return obj.cmd;
  }
  return JSON.stringify(rawInput ?? '');
}

export function isRateLimitOrUpstreamError(message: string): boolean {
  return /503|429|rate[- ]?limit|cooldown|all accounts|quota|overloaded/i.test(message);
}

interface PendingRpc {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRun {
  chatId: string;
  sessionId: string;
  startedAt: number;
  tools: AgentToolCall[];
  toolCallsById: Map<string, { name: string; rawInput: unknown }>;
  messagesById: Map<string, string>;
  messageOrder: string[];
  cancelledByGuard: boolean;
  guardError?: string;
}

/**
 * 全局单例 DeepSeek Harness (dsh --profile acp) 管理器：
 * - 基于标准 ACP v1 JSON-RPC 2.0 over stdio 驱动持久化会话
 * - 支持 session/new、session/resume（跨进程重启恢复）、session/cancel、session/close
 * - 支持原生执行前权限网关 session/request_permission -> 微信 Y/N 审批
 * - 主模型 (antigravity/gemini-3.8-flash) 限流时自动切换备选模型并重跑一次
 * - 闲置 3 分钟自动回收子进程，守护 1.6GB ECS 内存水位
 */
export class DshAcpManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private procStartAt = 0;
  private initPromise: Promise<void> | null = null;
  private reqSeq = 1;
  private pendingRpc = new Map<number, PendingRpc>();
  private chatSessions = new Map<string, { sessionId: string; cwd: string; modelValue?: string }>();
  private activeRun: ActiveRun | null = null;
  private currentCwd = config.dsh.defaultCwd;

  busy(): boolean {
    return this.activeRun !== null;
  }

  procInfo(): {
    alive: boolean;
    pid?: number;
    uptimeMs: number;
    cwd: string;
    engine: 'dsh-acp';
    provider: string;
    model: string;
    activeSessions: number;
  } {
    return {
      alive: !!this.proc,
      pid: this.proc?.pid,
      uptimeMs: this.proc ? Date.now() - this.procStartAt : 0,
      cwd: this.currentCwd,
      engine: 'dsh-acp',
      provider: config.dsh.provider,
      model: config.dsh.model,
      activeSessions: this.chatSessions.size,
    };
  }

  getActiveSessionId(chatId: string): string | undefined {
    return this.chatSessions.get(chatId)?.sessionId || getDshSession(chatId)?.sessionId;
  }

  /** 空闲时立即回收进程；忙时返回 false */
  killIfIdle(): boolean {
    if (this.activeRun || !this.proc) return !this.activeRun;
    this.terminateProcess('idle_kill');
    return true;
  }

  private terminateProcess(reason = 'shutdown'): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const p = this.proc;
    this.proc = null;
    this.initPromise = null;
    this.chatSessions.clear();
    this.rl?.close();
    this.rl = null;
    for (const [id, pending] of this.pendingRpc) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`DSH 进程关闭 (${reason})`));
      this.pendingRpc.delete(id);
    }
    if (p) {
      try {
        p.stdin?.end();
      } catch { /* ignore */ }
      try {
        p.kill('SIGTERM');
      } catch { /* ignore */ }
    }
    this.emit('recycled');
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.activeRun && this.proc) {
        this.terminateProcess('idle_timeout');
      }
    }, config.dsh.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private async ensureReady(): Promise<void> {
    this.resetIdleTimer();
    if (this.proc && this.initPromise) {
      return this.initPromise;
    }

    const env: Record<string, string> = {
      PATH: `${dirname(config.dsh.nodeBin)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      HOME: process.env.HOME || '/root',
      LANG: 'C.UTF-8',
      DSH_HOME: config.dsh.dshHome,
      DSH_PERMISSION_MODE: config.dsh.permissionMode,
      NODE_OPTIONS: `--max-old-space-size=${config.dsh.maxOldSpace}`,
      HTTP_PROXY: config.proxyUrl,
      HTTPS_PROXY: config.proxyUrl,
      NO_PROXY: '127.0.0.1,localhost,100.70.137.52',
    };

    const spawnCwd = existsSync(this.currentCwd) ? this.currentCwd : process.cwd();
    const proc = spawn(config.dsh.nodeBin, [config.dsh.dshBin, '--profile', config.dsh.profile], {
      cwd: spawnCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.procStartAt = Date.now();

    proc.on('exit', (code, signal) => {
      const wasCurrent = this.proc === proc;
      if (wasCurrent) {
        this.proc = null;
        this.initPromise = null;
        this.chatSessions.clear();
        this.rl?.close();
        this.rl = null;
      }
      for (const [id, pending] of this.pendingRpc) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`DSH 进程退出 (code=${code}, signal=${signal})`));
        this.pendingRpc.delete(id);
      }
    });

    proc.on('error', (err) => {
      this.emit('log', `spawn error: ${err.message}`);
      if (this.proc === proc) {
        this.proc = null;
        this.initPromise = null;
        this.chatSessions.clear();
        this.rl?.close();
        this.rl = null;
      }
      for (const [id, pending] of this.pendingRpc) {
        clearTimeout(pending.timer);
        pending.reject(err);
        this.pendingRpc.delete(id);
      }
    });

    this.rl = readline.createInterface({ input: proc.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));

    proc.stderr!.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s) this.emit('log', s.slice(0, 400));
    });

    this.initPromise = this.rpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    }, 30_000).then(() => undefined);

    return this.initPromise;
  }

  private sendRaw(obj: Record<string, unknown>): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error('DSH stdin 不可用');
    }
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  private rpc<T = any>(method: string, params: unknown, timeoutMs = 120_000): Promise<T> {
    const id = this.reqSeq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRpc.has(id)) {
          this.pendingRpc.delete(id);
          reject(new Error(`ACP RPC 超时 (${method}, ${Math.round(timeoutMs / 1000)}s)`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pendingRpc.set(id, { resolve, reject, timer });
      try {
        this.sendRaw({ jsonrpc: '2.0', id, method, params });
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRpc.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    try {
      if (this.proc?.stdin && !this.proc.stdin.destroyed) {
        this.sendRaw({ jsonrpc: '2.0', method, params });
      }
    } catch { /* ignore */ }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // 1. Response to client->server RPC
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pendingRpc.get(msg.id);
      if (!pending) return;
      this.pendingRpc.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        const detail = msg.error?.data?.details ? `: ${msg.error.data.details}` : '';
        pending.reject(new Error(`${msg.error.message || 'ACP error'}${detail}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 2. Server->client request (e.g. session/request_permission)
    if (msg.id !== undefined && msg.method === 'session/request_permission') {
      void this.handlePermissionRequest(msg.id, msg.params);
      return;
    }

    // 3. Server->client notification (session/update)
    if (msg.method === 'session/update') {
      this.handleSessionUpdate(msg.params);
    }
  }

  private handleSessionUpdate(params: any): void {
    const run = this.activeRun;
    if (!run || !params?.update) return;
    if (params.sessionId && params.sessionId !== run.sessionId) return;

    const u = params.update;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content?.type === 'text' && typeof u.content.text === 'string') {
          const mid = String(u.messageId || 'default');
          if (!run.messagesById.has(mid)) {
            run.messageOrder.push(mid);
            run.messagesById.set(mid, u.content.text);
          } else {
            run.messagesById.set(mid, (run.messagesById.get(mid) || '') + u.content.text);
          }
        }
        break;
      }
      case 'tool_call': {
        const callId = String(u.toolCallId || '');
        const name = String(u.title || 'tool');
        const rawInput = u.rawInput;
        if (callId) run.toolCallsById.set(callId, { name, rawInput });
        run.tools.push({ name, args: rawInput });
        this.emit('tool', { name, args: rawInput });

        // Shell 类工具：人设禁 Shell 或高危清单命中 -> 立即取消本轮
        if (name === 'bash' || name === 'shell' || name === 'terminal') {
          const cmd = extractCommandText(rawInput);
          const ctx = getTaskCtx();
          if (ctx && !ctx.persona.allow_shell) {
            run.cancelledByGuard = true;
            run.guardError = `人设 ${ctx.persona.id} 禁止 Shell`;
            this.emit('hazard', { label: run.guardError, cmd: cmd.slice(0, 200) });
            this.notify('session/cancel', { sessionId: run.sessionId });
            return;
          }
          if (consumeGrant(cmd)) {
            this.emit('granted', { cmd: cmd.slice(0, 200) });
            break;
          }
          const hit = matchHardBlock(cmd);
          if (hit) {
            run.cancelledByGuard = true;
            run.guardError = `命中高危命令拦截（${hit.label}）`;
            this.emit('hazard', { label: hit.label, cmd: cmd.slice(0, 200) });
            this.notify('session/cancel', { sessionId: run.sessionId });
            return;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private async handlePermissionRequest(rpcId: number | string, params: any): Promise<void> {
    const reply = (optionId: 'allow-once' | 'reject-once' | null) => {
      try {
        this.sendRaw({
          jsonrpc: '2.0',
          id: rpcId,
          result: optionId
            ? { outcome: { outcome: 'selected', optionId } }
            : { outcome: { outcome: 'cancelled' } },
        });
      } catch { /* ignore */ }
    };

    const run = this.activeRun;
    const callId = String(params?.toolCall?.toolCallId || '');
    const tc = run?.toolCallsById.get(callId);
    const toolName = tc?.name || 'tool';
    const cmd = extractCommandText(tc?.rawInput ?? params?.toolCall ?? {});

    const ctx = getTaskCtx();
    if (ctx && !ctx.persona.allow_shell && (toolName === 'bash' || toolName === 'shell' || toolName === 'terminal')) {
      this.emit('hazard', { label: `人设 ${ctx.persona.id} 禁止 Shell`, cmd: cmd.slice(0, 200) });
      reply('reject-once');
      return;
    }

    if (consumeGrant(cmd)) {
      this.emit('granted', { cmd: cmd.slice(0, 200) });
      reply('allow-once');
      return;
    }

    const hit = matchHardBlock(cmd);
    if (hit) {
      this.emit('hazard', { label: hit.label, cmd: cmd.slice(0, 200) });
      reply('reject-once');
      return;
    }

    // 原生执行前预审批：挂起等待微信 Y/N（最长 120s）
    const verdict = await requestApproval(`[${toolName}] ${cmd.slice(0, 350)}`, 'DSH 请求执行受限操作');
    if (verdict.approved) {
      reply('allow-once');
    } else if (verdict.reason === 'superseded') {
      reply(null);
    } else {
      reply('reject-once');
    }
  }

  private buildMcpServers(): AcpMcpServer[] {
    const gatewayUrl = `http://127.0.0.1:${config.gatewayPort}`;
    return [
      {
        name: 'mnemosyne',
        command: process.execPath,
        args: [join(ROOT, 'mcp', 'mnemosyne-mcp.mjs')],
        env: [
          { name: 'MNEMOSYNE_BASE_URL', value: config.mnemosyne.baseUrl },
          { name: 'MN_USER_ID', value: config.mnemosyne.userId },
          { name: 'GATEWAY_BASE_URL', value: gatewayUrl },
        ],
      },
      {
        name: 'gateway-ctl',
        command: process.execPath,
        args: [join(ROOT, 'mcp', 'gateway-ctl-mcp.mjs')],
        env: [
          { name: 'GATEWAY_BASE_URL', value: gatewayUrl },
        ],
      },
    ];
  }

  private extractCurrentModelValue(configOptions: any): string | undefined {
    if (!Array.isArray(configOptions)) return undefined;
    const opt = configOptions.find((o: any) => o?.id === 'model');
    return typeof opt?.currentValue === 'string' ? opt.currentValue : undefined;
  }

  private async ensureSession(chatId: string, cwd: string): Promise<string> {
    this.currentCwd = cwd;
    const mcpServers = this.buildMcpServers();
    const cached = this.chatSessions.get(chatId);
    if (cached && cached.cwd === cwd) {
      return cached.sessionId;
    }
    if (cached && cached.cwd !== cwd) {
      try {
        await this.rpc('session/close', { sessionId: cached.sessionId }, 15_000);
      } catch { /* ignore */ }
      this.chatSessions.delete(chatId);
    }

    const primaryVal = JSON.stringify([config.dsh.provider, config.dsh.model]);
    const persisted = getDshSession(chatId);
    if (persisted && persisted.cwd === cwd) {
      try {
        const res = await this.rpc<{ configOptions?: any }>('session/resume', {
          sessionId: persisted.sessionId,
          cwd,
          mcpServers,
        }, 30_000);
        let modelValue = this.extractCurrentModelValue(res?.configOptions);
        if (modelValue && modelValue !== primaryVal) {
          try {
            await this.rpc('session/set_config_option', {
              sessionId: persisted.sessionId,
              configId: 'model',
              value: primaryVal,
            }, 15_000);
            modelValue = primaryVal;
          } catch { /* keep existing */ }
        }
        this.chatSessions.set(chatId, { sessionId: persisted.sessionId, cwd, modelValue });
        return persisted.sessionId;
      } catch (err: any) {
        this.emit('log', `session/resume failed for ${chatId}, creating new: ${err?.message || err}`);
        setDshSession(chatId, null);
      }
    }

    const created = await this.rpc<{ sessionId: string; configOptions?: any }>('session/new', {
      cwd,
      mcpServers,
    }, 30_000);
    const sessionId = created.sessionId;
    const modelValue = this.extractCurrentModelValue(created?.configOptions) || primaryVal;
    this.chatSessions.set(chatId, { sessionId, cwd, modelValue });
    setDshSession(chatId, { sessionId, cwd });
    return sessionId;
  }

  async prompt(message: string, opts: PromptOptions): Promise<AgentResult> {
    if (this.activeRun) {
      return {
        ok: false,
        text: '',
        tools: [],
        error: 'BUSY: 已有任务在执行',
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    const timeoutMs = opts.timeoutMs ?? config.dsh.promptTimeoutMs;
    const cwd = opts.workspace || config.dsh.defaultCwd;

    try {
      await this.ensureReady();
      const sessionId = await this.ensureSession(opts.chatId, cwd);
      const primaryLabel = `${config.dsh.provider}/${config.dsh.model}`;
      let modelUsed = primaryLabel;

      let currentRun = null as ActiveRun | null;
      const executeOnce = async (): Promise<{ res: { stopReason: string }; run: ActiveRun }> => {
        const run: ActiveRun = {
          chatId: opts.chatId,
          sessionId,
          startedAt,
          tools: [],
          toolCallsById: new Map(),
          messagesById: new Map(),
          messageOrder: [],
          cancelledByGuard: false,
        };
        currentRun = run;
        this.activeRun = run;

        const timer = setTimeout(() => {
          if (this.activeRun === run) {
            run.cancelledByGuard = true;
            run.guardError = `任务超时 (${Math.round(timeoutMs / 60000)}min)，已中断`;
            this.notify('session/cancel', { sessionId });
          }
        }, timeoutMs);
        timer.unref?.();

        try {
          const res = await this.rpc<{ stopReason: string }>('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: message }],
          }, timeoutMs + 15_000);
          return { res, run };
        } finally {
          clearTimeout(timer);
        }
      };

      let attempt: { res: { stopReason: string }; run: ActiveRun };
      try {
        attempt = await executeOnce();
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const hasFallback = Boolean(config.dsh.fallbackProvider && config.dsh.fallbackModel);
        const canFallback =
          hasFallback &&
          isRateLimitOrUpstreamError(errMsg) &&
          !(currentRun?.cancelledByGuard);

        if (!canFallback) {
          throw err;
        }

        const fbVal = JSON.stringify([config.dsh.fallbackProvider, config.dsh.fallbackModel]);
        modelUsed = `${config.dsh.fallbackProvider}/${config.dsh.fallbackModel}`;
        this.emit('log', `[fallback] primary ${primaryLabel} error (${errMsg.slice(0, 120)}), switching to ${modelUsed}`);
        this.activeRun = null;

        await this.rpc('session/set_config_option', {
          sessionId,
          configId: 'model',
          value: fbVal,
        }, 15_000);

        attempt = await executeOnce();

        // 成功后切回主模型配置供下次优先使用
        try {
          await this.rpc('session/set_config_option', {
            sessionId,
            configId: 'model',
            value: JSON.stringify([config.dsh.provider, config.dsh.model]),
          }, 10_000);
        } catch { /* ignore */ }
      }

      const { res: promptRes, run } = attempt;
      this.activeRun = null;
      this.resetIdleTimer();

      let finalText = '';
      for (let i = run.messageOrder.length - 1; i >= 0; i--) {
        const t = (run.messagesById.get(run.messageOrder[i]) || '').trim();
        if (t) {
          finalText = t;
          break;
        }
      }

      if (run.cancelledByGuard) {
        return {
          ok: false,
          text: finalText,
          tools: run.tools,
          error: run.guardError || '任务已被安全规则中断',
          durationMs: Date.now() - startedAt,
          modelUsed,
        };
      }

      if (promptRes?.stopReason === 'cancelled') {
        return {
          ok: false,
          text: finalText,
          tools: run.tools,
          error: '任务已被中断',
          durationMs: Date.now() - startedAt,
          modelUsed,
        };
      }

      return {
        ok: true,
        text: finalText,
        tools: run.tools,
        durationMs: Date.now() - startedAt,
        modelUsed,
      };
    } catch (err: any) {
      const tools = (this.activeRun as ActiveRun | null)?.tools ?? [];
      this.activeRun = null;
      this.resetIdleTimer();
      return {
        ok: false,
        text: '',
        tools,
        error: err?.message || String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.proc || !this.activeRun) return false;
    this.notify('session/cancel', { sessionId: this.activeRun.sessionId });
    return true;
  }

  async closeChatSession(chatId: string): Promise<void> {
    const cached = this.chatSessions.get(chatId);
    if (cached && this.proc) {
      try {
        await this.rpc('session/close', { sessionId: cached.sessionId }, 10_000);
      } catch { /* ignore */ }
    }
    this.chatSessions.delete(chatId);
    setDshSession(chatId, null);
  }

  async shutdown(): Promise<void> {
    if (this.activeRun) {
      await this.cancel();
    }
    this.terminateProcess('gateway_shutdown');
  }
}

export const dshManager = new DshAcpManager();

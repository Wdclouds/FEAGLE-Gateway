/**
 * L0 硬指令统一注册表与调度中心 (Hard Commands Registry)
 * 借鉴 AstrBot 工业级指令集，100% 纯 TypeScript 底层执行，0 延迟、0 Token 消耗、绝不走 LLM。
 */
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { config, isGroup } from './config.js';
import { db, getLease, setLease, trace } from './db.js';
import {
  getSession, setPersona, setWorkspace, getPersona, listPersonas,
  hasPendingConfirm, resolveApproval, consumeHazard, listJobs, addJob, deleteJob, nextRun,
  setMode, GatewayMode, addBlock, removeBlock, listBlocks
} from './control.js';
import { piManager, grantOnce } from './pi-manager.js';
import { quickBatch } from './sanitizer.js';
import { toCompactLines, getSessionKey } from './protocol.js';
import type { WxInboundPkt, WxOutboundBatch, MemoryHit } from './protocol.js';
import { saveCheckpoint, loadCheckpoint, semanticSearch } from './mnemosyne.js';

// 运行时动态配置状态（内存级，即时生效）
export interface RuntimeChatSettings {
  llmEnabled: boolean; // 是否允许 LLM 发言 (/llm on/off)
  alias?: string;      // 会话别名 (/name)
}
const chatSettings = new Map<string, RuntimeChatSettings>();

export function getChatSettings(chatId: string): RuntimeChatSettings {
  let s = chatSettings.get(chatId);
  if (!s) {
    s = { llmEnabled: true };
    chatSettings.set(chatId, s);
  }
  return s;
}

export function isLlmEnabled(chatId: string): boolean {
  return getChatSettings(chatId).llmEnabled;
}

export interface CommandContext {
  pkt: WxInboundPkt;
  arg: string;
  isOp: boolean;
  atU?: string;
  send: (text: string) => Promise<boolean>;
  runTaskReplay: (chat: string, prompt: string, rid?: string) => Promise<void>;
  getWindowHistory: (sessionKey: string) => WxInboundPkt[];
}

export interface HardCommandDef {
  name: string;
  aliases?: string[];
  opOnly: boolean;
  description: string;
  execute: (ctx: CommandContext) => Promise<void>;
}

export const HARD_COMMANDS: Record<string, HardCommandDef> = {
  help: {
    name: 'help',
    opOnly: false,
    description: '查看可用指令列表与系统状态',
    execute: async ({ isOp, send }) => {
      const cmds = Object.values(HARD_COMMANDS).filter((c) => isOp || !c.opOnly);
      const lines = cmds.map((c) => `/${c.name} : ${c.description}${c.opOnly ? ' [👑OP]' : ''}`);
      await send(`📋 【指令帮助】\n` + lines.join('\n') + `\n\n提示：以 / 开头的硬指令直接在底层瞬时执行，不耗费任何模型额度。`);
    },
  },

  sid: {
    name: 'sid',
    opOnly: false,
    description: '查询当前消息源、UID、群ID与权限身份',
    execute: async ({ pkt, isOp, send }) => {
      const group = isGroup(pkt.c);
      const sess = getSession(pkt.c);
      const text =
        `🆔 【消息源身份识别】\n` +
        `• 统一会话: ${pkt.c}\n` +
        `• 用户标识: ${pkt.u}\n` +
        `• 用户昵称: ${pkt.n || '(无)'}\n` +
        `• 会话类型: ${group ? '微信群聊' : '私聊'}\n` +
        `• 权限级别: ${isOp ? '👑 系统管理员 (OP)' : '👤 普通成员'}\n` +
        `• 运行模式: 【${sess.mode}】`;
      await send(text);
    },
  },

  stats: {
    name: 'stats',
    opOnly: false,
    description: '查看当前会话与全网关用量审计统计',
    execute: async ({ pkt, send }) => {
      const chatTraces = (db.prepare('SELECT COUNT(*) as n FROM trace_logs WHERE chat_id = ?').get(pkt.c) as any)?.n ?? 0;
      const totalTraces = (db.prepare('SELECT COUNT(*) as n FROM trace_logs').get() as any)?.n ?? 0;
      const totalSessions = (db.prepare('SELECT COUNT(*) as n FROM sessions').get() as any)?.n ?? 0;
      const sess = getSession(pkt.c);
      const text =
        `📊 【用量与会话统计】\n` +
        `• 本会话日志数: ${chatTraces} 条\n` +
        `• 网关总日志数: ${totalTraces} 条\n` +
        `• 活跃会话数: ${totalSessions} 个\n` +
        `• 当前工作区: ${sess.workspace}\n` +
        `• 人设模板: ${sess.persona_id}`;
      await send(text);
    },
  },

  history: {
    name: 'history',
    opOnly: false,
    description: '查看当前滑动窗口待发送给 LLM 的紧凑上下文',
    execute: async ({ pkt, getWindowHistory, send }) => {
      const sk = getSessionKey(pkt);
      const pkts = getWindowHistory(sk);
      if (!pkts || !pkts.length) {
        await send(`📭 当前窗口缓冲区为空（无残留等待对话）。`);
        return;
      }
      const lines = toCompactLines(pkts);
      await send(`📜 【当前会话缓冲 (${pkts.length} 条)】\n${lines}`);
    },
  },

  stop: {
    name: 'stop',
    opOnly: true,
    description: '中断当前正在运行的智能体任务',
    execute: async ({ pkt, send }) => {
      piManager.abort();
      setLease(pkt.c, false);
      await send('🛑 已向智能体进程发送中断指令，任务已取消。');
    },
  },

  new: {
    name: 'new',
    opOnly: true,
    description: '开启全新会话，重置上下文',
    execute: async ({ pkt, send }) => {
      piManager.newSession();
      setLease(pkt.c, false);
      await send('✨ 已开启新会话（上下文已清空，智能体已重置）。');
    },
  },

  status: {
    name: 'status',
    opOnly: true,
    description: '获取网关与宿主核心进程状态',
    execute: async ({ pkt, send }) => {
      const p = piManager.procInfo();
      const sess = getSession(pkt.c);
      const jobs = listJobs().filter((j) => j.enabled === 1);
      const pend = hasPendingConfirm(pkt.c);
      const statusText =
        `👑 【OP 控制台状态】\n` +
        `• 网关引擎: 运行中 (HTTP 6185)\n` +
        `• Pi 状态: ${p.alive ? `PID ${p.pid} (在线 ${Math.round(p.uptimeMs / 1000)}s)` : '已回收 (闲置待命)'}\n` +
        `• 全局任务: ${piManager.busy() ? '🔴 BUSY (运行中)' : '🟢 IDLE (空闲)'}\n` +
        `• 会话租约: ${getLease(pkt.c) ? '🔒 占用' : '🔓 空闲'}\n` +
        `• 当前人设: ${getPersona(sess.persona_id, true).name} (${sess.persona_id})\n` +
        `• 定时任务: ${jobs.length} 个启用中\n` +
        `• 待办审批: ${pend ? pend + ' 挂起中' : '无'}\n` +
        `• 工作模式: 【${sess.mode}】`;
      await send(statusText);
    },
  },

  persona: {
    name: 'persona',
    opOnly: true,
    description: '查看或热切换人设（OP 可见里/表全量人设）',
    execute: async ({ pkt, arg, send }) => {
      if (!arg) {
        const cur = getSession(pkt.c).persona_id;
        const all = listPersonas(true).map(
          (p) => `${p.id === cur ? '▶' : ' '} ${p.id} (${p.name}${p.op_only ? ' 👑里' : ' 🌐表'}${p.allow_shell ? '，允许Shell' : ''})`
        ).join('\n');
        await send(`🎭 【人设管理 (OP 全量视角)】\n${all}\n\n切换语法：/persona <id>`);
        return;
      }
      const target = listPersonas(true).find((p) => p.id === arg);
      if (!target) {
        await send(`❌ 未知人设: ${arg}，发送 /persona 查看可用 ID。`);
        return;
      }
      setPersona(pkt.c, target.id);
      await send(`✅ 已成功切换人设：${target.name} (${target.id})\n模式: ${target.engine_mode === 'l1_only' ? '轻量直答' : '完整管线'}${target.op_only ? ' (👑里人设)' : ' (🌐表人设)'}`);
    },
  },

  sh: {
    name: 'sh',
    opOnly: true,
    description: '在宿主机指定工作区执行原生 Shell 并返回输出',
    execute: async ({ pkt, arg, send }) => {
      if (!arg) {
        await send('用法：/sh <shell命令>\n例如: /sh df -h 或 /sh free -m');
        return;
      }
      const sess = getSession(pkt.c);
      try {
        const out = execSync(arg, { cwd: sess.workspace, timeout: 15000, encoding: 'utf8' });
        await send(`💻 【终端命令执行结果】\n${out ? out.slice(0, 1500) : '(命令已执行完成，无标准输出)'}`);
      } catch (err: any) {
        await send(`❌ 【执行报错】\n${(err?.stderr || err?.message || String(err)).slice(0, 1500)}`);
      }
    },
  },

  mode: {
    name: 'mode',
    opOnly: true,
    description: '切换会话运行模式: chat(正常交互) | sentry(哨兵观测) | mute(静音)',
    aliases: ['llm'],
    execute: async ({ pkt, arg, send }) => {
      const sess = getSession(pkt.c);
      const sub = arg.toLowerCase().trim();
      const validModes: GatewayMode[] = ['chat', 'sentry', 'mute'];
      if (!sub || !validModes.includes(sub as GatewayMode)) {
        await send(
          `🕹️ 【会话工作模式管理】\n` +
          `• 当前会话模式: 【${sess.mode}】\n\n` +
          `可选模式：\n` +
          `1. /mode chat   : 正常模式（群内@回复，私聊正常对话）\n` +
          `2. /mode sentry : 哨兵观测模式（静默倾听所有群消息，群里不回复；突发紧急事件直接私信OP，提炼人际图谱入记忆库）\n` +
          `3. /mode mute   : 彻底静音模式（大模型完全闭嘴，仅硬指令可用）`
        );
        return;
      }
      setMode(pkt.c, sub as GatewayMode);
      const modeNames: Record<GatewayMode, string> = {
        chat: '🟢 正常交互模式 (chat)',
        sentry: '👁️ 哨兵观测模式 (sentry: 只听不回，紧急私聊OP，提炼关系图谱)',
        mute: '🔴 彻底静音模式 (mute: 大模型静默)',
      };
      await send(`✅ 已成功将当前会话模式切换为: ${modeNames[sub as GatewayMode]}`);
    },
  },

  block: {
    name: 'block',
    opOnly: true,
    description: '黑名单屏蔽某人或群聊 (/block <wxid|群ID> [原因])',
    execute: async ({ pkt, arg, send }) => {
      const parts = arg.trim().split(/\s+/);
      const target = parts[0];
      const reason = parts.slice(1).join(' ') || 'manual_blocked';
      if (!target) {
        const blocks = listBlocks();
        if (!blocks.length) {
          await send('🛡️ 【黑名单列表】\n当前无被屏蔽的用户或群聊。\n\n屏蔽用法：/block <wxid或群ID> [原因]\n解封用法：/unblock <wxid或群ID>');
          return;
        }
        const lines = blocks.map(
          (b) => `• [${b.type === 'user' ? '👤用户' : '👥群聊'}] ${b.target_id} (${new Date(b.created_at).toLocaleDateString('zh-CN')} 原因: ${b.reason})`
        ).join('\n');
        await send(`🛡️ 【已屏蔽黑名单 (${blocks.length})】\n${lines}\n\n解封语法：/unblock <ID>`);
        return;
      }
      if (target === pkt.u || config.adminWxids.includes(target)) {
        await send('❌ 安全限制：不可屏蔽 OP 管理员。');
        return;
      }
      const type = target.endsWith('@chatroom') ? 'group' : 'user';
      const ok = addBlock(target, type, reason);
      await send(ok ? `🚫 已将 ${type === 'user' ? '用户' : '群聊'} [${target}] 加入黑名单！\n机器人将彻底无视该目标的一切消息。` : '❌ 添加黑名单失败。');
    },
  },

  unblock: {
    name: 'unblock',
    opOnly: true,
    description: '解除对某人或群聊的黑名单屏蔽 (/unblock <ID>)',
    execute: async ({ arg, send }) => {
      const target = arg.trim();
      if (!target) {
        await send('用法：/unblock <wxid或群聊ID>');
        return;
      }
      const ok = removeBlock(target);
      await send(ok ? `✅ 已成功从黑名单中解除对 [${target}] 的屏蔽。` : `未在黑名单中找到目标 [${target}]。`);
    },
  },

  name: {
    name: 'name',
    opOnly: true,
    description: '为当前会话设置或查看展示别名',
    execute: async ({ pkt, arg, send }) => {
      const settings = getChatSettings(pkt.c);
      if (!arg) {
        await send(`当前会话 ID: ${pkt.c}\n当前别名: ${settings.alias || '(未设置)'}\n设置方法: /name <自定义别名>`);
        return;
      }
      settings.alias = arg;
      await send(`✅ 已为当前会话设置别名：${arg}`);
    },
  },

  op: {
    name: 'op',
    opOnly: true,
    description: '在线热提权管理员 (/op <wxid>)',
    execute: async ({ arg, send }) => {
      if (!arg) {
        await send(`当前管理员 ID 列表:\n${config.adminWxids.join('\n')}\n\n提权用法: /op <wxid>`);
        return;
      }
      if (!config.adminWxids.includes(arg)) {
        config.adminWxids.push(arg);
        await send(`👑 已成功将用户 ${arg} 提升为管理员 (OP)。`);
      } else {
        await send(`用户 ${arg} 已经是管理员。`);
      }
    },
  },

  deop: {
    name: 'deop',
    opOnly: true,
    description: '撤销管理员权限 (/deop <wxid>)',
    execute: async ({ pkt, arg, send }) => {
      if (!arg) {
        await send('用法: /deop <wxid>');
        return;
      }
      if (arg === pkt.u) {
        await send('❌ 安全限制：不可撤销自身的管理员权限。');
        return;
      }
      const idx = config.adminWxids.indexOf(arg);
      if (idx !== -1) {
        config.adminWxids.splice(idx, 1);
        await send(`✅ 已撤销用户 ${arg} 的管理员权限。`);
      } else {
        await send(`未找到管理员: ${arg}`);
      }
    },
  },

  save: {
    name: 'save',
    opOnly: true,
    description: '保存当前工程状态与快照入记忆宫殿',
    execute: async ({ pkt, arg, send }) => {
      if (!arg) { await send('用法：/save <标签名>'); return; }
      const gitHead = (() => {
        try { return execSync('git rev-parse HEAD', { cwd: config.pi.defaultCwd, timeout: 3000 }).toString().trim(); }
        catch { return 'no-git'; }
      })();
      piManager.compact();
      const snapshot = `workspace=${config.pi.defaultCwd}\ngit=${gitHead}\nsaved_at=${new Date().toISOString()}\nrecent=${toCompactLines([pkt]).slice(-300)}`;
      const ok = await saveCheckpoint(arg, snapshot);
      await send(ok ? `💾 存档完成：${arg}（含 git HEAD ${gitHead.slice(0, 8)}）` : '❌ 存档失败：记忆服务暂时不可用');
    },
  },

  load: {
    name: 'load',
    opOnly: true,
    description: '从记忆宫殿检索快照并恢复任务上下文',
    execute: async ({ pkt, arg, send, runTaskReplay }) => {
      if (!arg) { await send('用法：/load <标签名>'); return; }
      const snap = await loadCheckpoint(arg);
      if (!snap) { await send(`❌ 未找到存档：${arg}`); return; }
      await send(`📂 正在注入存档快照 [${arg}]，继续任务...`);
      await runTaskReplay(pkt.c, `恢复存档 ${arg}，以下是快照上下文，请继续：\n${snap}`, pkt.rid);
    },
  },

  cd: {
    name: 'cd',
    opOnly: true,
    description: '切换底层工作目录 (/cd <绝对路径>)',
    execute: async ({ pkt, arg, send }) => {
      const sess = getSession(pkt.c);
      if (!arg) {
        await send(`当前工作区目录：${sess.workspace}\n切换方法：/cd <绝对路径>`);
        return;
      }
      const path = arg.replace(/\/+$/, '') || '/';
      let ok = false;
      try { ok = statSync(path).isDirectory(); } catch { ok = false; }
      if (!ok) { await send(`❌ 目录不存在或不是有效文件夹：${path}`); return; }
      setWorkspace(pkt.c, path);
      const killed = piManager.killIfIdle();
      await send(`📁 工作区已切换为：${path}\n${killed ? '已回收空闲进程，下个任务在新目录下冷启动。' : '当前有任务在跑，切换将在任务结束后生效。'}`);
    },
  },

  cron: {
    name: 'cron',
    opOnly: true,
    description: '定时任务管理 (/cron list | add | del)',
    execute: async ({ pkt, arg, send }) => {
      const sub = arg.split(/\s+/)[0] || 'list';
      const rest = arg.slice(sub.length).trim();
      if (sub === 'list') {
        const jobs = listJobs();
        if (!jobs.length) { await send('暂无已配置的定时任务。'); return; }
        const lines = jobs.map((j) =>
          `${j.enabled ? '🟢' : '⚪'} ${j.id} | ${j.cron_expr || '一次性'} | 下次: ${new Date(j.run_at).toLocaleString('zh-CN')} | 人设: ${j.persona_id}\n  指令: ${j.prompt_payload.slice(0, 45)}`
        ).join('\n');
        await send(`⏰ 【定时任务清单 (${jobs.length})】\n${lines}\n\n添加：/cron add <id> <cron表达式> <任务指令>\n删除：/cron del <id>`);
        return;
      }
      if (sub === 'add') {
        const mm = rest.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
        const mm2 = rest.match(/^(\d+)\s+([\s\S]+)$/);
        if (mm2 && /^\d+$/.test(mm2[1])) {
          const delayMs = parseInt(mm2[1], 10);
          if (delayMs < 5000 || delayMs > 30 * 86400_000) {
            await send('延迟需在 5 秒 ~ 30 天之间（毫秒）。');
            return;
          }
          const id = `delay_${Date.now().toString(36)}`;
          const err = addJob(id, pkt.c, null, Date.now() + delayMs, mm2[2], getSession(pkt.c).persona_id);
          await send(err ? `创建失败: ${err}` : `✅ 一次性任务已创建: ${id}（${Math.round(delayMs / 1000)}s 后触发）`);
          return;
        }
        if (!mm) {
          await send('用法：\n/cron add <任务id> <cron表达式: 分 时 日 月 周> <任务指令>\n/cron add <毫秒数> <任务指令>');
          return;
        }
        const [, id, expr, prompt] = mm;
        const runAt = nextRun(expr, new Date());
        if (!runAt) { await send(`cron 表达式无效: ${expr}`); return; }
        const err = addJob(id, pkt.c, expr, runAt, prompt, getSession(pkt.c).persona_id);
        await send(err ? `创建失败: ${err}` : `✅ 定时任务已创建: ${id}\n下次执行: ${new Date(runAt).toLocaleString('zh-CN')}`);
        return;
      }
      if (sub === 'del') {
        if (!rest) { await send('用法: /cron del <任务id>'); return; }
        const ok = deleteJob(rest);
        await send(ok ? `✅ 已删除任务: ${rest}` : `未找到任务: ${rest}`);
        return;
      }
      await send('子命令支持: list | add | del');
    },
  },

  audit: {
    name: 'audit',
    opOnly: true,
    description: '查看全链路最近 N 条审计日志 (/audit <条数>)',
    execute: async ({ arg, send }) => {
      const n = Math.min(parseInt(arg, 10) || 10, 50);
      const rows = db.prepare('SELECT ts, event, source, risk_flag, req_id FROM trace_logs ORDER BY id DESC LIMIT ?').all(n) as any[];
      if (!rows.length) { await send('暂无审计日志。'); return; }
      const lines = rows.reverse().map((r) =>
        `${new Date(r.ts).toLocaleTimeString('zh-CN')} ${r.event}${r.risk_flag ? (r.risk_flag === 2 ? ' ✅放行' : ' ⚠️高危') : ''} [${r.source}]`
      ).join('\n');
      await send(`🔍 【最近 ${rows.length} 条审计日志】\n${lines}`);
    },
  },

  approve: {
    name: 'approve',
    opOnly: true,
    description: '放行并重跑被熔断的高危操作 (金牌 60s)',
    execute: async ({ pkt, send, runTaskReplay }) => {
      const h = consumeHazard(pkt.c);
      if (!h) {
        if (hasPendingConfirm(pkt.c)) { resolveApproval(pkt.c, true, true); return; }
        await send('当前没有待放行的高危命令。');
        return;
      }
      grantOnce(h.cmd);
      await send(`🔑 已为命令颁发 60s 临时金牌并重放任务:\n${h.cmd.slice(0, 120)}`);
      await runTaskReplay(pkt.c, h.prompt, pkt.rid);
    },
  },

  deny: {
    name: 'deny',
    opOnly: true,
    description: '拒绝待裁决的高危命令审批',
    execute: async ({ pkt, send }) => {
      if (hasPendingConfirm(pkt.c)) {
        if (resolveApproval(pkt.c, false, true)) return;
      }
      await send('当前没有待裁决的审批。');
    },
  },
};

/** 解析文本是否匹配硬指令 */
export function matchHardCommand(text: string): { cmdName: string; arg: string } | null {
  const m = text.trim().match(/^\/([A-Za-z0-9_]+)\b\s*([\s\S]*)$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const arg = m[2].trim();

  // 1. 直接命中指令名
  if (HARD_COMMANDS[name]) {
    return { cmdName: name, arg };
  }
  // 2. 命中别名 (如 /llm 映射到 /mode)
  for (const cmd of Object.values(HARD_COMMANDS)) {
    if (cmd.aliases && cmd.aliases.includes(name)) {
      // 若原为 /llm on/off，将其参数映射为 mode 语义
      let mappedArg = arg;
      if (cmd.name === 'mode') {
        if (arg === 'on') mappedArg = 'chat';
        if (arg === 'off') mappedArg = 'mute';
      }
      return { cmdName: cmd.name, arg: mappedArg };
    }
  }
  return null;
}

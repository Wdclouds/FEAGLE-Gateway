import { config, isGroup } from './config.js';
import { getLease, setLease, trace, touchSession } from './db.js';
import { routeMessage, distillMemories, directChat, analyzeSentryTranscript } from './llm.js';
import { summon, semanticSearch, remember, saveCheckpoint, loadCheckpoint } from './mnemosyne.js';
import { piManager, grantOnce } from './pi-manager.js';
import { buildOutboundBatch, quickBatch, isPromptInjectionOrToxic } from './sanitizer.js';
import { toCompactLines, getSessionKey } from './protocol.js';
import type { WxInboundPkt, WxOutboundBatch, MemoryHit } from './protocol.js';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { db } from './db.js';
import {
  auditFull, getSession, setPersona, setWorkspace, getPersona, listPersonas, hasPendingConfirm, resolveApproval,
  recordHazard, consumeHazard, taskStart, taskEnd, getTaskCtx,
  listJobs, addJob, deleteJob, nextRun, setJobHandler,
  isBlocked
} from './control.js';
import { matchHardCommand, HARD_COMMANDS, isLlmEnabled } from './commands.js';

// ---------- 出站：把批次推给 wxbridge ----------
export async function sendToBridge(batch: WxOutboundBatch): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(config.bridgeOutUrl, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 紧急专线：向所有 OP 管理员私信报警 */
export async function notifyOp(text: string): Promise<void> {
  for (const adminWxid of config.adminWxids) {
    await sendToBridge(quickBatch(adminWxid, text));
  }
}

// ---------- 哨兵观测模式 (Sentry Mode) 缓冲队列与人际图谱分析 ----------
interface SentryBuf {
  pkts: WxInboundPkt[];
  timer: NodeJS.Timeout;
}
const sentryBuffers = new Map<string, SentryBuf>();
const SENTRY_FLUSH_INTERVAL_MS = 60_000; // 60秒无新消息或满 8 条即触发批分析

function pushToSentry(pkt: WxInboundPkt): void {
  let buf = sentryBuffers.get(pkt.c);
  if (!buf) {
    buf = { pkts: [], timer: null as unknown as NodeJS.Timeout };
    sentryBuffers.set(pkt.c, buf);
  }
  buf.pkts.push(pkt);

  if (buf.pkts.length >= 8) {
    flushSentry(pkt.c);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushSentry(pkt.c), SENTRY_FLUSH_INTERVAL_MS);
  buf.timer.unref?.();
}

async function flushSentry(chatId: string): Promise<void> {
  const buf = sentryBuffers.get(chatId);
  if (!buf || buf.pkts.length === 0) {
    sentryBuffers.delete(chatId);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  const pkts = buf.pkts;
  sentryBuffers.delete(chatId);

  const transcript = toCompactLines(pkts);
  trace(chatId, 'L0', 'sentry_batch_flush', { count: pkts.length });

  try {
    const res = await analyzeSentryTranscript(transcript, chatId);

    // 1. 若检测到紧急情况，直接穿透私聊 OP 管理员
    if (res.urgent) {
      trace(chatId, 'L0', 'sentry_urgent_alert', { reason: res.urgentReason }, undefined, { risk_flag: 2 });
      const alertMsg =
        `🚨 【哨兵紧急警报 · 群聊预警】\n` +
        `• 来源群聊: ${chatId}\n` +
        `• 紧急事由: ${res.urgentReason || '群内出现需管理员介入的紧急求助或突发事件'}\n` +
        `• 关键发言: ${res.urgentSnippet ? `"${res.urgentSnippet}"` : '（见群消息）'}\n\n` +
        `💡 提示：该群当前处于 sentry 哨兵模式，机器人已保持静默，请管理员及时处理。`;
      await notifyOp(alertMsg);
    }

    // 2. 沉淀人际社交关系与知识图谱入 Mnemosyne 记忆宫殿
    if (res.relations && res.relations.length > 0) {
      for (const rel of res.relations) {
        const memoryContent = `[CURRENT][RELATION][${chatId}] ${rel.subject} -> ${rel.relation} -> ${rel.object} (背景: ${rel.context})`;
        await remember(memoryContent, 'knowledge', {
          source: 'sentry_graph',
          chat_id: chatId,
          subject: rel.subject,
          relation: rel.relation,
          object: rel.object,
          scope: 'group',
          visibility: 'private_op',
          is_test: false,
          ts: Date.now(),
        });
      }
      trace(chatId, 'L3', 'sentry_graph_stored', { count: res.relations.length });
    }
  } catch (err: any) {
    trace(chatId, 'SYS', 'sentry_analyze_error', { err: String(err) });
  }
}

// ---------- 滑动窗口防抖缓冲（方案 C：以 getSessionKey 区分群内用户与私聊） ----------
interface WindowBuf {
  pkts: WxInboundPkt[];
  timer: NodeJS.Timeout;
  firstAt: number;
}
const buffers = new Map<string, WindowBuf>();
const MAX_WINDOW_MS = 30_000; // W 判定下的最长等待

function pushToWindow(pkt: WxInboundPkt, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const sk = getSessionKey(pkt);
  let buf = buffers.get(sk);
  if (!buf) {
    buf = { pkts: [], timer: null as unknown as NodeJS.Timeout, firstAt: Date.now() };
    buffers.set(sk, buf);
  }
  buf.pkts.push(pkt);
  if (buf.pkts.length >= 10) { flushWindow(sk, onFlush); return; } // 防爆缓冲
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushWindow(sk, onFlush), config.debounceMs);
  buf.timer.unref?.();
}

function extendWindow(sessionKey: string, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const buf = buffers.get(sessionKey);
  if (!buf) return;
  if (Date.now() - buf.firstAt >= MAX_WINDOW_MS) { flushWindow(sessionKey, onFlush); return; }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushWindow(sessionKey, onFlush), config.debounceMs);
  buf.timer.unref?.();
}

function flushWindow(sessionKey: string, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const buf = buffers.get(sessionKey);
  if (!buf || buf.pkts.length === 0) { buffers.delete(sessionKey); return; }
  if (buf.timer) clearTimeout(buf.timer);
  buffers.delete(sessionKey);
  onFlush(buf.pkts);
}

// ---------- 高危告警路由（通道 B：熔断存档 + /approve 金牌重放） ----------
piManager.on('hazard', (h: { label: string; cmd: string }) => {
  trace(getTaskCtx()?.chat ?? '-', 'L2', 'hazard_blocked', h, undefined, { risk_flag: 1 });
  recordHazard(h.label, h.cmd); // 存档 (chat + 原始 prompt + cmd)，微信提示 /approve
});
piManager.on('granted', (g: { cmd: string }) => {
  trace(getTaskCtx()?.chat ?? '-', 'L2', 'grant_used', g, undefined, { risk_flag: 2 });
});

// ---------- 第 2 层：记忆预热 + Pi 执行 ----------
function buildTaskPrompt(pkts: WxInboundPkt[], memories: MemoryHit[], personaPrompt: string, imgDesc?: string | null): string {
  const last = pkts[pkts.length - 1];
  const history = toCompactLines(pkts.slice(0, -1));
  const memBlock = memories.length
    ? memories.map((m, i) => `${i + 1}. [${m.created_at ? m.created_at.slice(0, 10) : '近期'}] ${m.content.slice(0, 300)}`).join('\n')
    : '（无命中）';
  return [
    '[人设指令]',
    personaPrompt,
    '',
    '[微信任务上下文]',
    history ? `近期对话：\n${history.slice(-1500)}` : '',
    `[历史记忆参考（按时效加权排序）]\n${memBlock}`,
    '【记忆时效与时序仲裁约束】：',
    '1. 记忆内容按时间倒序及半衰期有效度排列；',
    '2. 新决策自动覆盖旧决策：当记忆中针对同一项目架构、配置或决策存在冲突时，必须严格以最新时间（或带有 [CURRENT] 标签）的记忆为准；',
    '3. 宁缺毋滥：若记忆内容依赖已下线或已废弃的旧方案，严禁生搬硬套，以当前对话与实际代码现状为准。',
    last.img
      ? `[用户发图] 图片内容转述：${imgDesc || '（视觉模型未能读取，可自行 cat 该文件查看）'}\n图片本地路径：${last.img}`
      : '',
    '',
    '[当前任务]',
    last.t,
    '',
    '要求：直接执行任务（可读写工作区文件、跑 shell），完成后输出简洁中文总结；代码与报错保持原样输出，不要改写。',
    '高危操作铁律：凡涉及删除数据/修改系统配置/重启服务/大范围文件变动的命令，执行前必须先调用 request_high_risk_exec 工具获得用户批准，禁止直接执行。',
  ].filter(Boolean).join('\n');
}

/** 通道 B 金牌重放：带原始 Prompt 重新触发 Pi */
async function runReplay(chat: string, prompt: string, rid?: string): Promise<void> {
  const persona = getPersona(getSession(chat).persona_id, true, chat);
  const mems: MemoryHit[] = [];
  try { mems.push(...await semanticSearch(prompt.slice(0, 200), { topK: 3, chatId: chat, includeTest: false })); } catch { /* 检索失败不阻塞 */ }
  await runTaskCore(chat, prompt, mems, persona, rid ?? `replay_${Date.now()}`);
}

async function runTask(pkts: WxInboundPkt[], origin: WxInboundPkt, imgDesc?: string | null): Promise<void> {
  const chat = origin.c;
  const rid = origin.rid ?? `wx_${Date.now()}`;
  const persona = getPersona(getSession(chat).persona_id, true, chat);
  const memories = await prefetchMemories(pkts, persona);
  const promptText = buildTaskPrompt(pkts, memories, persona.sys_prompt, imgDesc);
  await runTaskCore(chat, promptText, memories, persona, rid, origin);
}
/** 任务核心执行（runTask / runReplay / cron 殊途同归） */
async function runTaskCore(
  chat: string,
  promptText: string,
  memories: MemoryHit[],
  persona: ReturnType<typeof getPersona>,
  rid: string,
  origin?: WxInboundPkt
): Promise<void> {
  if (piManager.busy() || getLease(chat)) {
    const steered = piManager.steer(promptText.slice(-600));
    if (!steered) await sendToBridge(quickBatch(chat, '当前有任务在跑，请稍候或发 /stop 中断。'));
    trace(chat, 'L2', 'steer_queued', { steered }, undefined, { req_id: rid });
    return;
  }
  setLease(chat, true);
  taskStart({ chat, reqId: rid, prompt: promptText, persona, startedAt: Date.now() });
  trace(chat, 'L2', 'task_start', { persona: persona.id, workspace: getSession(chat).workspace }, undefined, { req_id: rid, source: rid.startsWith('cron_') ? 'cron' : 'wx' });

  try {
    const workspace = getSession(chat).workspace;
    const result = await piManager.prompt(promptText, undefined, workspace !== config.pi.defaultCwd ? workspace : undefined);
    trace(chat, 'L2', 'pi_done', { ok: result.ok, tools: result.tools.length, ms: result.durationMs }, result.durationMs, { req_id: rid });

    const replyText = result.ok
      ? result.text || '（任务完成，无文本输出）'
      : `任务失败：${result.error || '未知错误'}`;
    const atU = origin && isGroup(chat) && origin.at ? origin.u : undefined;
    const batch = buildOutboundBatch(chat, replyText, atU);
    await sendToBridge(batch);
    trace(chat, 'L3', 'sync_out', { chunks: batch.seq.length }, undefined, { req_id: rid });
    auditFull({ type: 'task_reply', chat, req_id: rid, persona: persona.id, ok: result.ok, tools: result.tools.length, reply_head: replyText.slice(0, 400), ts: Date.now() });

    if (result.ok && origin) {
      void historian(chat, origin, promptText.slice(-1200), result.text);
    }
  } finally {
    setLease(chat, false);
    taskEnd();
  }
}

/** 记忆预取（任务前置，带空间隔离与防串台过滤） */
async function prefetchMemories(pkts: WxInboundPkt[], _persona: ReturnType<typeof getPersona>): Promise<MemoryHit[]> {
  const chat = pkts[0]?.c ?? '-';
  const query = toCompactLines(pkts).slice(-400);
  let memories: MemoryHit[] = [];
  try {
    memories = await summon(query);
    if (memories.length === 0) {
      memories = await semanticSearch(query, {
        topK: 5,
        chatId: chat !== '-' ? chat : undefined,
        includeTest: false,
      });
    }
  } catch { /* 记忆库故障不阻塞任务 */ }
  trace(chat, 'L2', 'memory_prewarm', { hits: memories.length, chat });
  return memories;
}

/** 异步史官：过滤水群，提炼决策/踩坑/偏好，按翼区写入；群聊非管理员禁写个人翼区 */
async function historian(chat: string, origin: WxInboundPkt, userTranscript: string, aiResult: string): Promise<void> {
  const t0 = Date.now();
  const transcript = `用户侧：\n${userTranscript}\n\nAI侧结果：\n${aiResult.slice(0, 3000)}`;
  const distilled = await distillMemories(transcript);
  if (!distilled.length) return;

  const isAdmin = config.adminWxids.includes(origin.u);
  const allowed = isAdmin
    ? distilled
    : distilled.filter((m) => ['project', 'knowledge', 'worklog', 'pitfall'].includes(m.category)); // 群聊防串台：非管理员禁写 preference

  let written = 0;
  for (const m of allowed) {
    const isGrp = isGroup(chat);
    // 写入时加注规范状态前缀与来源标签（源头防腐）
    const taggedContent = `[CURRENT][${m.category.toUpperCase()}] ${m.content}`;
    const ok = await remember(taggedContent, m.category, {
      source: 'historian',
      chat_id: chat,
      sender: origin.u,
      scope: isGrp ? 'group' : 'private',
      visibility: isGrp ? 'group' : 'private',
      is_test: false,
      ts: Date.now(),
    });
    if (ok) written++;
  }
  trace(chat, 'L3', 'historian', { distilled: distilled.length, written, admin: isAdmin }, Date.now() - t0);
}

// ---------- 漏斗主入口 ----------
export async function receiveInbound(pkt: WxInboundPkt): Promise<void> {
  const t0 = Date.now();
  pkt.rid = pkt.rid ?? `${pkt.u === 'system_cron' ? 'cron' : 'wx'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  touchSession(pkt.c);
  trace(pkt.c, 'L0', 'inbound', { u: pkt.u, at: pkt.at, t: pkt.t.slice(0, 80), img: !!pkt.img }, Date.now() - t0, { req_id: pkt.rid, source: pkt.u === 'system_cron' ? 'cron' : 'wx' });
  auditFull({ type: 'inbound', req_id: pkt.rid, chat: pkt.c, from: pkt.u, text: pkt.t, img: pkt.img, at: pkt.at, ts: Date.now() });

  // cron 系统投递：跳过鉴权与 @ 校验（构造即受信）
  const systemCron = pkt.u === 'system_cron';
  const isOp = config.adminWxids.includes(pkt.u);
  const group = isGroup(pkt.c);
  const sess = getSession(pkt.c);

  // 🚫 黑名单硬拦截：被屏蔽的用户 (wxid) 或群聊直接物理丢弃，绝不响应、不进日志
  if (!systemCron && !isOp) {
    if (isBlocked(pkt.u) || isBlocked(pkt.c)) {
      trace(pkt.c, 'L0', 'blocked_target_dropped', { u: pkt.u, c: pkt.c });
      return;
    }
  }

  // ⚡ L0 硬指令集中调度执行（0 延迟、0 成本、100% 纯 TS 原生执行，绝不走 LLM）
  // 无论当前处于什么模式，硬指令始终享有最高执行优先权！
  const hardMatch = matchHardCommand(pkt.t);
  if (hardMatch) {
    const cmdDef = HARD_COMMANDS[hardMatch.cmdName];
    if (cmdDef.opOnly && !isOp) {
      trace(pkt.c, 'L0', 'op_cmd_rejected', { cmd: hardMatch.cmdName, u: pkt.u }, undefined, { req_id: pkt.rid });
      await sendToBridge(quickBatch(pkt.c, '🔒 [权限限制] 该控制指令仅供系统管理员 (OP) 执行。', group ? pkt.u : undefined));
      return;
    }

    trace(pkt.c, 'L0', 'hard_command_executed', { cmd: hardMatch.cmdName, arg: hardMatch.arg.slice(0, 80) }, undefined, { req_id: pkt.rid });
    await cmdDef.execute({
      pkt,
      arg: hardMatch.arg,
      isOp,
      atU: group && pkt.at ? pkt.u : undefined,
      send: (text) => sendToBridge(quickBatch(pkt.c, text, group && pkt.at ? pkt.u : undefined)),
      runTaskReplay: (chat, prompt, rid) => runReplay(chat, prompt, rid),
      getWindowHistory: (sk) => buffers.get(sk)?.pkts || [],
    });
    return;
  }

  // ⚡ 小红书智能自然语言直达：彻底清洗群聊 @、前后缀口语词
  const rawClean = pkt.t.replace(/^@\S+[\s\u2005\u00a0]*/, '').trim();
  let xhsKeyword: string | null = null;

  const mCmd = rawClean.match(/^\/xhs\s+(.+)$/i);
  if (mCmd) {
    xhsKeyword = mCmd[1].trim();
  } else if (/小红书|xhs/i.test(rawClean)) {
    const p1 = rawClean.match(/^(?:帮我|请|麻烦|快|给|去|在|到|\s)*(?:小红书|xhs)\s*(?:上)?\s*(?:搜搜|搜一下|搜一搜|搜索|搜|查查|查一下|查找|查|看下|看看|看|找找|找一下|找|翻翻|翻一下)?\s*(?:一下|下)?\s*[,，:：\s]*(.+)$/i);
    const p2 = rawClean.match(/^(?:帮我|请|麻烦|快|给|去|在|到|\s)*(?:搜搜|搜一下|搜一搜|搜索|搜|查查|查一下|查找|查|看下|看看|看|找找|找一下|找)\s*(?:一下|下)?\s*(?:小红书|xhs)\s*(?:上)?\s*[,，:：\s]*(.+)$/i);
    const pFallback = rawClean.match(/(?:小红书|xhs)\s*(?:上)?\s*(?:搜搜|搜一下|搜一搜|搜索|搜|查查|查一下|查找|查|看下|看看|看|找找|找一下|找|翻翻|翻一下)?\s*(?:一下|下)?\s*[,，:：\s]*(.+)$/i);
    xhsKeyword = p1?.[1]?.trim() || p2?.[1]?.trim() || pFallback?.[1]?.trim() || null;
  }

  if (xhsKeyword && (!group || pkt.at)) {
    xhsKeyword = xhsKeyword.replace(/^[，,。？?！!：:\s]+|[，,。？?！!：:\s]+$/g, '');
    if (xhsKeyword.length >= 2) {
      await sendToBridge(quickBatch(pkt.c, `🔍 正在调动平板小红书实时翻找【${xhsKeyword}】，请稍候...`, group ? pkt.u : undefined));
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 20000);
        const res = await fetch('http://127.0.0.1:6192/gw/xhs/search', {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: xhsKeyword }),
        });
        clearTimeout(timer);
        const data = await res.json() as any;
        const result = data.result || {};
        const notes = Array.isArray(result.notes) ? result.notes : [];
        if (!notes.length) {
          await sendToBridge(quickBatch(pkt.c, `📕 【小红书检索 · ${xhsKeyword}】\n未检索到相关有效笔记，建议换个关键词试试～`, group ? pkt.u : undefined));
          return;
        }

        const rawNotes = notes.slice(0, 6).join('\n---\n');
        let finalReply = '';
        try {
          const summaryPrompt = `用户正在询问关于【${xhsKeyword}】的信息。以下是通过端侧设备从小红书实时检索抓取到的真实笔记核心内容：\n${rawNotes}\n\n请以群助手 Nox 的身份，结合这些最新真实笔记，为群友输出一段干货满满、重点突出的总结：\n1. 明确说明这是“刚从小红书实时翻出来的新鲜笔记”；\n2. 提取出大家最关心的几个避坑/经验重点（带出笔记里提到的真实细节，不要空泛）；\n3. 口吻自然亲切、灵动、排版清晰，避免机械式罗列。`;
          finalReply = await directChat(summaryPrompt, '你是微信群聊智能助手 Nox。语言简炼生动、干货满满。');
        } catch {
          finalReply = `📕 【小红书实测提炼 · ${xhsKeyword}】\n\n` + notes.slice(0, 5).map((n: string, i: number) => `${i + 1}. ${n}`).join('\n\n');
        }

        await sendToBridge(quickBatch(pkt.c, finalReply, group ? pkt.u : undefined));
        return;
      } catch (e: any) {
        await sendToBridge(quickBatch(pkt.c, `❌ 小红书检索暂不可用: ${e.message}`, group ? pkt.u : undefined));
        return;
      }
    }
  }

  // 🛡️ 屏蔽机制：防止提示词投毒 / 越狱攻击注入拦截 (硬规则，0 成本)
  if (!systemCron) {
    const toxicCheck = isPromptInjectionOrToxic(pkt.t);
    if (toxicCheck.blocked) {
      trace(pkt.c, 'L0', 'injection_blocked', { u: pkt.u, text: pkt.t.slice(0, 80) }, undefined, { req_id: pkt.rid, risk_flag: 1 });
      await sendToBridge(quickBatch(pkt.c, `🛡️ [安全拦截] ${toxicCheck.reason || '输入含有未授权指令，已被系统安全层拦截。'}`, group ? pkt.u : undefined));
      return;
    }
  }

  // ⚡ 审批优先拦截：本会话有挂起审批时，Y/N 直接进裁决器（蓝图通道 A）
  const pendingNo = hasPendingConfirm(pkt.c);
  if (pendingNo && !systemCron) {
    const text = pkt.t.trim().toUpperCase();
    const isApproveCmd = /^\/(APPROVE|DENY)\b/.test(text) || /^\/(approve|deny)\b/.test(pkt.t.trim());
    if (!isApproveCmd) {
      if (text === 'Y' || text === 'Y。' || text === 'YES' || text === '是') {
        if (resolveApproval(pkt.c, true, isOp)) return;
      } else if (text === 'N' || text === 'N。' || text === 'NO' || text === '否') {
        if (resolveApproval(pkt.c, false, isOp)) return;
      } else {
        await sendToBridge(quickBatch(pkt.c, `有审批 ${pendingNo} 等待回复：请回 Y 批准 / N 拒绝（其余消息暂停处理）。`));
        return;
      }
    }
    // /approve /deny 放行到 L0 指令层处理（与通道 B 语义统一）
  }

  // 🕹️ 三大模式行为路由：
  // 模式 1: mute (彻底静音)
  if (sess.mode === 'mute') {
    trace(pkt.c, 'L0', 'mode_mute_skip', { u: pkt.u });
    return;
  }

  // 模式 2: sentry (哨兵观测模式)
  if (sess.mode === 'sentry') {
    // 哨兵模式下：收集所有消息进行离线分析与社交图谱沉淀，但在群内绝不主动回复发信
    pushToSentry(pkt);
    trace(pkt.c, 'L0', 'mode_sentry_ingest', { u: pkt.u });
    return;
  }

  // 模式 3: chat (正常交互模式)
  // 鉴权：私聊白名单 / 群聊 @ 校验
  if (!systemCron) {
    if (!group && config.adminWxids.length && !isOp) {
      trace(pkt.c, 'L0', 'auth_rejected', { u: pkt.u }, undefined, { req_id: pkt.rid });
      return; // 非管理员私聊：静默丢弃
    }
    if (group && !pkt.at) return; // 群聊未 @ 机器人：忽略
  }

  // 进入滑动窗口防抖
  pushToWindow(pkt, (pkts) => void onWindowFlush(pkts));
}

async function onWindowFlush(pkts: WxInboundPkt[]): Promise<void> {
  const last = pkts[pkts.length - 1];
  const chat = last.c;
  const sessionKey = getSessionKey(last);
  const rid = last.rid ?? `wx_${Date.now()}`;
  const busy = piManager.busy() || getLease(chat);
  const compactHistory = toCompactLines(pkts);
  const isOp = config.adminWxids.includes(last.u);

  // 人设解析：OP 可用任意指定人设，群聊优先独立 MD 文档，普通用户强行指定里人设时降级为表人设
  const persona = getPersona(last.persona_id || getSession(chat).persona_id, isOp, chat);
  const memories = await prefetchMemories(pkts, persona);

  // 人设 l1_only：强制不唤醒 Pi，DeepSeek 带人设直答（蓝图破局二）
  if (persona.engine_mode === 'l1_only') {
    const t = Date.now();
    const memBlock = memories.length
      ? memories.map((m, i) => `${i + 1}. [${m.created_at ? m.created_at.slice(0, 10) : '近期'}] ${m.content.slice(0, 300)}`).join('\n')
      : '（无命中）';
    const personaWithAging = `${persona.sys_prompt}\n\n【时效与记忆仲裁规则】：\n1. 历史记忆仅供参考。当记忆与用户当前给出的上下文/代码冲突时，以最新事实为准。\n2. 若存在标有 [CURRENT] 的项目状态，以该状态为最新方案。旧方案视为已废弃，不要主动提及。`;
    const reply = await directChat(
      `[历史记忆参考]\n${memBlock}\n\n[用户对话]\n${compactHistory}`,
      personaWithAging
    );
    await sendToBridge(quickBatch(chat, reply, isGroup(chat) ? last.u : undefined));
    trace(chat, 'L1', 'persona_direct', { persona: persona.id, sessionKey }, Date.now() - t, { req_id: rid, source: rid.startsWith('cron_') ? 'cron' : 'wx' });
    return;
  }

  // 第 1 层：入口状态与意图路由（图片先经 NIM VL 转述）
  const t1 = Date.now();
  const { decision, provider, imgDesc } = await routeMessage(compactHistory, busy, last.img);
  trace(chat, 'L1', 'route', { decision, provider, imgDesc: imgDesc || undefined, sessionKey }, Date.now() - t1, { req_id: rid });

  switch (decision.s) {
    case 'W': // 话没说完：延长窗口继续等
      extendWindow(sessionKey, (p) => void onWindowFlush(p));
      trace(chat, 'L1', 'wait_more', { sessionKey });
      return;
    case 'X': // 打断
      piManager.abort();
      setLease(chat, false);
      await sendToBridge(quickBatch(chat, '已中断当前任务。', isGroup(chat) ? last.u : undefined));
      return;
    case 'T': { // 闲聊秒回（不唤醒 Pi）
      const reply = decision.r || '在的，请讲。';
      await sendToBridge(quickBatch(chat, reply, isGroup(chat) ? last.u : undefined));
      trace(chat, 'L1', 'chitchat_direct', { provider });
      return;
    }
    case 'R': { // 额度保护拒单（不唤醒 Pi，礼貌拒绝+建议拆解）
      const reply =
        decision.r ||
        '这个任务规模有点大，一口气跑完会烧掉不少额度。建议拆成小步骤分批发给我，每批一个明确的小任务，我逐个搞定。';
      await sendToBridge(quickBatch(chat, reply, isGroup(chat) ? last.u : undefined));
      trace(chat, 'L1', 'refuse_quota_guard', { provider, c: decision.c }, undefined, {
        req_id: rid,
        risk_flag: 1, // 额度保护拦截（非高危，仅标记）
      });
      return;
    }
    case 'S': // 追加引导
      if (piManager.busy()) {
        const ok = piManager.steer(compactHistory.slice(-500));
        trace(chat, 'L1', 'steer', { ok });
        return;
      }
      // 不忙时的 S 按 C 处理
      break;
    case 'C': // 工程任务 → 第 2 层
      break;
  }

  // 置信度 < 0.75：扩大记忆检索范围（防失忆）——在 runTask 前预取宽口径记忆
  await runTask(pkts, last, imgDesc);
}

// ---------- Cron 事件化（蓝图破局三：定时任务构造标准入站包进主管线） ----------
let cronWired = false;
export function wireCronToPipeline(): void {
  if (cronWired) return;
  cronWired = true;
  setJobHandler(async (job) => {
    const pkt: WxInboundPkt = {
      id: `cron_${job.id}_${Date.now()}`,
      c: job.chat_id,
      u: 'system_cron',
      n: '定时任务',
      at: 0,
      t: job.prompt_payload,
      ts: Date.now(),
      rid: `cron_${job.id}_${Date.now()}`,
      persona_id: job.persona_id, // 任务自带人设，优先于会话当前人设
    };
    // 直接进主管线：享受 Turn Lease / 人设 / 审计 / 微批次出站全套
    await receiveInbound(pkt);
  });
}

export function gatewayStatus() {
  return {
    buffers: Array.from(buffers.keys()),
    pi: piManager.procInfo(),
    busy: piManager.busy(),
    admin: config.adminWxids,
    personas: listPersonas().map((p) => ({ id: p.id, mode: p.engine_mode, shell: p.allow_shell })),
    jobs: listJobs().filter((j) => j.enabled === 1).map((j) => ({ id: j.id, next: j.run_at, cron: j.cron_expr })),
  };
}

import { config, isGroup } from './config.js';
import { getLease, setLease, trace, touchSession } from './db.js';
import { routeMessage, directChat } from './llm.js';
import { semanticSearch } from './mnemosyne.js';
import { dshManager } from './dsh-manager.js';
import { buildOutboundBatch, quickBatch, isPromptInjectionOrToxic } from './sanitizer.js';
import { toCompactLines, getSessionKey } from './protocol.js';
import type { WxInboundPkt, MemoryHit } from './protocol.js';
import { dialogManager, formatQuoteReply } from './dialog.js';
import {
  auditFull, getSession, getPersona, listPersonas, hasPendingConfirm, resolveApproval,
  recordHazard, taskStart, taskEnd, getTaskCtx,
  listJobs, setJobHandler, isBlocked, touchMemberProfile, formatMemberProfileContext
} from './control.js';
import { matchHardCommand, HARD_COMMANDS } from './commands.js';
import { sendToBridge, notifyOp } from './pipeline/bridge-io.js';
import { pushToSentry } from './pipeline/sentry.js';
import { pushToWindow, extendWindow, getWindowPackets, listBufferKeys } from './pipeline/window.js';
import { buildTaskPrompt, prefetchMemories, historian, isTestOrSystemChat } from './pipeline/prompt-builder.js';

export { sendToBridge, notifyOp };

dshManager.on('hazard', (h: { label: string; cmd: string }) => {
  trace(getTaskCtx()?.chat ?? '-', 'L2', 'hazard_blocked', h, undefined, { risk_flag: 1 });
  recordHazard(h.label, h.cmd);
});
dshManager.on('granted', (g: { cmd: string }) => {
  trace(getTaskCtx()?.chat ?? '-', 'L2', 'grant_used', g, undefined, { risk_flag: 2 });
});

interface QueuedFollowup {
  chat: string;
  promptText: string;
  memories: MemoryHit[];
  persona: ReturnType<typeof getPersona>;
  rid: string;
  origin?: WxInboundPkt;
}
const queuedFollowups = new Map<string, QueuedFollowup>();

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

async function runTaskCore(
  chat: string,
  promptText: string,
  memories: MemoryHit[],
  persona: ReturnType<typeof getPersona>,
  rid: string,
  origin?: WxInboundPkt
): Promise<void> {
  if (dshManager.busy() || getLease(chat)) {
    queuedFollowups.set(chat, { chat, promptText, memories, persona, rid, origin });
    const busyReply = origin
      ? formatQuoteReply({
          senderName: origin.n || origin.u,
          sourceText: origin.t,
          replyText: '当前任务正在执行中，已将你的补充任务排队，本轮结束后自动续跑（或发 /stop 中断）。',
          isGroup: isGroup(chat),
        })
      : '当前任务正在执行中，已排队等待本轮结束。';
    await sendToBridge(quickBatch(chat, busyReply, origin && isGroup(chat) ? origin.u : undefined));
    trace(chat, 'L2', 'followup_queued', { queued: true }, undefined, { req_id: rid });
    return;
  }
  setLease(chat, true);
  taskStart({ chat, reqId: rid, prompt: promptText, persona, startedAt: Date.now() });
  trace(chat, 'L2', 'task_start', { persona: persona.id, workspace: getSession(chat).workspace }, undefined, { req_id: rid, source: rid.startsWith('cron_') ? 'cron' : 'wx' });

  try {
    const workspace = getSession(chat).workspace;
    const result = await dshManager.prompt(promptText, {
      chatId: chat,
      workspace: workspace !== config.dsh.defaultCwd ? workspace : undefined,
    });
    trace(chat, 'L2', 'dsh_done', { ok: result.ok, tools: result.tools.length, ms: result.durationMs, model: result.modelUsed }, result.durationMs, { req_id: rid });

    const replyText = result.ok
      ? result.text || '（任务完成，无文本输出）'
      : `任务失败：${result.error || '未知错误'}`;

    if (origin) {
      dialogManager.appendTurn(chat, {
        role: 'user',
        content: origin.t,
        sender: origin.n || origin.u,
        timestamp: Date.now(),
        imgPath: origin.img,
      });
      dialogManager.appendTurn(chat, {
        role: 'assistant',
        content: replyText,
        timestamp: Date.now(),
      });
    }

    const formattedReply = origin
      ? formatQuoteReply({
          senderName: origin.n || origin.u,
          sourceText: origin.t,
          replyText,
          isGroup: isGroup(chat),
        })
      : replyText;

    const atU = origin && isGroup(chat) && origin.at ? origin.u : undefined;
    const batch = buildOutboundBatch(chat, formattedReply, atU);
    await sendToBridge(batch);
    trace(chat, 'L3', 'sync_out', { chunks: batch.seq.length }, undefined, { req_id: rid });
    auditFull({ type: 'task_reply', chat, req_id: rid, persona: persona.id, ok: result.ok, tools: result.tools.length, reply_head: replyText.slice(0, 400), ts: Date.now() });

    if (result.ok && origin) {
      void historian(chat, origin, promptText.slice(-1200), result.text);
    }
  } finally {
    setLease(chat, false);
    taskEnd();
    const next = queuedFollowups.get(chat);
    if (next) {
      queuedFollowups.delete(chat);
      queueMicrotask(() => {
        void runTaskCore(next.chat, next.promptText, next.memories, next.persona, next.rid, next.origin);
      });
    }
  }
}

export async function receiveInbound(pkt: WxInboundPkt): Promise<void> {
  const t0 = Date.now();
  pkt.rid = pkt.rid ?? `${pkt.u === 'system_cron' ? 'cron' : 'wx'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  touchSession(pkt.c);
  trace(pkt.c, 'L0', 'inbound', { u: pkt.u, at: pkt.at, t: pkt.t.slice(0, 80), img: !!pkt.img }, Date.now() - t0, { req_id: pkt.rid, source: pkt.u === 'system_cron' ? 'cron' : 'wx' });
  auditFull({ type: 'inbound', req_id: pkt.rid, chat: pkt.c, from: pkt.u, text: pkt.t, img: pkt.img, at: pkt.at, ts: Date.now() });

  const systemCron = pkt.u === 'system_cron';
  const isOp = config.adminWxids.includes(pkt.u);
  const group = isGroup(pkt.c);
  const sess = getSession(pkt.c);

  if (!systemCron && isTestOrSystemChat(pkt.c)) {
    trace(pkt.c, 'L0', 'test_system_chat_dropped', { c: pkt.c, u: pkt.u });
    return;
  }

  if (!systemCron && !isOp) {
    if (isBlocked(pkt.u) || isBlocked(pkt.c)) {
      trace(pkt.c, 'L0', 'blocked_target_dropped', { u: pkt.u, c: pkt.c });
      return;
    }
  }

  if (!systemCron && group) {
    touchMemberProfile(pkt.c, pkt.u, pkt.n);
  }

  const hardMatch = matchHardCommand(pkt.t);
  if (hardMatch) {
    const cmdDef = HARD_COMMANDS[hardMatch.cmdName];
    if (cmdDef.opOnly && !isOp) {
      trace(pkt.c, 'L0', 'op_cmd_rejected', { cmd: hardMatch.cmdName, u: pkt.u }, undefined, { req_id: pkt.rid });
      const opReply = formatQuoteReply({
        senderName: pkt.n || pkt.u,
        sourceText: pkt.t,
        replyText: '🔒 [权限限制] 该控制指令仅供系统管理员 (OP) 执行。',
        isGroup: group,
      });
      await sendToBridge(quickBatch(pkt.c, opReply, group ? pkt.u : undefined));
      return;
    }

    trace(pkt.c, 'L0', 'hard_command_executed', { cmd: hardMatch.cmdName, arg: hardMatch.arg.slice(0, 80) }, undefined, { req_id: pkt.rid });
    await cmdDef.execute({
      pkt,
      arg: hardMatch.arg,
      isOp,
      atU: group && pkt.at ? pkt.u : undefined,
      send: (text) => {
        const quoted = formatQuoteReply({
          senderName: pkt.n || pkt.u,
          sourceText: pkt.t,
          replyText: text,
          isGroup: group,
        });
        return sendToBridge(quickBatch(pkt.c, quoted, group && pkt.at ? pkt.u : undefined));
      },
      runTaskReplay: (chat, prompt, rid) => runReplay(chat, prompt, rid),
      getWindowHistory: (sk) => getWindowPackets(sk),
    });
    return;
  }

  if (!systemCron) {
    const toxicCheck = isPromptInjectionOrToxic(pkt.t);
    if (toxicCheck.blocked) {
      trace(pkt.c, 'L0', 'injection_blocked', { u: pkt.u, text: pkt.t.slice(0, 80) }, undefined, { req_id: pkt.rid, risk_flag: 1 });
      const toxicReply = formatQuoteReply({
        senderName: pkt.n || pkt.u,
        sourceText: pkt.t,
        replyText: `🛡️ [安全拦截] ${toxicCheck.reason || '输入含有未授权指令，已被系统安全层拦截。'}`,
        isGroup: group,
      });
      await sendToBridge(quickBatch(pkt.c, toxicReply, group ? pkt.u : undefined));
      return;
    }
  }

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
  }

  if (sess.mode === 'mute') {
    trace(pkt.c, 'L0', 'mode_mute_skip', { u: pkt.u });
    return;
  }

  if (sess.mode === 'sentry') {
    pushToSentry(pkt);
    trace(pkt.c, 'L0', 'mode_sentry_ingest', { u: pkt.u });
    return;
  }

  if (!systemCron) {
    if (!group && config.adminWxids.length && !isOp) {
      trace(pkt.c, 'L0', 'auth_rejected', { u: pkt.u }, undefined, { req_id: pkt.rid });
      return;
    }
    if (group && !pkt.at) {
      dialogManager.recordGroupBackground(pkt.c, pkt.n || pkt.u, pkt.t);
      return;
    }
  }

  pushToWindow(pkt, (pkts) => void onWindowFlush(pkts));
}

async function onWindowFlush(pkts: WxInboundPkt[]): Promise<void> {
  const last = pkts[pkts.length - 1];
  const chat = last.c;
  const isGrp = isGroup(chat);
  const sessionKey = getSessionKey(last);
  const rid = last.rid ?? `wx_${Date.now()}`;
  const busy = dshManager.busy() || getLease(chat);
  const compactHistory = toCompactLines(pkts);
  const isOp = config.adminWxids.includes(last.u);
  const currentImg = pkts.slice().reverse().find((p) => p.img)?.img;

  const persona = getPersona(last.persona_id || getSession(chat).persona_id, isOp, chat);
  const memories = await prefetchMemories(pkts, persona);
  const memberTag = isGrp ? formatMemberProfileContext(chat, last.u, last.n) : '';
  const historyTurns = dialogManager.getTurns(chat);
  const groupBg = isGrp ? dialogManager.getGroupBackground(chat) : '';

  if (persona.engine_mode === 'l1_only') {
    const t = Date.now();
    const memBlock = memories.length
      ? memories.map((m, i) => `${i + 1}. [${m.created_at ? m.created_at.slice(0, 10) : '近期'}] ${m.content.slice(0, 300)}`).join('\n')
      : '（无命中）';
    const personaWithAging = `${persona.sys_prompt}\n\n【时效与记忆仲裁规则】：\n1. 历史记忆仅供参考。当记忆与用户当前给出的上下文/代码冲突时，以最新事实为准。\n2. 若存在标有 [CURRENT] 的项目状态，以该状态为最新方案。旧方案视为已废弃，不要主动提及。`;

    const promptParts = [
      `[历史记忆参考]\n${memBlock}`,
      memberTag ? `[提问者身份信息]\n${memberTag}` : '',
      groupBg ? `[群聊近期背景流水（仅供环境话题参考，并非直接向你提问）]\n${groupBg}` : '',
      `[用户当前对话]\n${compactHistory}`,
    ].filter(Boolean).join('\n\n');

    const reply = await directChat(
      promptParts,
      personaWithAging,
      currentImg,
      historyTurns.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        chatId: chat,
        senderWxid: last.u,
        senderName: last.n || last.u,
        isGroup: isGrp,
        isAdmin: isOp,
        allowedToolNames: persona.allowed_mcp_tools,
      }
    );

    dialogManager.appendTurn(chat, {
      role: 'user',
      content: last.t,
      sender: last.n || last.u,
      timestamp: Date.now(),
      imgPath: currentImg,
    });
    dialogManager.appendTurn(chat, {
      role: 'assistant',
      content: reply,
      timestamp: Date.now(),
    });

    const formattedReply = formatQuoteReply({
      senderName: last.n || last.u,
      sourceText: last.t,
      replyText: reply,
      isGroup: isGrp,
    });

    await sendToBridge(quickBatch(chat, formattedReply, isGrp ? last.u : undefined));
    trace(chat, 'L1', 'persona_direct', { persona: persona.id, sessionKey }, Date.now() - t, { req_id: rid, source: rid.startsWith('cron_') ? 'cron' : 'wx' });
    return;
  }

  const t1 = Date.now();
  const { decision, provider, imgDesc } = await routeMessage(compactHistory, busy, currentImg);
  trace(chat, 'L1', 'route', { decision, provider, imgDesc: imgDesc || undefined, sessionKey }, Date.now() - t1, { req_id: rid });

  switch (decision.s) {
    case 'W':
      extendWindow(sessionKey, (p) => void onWindowFlush(p));
      trace(chat, 'L1', 'wait_more', { sessionKey });
      return;
    case 'X': {
      await dshManager.cancel();
      queuedFollowups.delete(chat);
      setLease(chat, false);
      const xReply = formatQuoteReply({
        senderName: last.n || last.u,
        sourceText: last.t,
        replyText: '已中断当前任务。',
        isGroup: isGrp,
      });
      await sendToBridge(quickBatch(chat, xReply, isGrp ? last.u : undefined));
      return;
    }
    case 'T': {
      const reply = decision.r || '在的，请讲。';
      dialogManager.appendTurn(chat, {
        role: 'user',
        content: last.t,
        sender: last.n || last.u,
        timestamp: Date.now(),
      });
      dialogManager.appendTurn(chat, {
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      });
      const formattedReply = formatQuoteReply({
        senderName: last.n || last.u,
        sourceText: last.t,
        replyText: reply,
        isGroup: isGrp,
      });
      await sendToBridge(quickBatch(chat, formattedReply, isGrp ? last.u : undefined));
      trace(chat, 'L1', 'chitchat_direct', { provider });
      return;
    }
    case 'R': {
      const reply =
        decision.r ||
        '这个任务规模有点大，一口气跑完会烧掉不少额度。建议拆成小步骤分批发给我，每批一个明确的小任务，我逐个搞定。';
      const formattedReply = formatQuoteReply({
        senderName: last.n || last.u,
        sourceText: last.t,
        replyText: reply,
        isGroup: isGrp,
      });
      await sendToBridge(quickBatch(chat, formattedReply, isGrp ? last.u : undefined));
      trace(chat, 'L1', 'refuse_quota_guard', { provider, c: decision.c }, undefined, {
        req_id: rid,
        risk_flag: 1,
      });
      return;
    }
    case 'S':
      if (dshManager.busy()) {
        await runTask(pkts, last, imgDesc);
        return;
      }
      break;
    case 'C':
      break;
  }

  await runTask(pkts, last, imgDesc);
}

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
      persona_id: job.persona_id,
    };
    await receiveInbound(pkt);
  });
}

export function gatewayStatus() {
  return {
    buffers: listBufferKeys(),
    dsh: dshManager.procInfo(),
    busy: dshManager.busy(),
    admin: config.adminWxids,
    personas: listPersonas().map((p) => ({ id: p.id, mode: p.engine_mode, shell: p.allow_shell })),
    jobs: listJobs().filter((j) => j.enabled === 1).map((j) => ({ id: j.id, next: j.run_at, cron: j.cron_expr })),
  };
}

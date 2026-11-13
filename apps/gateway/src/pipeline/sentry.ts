import { trace } from '../db.js';
import { analyzeSentryTranscript } from '../llm.js';
import { remember } from '../mnemosyne.js';
import { toCompactLines, type WxInboundPkt } from '../protocol.js';
import { notifyOp } from './bridge-io.js';

interface SentryBuf {
  pkts: WxInboundPkt[];
  timer: NodeJS.Timeout;
}

const sentryBuffers = new Map<string, SentryBuf>();
const SENTRY_FLUSH_INTERVAL_MS = 60_000;

export function pushToSentry(pkt: WxInboundPkt): void {
  let buf = sentryBuffers.get(pkt.c);
  if (!buf) {
    buf = { pkts: [], timer: null as unknown as NodeJS.Timeout };
    sentryBuffers.set(pkt.c, buf);
  }
  buf.pkts.push(pkt);

  if (buf.pkts.length >= 8) {
    void flushSentry(pkt.c);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => void flushSentry(pkt.c), SENTRY_FLUSH_INTERVAL_MS);
  buf.timer.unref?.();
}

export async function flushSentry(chatId: string): Promise<void> {
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

// ===== 切面一：wxbridge ⇄ Gateway 扁平协议（唯一契约源：@feagle/protocol） =====
export type {
  WxInboundPkt,
  WxOutboundItem,
  WxOutboundBatch,
  RouteSignal,
  CompactRouteDecision,
  MemoryHit,
  TraceEntry,
  DshRuntimeHealth,
  GatewayHealthStatus,
} from '@feagle/protocol';

import type { WxInboundPkt } from '@feagle/protocol';

// ===== 方案 C 核心：智能 SessionKey 规范 =====
// 群聊：以 用户ID@群ID 复合隔离（群内各人独立栈，杜绝张三李四串话与租约互锁）
// 私聊：以 用户ID 为唯一键（随身背包穿透，私聊延续个人全量状态）
export const getSessionKey = (pkt: { c: string; u: string }): string =>
  pkt.c.endsWith('@chatroom') ? `${pkt.u}@${pkt.c}` : pkt.u;

// ===== 切面二：剧本行压缩（喂给 LLM 的历史缓冲，省 ~45% 输入 token） =====
export const toCompactLines = (pkts: WxInboundPkt[]): string =>
  pkts
    .map((p) => {
      let text = p.t || '';
      if (text.includes('<msg><img') || text.includes('cdnthumburl')) {
        text = text.replace(/<msg><img[\s\S]*?<\/msg>/g, '[图片]');
      }
      const q = p.q ? `(引:"${p.q.slice(0, 20)}")` : '';
      return `${p.n}${q}: ${p.img ? '[图]' : ''}${text}`;
    })
    .join('\n');

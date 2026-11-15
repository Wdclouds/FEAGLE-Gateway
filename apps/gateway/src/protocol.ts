// ===== 切面一：wxbridge ⇄ Gateway 扁平协议 =====
export interface WxInboundPkt {
  id: string;            // 消息唯一 ID（bridge 生成，用于去重）
  c: string;             // chat_id（以 @chatroom 结尾即为群聊）
  u: string;             // 发言人 wxid
  n: string;             // 发言人昵称
  at: 0 | 1;             // 是否 @ 机器人（Bridge 层已洗掉文本里的 @名字）
  t: string;             // 纯净文本
  img?: string;          // 图片本地路径/URL（喂给多模态路由）
  q?: string;            // 引用消息拍平文本
  ts?: number;           // bridge 侧时间戳
  rid?: string;          // 网关侧 Turn 追踪 ID（req_id，审计串联用，bridge 无需传）
  persona_id?: string;   // 指定人设（cron 任务用；缺省用会话当前人设）
}

export interface WxOutboundItem {
  t?: string;
  img?: string;
  d: number;             // 延迟毫秒（bridge 按此间隔依次发出，拟人防风控）
}

export interface WxOutboundBatch {
  c: string;             // 目标 chat_id
  at_u?: string;         // 群聊中需要 @ 的 wxid
  seq: WxOutboundItem[];
}

// ===== 方案 C 核心：智能 SessionKey 规范 =====
// 群聊：以 用户ID@群ID 复合隔离（群内各人独立栈，杜绝张三李四串话与租约互锁）
// 私聊：以 用户ID 为唯一键（随身背包穿透，私聊延续个人全量状态）
export const getSessionKey = (pkt: { c: string; u: string }): string =>
  pkt.c.endsWith('@chatroom') ? `${pkt.u}@${pkt.c}` : pkt.u;

// ===== 切面二：剧本行压缩（喂给 LLM 的历史缓冲，省 ~45% 输入 token） =====
export const toCompactLines = (pkts: WxInboundPkt[]): string =>
  pkts
    .map(
      (p) => {
        let text = p.t || '';
        if (text.includes('<msg><img') || text.includes('cdnthumburl')) {
          text = text.replace(/<msg><img[\s\S]*?<\/msg>/g, '[图片]');
        }
        const q = p.q ? `(引:"${p.q.slice(0, 20)}")` : '';
        return `${p.n}${q}: ${p.img ? '[图]' : ''}${text}`;
      }
    )
    .join('\n');

// ===== 切面三：Llama-90B 单字母路由决策（省 70% 输出 token） =====
export type RouteSignal = 'W' | 'S' | 'X' | 'T' | 'C' | 'R'; // Wait | Steer | Cancel | Talk | Coding | Refuse(额度保护拒单)

export interface CompactRouteDecision {
  s: RouteSignal;
  c: number;             // Confidence 0.0~1.0（< 0.75 时网关强制扩大记忆检索范围）
  g?: string[];          // Mnemosyne 翼区/房间引导 (by_guide)
  q?: string;            // Mnemosyne 语义共鸣检索词
  r?: string | null;     // s==='T' 时直接生成简短中文回复，否则 null
}

// 检索命中的记忆条目（含时效半衰期与元数据）
export interface MemoryHit {
  id?: string | number;
  content: string;
  category?: string;
  hall?: string;
  score?: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
  effectiveScore?: number; // 经时间半衰期衰减后的最终排序得分
  isExpired?: boolean;     // 是否被判定为过时淘汰
}

// 全链路追踪日志条目
export interface TraceEntry {
  ts: number;
  chat_id: string;
  layer: 'L0' | 'L1' | 'L2' | 'L3' | 'SYS';
  event: string;
  detail?: unknown;
  latency_ms?: number;
}

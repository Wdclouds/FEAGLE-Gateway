/**
 * FEAGLE Bridge ⇄ Gateway ⇄ Web Console Shared Protocol Contracts
 */

export interface WxInboundPkt {
  id: string;
  c: string;
  u: string;
  n: string;
  at: 0 | 1;
  t: string;
  img?: string;
  q?: string;
  ts?: number;
  rid?: string;
  persona_id?: string;
}

export interface WxOutboundItem {
  t?: string;
  img?: string;
  d: number;
}

export interface WxOutboundBatch {
  c: string;
  at_u?: string;
  seq: WxOutboundItem[];
}

export type RouteSignal = 'W' | 'S' | 'X' | 'T' | 'C' | 'R';

export interface CompactRouteDecision {
  s: RouteSignal;
  c: number;
  g?: string[];
  q?: string;
  r?: string | null;
}

export interface MemoryHit {
  id?: string | number;
  content: string;
  category?: string;
  hall?: string;
  score?: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
  effectiveScore?: number;
  isExpired?: boolean;
}

export interface TraceEntry {
  ts: number;
  chat_id: string;
  layer: 'L0' | 'L1' | 'L2' | 'L3' | 'SYS';
  event: string;
  detail?: unknown;
  latency_ms?: number;
}

export interface DshRuntimeHealth {
  alive: boolean;
  pid?: number;
  uptimeMs: number;
  cwd: string;
  engine: 'dsh-acp';
  provider: string;
  model: string;
  activeSessions: number;
}

export interface GatewayHealthStatus {
  ok: boolean;
  service: 'feagle-wx-gateway' | 'pi-wx-gateway';
  buffers?: string[];
  dsh?: DshRuntimeHealth;
  busy?: boolean;
  admin?: string[];
  inbound?: {
    received: number;
    parsed: number;
    last_id: string;
    last_at: number;
  };
  outbound?: {
    attempted: number;
    success: number;
    failed: number;
    last_at: number;
  };
  db: {
    sessions: number;
    traces: number;
  };
  uptime_s: number;
  rss_mb: number;
}

export interface ChannelSummary {
  chatId: string;
  name?: string;
  tools: string[];
  memberCount: number;
  hasPersona: boolean;
  hasRules: boolean;
}

export interface ChannelSandboxDetail {
  chatId: string;
  name?: string;
  dir: string;
  personaText: string;
  rulesText: string;
  tools: string[];
  memberCount: number;
}

export interface MemberProfile {
  name: string;
  role?: string;
  tags?: string[];
  notes?: string;
  interactions: number;
  lastSeen: number;
}

export type MemberProfilesMap = Record<string, MemberProfile>;

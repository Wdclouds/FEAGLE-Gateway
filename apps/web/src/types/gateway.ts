export interface GatewayHealthStatus {
  ok: boolean;
  service: 'pi-wx-gateway';
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

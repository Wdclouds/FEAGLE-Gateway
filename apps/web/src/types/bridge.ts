export type WechatStatus =
  | 'STARTING' | 'CONNECTING' | 'RESTORING' | 'WAITING_SCAN'
  | 'WAITING_AGENT' | 'WAITING_HOOK' | 'WAITING' | 'LISTENING'
  | 'STOPPED' | 'SCANNED' | 'ONLINE' | 'CONNECTED' | 'READY'
  | 'RUNNING' | 'ACTIVE' | 'TEST' | 'SLEEPING' | 'PAUSED'
  | 'MANUAL_OFFLINE' | 'LOGGING_OUT' | 'LOGGED_OUT' | 'DISCONNECTED'
  | 'DISABLED' | 'WAITING_BIND' | 'BOUND' | 'UNBOUND' | 'DEGRADED'
  | 'RECOVERING' | 'ERROR' | 'EXITED' | 'UNKNOWN' | 'HEALTHY'
  | 'STALE' | 'FAILED' | 'OFFLINE';

export type WechatAdminMode = 'RUNNING' | 'PAUSED' | 'MANUAL_OFFLINE';
export type GroupChatMode = 'OFF' | 'OBSERVE' | 'MENTION_ONLY';

export interface WechatState {
  status: WechatStatus;
  adminMode: WechatAdminMode;
  adminModeChangedAt?: string;
  account: string;
  detail: string;
  qrDataUrl?: string;
  qrCreatedAt?: string;
  protocolHealth: string;
  lastSyncAt: string;
  syncAgeMs: number | null;
  syncErrors: number;
  consecutiveSyncErrors: number;
  recoveryAttempts: number;
  lastRecoveryAt: string;
  lastDisconnectAt: string;
  lastDisconnectReason: string;
  reloginTestStatus: string;
  reloginTestStartedAt: string;
  reloginTestCompletedAt: string;
  reloginTestDetail: string;
  degradedAfterMs: number;
  fatalAfterMs: number;
}

export interface AndroidState {
  serverStatus: 'ACTIVE' | 'DISABLED' | 'WAITING' | string;
  endpoint: string;
  deviceStatus: 'CONNECTED' | 'DISCONNECTED' | 'WAITING_SCAN' | string;
  hookConnected: boolean;
  deviceIdMasked: string;
  lastHeartbeatAt: string;
  heartbeatAgeMs: number | null;
  pendingCommands: number;
  heartbeatTimeoutMs: number;
}

export interface GroupChatDiscovered {
  groupId: string;
  name: string;
  memberCount: number;
  lastSeenAt: string;
  mode: GroupChatMode;
}

export interface GroupChatState {
  mode: GroupChatMode;
  allowlist: string[];
  blockedTerms: string[];
  groupModes: Record<string, GroupChatMode>;
  discovered?: GroupChatDiscovered[];
  fuses: string[];
  jitterMinMs: number;
  jitterMaxMs: number;
  observed: number;
  forwarded: number;
  replied: number;
  blocked: number;
  policyBlocked: number;
  rateLimited: number;
  fused: number;
  lastMessageAt: string;
}

export interface ScheduleState {
  mode: 'ACTIVE' | 'SLEEPING' | string;
  testMode: boolean;
  timezone: string;
  quietHours: string;
  sleepOverride?: boolean;
}

export interface PipelineCounters {
  received: number;
  forwarded: number;
  replied: number;
  dropped: number;
  blocked: number;
  failed: number;
}

export interface SelfAvatar {
  wxid: string;
  nickname: string;
  avatarBase64: string;
  avatarSize?: number;
  updatedAt?: string;
}

export interface BridgeStateSnapshot {
  startedAt: string;
  now?: string;
  botBackend?: string;
  wechat: WechatState;
  transport?: {
    active: 'wechat4u' | 'android';
    requested: 'wechat4u' | 'android';
    switching: boolean;
    restartRequired: boolean;
    detail: string;
  };
  selfAvatar?: SelfAvatar;
  android?: AndroidState;
  hermes?: { status: string; detail: string };
  onebot?: { status: string; detail: string; reconnects: number };
  groupChat: GroupChatState;
  schedule: ScheduleState;
  counters: PipelineCounters;
  errors?: Array<{ time: string; source: string; message: string }>;
}

export interface PairCodeResponse {
  endpoint: string;
  downloadUrl: string;
  downloadQrDataUrl: string;
  lanzouUrl: string;
  lanzouPass: string;
  selectedIp: string;
  lanIps: string[];
  pairingCode?: string;
  expiresAt?: number;
  timestamp: number;
  qrDataUrl: string;
  deviceStatus: string;
}

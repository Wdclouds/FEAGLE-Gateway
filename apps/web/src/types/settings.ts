export interface BridgeSettings {
  transport: 'wechat4u' | 'android';
  quietHours: string;
  timezone: string;
  userRateLimit: number;
  userRateWindowMs: number;
  globalRateLimit: number;
  globalRateWindowMs: number;
  maxInFlight: number;
  maxInFlightPerUser: number;
  groupReplyCooldownMs: number;
  groupReplyMaxChars: number;
  groupJitterMinMs: number;
  groupJitterMaxMs: number;
  groupMemberRateLimit: number;
  groupMemberRateWindowMs: number;
  groupRateLimit: number;
  groupRateWindowMs: number;
}

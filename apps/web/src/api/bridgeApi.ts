import { request } from './client';
import type { BridgeStateSnapshot, PairCodeResponse, WechatAdminMode, GroupChatMode } from '../types/bridge';
import type { BridgeSettings } from '../types/settings';

export const bridgeApi = {
  getStatus(): Promise<BridgeStateSnapshot> {
    return request<BridgeStateSnapshot>('/api/status');
  },

  getPairCode(ip?: string): Promise<PairCodeResponse> {
    const query = ip ? `?ip=${encodeURIComponent(ip)}` : '';
    return request<PairCodeResponse>(`/api/device/pair-code${query}`);
  },

  getSettings(): Promise<{ settings: BridgeSettings }> {
    return request<{ settings: BridgeSettings }>('/api/settings');
  },

  updateSettings(settings: Partial<BridgeSettings>): Promise<{ settings: BridgeSettings }> {
    return request<{ settings: BridgeSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  setAdminMode(mode: WechatAdminMode, confirm?: string): Promise<BridgeStateSnapshot> {
    return request<BridgeStateSnapshot>('/api/wechat/admin-mode', {
      method: 'POST',
      body: JSON.stringify({ mode, confirm }),
    });
  },

  setScheduleOverride(override: boolean): Promise<BridgeStateSnapshot> {
    return request<BridgeStateSnapshot>('/api/test-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled: override }),
    });
  },

  setGroupMode(talker: string, mode: GroupChatMode): Promise<BridgeStateSnapshot> {
    return request<BridgeStateSnapshot>('/api/group-chat/status', {
      method: 'POST',
      body: JSON.stringify({ talker, mode }),
    });
  },
};

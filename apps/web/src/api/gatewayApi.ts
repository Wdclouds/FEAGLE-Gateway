import { request } from './client';
import type { GatewayHealthStatus, ChannelSummary, ChannelSandboxDetail, MemberProfilesMap, MemberProfile } from '../types/gateway';
import type { ToolDefinition } from '../types/tools';

export const gatewayApi = {
  getHealth(): Promise<GatewayHealthStatus> {
    return request<GatewayHealthStatus>('/api/gateway/health');
  },

  getTools(): Promise<{ ok: boolean; tools: ToolDefinition[] }> {
    return request<{ ok: boolean; tools: ToolDefinition[] }>('/api/tools');
  },

  createCustomTool(data: { name: string; description: string; parameters?: any; endpoint?: string }): Promise<{ ok: boolean; tool: ToolDefinition }> {
    return request<{ ok: boolean; tool: ToolDefinition }>('/api/tools', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteTool(name: string): Promise<{ ok: boolean; message: string }> {
    return request<{ ok: boolean; message: string }>(`/api/tools/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  getChannels(): Promise<{ ok: boolean; channels: ChannelSummary[] }> {
    return request<{ ok: boolean; channels: ChannelSummary[] }>('/api/channels');
  },

  createChannelSandbox(data: { chatId: string; name?: string; personaText?: string; rulesText?: string; tools?: string[] }): Promise<{ ok: boolean; chatId: string; sandbox: ChannelSandboxDetail }> {
    return request<{ ok: boolean; chatId: string; sandbox: ChannelSandboxDetail }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteChannelSandbox(chatId: string): Promise<{ ok: boolean; chatId: string }> {
    return request<{ ok: boolean; chatId: string }>(`/api/channels/${encodeURIComponent(chatId)}`, {
      method: 'DELETE',
    });
  },

  getChannelSession(chatId: string): Promise<{ ok: boolean; chatId: string; remainingTtlSec: number; turns: Array<{ role: string; content: string; sender?: string; timestamp: number }> }> {
    return request<{ ok: boolean; chatId: string; remainingTtlSec: number; turns: Array<{ role: string; content: string; sender?: string; timestamp: number }> }>(`/api/channels/${encodeURIComponent(chatId)}/session`);
  },

  resetChannelSession(chatId: string): Promise<{ ok: boolean; chatId: string; reset: boolean }> {
    return request<{ ok: boolean; chatId: string; reset: boolean }>(`/api/channels/${encodeURIComponent(chatId)}/session/reset`, {
      method: 'POST',
    });
  },

  getChannelBackground(chatId: string): Promise<{ ok: boolean; chatId: string; backgroundText: string }> {
    return request<{ ok: boolean; chatId: string; backgroundText: string }>(`/api/channels/${encodeURIComponent(chatId)}/background`);
  },

  getChannelSandbox(chatId: string): Promise<{ ok: boolean; sandbox: ChannelSandboxDetail }> {
    return request<{ ok: boolean; sandbox: ChannelSandboxDetail }>(`/api/channels/${encodeURIComponent(chatId)}`);
  },

  updateChannelSandbox(chatId: string, data: { name?: string; personaText?: string; rulesText?: string; tools?: string[] }): Promise<{ ok: boolean; sandbox: ChannelSandboxDetail }> {
    return request<{ ok: boolean; sandbox: ChannelSandboxDetail }>(`/api/channels/${encodeURIComponent(chatId)}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getChannelMembers(chatId: string): Promise<{ ok: boolean; chatId: string; members: MemberProfilesMap }> {
    return request<{ ok: boolean; chatId: string; members: MemberProfilesMap }>(`/api/channels/${encodeURIComponent(chatId)}/members`);
  },

  updateMemberProfile(chatId: string, wxid: string, profile: { role?: string; tags?: string[]; notes?: string }): Promise<{ ok: boolean; chatId: string; wxid: string; profile: MemberProfile }> {
    return request<{ ok: boolean; chatId: string; wxid: string; profile: MemberProfile }>(`/api/channels/${encodeURIComponent(chatId)}/members/${encodeURIComponent(wxid)}`, {
      method: 'POST',
      body: JSON.stringify(profile),
    });
  },
};

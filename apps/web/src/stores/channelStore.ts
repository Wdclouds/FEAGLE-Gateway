import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ChannelSummary, ChannelSandboxDetail, MemberProfilesMap, MemberProfile } from '../types/gateway';
import { gatewayApi } from '../api/gatewayApi';

export const useChannelStore = defineStore('channel', () => {
  const channels = ref<ChannelSummary[]>([]);
  const activeSandbox = ref<ChannelSandboxDetail | null>(null);
  const activeMembers = ref<MemberProfilesMap | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchChannels() {
    loading.value = true;
    try {
      const res = await gatewayApi.getChannels();
      channels.value = res.channels || [];
      error.value = null;
    } catch (err: any) {
      error.value = err?.message || 'Failed to fetch channels';
    } finally {
      loading.value = false;
    }
  }

  async function loadSandbox(chatId: string) {
    loading.value = true;
    try {
      const res = await gatewayApi.getChannelSandbox(chatId);
      activeSandbox.value = res.sandbox;
      return res.sandbox;
    } finally {
      loading.value = false;
    }
  }

  async function saveSandbox(chatId: string, data: { name?: string; personaText?: string; rulesText?: string; tools?: string[] }) {
    loading.value = true;
    try {
      const res = await gatewayApi.updateChannelSandbox(chatId, data);
      activeSandbox.value = res.sandbox;
      await fetchChannels();
      return res.sandbox;
    } finally {
      loading.value = false;
    }
  }

  async function createSandbox(data: { chatId: string; name?: string; personaText?: string; rulesText?: string; tools?: string[] }) {
    loading.value = true;
    try {
      const res = await gatewayApi.createChannelSandbox(data);
      await fetchChannels();
      return res.sandbox;
    } finally {
      loading.value = false;
    }
  }

  async function deleteSandbox(chatId: string) {
    loading.value = true;
    try {
      const res = await gatewayApi.deleteChannelSandbox(chatId);
      await fetchChannels();
      return res.ok;
    } finally {
      loading.value = false;
    }
  }

  async function getSession(chatId: string) {
    return await gatewayApi.getChannelSession(chatId);
  }

  async function resetSession(chatId: string) {
    return await gatewayApi.resetChannelSession(chatId);
  }

  async function getBackground(chatId: string) {
    return await gatewayApi.getChannelBackground(chatId);
  }

  async function loadMembers(chatId: string) {
    loading.value = true;
    try {
      const res = await gatewayApi.getChannelMembers(chatId);
      activeMembers.value = res.members || {};
      return res.members;
    } finally {
      loading.value = false;
    }
  }

  async function updateMember(chatId: string, wxid: string, profile: { role?: string; tags?: string[]; notes?: string }) {
    loading.value = true;
    try {
      const res = await gatewayApi.updateMemberProfile(chatId, wxid, profile);
      if (activeMembers.value) {
        activeMembers.value[wxid] = res.profile;
      }
      return res.profile;
    } finally {
      loading.value = false;
    }
  }

  return {
    channels,
    activeSandbox,
    activeMembers,
    loading,
    error,
    fetchChannels,
    loadSandbox,
    saveSandbox,
    createSandbox,
    deleteSandbox,
    getSession,
    resetSession,
    getBackground,
    loadMembers,
    updateMember,
  };
});

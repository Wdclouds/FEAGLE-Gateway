import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { BridgeStateSnapshot, WechatAdminMode, GroupChatMode } from '../types/bridge';
import { bridgeApi } from '../api/bridgeApi';
import { SseStream } from '../api/sse';

export const useBridgeStore = defineStore('bridge', () => {
  const snapshot = ref<BridgeStateSnapshot | null>(null);
  const isConnected = ref(false);
  const lastError = ref<string | null>(null);

  let eventStream: SseStream<BridgeStateSnapshot> | null = null;

  async function fetchStatus() {
    try {
      const data = await bridgeApi.getStatus();
      snapshot.value = data;
      isConnected.value = true;
      lastError.value = null;
    } catch (err: any) {
      isConnected.value = false;
      lastError.value = err?.message || 'Failed to fetch status';
    }
  }

  function initSse() {
    if (eventStream) return;
    eventStream = new SseStream<BridgeStateSnapshot>('/events');
    eventStream.subscribe((data) => {
      if (data && typeof data === 'object') {
        snapshot.value = data;
        isConnected.value = true;
        lastError.value = null;
      }
    });
  }

  async function setAdminMode(mode: WechatAdminMode, confirm?: string) {
    const updated = await bridgeApi.setAdminMode(mode, confirm);
    snapshot.value = updated;
  }

  async function setScheduleOverride(override: boolean) {
    const updated = await bridgeApi.setScheduleOverride(override);
    snapshot.value = updated;
  }

  async function setGroupMode(talker: string, mode: GroupChatMode) {
    const updated = await bridgeApi.setGroupMode(talker, mode);
    snapshot.value = updated;
  }

  return {
    snapshot,
    isConnected,
    lastError,
    fetchStatus,
    initSse,
    setAdminMode,
    setScheduleOverride,
    setGroupMode,
  };
});

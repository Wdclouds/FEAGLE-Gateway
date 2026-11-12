import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { GatewayHealthStatus } from '../types/gateway';
import { gatewayApi } from '../api/gatewayApi';

export const useGatewayStore = defineStore('gateway', () => {
  const health = ref<GatewayHealthStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchHealth() {
    loading.value = true;
    try {
      const res = await gatewayApi.getHealth();
      health.value = res;
      error.value = null;
    } catch (err: any) {
      error.value = err?.message || 'Gateway offline';
    } finally {
      loading.value = false;
    }
  }

  return {
    health,
    loading,
    error,
    fetchHealth,
  };
});

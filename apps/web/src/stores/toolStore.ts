import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ToolDefinition } from '../types/tools';
import { gatewayApi } from '../api/gatewayApi';

export const useToolStore = defineStore('tool', () => {
  const tools = ref<ToolDefinition[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchTools() {
    loading.value = true;
    try {
      const res = await gatewayApi.getTools();
      tools.value = res.tools || [];
      error.value = null;
    } catch (err: any) {
      error.value = err?.message || 'Failed to fetch tools';
    } finally {
      loading.value = false;
    }
  }

  async function addCustomTool(data: { name: string; description: string; endpoint?: string }) {
    loading.value = true;
    try {
      const res = await gatewayApi.createCustomTool(data);
      await fetchTools();
      return res.tool;
    } finally {
      loading.value = false;
    }
  }

  async function removeTool(name: string) {
    loading.value = true;
    try {
      const res = await gatewayApi.deleteTool(name);
      await fetchTools();
      return res.ok;
    } finally {
      loading.value = false;
    }
  }

  return {
    tools,
    loading,
    error,
    fetchTools,
    addCustomTool,
    removeTool,
  };
});

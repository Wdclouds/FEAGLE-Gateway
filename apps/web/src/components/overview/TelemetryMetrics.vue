<script setup lang="ts">
import { computed } from 'vue';
import { useBridgeStore } from '../../stores/bridgeStore';

const bridgeStore = useBridgeStore();
const group = computed(() => bridgeStore.snapshot?.groupChat);

const metrics = computed(() => [
  { label: '消息观察', val: group.value?.observed || 0 },
  { label: '消息转发', val: group.value?.forwarded || 0 },
  { label: '智能体回复', val: group.value?.replied || 0 },
  { label: '常规拦截', val: group.value?.blocked || 0 },
  { label: '安全策略拦截', val: group.value?.policyBlocked || 0 },
  { label: '限流保护', val: group.value?.rateLimited || 0 },
  { label: '熔断降级', val: group.value?.fused || 0 },
]);
</script>

<template>
  <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 space-y-6 transition-colors shadow-xs">
    <div class="flex items-baseline justify-between border-b border-slate-100 dark:border-white/[0.04] pb-4">
      <h3 class="text-base font-semibold text-slate-900 dark:text-white">消息管道吞吐指标</h3>
      <span class="text-xs text-slate-400 dark:text-zinc-500">实时流水统计</span>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-6">
      <div
        v-for="m in metrics"
        :key="m.label"
        class="space-y-1"
      >
        <span class="text-xs text-slate-500 dark:text-zinc-400 block font-normal">{{ m.label }}</span>
        <span class="text-2xl font-bold font-mono text-slate-900 dark:text-white block">
          {{ m.val }}
        </span>
      </div>
    </div>
  </div>
</template>

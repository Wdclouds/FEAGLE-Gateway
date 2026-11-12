<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    status?: string;
    size?: 'sm' | 'md' | 'lg';
    pulse?: boolean;
  }>(),
  {
    status: 'online',
    size: 'md',
    pulse: true,
  }
);

const colorClass = computed(() => {
  const s = props.status?.toUpperCase() || '';
  if (['ONLINE', 'RUNNING', 'HEALTHY', 'ACTIVE', 'READY', 'CONNECTED'].includes(s)) {
    return 'bg-emerald-400 shadow-emerald-500/50';
  }
  if (['PAUSED', 'SLEEPING', 'WAITING_SCAN', 'WAITING', 'TEST', 'DEGRADED'].includes(s)) {
    return 'bg-amber-400 shadow-amber-500/50';
  }
  if (['DISCONNECTED', 'OFFLINE', 'ERROR', 'FAILED', 'MANUAL_OFFLINE'].includes(s)) {
    return 'bg-rose-500 shadow-rose-500/50';
  }
  return 'bg-sky-400 shadow-sky-500/50';
});

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'w-2 h-2';
  if (props.size === 'lg') return 'w-3.5 h-3.5';
  return 'w-2.5 h-2.5';
});
</script>

<template>
  <span class="relative inline-flex items-center justify-center">
    <span
      v-if="pulse"
      :class="[
        colorClass,
        sizeClass,
        'absolute inline-flex rounded-full opacity-75 animate-ping'
      ]"
    />
    <span
      :class="[
        colorClass,
        sizeClass,
        'relative inline-flex rounded-full shadow-sm'
      ]"
    />
  </span>
</template>

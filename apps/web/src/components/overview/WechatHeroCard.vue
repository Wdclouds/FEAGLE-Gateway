<script setup lang="ts">
import { computed } from 'vue';
import { useBridgeStore } from '../../stores/bridgeStore';
import StatusDot from '../common/StatusDot.vue';

const bridgeStore = useBridgeStore();

const wechat = computed(() => bridgeStore.snapshot?.wechat);
const status = computed(() => {
  const s = wechat.value?.status;
  if (s === 'ONLINE') return '在线';
  if (s === 'OFFLINE') return '离线';
  if (s === 'PAUSED') return '已暂停';
  return s || '未就绪';
});

const isOnline = computed(() => wechat.value?.status === 'ONLINE');
const nickname = computed(() => bridgeStore.snapshot?.selfAvatar?.nickname || wechat.value?.account || '未登录微信');
const account = computed(() => wechat.value?.account || '无');

const protocolHealth = computed(() => {
  const h = wechat.value?.protocolHealth;
  if (h === 'HEALTHY') return '健康';
  if (h === 'DEGRADED') return '降级';
  return '未检测';
});

const avatarUrl = computed(() => {
  const b64 = bridgeStore.snapshot?.selfAvatar?.avatarBase64;
  if (!b64) return '';
  return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
});

const syncAge = computed(() => {
  const ms = wechat.value?.syncAgeMs;
  if (ms === null || ms === undefined) return '正常';
  if (ms < 1000) return `${ms} 毫秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
});
</script>

<template>
  <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 sm:gap-8 transition-colors shadow-xs">
    <!-- 头像与核心身份 -->
    <div class="flex items-center gap-4 sm:gap-6">
      <div class="relative w-16 h-16 bg-slate-100 dark:bg-white/[0.04] overflow-hidden flex items-center justify-center flex-shrink-0 border border-slate-200 dark:border-white/[0.06]">
        <img v-if="avatarUrl" :src="avatarUrl" alt="头像" class="w-full h-full object-cover" />
        <span v-else class="text-xl font-bold text-slate-400 dark:text-zinc-500">WX</span>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{{ nickname }}</h2>
          <div class="flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-100 dark:bg-white/[0.06] text-xs font-medium">
            <StatusDot :status="wechat?.status || 'OFFLINE'" size="sm" :pulse="false" />
            <span :class="isOnline ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-500 dark:text-zinc-400'">{{ status }}</span>
          </div>
        </div>
        <p class="text-sm text-slate-600 dark:text-zinc-400">微信号：<span class="text-slate-900 dark:text-zinc-200 font-mono font-medium">{{ account }}</span></p>
        <p class="text-xs text-slate-400 dark:text-zinc-500">{{ wechat?.detail || '微信消息监听与转发链路就绪' }}</p>
      </div>
    </div>

    <!-- 运行指标（横向排布、留白充分、大字号清晰） -->
    <div class="grid grid-cols-3 gap-6 sm:gap-8 w-full md:w-auto pt-6 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-white/[0.06]">
      <div class="space-y-1">
        <span class="text-xs text-slate-400 dark:text-zinc-500 block">协议连接状态</span>
        <span
          class="text-lg font-semibold block"
          :class="protocolHealth === '健康' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'"
        >
          {{ protocolHealth }}
        </span>
      </div>

      <div class="space-y-1">
        <span class="text-xs text-slate-400 dark:text-zinc-500 block">消息同步延迟</span>
        <span class="text-lg font-semibold text-slate-800 dark:text-zinc-200 block font-mono">{{ syncAge }}</span>
      </div>

      <div class="space-y-1">
        <span class="text-xs text-slate-400 dark:text-zinc-500 block">链路重连次数</span>
        <span class="text-lg font-semibold text-slate-800 dark:text-zinc-200 block font-mono">
          {{ wechat?.recoveryAttempts || 0 }} 次
        </span>
      </div>
    </div>
  </div>
</template>

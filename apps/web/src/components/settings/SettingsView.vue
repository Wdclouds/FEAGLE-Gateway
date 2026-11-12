<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { bridgeApi } from '../../api/bridgeApi';
import type { BridgeSettings } from '../../types/settings';

const settings = ref<BridgeSettings>({
  transport: 'wechat4u',
  quietHours: '00:00-07:00',
  timezone: 'Asia/Shanghai',
  userRateLimit: 5,
  userRateWindowMs: 60000,
  globalRateLimit: 30,
  globalRateWindowMs: 60000,
  maxInFlight: 8,
  maxInFlightPerUser: 2,
  groupReplyCooldownMs: 5000,
  groupReplyMaxChars: 500,
  groupJitterMinMs: 1000,
  groupJitterMaxMs: 3000,
  groupMemberRateLimit: 5,
  groupMemberRateWindowMs: 60000,
  groupRateLimit: 20,
  groupRateWindowMs: 60000,
});

const isSaving = ref(false);
const isLoading = ref(true);

onMounted(async () => {
  try {
    const res = await bridgeApi.getSettings();
    if (res.settings) {
      settings.value = { ...settings.value, ...res.settings };
    }
  } catch (err: any) {
    console.error('Failed to load settings:', err);
  } finally {
    isLoading.value = false;
  }
});

async function saveSettings() {
  isSaving.value = true;
  try {
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(settings.value.quietHours)) {
      alert('休眠时段格式错误，应为 00:00-07:00 形式');
      return;
    }
    await bridgeApi.updateSettings(settings.value);
    alert('配置已成功保存。');
  } catch (err: any) {
    alert(`保存配置失败: ${err.message}`);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-8 max-w-5xl mx-auto">
    <!-- 顶部操作条 -->
    <div class="flex items-center justify-between pb-6 border-b border-slate-200 dark:border-white/[0.08]">
      <div>
        <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">系统参数与风控配置</h2>
        <p class="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          配置消息吞吐频率、休眠时段以及拟人化随机延迟参数。
        </p>
      </div>

      <button
        type="button"
        class="px-6 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium transition-colors shadow-xs"
        :disabled="isSaving"
        @click="saveSettings"
      >
        {{ isSaving ? '保存中...' : '保存配置' }}
      </button>
    </div>

    <!-- 配置表单区 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- 模块 1：时间计划 -->
      <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5 shadow-xs transition-colors">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-white/[0.04] pb-3">
          时间调度计划
        </h3>

        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">休眠静默时段</label>
          <input
            v-model="settings.quietHours"
            type="text"
            placeholder="00:00-07:00"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <p class="text-xs text-slate-400 dark:text-zinc-500 mt-1.5">在此时间区间内机器人将进入休眠状态不主动回复</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">系统时区</label>
          <input
            v-model="settings.timezone"
            type="text"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </div>
      </div>

      <!-- 模块 2：并发与限流 -->
      <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5 shadow-xs transition-colors">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-white/[0.04] pb-3">
          并发与流控
        </h3>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">最大并发请求数</label>
            <input
              v-model.number="settings.maxInFlight"
              type="number"
              min="1"
              max="50"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">单人并发上限</label>
            <input
              v-model.number="settings.maxInFlightPerUser"
              type="number"
              min="1"
              max="10"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">单人限流阈值</label>
            <input
              v-model.number="settings.userRateLimit"
              type="number"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">全局限流阈值</label>
            <input
              v-model.number="settings.globalRateLimit"
              type="number"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>
      </div>

      <!-- 模块 3：拟人风控延迟 -->
      <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5 md:col-span-2 shadow-xs transition-colors">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-white/[0.04] pb-3">
          群聊拟人风控与延迟
        </h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">回复冷却 (毫秒)</label>
            <input
              v-model.number="settings.groupReplyCooldownMs"
              type="number"
              step="500"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">单条回复最大字数</label>
            <input
              v-model.number="settings.groupReplyMaxChars"
              type="number"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">拟人延迟下限 (毫秒)</label>
            <input
              v-model.number="settings.groupJitterMinMs"
              type="number"
              step="200"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">拟人延迟上限 (毫秒)</label>
            <input
              v-model.number="settings.groupJitterMaxMs"
              type="number"
              step="500"
              class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm font-mono text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

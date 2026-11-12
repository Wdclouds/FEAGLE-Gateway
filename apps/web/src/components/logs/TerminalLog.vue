<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import { useLogStore, type LogEntry } from '../../stores/logStore';

const logStore = useLogStore();
const logContainer = ref<HTMLDivElement | null>(null);

onMounted(() => {
  logStore.initLogStream();
});

function scrollToBottom() {
  if (logStore.autoScroll && logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
}

watch(
  () => logStore.filteredLogs.length,
  () => {
    nextTick(scrollToBottom);
  }
);

function getLevelLabel(level: LogEntry['level']) {
  if (level === 'ERROR') return { text: '错误', color: 'text-rose-600 dark:text-rose-400' };
  if (level === 'WARN') return { text: '警告', color: 'text-amber-600 dark:text-amber-400' };
  if (level === 'INFO') return { text: '信息', color: 'text-blue-600 dark:text-blue-400' };
  if (level === 'SYS') return { text: '系统', color: 'text-purple-600 dark:text-purple-400' };
  return { text: '调试', color: 'text-slate-400 dark:text-zinc-500' };
}

function copyLogs() {
  const text = logStore.filteredLogs.map((l) => l.raw).slice(-50).join('\n');
  navigator.clipboard.writeText(text);
  alert('最近日志已复制。');
}
</script>

<template>
  <div class="flex flex-col h-full w-full flex-1 bg-slate-50 dark:bg-black transition-colors">
    <!-- 极简紧凑顶部控制条 -->
    <div class="px-4 py-2 border-b border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#050505] flex flex-wrap items-center justify-between gap-3 flex-shrink-0 transition-colors">
      <!-- 级别过滤与计数 -->
      <div class="flex items-center gap-3">
        <span class="text-xs font-mono text-slate-500 dark:text-zinc-400 select-none">
          {{ logStore.filteredLogs.length }} 行
        </span>

        <div class="inline-flex bg-slate-100 dark:bg-white/[0.04] p-0.5 text-xs">
          <button
            type="button"
            class="px-2 py-0.5 transition-colors"
            :class="logStore.filterLevel === 'ALL' ? 'bg-[var(--color-accent)] text-white font-medium' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            @click="logStore.filterLevel = 'ALL'"
          >
            全部
          </button>
          <button
            type="button"
            class="px-2 py-0.5 transition-colors"
            :class="logStore.filterLevel === 'INFO' ? 'bg-blue-600 text-white font-medium' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            @click="logStore.filterLevel = 'INFO'"
          >
            信息
          </button>
          <button
            type="button"
            class="px-2 py-0.5 transition-colors"
            :class="logStore.filterLevel === 'WARN' ? 'bg-amber-600 text-white font-medium' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            @click="logStore.filterLevel = 'WARN'"
          >
            警告
          </button>
          <button
            type="button"
            class="px-2 py-0.5 transition-colors"
            :class="logStore.filterLevel === 'ERROR' ? 'bg-rose-600 text-white font-medium' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            @click="logStore.filterLevel = 'ERROR'"
          >
            错误
          </button>
        </div>
      </div>

      <!-- 搜索与操作 -->
      <div class="flex items-center gap-2">
        <input
          v-model="logStore.searchKeyword"
          type="text"
          placeholder="搜索日志..."
          class="px-2.5 py-1 bg-slate-100 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-xs font-mono text-slate-900 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] w-36 sm:w-56"
        />

        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium transition-colors"
          :class="logStore.autoScroll ? 'bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-white/[0.1]' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'"
          @click="logStore.autoScroll = !logStore.autoScroll"
        >
          {{ logStore.autoScroll ? '自动滚动' : '已锁屏' }}
        </button>

        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-300 transition-colors"
          @click="copyLogs"
        >
          复制
        </button>

        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-400 dark:hover:text-rose-300 transition-colors"
          @click="logStore.clearLogs"
        >
          清空
        </button>
      </div>
    </div>

    <!-- 全屏全宽终端日志流视窗 -->
    <div
      ref="logContainer"
      class="flex-1 px-4 py-3 overflow-y-auto font-mono text-xs sm:text-sm text-slate-800 dark:text-zinc-300 space-y-1 select-text"
    >
      <div
        v-for="log in logStore.filteredLogs"
        :key="log.id"
        class="flex items-start gap-3 leading-relaxed hover:bg-slate-200/50 dark:hover:bg-white/[0.02] px-1.5 py-0.5 transition-colors font-mono"
      >
        <span class="text-slate-400 dark:text-zinc-500 select-none text-xs whitespace-nowrap">{{ log.time }}</span>
        <span
          class="text-xs font-semibold select-none whitespace-nowrap"
          :class="getLevelLabel(log.level).color"
        >
          {{ getLevelLabel(log.level).text }}
        </span>
        <span class="break-all whitespace-pre-wrap flex-1 text-slate-800 dark:text-zinc-200">{{ log.message }}</span>
      </div>

      <div v-if="logStore.filteredLogs.length === 0" class="py-24 text-center text-slate-400 dark:text-zinc-600 text-sm">
        暂无匹配日志记录
      </div>
    </div>
  </div>
</template>

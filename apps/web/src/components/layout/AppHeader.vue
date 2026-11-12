<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useBridgeStore } from '../../stores/bridgeStore';
import { useThemeStore, ACCENT_PRESETS, type AccentPreset } from '../../stores/themeStore';
import StatusDot from '../common/StatusDot.vue';
import type { WechatAdminMode } from '../../types/bridge';

const emit = defineEmits<{
  (e: 'open-pair'): void;
}>();

const route = useRoute();
const bridgeStore = useBridgeStore();
const themeStore = useThemeStore();

const showAccentPicker = ref(false);
const timeStr = ref('--:--:--');
let timer: any = null;

function updateTime() {
  const now = new Date();
  timeStr.value = now.toLocaleTimeString('zh-CN', {
    timeZone: bridgeStore.snapshot?.schedule?.timezone || 'Asia/Shanghai',
    hour12: false,
  });
}

onMounted(() => {
  updateTime();
  timer = setInterval(updateTime, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const navLinks = [
  { path: '/overview', label: '总览' },
  { path: '/channels', label: '社群沙箱' },
  { path: '/tools', label: '工具目录' },
  { path: '/logs', label: '系统日志' },
  { path: '/settings', label: '系统设置' },
];

const wechatStatus = computed(() => {
  const s = bridgeStore.snapshot?.wechat?.status;
  if (s === 'ONLINE') return '在线';
  if (s === 'OFFLINE') return '离线';
  if (s === 'PAUSED') return '已暂停';
  return s || '未就绪';
});

const currentAdminMode = computed(() => bridgeStore.snapshot?.wechat?.adminMode || 'RUNNING');
const nickname = computed(() => {
  return bridgeStore.snapshot?.selfAvatar?.nickname || bridgeStore.snapshot?.wechat?.account || '机器人';
});

const isChangingMode = ref(false);

async function changeAdminMode(mode: WechatAdminMode) {
  if (mode === currentAdminMode.value) return;
  if (mode === 'MANUAL_OFFLINE') {
    if (!confirm('确定将微信切换至离线状态吗？')) return;
  }
  isChangingMode.value = true;
  try {
    await bridgeStore.setAdminMode(mode, mode === 'MANUAL_OFFLINE' ? 'CONFIRM_MANUAL_OFFLINE' : undefined);
  } catch (err: any) {
    alert(`切换模式失败: ${err.message}`);
  } finally {
    isChangingMode.value = false;
  }
}

function selectAccent(id: AccentPreset) {
  themeStore.setAccent(id);
  showAccentPicker.value = false;
}
</script>

<template>
  <header class="w-full bg-white dark:bg-black border-b border-slate-200 dark:border-white/[0.08] sticky top-0 z-40 transition-colors">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <!-- 品牌标识与时钟 -->
      <div class="flex items-center gap-6">
        <div class="flex items-baseline gap-2 sm:gap-3">
          <span class="text-lg font-bold tracking-tight text-slate-900 dark:text-white">FEAGLE</span>
          <span class="text-xs text-slate-500 dark:text-zinc-500 font-mono tracking-widest">控制台</span>
        </div>

        <div class="hidden md:flex items-center gap-2 pl-4 border-l border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-mono text-sm">
          <span class="font-dseg text-blue-600 dark:text-sky-400 font-semibold tracking-wider">{{ timeStr }}</span>
        </div>
      </div>

      <!-- 顶部集成导航菜单 -->
      <nav class="flex items-center gap-1 sm:gap-2 h-full">
        <RouterLink
          v-for="item in navLinks"
          :key="item.path"
          :to="item.path"
          class="h-full flex items-center px-3 sm:px-4 text-xs sm:text-sm font-medium transition-colors border-b-2"
          :class="
            route.path.startsWith(item.path)
              ? 'text-slate-900 dark:text-white border-[var(--color-accent)] font-semibold'
              : 'text-slate-500 dark:text-zinc-400 border-transparent hover:text-slate-900 dark:hover:text-slate-200'
          "
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <!-- 右侧操作栏与微信状态 -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- 微信状态指示 -->
        <div class="hidden xl:flex items-center gap-2 text-xs sm:text-sm text-slate-600 dark:text-zinc-300 mr-1">
          <StatusDot :status="bridgeStore.snapshot?.wechat?.status || 'OFFLINE'" size="sm" :pulse="false" />
          <span class="font-medium truncate max-w-[100px]">{{ nickname }}</span>
          <span class="text-xs text-slate-400 dark:text-zinc-500">({{ wechatStatus }})</span>
        </div>

        <!-- 模式切换 -->
        <div class="inline-flex bg-slate-100 dark:bg-white/[0.04] p-0.5 text-xs font-medium">
          <button
            type="button"
            class="px-2.5 py-1 sm:px-3 sm:py-1.5 transition-colors"
            :class="currentAdminMode === 'RUNNING' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            :disabled="isChangingMode"
            @click="changeAdminMode('RUNNING')"
          >
            运行
          </button>
          <button
            type="button"
            class="px-2.5 py-1 sm:px-3 sm:py-1.5 transition-colors"
            :class="currentAdminMode === 'PAUSED' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
            :disabled="isChangingMode"
            @click="changeAdminMode('PAUSED')"
          >
            暂停
          </button>
        </div>

        <!-- 主题色快速微调面板入口 -->
        <div class="relative">
          <button
            type="button"
            class="p-2 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors flex items-center justify-center"
            title="选择主题强调色"
            @click="showAccentPicker = !showAccentPicker"
          >
            <div
              class="w-3.5 h-3.5 rounded-full shadow-sm"
              :style="{ backgroundColor: 'var(--color-accent)' }"
            />
          </button>

          <!-- 主题色下拉选择气泡 -->
          <div
            v-if="showAccentPicker"
            class="absolute right-0 mt-2 w-48 p-2.5 bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-zinc-800 shadow-xl z-50 space-y-1.5 text-xs font-sans select-none"
          >
            <div class="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 px-1.5 pb-1 border-b border-slate-100 dark:border-zinc-800/80">
              主题风格色
            </div>
            <button
              v-for="preset in Object.values(ACCENT_PRESETS)"
              :key="preset.id"
              type="button"
              class="w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-left"
              @click="selectAccent(preset.id)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="w-3 h-3 rounded-full"
                  :style="{ backgroundColor: themeStore.mode === 'dark' ? preset.darkPrimary : preset.lightPrimary }"
                />
                <span :class="themeStore.accent === preset.id ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-zinc-400'">
                  {{ preset.name }}
                </span>
              </div>
              <span v-if="themeStore.accent === preset.id" class="text-blue-500 font-bold">✓</span>
            </button>
          </div>
        </div>

        <!-- 白天模式 / 纯黑夜间模式 切换按钮 -->
        <button
          type="button"
          class="p-2 text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors flex items-center justify-center"
          :title="themeStore.mode === 'dark' ? '切换为白天明亮模式' : '切换为纯黑夜间模式'"
          @click="themeStore.toggleMode"
        >
          <!-- 太阳图标 (当前为暗黑模式，点击切白天) -->
          <svg
            v-if="themeStore.mode === 'dark'"
            class="w-4 h-4 text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <!-- 月亮图标 (当前为白天模式，点击切纯黑) -->
          <svg
            v-else
            class="w-4 h-4 text-slate-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        </button>

        <!-- 平板连接 -->
        <button
          type="button"
          class="px-3 py-1.5 bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] text-slate-800 dark:text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
          @click="emit('open-pair')"
        >
          设备配对
        </button>
      </div>
    </div>
  </header>
</template>

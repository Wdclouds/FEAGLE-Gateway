<script setup lang="ts">
import { ref, watch } from 'vue';
import { bridgeApi } from '../../api/bridgeApi';
import type { PairCodeResponse } from '../../types/bridge';
import ModalDialog from '../common/ModalDialog.vue';
import StatusDot from '../common/StatusDot.vue';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const activeTab = ref<'download' | 'pair'>('download');
const pairData = ref<PairCodeResponse | null>(null);
const selectedIp = ref('');
const isLoading = ref(false);

async function loadPairCode(ip?: string) {
  isLoading.value = true;
  try {
    const data = await bridgeApi.getPairCode(ip);
    pairData.value = data;
    if (!selectedIp.value && data.selectedIp) {
      selectedIp.value = data.selectedIp;
    }
  } catch (err: any) {
    console.error('Failed to load pair code:', err);
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => props.show,
  (open) => {
    if (open) {
      loadPairCode(selectedIp.value || undefined);
    }
  }
);

function onIpChange() {
  loadPairCode(selectedIp.value);
}

function copyPass() {
  navigator.clipboard.writeText('9qt0');
  alert('蓝奏云提取码 9qt0 已复制到剪贴板。');
}
</script>

<template>
  <ModalDialog
    :show="show"
    title="安卓设备驱动安装与配对向导"
    max-width="max-w-2xl"
    @close="emit('close')"
  >
    <div class="space-y-6">
      <!-- 目标 IP 选择 -->
      <div class="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] transition-colors">
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium text-slate-700 dark:text-zinc-300">目标通信 IP:</span>
          <select
            v-model="selectedIp"
            class="px-3 py-1.5 bg-white dark:bg-black text-slate-900 dark:text-zinc-200 text-sm font-mono border border-slate-200 dark:border-white/10 focus:outline-none"
            @change="onIpChange"
          >
            <option
              v-for="ip in pairData?.lanIps || []"
              :key="ip"
              :value="ip"
            >
              {{ ip }}
            </option>
          </select>
        </div>

        <button
          type="button"
          class="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 dark:border-transparent text-xs font-medium transition-colors"
          :disabled="isLoading"
          @click="loadPairCode(selectedIp)"
        >
          刷新配对码
        </button>
      </div>

      <!-- 选项卡切换 -->
      <div class="flex items-center gap-2 border-b border-slate-200 dark:border-white/[0.06] pb-3">
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="activeTab === 'download' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'download'"
        >
          第一步：下载安卓驱动
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="activeTab === 'pair' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'pair'"
        >
          第二步：扫码免密配对
        </button>
      </div>

      <!-- 选项卡 1：下载 APK -->
      <div v-show="activeTab === 'download'" class="flex flex-col sm:flex-row items-center gap-8 p-4">
        <div class="w-48 h-48 bg-white p-3 border border-slate-200 dark:border-white/[0.08] flex items-center justify-center flex-shrink-0 shadow-xs">
          <img
            v-if="pairData?.downloadQrDataUrl"
            :src="pairData.downloadQrDataUrl"
            alt="下载二维码"
            class="w-full h-full object-contain"
          />
          <span v-else class="text-xs text-slate-700 font-mono">生成二维码中...</span>
        </div>

        <div class="flex-1 space-y-4 text-sm text-slate-700 dark:text-zinc-300">
          <p class="leading-relaxed">
            请使用平板相机或浏览器扫码，通过蓝奏云高速下载安卓端驱动应用：
          </p>

          <div class="flex items-center gap-3">
            <span class="text-slate-500 dark:text-zinc-400">下载提取码:</span>
            <span class="px-2.5 py-1 font-mono font-bold bg-slate-100 dark:bg-white/[0.06] text-slate-900 dark:text-white">
              {{ pairData?.lanzouPass || '9qt0' }}
            </span>
            <button
              type="button"
              class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 text-xs transition-colors"
              @click="copyPass"
            >
              复制
            </button>
          </div>

          <div class="pt-3 border-t border-slate-100 dark:border-white/[0.04] space-y-2">
            <span class="text-xs text-slate-400 dark:text-zinc-500 block">备用下载直链：</span>
            <div class="flex items-center gap-4 text-xs font-mono">
              <a
                :href="pairData?.downloadUrl || '/api/device/download-agent'"
                download="feaglewxbot-agent.apk"
                class="text-[var(--color-accent)] hover:underline"
              >
                本机服务器直链下载
              </a>
              <span class="text-slate-400 dark:text-zinc-600">/</span>
              <a
                :href="pairData?.lanzouUrl || 'https://wwbpz.lanzout.com/ij5Aw4avhhni'"
                target="_blank"
                class="text-[var(--color-accent)] hover:underline"
              >
                蓝奏云网页
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- 选项卡 2：配对二维码 -->
      <div v-show="activeTab === 'pair'" class="flex flex-col sm:flex-row items-center gap-8 p-4">
        <div class="w-48 h-48 bg-white p-3 border border-slate-200 dark:border-white/[0.08] flex items-center justify-center flex-shrink-0 shadow-xs">
          <img
            v-if="pairData?.qrDataUrl"
            :src="pairData.qrDataUrl"
            alt="配对二维码"
            class="w-full h-full object-contain"
          />
          <span v-else class="text-xs text-slate-700 font-mono">生成配对码中...</span>
        </div>

        <div class="flex-1 space-y-4 text-sm text-slate-700 dark:text-zinc-300">
          <p class="leading-relaxed">
            在平板端打开已安装的 FEAGLE 驱动应用，点击扫码功能扫描此二维码即可自动完成握手配对。
          </p>

          <div class="p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] space-y-2 font-mono text-xs">
            <div class="flex justify-between">
              <span class="text-slate-500 dark:text-zinc-400">通信端点:</span>
              <span class="text-slate-800 dark:text-zinc-200 truncate max-w-[240px]">{{ pairData?.endpoint || '--' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500 dark:text-zinc-400">连接状态:</span>
              <span class="font-bold flex items-center gap-2">
                <StatusDot :status="pairData?.deviceStatus || 'DISCONNECTED'" size="sm" :pulse="false" />
                <span class="text-slate-800 dark:text-zinc-200">{{ pairData?.deviceStatus === 'CONNECTED' ? '已连接' : '等待扫码' }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="px-6 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-white transition-colors"
        @click="emit('close')"
      >
        完成
      </button>
    </template>
  </ModalDialog>
</template>

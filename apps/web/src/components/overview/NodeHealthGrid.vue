<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBridgeStore } from '../../stores/bridgeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import StatusDot from '../common/StatusDot.vue';

const bridgeStore = useBridgeStore();
const gatewayStore = useGatewayStore();

const android = computed(() => bridgeStore.snapshot?.android);
const schedule = computed(() => bridgeStore.snapshot?.schedule);
const gatewayHealth = computed(() => gatewayStore.health);

const isTogglingOverride = ref(false);

async function toggleScheduleOverride() {
  const current = schedule.value?.testMode || false;
  isTogglingOverride.value = true;
  try {
    await bridgeStore.setScheduleOverride(!current);
  } catch (err: any) {
    alert(`切换计划失败: ${err.message}`);
  } finally {
    isTogglingOverride.value = false;
  }
}
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
    <!-- 1. 安卓平板硬件驱动 -->
    <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-4 transition-colors shadow-xs">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-slate-600 dark:text-zinc-400">安卓硬件链路</span>
        <StatusDot :status="android?.deviceStatus || 'DISCONNECTED'" size="sm" :pulse="false" />
      </div>
      <div>
        <div class="text-xl font-bold text-slate-900 dark:text-white">
          {{ android?.deviceStatus === 'CONNECTED' ? '驱动已连接' : '等待设备接入' }}
        </div>
        <p class="text-xs text-slate-500 dark:text-zinc-400 mt-2 font-mono">
          设备标识: {{ android?.deviceIdMasked || '未配对' }}
        </p>
      </div>
      <div class="text-xs text-slate-400 dark:text-zinc-500 pt-3 border-t border-slate-100 dark:border-white/[0.04] flex justify-between">
        <span>驱动挂载: {{ android?.hookConnected ? '正常' : '未就绪' }}</span>
        <span>待处理指令: {{ android?.pendingCommands || 0 }}</span>
      </div>
    </div>

    <!-- 2. 网关智能体核心 -->
    <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-4 transition-colors shadow-xs">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-slate-600 dark:text-zinc-400">网关智能体引擎</span>
        <StatusDot :status="gatewayHealth ? 'ONLINE' : 'ERROR'" size="sm" :pulse="false" />
      </div>
      <div>
        <div class="text-xl font-bold text-slate-900 dark:text-white">
          {{ gatewayHealth ? '引擎运行中' : '服务未就绪' }}
        </div>
        <p class="text-xs text-slate-500 dark:text-zinc-400 mt-2 font-mono">
          内存占用: {{ gatewayHealth?.rss_mb || '--' }} MB · 运行时长: {{ gatewayHealth?.uptime_s || '--' }} 秒
        </p>
      </div>
      <div class="text-xs text-slate-400 dark:text-zinc-500 pt-3 border-t border-slate-100 dark:border-white/[0.04] flex justify-between">
        <span>服务形态: 本地内网</span>
        <span>通信端口: 6185</span>
      </div>
    </div>

    <!-- 3. 数据审计与会话 -->
    <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-4 transition-colors shadow-xs">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-slate-600 dark:text-zinc-400">数据库存储状态</span>
        <span class="text-xs text-emerald-600 dark:text-emerald-400 font-mono font-medium">SQLite WAL</span>
      </div>
      <div>
        <div class="text-xl font-bold text-slate-900 dark:text-white font-mono">
          {{ gatewayHealth?.db?.sessions || 0 }} <span class="text-sm font-normal text-slate-500 dark:text-zinc-400">个活跃会话</span>
        </div>
        <p class="text-xs text-slate-500 dark:text-zinc-400 mt-2 font-mono">
          已记录调用轨迹: {{ gatewayHealth?.db?.traces || 0 }} 条
        </p>
      </div>
      <div class="text-xs text-slate-400 dark:text-zinc-500 pt-3 border-t border-slate-100 dark:border-white/[0.04] flex justify-between">
        <span>并发事务: 支持</span>
        <span>读写锁状态: 正常</span>
      </div>
    </div>

    <!-- 4. 时间调度与休眠 -->
    <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-4 transition-colors shadow-xs">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-slate-600 dark:text-zinc-400">休眠调度计划</span>
        <StatusDot :status="schedule?.mode === 'ACTIVE' ? 'ONLINE' : 'PAUSED'" size="sm" :pulse="false" />
      </div>
      <div>
        <div class="flex items-center justify-between">
          <span class="text-xl font-bold text-slate-900 dark:text-white">
            {{ schedule?.mode === 'ACTIVE' ? '工作状态' : '休眠静默中' }}
          </span>
          <button
            type="button"
            class="text-xs px-2.5 py-1 font-medium transition-colors"
            :class="schedule?.testMode ? 'bg-amber-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.12]'"
            :disabled="isTogglingOverride"
            @click="toggleScheduleOverride"
          >
            {{ schedule?.testMode ? '休眠豁免中' : '解除时限' }}
          </button>
        </div>
        <p class="text-xs text-slate-500 dark:text-zinc-400 mt-2 font-mono">
          静音时段: {{ schedule?.quietHours || '00:00-07:00' }}
        </p>
      </div>
      <div class="text-xs text-slate-400 dark:text-zinc-500 pt-3 border-t border-slate-100 dark:border-white/[0.04] flex justify-between">
        <span>系统时区: {{ schedule?.timezone || 'Asia/Shanghai' }}</span>
        <span>测试豁免: {{ schedule?.testMode ? '开启' : '关闭' }}</span>
      </div>
    </div>
  </div>
</template>

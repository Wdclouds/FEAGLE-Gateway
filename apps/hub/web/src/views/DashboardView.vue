<template>
  <div class="dashboard-container">
    <!-- 顶部核心遥测指标卡片 -->
    <el-row :gutter="20" class="metric-row">
      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <span class="metric-label">FEAGLE 协议网关</span>
            <el-tag :type="telemetry.gateway?.connected ? 'success' : 'danger'" size="small">
              {{ telemetry.gateway?.connected ? 'ONLINE' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="metric-value">{{ telemetry.gateway?.connected ? '已连接' : '断开重试' }}</div>
          <div class="metric-sub">
            端点: <code>{{ telemetry.gateway?.endpoint || 'ws://127.0.0.1:6199' }}</code>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <span class="metric-label">Hermes 智能体</span>
            <el-tag :type="telemetry.hermes?.connected ? 'primary' : 'info'" size="small">
              {{ telemetry.hermes?.connected ? 'READY' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="metric-value">
            {{ telemetry.hermes?.lastPingMs !== null ? `${telemetry.hermes?.lastPingMs} ms` : '--' }}
          </div>
          <div class="metric-sub">端点: {{ telemetry.hermes?.endpoint || 'http://127.0.0.1:18080' }}</div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <span class="metric-label">纳管微信群组</span>
            <el-tag type="warning" size="small">多群矩阵</el-tag>
          </div>
          <div class="metric-value">{{ telemetry.groupsCount || 0 }} <span class="unit">个活跃群</span></div>
          <div class="metric-sub">状态: 策略版本热更新中</div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <span class="metric-label">24h 消息吞吐</span>
            <el-tag type="success" size="small">全双工通信</el-tag>
          </div>
          <div class="metric-value">{{ total24hMessages }} <span class="unit">条事件</span></div>
          <div class="metric-sub">背压保护: 环形缓冲队列 100</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 中部 ECharts 趋势图 -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="card-title-bar">
          <span class="card-title">24小时消息吞吐与遥测流水趋势</span>
          <el-button size="small" type="primary" link @click="fetchData">刷新数据</el-button>
        </div>
      </template>
      <div ref="chartRef" class="echarts-box"></div>
    </el-card>

    <!-- 底部近期流转摘要 -->
    <el-card shadow="never" class="recent-card">
      <template #header>
        <span class="card-title">近期消息流水快照</span>
      </template>
      <el-table :data="telemetry.recentMessages || []" style="width: 100%" empty-text="等待网关入站消息流...">
        <el-table-column prop="time" label="时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.time) }}
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'group' ? 'warning' : 'info'">
              {{ row.type === 'group' ? '群聊' : '私聊' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="groupName" label="目标群/会话" width="180" />
        <el-table-column prop="sender" label="发送者" width="140" />
        <el-table-column prop="text" label="消息正文摘要" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import * as echarts from 'echarts';
import { apiClient } from '../api/client';

const chartRef = ref<HTMLDivElement>();
let myChart: echarts.ECharts | null = null;
let pollTimer: any = null;

const telemetry = ref<any>({
  gateway: { connected: false, endpoint: '', reconnectAttempts: 0 },
  hermes: { connected: false, endpoint: '', lastPingMs: null },
  groupsCount: 0,
  recentMessages: [],
  hourly24h: [],
});

const total24hMessages = computed(() => {
  const list = telemetry.value.hourly24h || [];
  return list.reduce((sum: number, item: any) => sum + (item.message_count || 0), 0);
});

function formatTime(isoString: string) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function initChart() {
  if (!chartRef.value) return;
  myChart = echarts.init(chartRef.value, 'dark');

  const hourly = telemetry.value.hourly24h || [];
  const hours = hourly.map((h: any) => h.hour_key.slice(-5));
  const counts = hourly.map((h: any) => h.message_count);

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#f8fafc' },
    },
    grid: {
      left: '2%',
      right: '2%',
      bottom: '3%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: hours.length > 0 ? hours : ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#94a3b8' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#94a3b8' },
    },
    series: [
      {
        name: '消息吞吐 (条/小时)',
        type: 'line',
        smooth: true,
        data: counts.length > 0 ? counts : [0, 0, 0, 0, 0, 0],
        itemStyle: { color: '#38bdf8' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(56, 189, 248, 0.35)' },
            { offset: 1, color: 'rgba(56, 189, 248, 0.02)' },
          ]),
        },
      },
    ],
  };

  myChart.setOption(option);
}

async function fetchData() {
  try {
    const res: any = await apiClient.get('/telemetry');
    telemetry.value = res;
    initChart();
  } catch {
    // handled by axios
  }
}

function handleResize() {
  myChart?.resize();
}

onMounted(() => {
  fetchData();
  window.addEventListener('resize', handleResize);
  pollTimer = setInterval(fetchData, 8000);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (pollTimer) clearInterval(pollTimer);
  myChart?.dispose();
});
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.metric-row {
  margin-bottom: 4px;
}
.metric-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.metric-label {
  font-size: 13px;
  color: #94a3b8;
  font-weight: 500;
}
.metric-value {
  font-size: 26px;
  font-weight: 700;
  color: #f8fafc;
  margin-bottom: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.metric-value .unit {
  font-size: 13px;
  font-weight: 400;
  color: #64748b;
}
.metric-sub {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.metric-sub code {
  color: #38bdf8;
  background: #1e293b;
  padding: 1px 4px;
  border-radius: 4px;
}
.chart-card, .recent-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.card-title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #f8fafc;
}
.echarts-box {
  width: 100%;
  height: 280px;
}
:deep(.el-table) {
  background-color: transparent !important;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #1e293b;
  --el-table-border-color: #1e293b;
  color: #cbd5e1;
}
</style>

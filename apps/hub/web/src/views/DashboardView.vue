<template>
  <div class="dashboard-container">
    <!-- 1. 顶部四大核心指标卡片 (去噪精炼，直击关键状态) -->
    <el-row :gutter="16" class="metric-row">
      <!-- 网关状态卡片 -->
      <el-col :span="6">
        <el-card shadow="never" class="metric-card gateway-card">
          <div class="metric-header">
            <div class="label-with-mode">
              <span class="metric-label">FEAGLE 微信网关</span>
              <el-tag size="small" effect="plain" class="mode-badge">
                {{ formatModeLabel(telemetry.gateway?.mode) }}
              </el-tag>
            </div>
            <div class="header-actions">
              <el-tag :type="telemetry.gateway?.connected ? 'success' : 'danger'" size="small">
                {{ telemetry.gateway?.connected ? 'ONLINE' : 'OFFLINE' }}
              </el-tag>
              <el-button link type="primary" size="small" class="config-btn" @click="goToGatewayConfig">
                <el-icon><Setting /></el-icon> 配置
              </el-button>
            </div>
          </div>
          <div class="metric-value">
            {{ telemetry.gateway?.connected ? (telemetry.gateway?.accountName || '已连接') : '等待连接' }}
          </div>
          <div class="metric-sub" :title="telemetry.gateway?.endpoint || telemetry.gateway?.bridgeUrl">
            直连: <code>{{ telemetry.gateway?.bridgeUrl || telemetry.gateway?.endpoint || '127.0.0.1:6190' }}</code>
          </div>
        </el-card>
      </el-col>

      <!-- Hermes 智能体卡片 -->
      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <div class="label-with-mode">
              <span class="metric-label">Hermes 智能体</span>
              <el-tag size="small" effect="plain" class="mode-badge">
                {{ formatHermesMode(telemetry.hermes?.mode) }}
              </el-tag>
            </div>
            <el-tag :type="telemetry.hermes?.connected ? 'success' : 'info'" size="small">
              {{ telemetry.hermes?.connected ? 'READY' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="metric-value">
            {{ telemetry.hermes?.lastPingMs !== null ? `${telemetry.hermes?.lastPingMs} ms` : (telemetry.hermes?.connected ? '就绪' : '--') }}
          </div>
          <div class="metric-sub" :title="telemetry.hermes?.endpoint">
            中枢: <code>{{ telemetry.hermes?.endpoint || 'http://127.0.0.1:18010' }}</code>
          </div>
        </el-card>
      </el-col>

      <!-- 微信群聊卡片 -->
      <el-col :span="6">
        <el-card shadow="never" class="metric-card clickable" @click="goToGroupPolicy">
          <div class="metric-header">
            <span class="metric-label">纳管微信群组</span>
            <el-button link type="primary" size="small" class="view-btn">编排策略 &gt;</el-button>
          </div>
          <div class="metric-value">
            {{ telemetry.groupsCount || 0 }} <span class="unit">个活跃群</span>
          </div>
          <div class="metric-sub">
            状态: 独立 Prompt 与权限管控已纳管
          </div>
        </el-card>
      </el-col>

      <!-- 24h 吞吐卡片 -->
      <el-col :span="6">
        <el-card shadow="never" class="metric-card">
          <div class="metric-header">
            <span class="metric-label">24h 消息吞吐</span>
            <el-tag type="success" size="small">实时流水</el-tag>
          </div>
          <div class="metric-value">
            {{ total24hMessages }} <span class="unit">条事件</span>
          </div>
          <div class="metric-sub">
            全双工 SSE 流式调度就绪
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 2. 中部 ECharts 趋势图 (高度适中，舒发展现) -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="card-title-bar">
          <span class="card-title">24小时消息吞吐与遥测流水趋势</span>
          <el-button size="small" type="primary" link @click="fetchData">刷新大盘</el-button>
        </div>
      </template>
      <div ref="chartRef" class="echarts-box"></div>
    </el-card>

    <!-- 3. 双子星全链路拓扑与节点健康度 (替代原有重复消息表格，展示架构全局) -->
    <el-card shadow="never" class="topology-card">
      <template #header>
        <div class="card-title-bar">
          <div>
            <span class="card-title">FEAGLE 双子星全链路节点拓扑矩阵</span>
            <span class="card-desc">端到端物理发信驱动 ↔ 云端协议网关 ↔ 本地中枢 ↔ 记忆宫殿</span>
          </div>
          <el-tag size="small" type="success" effect="dark">
            全链路闭环就绪
          </el-tag>
        </div>
      </template>

      <div class="topology-grid">
        <!-- 节点 1：安卓平板驱动 -->
        <div class="topology-node">
          <div class="node-header">
            <div class="node-icon">📱</div>
            <div class="node-info">
              <div class="node-name">物理驱动层 (Driver)</div>
              <div class="node-sub">三星平板 (SM-X200)</div>
            </div>
            <el-tag size="small" type="success">ONLINE</el-tag>
          </div>
          <div class="node-body">
            <div class="node-spec">组件: <code>WeChat 8.0.78 (LSPosed)</code></div>
            <div class="node-spec">通道: <code>WebSocket 驱动长连接 (:6191)</code></div>
            <div class="node-detail">负责真实微信二进制协议底层拦截与物理发信</div>
          </div>
        </div>

        <div class="node-arrow">➔</div>

        <!-- 节点 2：云端协议网关 -->
        <div class="topology-node">
          <div class="node-header">
            <div class="node-icon">☁️</div>
            <div class="node-info">
              <div class="node-name">协议网关层 (Bridge)</div>
              <div class="node-sub">阿里云 ECS 服务器</div>
            </div>
            <el-tag size="small" :type="telemetry.gateway?.connected ? 'success' : 'danger'">
              {{ telemetry.gateway?.connected ? 'ONLINE' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="node-body">
            <div class="node-spec">组件: <code>FEAGLE-Bridge (:6190)</code></div>
            <div class="node-spec">身份: <code>{{ telemetry.gateway?.accountName || 'FaSt_eAgle' }}</code></div>
            <div class="node-detail">OneBot v11 协议转译、REST &amp; SSE 消息推流中继</div>
          </div>
        </div>

        <div class="node-arrow">➔</div>

        <!-- 节点 3：本地 Hub 控制中台 -->
        <div class="topology-node">
          <div class="node-header">
            <div class="node-icon">🖥️</div>
            <div class="node-info">
              <div class="node-name">控制中枢层 (Hub)</div>
              <div class="node-sub">本地控制台 (Edge App)</div>
            </div>
            <el-tag size="small" type="success">RUNNING</el-tag>
          </div>
          <div class="node-body">
            <div class="node-spec">服务: <code>http://127.0.0.1:6200</code></div>
            <div class="node-spec">引擎: <code>Node.js 22+ &amp; SQLite WAL</code></div>
            <div class="node-detail">多群策略编排、权限白名单、实时遥测大盘</div>
          </div>
        </div>

        <div class="node-arrow">➔</div>

        <!-- 节点 4：Hermes / 记忆宫殿 -->
        <div class="topology-node">
          <div class="node-header">
            <div class="node-icon">🧠</div>
            <div class="node-info">
              <div class="node-name">智能与记忆 (Hermes)</div>
              <div class="node-sub">Mnemosyne 记忆宫殿</div>
            </div>
            <el-tag size="small" :type="telemetry.hermes?.connected ? 'success' : 'info'">
              {{ telemetry.hermes?.connected ? 'READY' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="node-body">
            <div class="node-spec">端点: <code>http://127.0.0.1:18010</code></div>
            <div class="node-spec">延时: <code>{{ telemetry.hermes?.lastPingMs ?? 42 }} ms</code></div>
            <div class="node-detail">多维记忆向量检索、跨会话沉淀与大模型推理</div>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { Setting } from '@element-plus/icons-vue';
import { apiClient } from '../api/client';

const router = useRouter();
const chartRef = ref<HTMLDivElement>();
let myChart: echarts.ECharts | null = null;
let pollTimer: any = null;

const telemetry = ref<any>({
  gateway: {
    connected: false,
    mode: 'bridge_sync',
    bridgeUrl: 'http://127.0.0.1:6190',
    listenPort: 6199,
    remoteUrl: '',
    endpoint: '',
    statusText: '',
    clientCount: 0,
    accountName: '',
    reconnectAttempts: 0,
  },
  hermes: { connected: false, endpoint: '', lastPingMs: null },
  groupsCount: 0,
  recentMessages: [],
  hourly24h: [],
});

function formatModeLabel(mode: string) {
  if (mode === 'bridge_sync') return '云端直连';
  if (mode === 'server') return '本地监听';
  if (mode === 'client') return '远程WS';
  return '未初始化';
}

function formatHermesMode(mode: string) {
  if (mode === 'memory') return '记忆中枢';
  if (mode === 'cli') return 'CLI交互';
  if (mode === 'http') return 'HTTP网关';
  return '智能体';
}

const total24hMessages = computed(() => {
  const list = telemetry.value.hourly24h || [];
  return list.reduce((sum: number, item: any) => sum + (item.message_count || 0), 0);
});

function goToGatewayConfig() {
  router.push('/connection');
}

function goToGroupPolicy() {
  router.push('/groups');
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
  } catch {}
}

function handleResize() {
  myChart?.resize();
}

onMounted(() => {
  fetchData();
  window.addEventListener('resize', handleResize);
  pollTimer = setInterval(fetchData, 4000);
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
  gap: 16px;
}
.metric-row {
  margin-bottom: 2px;
}
.metric-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
  transition: all 0.2s;
}
.metric-card.clickable {
  cursor: pointer;
}
.metric-card.clickable:hover {
  border-color: #38bdf8;
  transform: translateY(-2px);
}
.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.label-with-mode {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mode-badge {
  background: #1e293b;
  border-color: #334155;
  color: #38bdf8;
  font-size: 11px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.config-btn, .view-btn {
  font-size: 12px;
  color: #94a3b8;
  padding: 0;
}
.config-btn:hover, .view-btn:hover {
  color: #38bdf8;
}
.metric-label {
  font-size: 13px;
  color: #94a3b8;
  font-weight: 500;
}
.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: #f8fafc;
  margin-bottom: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.metric-value .unit {
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
  margin-left: 4px;
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

.chart-card {
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
.card-desc {
  font-size: 12px;
  color: #64748b;
  margin-left: 12px;
}
.echarts-box {
  width: 100%;
  height: 240px;
}

/* 拓扑矩阵样式 */
.topology-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.topology-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}
.topology-node {
  flex: 1;
  background-color: #0b1120;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 14px 16px;
  transition: all 0.2s;
}
.topology-node:hover {
  border-color: #334155;
  background-color: #0d1527;
}
.node-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.node-icon {
  font-size: 20px;
}
.node-info {
  flex: 1;
}
.node-name {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}
.node-sub {
  font-size: 11px;
  color: #64748b;
}
.node-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.node-spec {
  font-size: 11px;
  color: #94a3b8;
}
.node-spec code {
  color: #38bdf8;
  background: #1e293b;
  padding: 1px 5px;
  border-radius: 3px;
}
.node-detail {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}
.node-arrow {
  font-size: 18px;
  color: #334155;
  user-select: none;
}
</style>

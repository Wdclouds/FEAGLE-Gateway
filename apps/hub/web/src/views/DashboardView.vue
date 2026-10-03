<template>
  <div class="dashboard-container">
    <!-- 1. 置顶核心看板：双子星全链路 4 级拓扑与系统状态 (原顶部 4 块与底部拓扑合二为一，彻底消灭重复) -->
    <el-card shadow="never" class="pipeline-card">
      <template #header>
        <div class="card-title-bar">
          <div class="title-with-desc">
            <span class="card-title">FEAGLE 双子星全链路端到端驾驶舱</span>
            <span class="card-desc">驱动层 ➔ 协议层 ➔ 中枢层 ➔ 记忆智能 (4 级全双工实时联动)</span>
          </div>
          <div class="header-badges">
            <el-tag size="small" type="success" effect="dark">
              全链路闭环就绪
            </el-tag>
            <el-button size="small" type="primary" link @click="fetchData">
              刷新状态
            </el-button>
          </div>
        </div>
      </template>

      <div class="pipeline-grid">
        <!-- 节点 1：终端物理驱动 (Driver) -->
        <div class="pipeline-node">
          <div class="node-header">
            <div class="node-icon">📱</div>
            <div class="node-meta">
              <div class="node-title">物理驱动层 (Driver)</div>
              <div class="node-subtitle">三星平板 (SM-X200)</div>
            </div>
            <el-tag
              size="small"
              :type="telemetry.gateway?.android?.deviceStatus === 'CONNECTED' ? 'success' : (telemetry.gateway?.connected ? 'success' : 'danger')"
            >
              {{ telemetry.gateway?.android?.deviceStatus || (telemetry.gateway?.connected ? 'ONLINE' : 'OFFLINE') }}
            </el-tag>
          </div>
          <div class="node-main-val">
            WeChat 8.0.78
            <span class="val-unit" v-if="telemetry.gateway?.android?.deviceIdMasked">({{ telemetry.gateway.android.deviceIdMasked }})</span>
          </div>
          <div class="node-details">
            <div class="detail-row">
              <span class="detail-label">驱动方式:</span>
              <span class="detail-val">LSPosed Hook ({{ telemetry.gateway?.android?.hookConnected !== false ? '已挂载' : '未挂载' }})</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">通道接口:</span>
              <span class="detail-val">WS <code>:6191</code> (心跳 {{ telemetry.gateway?.android?.heartbeatAgeMs ?? 0 }}ms)</span>
            </div>
            <div class="detail-tip">负责底层微信原始报文拦截与物理发信</div>
          </div>
        </div>

        <div class="pipeline-arrow">➔</div>

        <!-- 节点 2：云端协议网关 (Bridge) -->
        <div class="pipeline-node clickable" @click="goToGatewayConfig">
          <div class="node-header">
            <div class="node-icon">☁️</div>
            <div class="node-meta">
              <div class="node-title">协议网关层 (Bridge)</div>
              <div class="node-subtitle">阿里云 ECS 服务器</div>
            </div>
            <div class="node-action-wrap">
              <el-tag size="small" :type="telemetry.gateway?.connected ? 'success' : 'danger'">
                {{ telemetry.gateway?.connected ? 'ONLINE' : 'OFFLINE' }}
              </el-tag>
            </div>
          </div>
          <div class="node-main-val" :title="telemetry.gateway?.accountName || 'FaSt_eAgle'">
            {{ telemetry.gateway?.connected ? (telemetry.gateway?.accountName || 'FaSt_eAgle') : '等待连接' }}
          </div>
          <div class="node-details">
            <div class="detail-row">
              <span class="detail-label">直连端点:</span>
              <span class="detail-val"><code>{{ telemetry.gateway?.bridgeUrl || telemetry.gateway?.endpoint || '127.0.0.1:6190' }}</code></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">协议中继:</span>
              <span class="detail-val">OneBot v11 &amp; SSE 流式</span>
            </div>
            <div class="detail-tip">负责消息清洗、联系人映射与协议转译</div>
          </div>
        </div>

        <div class="pipeline-arrow">➔</div>

        <!-- 节点 3：控制中枢 (Hub) -->
        <div class="pipeline-node clickable" @click="goToGroupPolicy">
          <div class="node-header">
            <div class="node-icon">🎛️</div>
            <div class="node-meta">
              <div class="node-title">控制中枢层 (Hub)</div>
              <div class="node-subtitle">本地桌面控制台</div>
            </div>
            <el-tag size="small" type="success">RUNNING</el-tag>
          </div>
          <div class="node-main-val">
            {{ groupsList.length || telemetry.groupsCount || 2 }} <span class="val-unit">个纳管群</span>
            <span class="val-divider">·</span>
            {{ total24hMessages }} <span class="val-unit">条事件</span>
          </div>
          <div class="node-details">
            <div class="detail-row">
              <span class="detail-label">中枢服务:</span>
              <span class="detail-val"><code>http://127.0.0.1:6200</code></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">引擎架构:</span>
              <span class="detail-val">Node.js 22 + SQLite WAL</span>
            </div>
            <div class="detail-tip">多群 Prompt 编排、安全白名单与大盘</div>
          </div>
        </div>

        <div class="pipeline-arrow">➔</div>

        <!-- 节点 4：智能与记忆 (Hermes) -->
        <div class="pipeline-node">
          <div class="node-header">
            <div class="node-icon">🧠</div>
            <div class="node-meta">
              <div class="node-title">智能与记忆 (Hermes)</div>
              <div class="node-subtitle">Mnemosyne 记忆宫殿</div>
            </div>
            <el-tag size="small" :type="telemetry.hermes?.connected ? 'success' : 'info'">
              {{ telemetry.hermes?.connected ? 'READY' : 'OFFLINE' }}
            </el-tag>
          </div>
          <div class="node-main-val">
            {{ telemetry.hermes?.lastPingMs !== null ? `${telemetry.hermes?.lastPingMs} ms` : (telemetry.hermes?.connected ? '就绪' : '--') }}
          </div>
          <div class="node-details">
            <div class="detail-row">
              <span class="detail-label">服务端点:</span>
              <span class="detail-val"><code>{{ telemetry.hermes?.endpoint || 'http://127.0.0.1:18010' }}</code></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">功能特性:</span>
              <span class="detail-val">多维向量召回 · 跨会话沉淀</span>
            </div>
            <div class="detail-tip">负责上下文蒸馏与大模型高智力推理</div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 2. 中部：24 小时消息吞吐与实时趋势图 -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="card-title-bar">
          <div class="title-with-desc">
            <span class="card-title">24小时消息吞吐与遥测流水趋势</span>
            <span class="card-desc">按小时统计群聊与私聊消息吞吐曲线</span>
          </div>
          <div class="chart-legend-wrap">
            <span class="legend-dot"></span>
            <span class="legend-text">消息吞吐 (条/小时)</span>
          </div>
        </div>
      </template>
      <div ref="chartRef" class="echarts-box"></div>
    </el-card>

    <!-- 3. 底部：当前纳管微信群策略矩阵 (直接展示核心业务态，拒绝冗余与冲突) -->
    <el-card shadow="never" class="groups-matrix-card">
      <template #header>
        <div class="card-title-bar">
          <div class="title-with-desc">
            <span class="card-title">纳管微信群策略矩阵</span>
            <span class="card-desc">已纳管真实活跃群 · 独立 Prompt · 工具权限白名单</span>
          </div>
          <el-button type="primary" size="small" @click="goToGroupPolicy">
            前往多群策略编排 &gt;
          </el-button>
        </div>
      </template>

      <el-table :data="groupsList" style="width: 100%" class="matrix-table" empty-text="暂无纳管微信群">
        <el-table-column prop="name" label="微信群名称" min-width="160">
          <template #default="{ row }">
            <div class="group-cell">
              <el-avatar :size="32" shape="square" class="group-avatar">
                {{ row.name.slice(0, 2) }}
              </el-avatar>
              <div class="group-names">
                <span class="group-main-name">{{ row.name }}</span>
                <span class="group-sub-id">ID: {{ row.group_id }}</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="response_mode" label="响应模式" width="130">
          <template #default="{ row }">
            <el-tag size="small" type="success" effect="plain">
              {{ row.response_mode || 'SMART' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="AI 工具白名单" min-width="180">
          <template #default="{ row }">
            <div class="tools-tags" v-if="row.allowed_tools && row.allowed_tools.length">
              <el-tag
                v-for="tool in row.allowed_tools"
                :key="tool"
                size="small"
                type="info"
                class="tool-tag"
              >
                {{ tool }}
              </el-tag>
            </div>
            <span v-else class="text-muted">禁用工具</span>
          </template>
        </el-table-column>

        <el-table-column prop="message_count" label="累计事件" width="110" align="center">
          <template #default="{ row }">
            <span class="metric-num">{{ row.message_count || 0 }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="last_seen_at" label="最后活跃时间" min-width="160">
          <template #default="{ row }">
            <span class="time-text">{{ formatTime(row.last_seen_at) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="管理" width="90" align="right">
          <template #default>
            <el-button link type="primary" size="small" @click="goToGroupPolicy">
              配置
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { apiClient } from '../api/client';

const router = useRouter();
const chartRef = ref<HTMLDivElement>();
let myChart: echarts.ECharts | null = null;
let pollTimer: any = null;

const groupsList = ref<any[]>([]);

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

function formatTime(isoString: string) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function initChart() {
  if (!chartRef.value) return;
  if (!myChart) {
    myChart = echarts.init(chartRef.value, 'dark');
  }

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
      top: '12%',
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
    const [teleRes, groupsRes]: [any, any] = await Promise.all([
      apiClient.get('/telemetry'),
      apiClient.get('/groups'),
    ]);
    telemetry.value = teleRes;
    groupsList.value = groupsRes?.groups || [];
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

/* 1. 全链路拓扑驾驶舱 */
.pipeline-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.card-title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.title-with-desc {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #f8fafc;
}
.card-desc {
  font-size: 12px;
  color: #64748b;
}
.header-badges {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pipeline-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.pipeline-node {
  flex: 1;
  background-color: #0b1120;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 14px 16px;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pipeline-node.clickable {
  cursor: pointer;
}
.pipeline-node.clickable:hover {
  border-color: #38bdf8;
  background-color: #0d1629;
  transform: translateY(-2px);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.node-icon {
  font-size: 22px;
}
.node-meta {
  flex: 1;
  min-width: 0;
}
.node-title {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}
.node-subtitle {
  font-size: 11px;
  color: #64748b;
}

.node-main-val {
  font-size: 18px;
  font-weight: 700;
  color: #38bdf8;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.val-unit {
  font-size: 11.5px;
  color: #94a3b8;
  font-weight: 400;
}
.val-divider {
  margin: 0 6px;
  color: #475569;
}

.node-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 8px;
}
.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
}
.detail-label {
  color: #64748b;
}
.detail-val {
  color: #cbd5e1;
}
.detail-val code {
  color: #38bdf8;
  background: #1e293b;
  padding: 1px 4px;
  border-radius: 3px;
}
.detail-tip {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
  line-height: 1.4;
}

.pipeline-arrow {
  font-size: 18px;
  color: #334155;
  user-select: none;
  flex-shrink: 0;
}

/* 2. 趋势图卡片 */
.chart-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.chart-legend-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #38bdf8;
}
.legend-text {
  font-size: 12px;
  color: #94a3b8;
}
.echarts-box {
  width: 100%;
  height: 220px;
}

/* 3. 多群策略矩阵卡片 */
.groups-matrix-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.matrix-table {
  background-color: transparent !important;
}
:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #0b1120;
  --el-table-border-color: #1e293b;
  --el-table-text-color: #cbd5e1;
  --el-table-header-text-color: #94a3b8;
}
:deep(.el-table__row:hover > td) {
  background-color: #131c31 !important;
}
.group-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.group-avatar {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
}
.group-names {
  display: flex;
  flex-direction: column;
}
.group-main-name {
  color: #f8fafc;
  font-size: 13.5px;
  font-weight: 600;
}
.group-sub-id {
  color: #64748b;
  font-size: 11px;
}
.tools-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tool-tag {
  background: #1e293b;
  border-color: #334155;
  color: #94a3b8;
  font-size: 11px;
}
.metric-num {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #38bdf8;
  font-weight: 600;
}
.time-text {
  font-size: 12px;
  color: #94a3b8;
}
.text-muted {
  font-size: 12px;
  color: #64748b;
}
</style>

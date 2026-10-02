<template>
  <div class="dashboard-container">
    <!-- 顶部核心遥测指标卡片 -->
    <el-row :gutter="20" class="metric-row">
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
                {{ telemetry.gateway?.connected ? 'ONLINE' : (telemetry.gateway?.mode === 'server' ? 'LISTENING' : 'OFFLINE') }}
              </el-tag>
              <el-button link type="primary" size="small" class="config-btn" @click="openGatewayDialog">
                <el-icon><Setting /></el-icon> 配置
              </el-button>
            </div>
          </div>
          <div class="metric-value">
            {{ telemetry.gateway?.connected ? (telemetry.gateway?.accountName || '已连接') : (telemetry.gateway?.mode === 'server' ? '等待接入' : '断开重连') }}
          </div>
          <div class="metric-sub" :title="telemetry.gateway?.statusText || telemetry.gateway?.endpoint">
            <span v-if="telemetry.gateway?.mode === 'bridge_sync'">
              直连地址: <code>{{ telemetry.gateway?.bridgeUrl || 'http://39.97.255.91:6190' }}</code>
            </span>
            <span v-else-if="telemetry.gateway?.mode === 'server'">
              监视端口: <code>:{{ telemetry.gateway?.listenPort || 6199 }}</code>
              <span class="sub-hint">({{ telemetry.gateway?.clientCount || 0 }} 个客户端)</span>
            </span>
            <span v-else>
              远程地址: <code>{{ telemetry.gateway?.remoteUrl || '未配置' }}</code>
            </span>
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
        <div class="card-title-bar">
          <span class="card-title">近期消息流水快照</span>
          <span class="card-tip">当前监视源: {{ telemetry.gateway?.endpoint || '--' }}</span>
        </div>
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

    <!-- 网关接入与端口监控配置弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      title="网关接入与地址配置"
      width="580px"
      append-to-body
      class="gateway-dialog"
    >
      <el-form :model="form" label-position="top">
        <el-form-item label="接入方式">
          <el-radio-group v-model="form.gatewayMode" class="mode-radios">
            <el-radio-button label="bridge_sync">
              云端直连 (免隧道·推荐)
            </el-radio-button>
            <el-radio-button label="server">
              本地监听 (WS Server)
            </el-radio-button>
            <el-radio-button label="client">
              远程 WS (Client)
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 云端免隧道直连模式 -->
        <div v-if="form.gatewayMode === 'bridge_sync'" class="mode-desc-box">
          <div class="desc-text">
            <b>云端直连模式说明</b>：直接填入你的服务器公网 IP 或域名，Hub 将自动通过 HTTP REST & SSE 实时流无缝对齐云端微信状态与消息大盘，<b>无需手动打任何 SSH 隧道</b>。
          </div>
          <el-form-item label="Bridge 服务器地址 (IP 或完整 URL)" style="margin-top: 14px;">
            <el-input v-model="form.bridgeUrl" placeholder="例如 39.97.255.91 或 http://39.97.255.91:6190" />
            <div class="quick-presets">
              <span class="preset-label">快捷填充：</span>
              <el-button size="small" link type="primary" @click="form.bridgeUrl = 'http://39.97.255.91:6190'">
                阿里云服务器 (39.97.255.91:6190)
              </el-button>
              <el-button size="small" link type="primary" @click="form.bridgeUrl = 'http://127.0.0.1:6190'">
                本地 Bridge (127.0.0.1:6190)
              </el-button>
            </div>
          </el-form-item>
        </div>

        <!-- 本地监听模式 -->
        <div v-else-if="form.gatewayMode === 'server'" class="mode-desc-box">
          <div class="desc-text">
            <b>本地监听模式说明</b>：Hub 将在本地开启 OneBot v11 反向 WebSocket 服务端，等待本地运行的 Bridge 或外部客户端连入。
          </div>
          <el-form-item label="本地监听端口 (Listen Port)" style="margin-top: 14px;">
            <el-input-number v-model="form.gatewayServerPort" :min="1024" :max="65535" style="width: 200px;" />
            <div class="form-tip">生效监听地址：<code>ws://0.0.0.0:{{ form.gatewayServerPort }}/ws</code></div>
          </el-form-item>
        </div>

        <!-- 远程 WS 模式 -->
        <div v-else class="mode-desc-box">
          <div class="desc-text">
            <b>远程 WS 模式说明</b>：Hub 作为 OneBot 客户端主动连入指定的 WebSocket 服务端。
          </div>
          <el-form-item label="远程 WebSocket 地址 (WS URL)" style="margin-top: 14px;">
            <el-input v-model="form.gatewayRemoteUrl" placeholder="ws://39.97.255.91:6199/ws" />
          </el-form-item>
          <el-form-item label="鉴权 Token (可选)">
            <el-input v-model="form.gatewayToken" placeholder="若远程服务有 Token 保护请输入" show-password />
          </el-form-item>
        </div>

        <div class="status-summary-box">
          <div class="summary-title">当前网关连接实况：</div>
          <div class="summary-line">
            <b>当前模式</b>: {{ formatModeLabel(telemetry.gateway?.mode) }}
          </div>
          <div class="summary-line">
            <b>监控端点</b>: <code>{{ telemetry.gateway?.endpoint || '--' }}</code>
          </div>
          <div class="summary-line">
            <b>连接详情</b>: <span :class="telemetry.gateway?.connected ? 'text-green' : 'text-gray'">{{ telemetry.gateway?.statusText || '等待检测' }}</span>
          </div>
        </div>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveGatewayConfig">
            保存并立即连接
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import * as echarts from 'echarts';
import { Setting } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { apiClient, gatewayApi } from '../api/client';

const chartRef = ref<HTMLDivElement>();
let myChart: echarts.ECharts | null = null;
let pollTimer: any = null;

const telemetry = ref<any>({
  gateway: {
    connected: false,
    mode: 'bridge_sync',
    bridgeUrl: 'http://39.97.255.91:6190',
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

const dialogVisible = ref(false);
const saving = ref(false);
const form = ref({
  gatewayMode: 'bridge_sync',
  bridgeUrl: 'http://39.97.255.91:6190',
  gatewayServerPort: 6199,
  gatewayRemoteUrl: 'ws://39.97.255.91:6199/ws',
  gatewayToken: '',
});

function formatModeLabel(mode: string) {
  if (mode === 'bridge_sync') return '云端直连';
  if (mode === 'server') return '本地监听';
  if (mode === 'client') return '远程WS';
  return '未初始化';
}

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
  } catch {}
}

async function openGatewayDialog() {
  dialogVisible.value = true;
  try {
    const res: any = await gatewayApi.getConfig();
    if (res?.config) {
      form.value.gatewayMode = res.config.gatewayMode || 'bridge_sync';
      form.value.bridgeUrl = res.config.bridgeUrl || 'http://39.97.255.91:6190';
      form.value.gatewayServerPort = res.config.gatewayServerPort || 6199;
      form.value.gatewayRemoteUrl = res.config.gatewayRemoteUrl || 'ws://39.97.255.91:6199/ws';
      form.value.gatewayToken = res.config.gatewayToken || '';
    }
  } catch {}
}

async function saveGatewayConfig() {
  saving.value = true;
  try {
    const res: any = await gatewayApi.saveConfig(form.value);
    ElMessage.success(res?.message || '网关配置已更新并连接！');
    dialogVisible.value = false;
    await fetchData();
  } catch (err: any) {
    ElMessage.error(err?.message || '保存配置失败');
  } finally {
    saving.value = false;
  }
}

function handleResize() {
  myChart?.resize();
}

onMounted(() => {
  fetchData();
  window.addEventListener('resize', handleResize);
  pollTimer = setInterval(fetchData, 3500);
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
.label-with-mode {
  display: flex;
  align-items: center;
  gap: 8px;
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
  gap: 8px;
}
.config-btn {
  font-size: 12px;
  color: #94a3b8;
  padding: 0;
}
.config-btn:hover {
  color: #38bdf8;
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
.sub-hint {
  color: #94a3b8;
  margin-left: 4px;
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
.card-tip {
  font-size: 12px;
  color: #64748b;
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

/* 对话框定制 */
.mode-radios {
  display: flex;
  width: 100%;
}
.mode-desc-box {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.desc-text {
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.6;
}
.form-tip {
  font-size: 12px;
  color: #64748b;
  margin-top: 6px;
}
.form-tip code {
  color: #38bdf8;
}
.quick-presets {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.preset-label {
  font-size: 12px;
  color: #64748b;
}
.status-summary-box {
  background: #0b0f19;
  border: 1px dashed #334155;
  border-radius: 8px;
  padding: 12px;
  margin-top: 16px;
  font-size: 12px;
}
.summary-title {
  color: #94a3b8;
  font-weight: 600;
  margin-bottom: 6px;
}
.summary-line {
  color: #cbd5e1;
  margin-bottom: 4px;
}
.summary-line code {
  color: #38bdf8;
}
.text-green {
  color: #10b981;
}
.text-gray {
  color: #94a3b8;
}
</style>

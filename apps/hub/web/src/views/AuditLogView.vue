<template>
  <div class="audit-container">
    <!-- 1. 原生终端风格系统实时日志控制台 (Native Terminal / TTY) -->
    <el-card shadow="never" class="terminal-card">
      <template #header>
        <div class="terminal-header">
          <div class="terminal-header-left">
            <div class="window-dots">
              <span class="dot close"></span>
              <span class="dot minimize"></span>
              <span class="dot zoom"></span>
            </div>
            <span class="terminal-title">FEAGLE Hub System Terminal (TTY-1)</span>
            <el-tag size="small" type="success" effect="dark" class="streaming-tag">
              <span class="pulse-indicator"></span>
              LIVE STREAMING
            </el-tag>
          </div>

          <div class="terminal-header-right">
            <!-- 分类过滤 -->
            <el-radio-group v-model="filterTag" size="small" class="tag-filter-group">
              <el-radio-button label="ALL">全部</el-radio-button>
              <el-radio-button label="MSG">消息收发</el-radio-button>
              <el-radio-button label="GATEWAY">网关</el-radio-button>
              <el-radio-button label="POLICY">策略</el-radio-button>
              <el-radio-button label="SYSTEM">系统</el-radio-button>
            </el-radio-group>

            <!-- 自动滚屏开关 -->
            <el-switch
              v-model="autoScroll"
              inline-prompt
              active-text="滚屏"
              inactive-text="静止"
              class="auto-scroll-switch"
            />

            <!-- 一键清屏 -->
            <el-button size="small" type="danger" link @click="clearTerminal">
              清屏
            </el-button>

            <!-- 重新拉取 -->
            <el-button size="small" :icon="Refresh" circle @click="fetchSystemLogs" :loading="loadingTerminal" />
          </div>
        </div>
      </template>

      <!-- 终端正文屏幕 -->
      <div class="terminal-screen" ref="terminalScreenRef">
        <div class="terminal-welcome-banner">
          <pre class="ascii-art">
   ______ ______ ___   ______ __     ______   __  __ __  __ ____ 
  / ____// ____//   | / ____// /    / ____/  / / / // / / // __ )
 / /_   / __/  / /| |/ / __ / /    / __/    / /_/ // / / // __  |
/ __/  / /___ / ___ / /_/ // /___ / /___   / __  // /_/ // /_/ / 
/_/   /_____//_/  |_\____//_____//_____/  /_/ /_/ \____//_____/  
                                              [Kernel v2.0-Live]</pre>
          <div class="terminal-meta-line">
            Host: Linux WSL · Node.js {{ nodeVersion }} · Active Gateway: Bridge Direct Sync · Port: 6200
          </div>
        </div>

        <div class="terminal-log-rows">
          <div
            v-for="item in filteredLogs"
            :key="item.id"
            class="terminal-row"
            :class="item.level.toLowerCase()"
          >
            <span class="t-time">{{ item.timestamp }}</span>
            <span class="t-level" :class="item.level.toLowerCase()">[{{ item.level.padEnd(5) }}]</span>
            <span class="t-tag" :class="formatTagClass(item.tag)">[{{ item.tag }}]</span>
            <span class="t-msg">{{ item.message }}</span>
          </div>

          <div v-if="filteredLogs.length === 0" class="terminal-empty-tip">
            终端屏幕空闲中，正在持续监听网关收发报文与系统底层事件...
          </div>
        </div>

        <!-- 终端光标 -->
        <div class="terminal-prompt-line">
          <span class="t-prompt">feagle@hub:~$</span>
          <span class="t-cursor">█</span>
        </div>
      </div>
    </el-card>

    <!-- 2. 操作审计日志表格 (Audit Log Table) -->
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="card-header-bar">
          <div>
            <span class="card-title">系统操作审计日志 (Audit Log)</span>
            <span class="card-desc">记录管理端策略热变更、权限下发与系统安全事件</span>
          </div>
          <el-button type="primary" :icon="Refresh" @click="fetchLogs" :loading="loading">
            刷新审计记录
          </el-button>
        </div>
      </template>

      <el-table :data="logs" v-loading="loading" style="width: 100%" empty-text="暂无审计事件记录">
        <el-table-column prop="id" label="事件 ID" width="90">
          <template #default="{ row }">
            <code>#{{ row.id }}</code>
          </template>
        </el-table-column>

        <el-table-column prop="action" label="操作行为" width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="row.action === 'POLICY_UPDATE' ? 'warning' : (row.action.includes('CLEAN') ? 'danger' : 'primary')">
              {{ row.action }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="operator" label="操作人" width="120">
          <template #default="{ row }">
            <span class="operator-badge">{{ row.operator }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="details" label="操作详情与变更内容" min-width="260" show-overflow-tooltip />

        <el-table-column prop="created_at" label="记录时间" width="200">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { apiClient, systemLogsApi } from '../api/client';

const logs = ref<any[]>([]);
const loading = ref(false);

const terminalLogs = ref<any[]>([]);
const loadingTerminal = ref(false);
const autoScroll = ref(true);
const filterTag = ref('ALL');
const terminalScreenRef = ref<HTMLDivElement | null>(null);
const nodeVersion = ref('v22.x');

let eventSource: EventSource | null = null;

const filteredLogs = computed(() => {
  if (filterTag.value === 'ALL') return terminalLogs.value;
  if (filterTag.value === 'MSG') {
    return terminalLogs.value.filter(
      (l) => l.tag.startsWith('RECV') || l.tag.startsWith('SEND'),
    );
  }
  return terminalLogs.value.filter((l) => l.tag.includes(filterTag.value));
});

function formatTagClass(tag: string) {
  if (tag.startsWith('RECV')) return 'tag-recv';
  if (tag.startsWith('SEND')) return 'tag-send';
  if (tag.includes('GATEWAY')) return 'tag-gateway';
  if (tag.includes('POLICY')) return 'tag-policy';
  if (tag.includes('SYSTEM')) return 'tag-system';
  if (tag.includes('AUTH')) return 'tag-auth';
  return 'tag-default';
}

function scrollToBottom() {
  if (!autoScroll.value) return;
  nextTick(() => {
    if (terminalScreenRef.value) {
      terminalScreenRef.value.scrollTop = terminalScreenRef.value.scrollHeight;
    }
  });
}

function formatDateTime(iso: string) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

async function fetchSystemLogs() {
  loadingTerminal.value = true;
  try {
    const res: any = await systemLogsApi.getLogs(150);
    if (Array.isArray(res.logs)) {
      terminalLogs.value = res.logs;
      scrollToBottom();
    }
  } catch {
    // handled
  } finally {
    loadingTerminal.value = false;
  }
}

async function clearTerminal() {
  try {
    await systemLogsApi.clearLogs();
    terminalLogs.value = [];
    ElMessage.success('终端屏幕已清空');
  } catch (err: any) {
    ElMessage.error(err.message || '清屏失败');
  }
}

async function fetchLogs() {
  loading.value = true;
  try {
    const res: any = await apiClient.get('/audit');
    logs.value = res.logs || [];
  } catch {
    // handled
  } finally {
    loading.value = false;
  }
}

function setupSse() {
  const token = localStorage.getItem('hub_token');
  const base = import.meta.env.VITE_API_BASE || '/api';
  const url = `${base}/events?token=${encodeURIComponent(token || '')}`;

  eventSource = new EventSource(url);

  eventSource.addEventListener('init', (e: any) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.recentLogs) && terminalLogs.value.length === 0) {
        terminalLogs.value = data.recentLogs;
        scrollToBottom();
      }
    } catch {}
  });

  eventSource.addEventListener('system_log', (e: any) => {
    try {
      const logEntry = JSON.parse(e.data);
      terminalLogs.value.push(logEntry);
      if (terminalLogs.value.length > 500) {
        terminalLogs.value.shift();
      }
      scrollToBottom();
    } catch {}
  });

  eventSource.addEventListener('policy_update', () => {
    fetchLogs();
  });

  eventSource.addEventListener('group_removed', () => {
    fetchLogs();
  });
}

onMounted(() => {
  fetchSystemLogs();
  fetchLogs();
  setupSse();
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});
</script>

<style scoped>
.audit-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 终端外壳卡片 */
.terminal-card {
  background-color: #070b14;
  border: 1px solid #1e293b;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.terminal-card :deep(.el-card__header) {
  background-color: #0d1526;
  border-bottom: 1px solid #1e293b;
  padding: 10px 16px;
}

/* 终端头部标题栏 */
.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.window-dots {
  display: flex;
  gap: 6px;
}
.window-dots .dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.window-dots .close {
  background-color: #ef4444;
}
.window-dots .minimize {
  background-color: #f59e0b;
}
.window-dots .zoom {
  background-color: #10b981;
}

.terminal-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

.streaming-tag {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background-color: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
  color: #4ade80;
}
.pulse-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  animation: pulse 1.8s infinite;
}
@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.7; }
}

.terminal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tag-filter-group :deep(.el-radio-button__inner) {
  background-color: #1e293b;
  border-color: #334155;
  color: #94a3b8;
  font-size: 12px;
  padding: 5px 10px;
}
.tag-filter-group :deep(.el-radio-button.is-active .el-radio-button__inner) {
  background-color: #0284c7;
  border-color: #0284c7;
  color: #ffffff;
}

/* 终端屏幕主体 */
.terminal-screen {
  background-color: #070b14;
  height: 340px;
  overflow-y: auto;
  padding: 14px 18px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: #cbd5e1;
  scroll-behavior: smooth;
}

.terminal-welcome-banner {
  margin-bottom: 12px;
  user-select: none;
}
.ascii-art {
  color: #0284c7;
  font-size: 10px;
  line-height: 1.15;
  margin: 0 0 6px 0;
  font-family: monospace;
}
.terminal-meta-line {
  font-size: 11px;
  color: #475569;
  border-bottom: 1px dashed #1e293b;
  padding-bottom: 8px;
}

.terminal-log-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.terminal-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  word-break: break-all;
  white-space: pre-wrap;
  transition: background-color 0.15s;
}
.terminal-row:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.t-time {
  color: #64748b;
  font-size: 11.5px;
  flex-shrink: 0;
}
.t-level {
  font-weight: 700;
  font-size: 11.5px;
  flex-shrink: 0;
}
.t-level.info {
  color: #22c55e;
}
.t-level.warn {
  color: #f59e0b;
}
.t-level.error {
  color: #ef4444;
}
.t-level.debug {
  color: #38bdf8;
}

.t-tag {
  font-weight: 600;
  font-size: 11.5px;
  flex-shrink: 0;
}
.tag-recv {
  color: #c084fc;
}
.tag-send {
  color: #60a5fa;
}
.tag-gateway {
  color: #34d399;
}
.tag-policy {
  color: #fcd34d;
}
.tag-system {
  color: #94a3b8;
}
.tag-auth {
  color: #f472b6;
}
.tag-default {
  color: #cbd5e1;
}

.t-msg {
  color: #f1f5f9;
}

.terminal-empty-tip {
  color: #64748b;
  padding: 40px 0;
  text-align: center;
  font-style: italic;
}

.terminal-prompt-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: #38bdf8;
}
.t-prompt {
  font-weight: 600;
}
.t-cursor {
  animation: blink 1s step-start infinite;
  color: #38bdf8;
}
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 审计日志卡片 */
.page-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.card-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
}
.card-desc {
  font-size: 12px;
  color: #64748b;
  margin-left: 12px;
}
.operator-badge {
  font-weight: 600;
  color: #38bdf8;
}
:deep(.el-table) {
  background-color: transparent !important;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #1e293b;
  --el-table-border-color: #1e293b;
  color: #cbd5e1;
}
</style>

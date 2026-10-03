<template>
  <div class="tui-viewport">
    <!-- 顶部极简 TUI 控制栏 (去噪整合) -->
    <header class="tui-topbar">
      <div class="topbar-left">
        <span class="live-status-pill">
          <span class="live-dot"></span>
          LIVE ({{ filteredLogs.length }} 条)
        </span>

        <!-- 分类快速过滤 -->
        <div class="filter-group">
          <button
            class="filter-btn"
            :class="{ active: filterTag === 'ALL' }"
            @click="filterTag = 'ALL'"
          >
            全部
          </button>
          <button
            class="filter-btn"
            :class="{ active: filterTag === 'MSG' }"
            @click="filterTag = 'MSG'"
          >
            消息收发
          </button>
          <button
            class="filter-btn"
            :class="{ active: filterTag === 'GATEWAY' }"
            @click="filterTag = 'GATEWAY'"
          >
            网关
          </button>
          <button
            class="filter-btn"
            :class="{ active: filterTag === 'POLICY' }"
            @click="filterTag = 'POLICY'"
          >
            策略
          </button>
          <button
            class="filter-btn"
            :class="{ active: filterTag === 'SYSTEM' }"
            @click="filterTag = 'SYSTEM'"
          >
            系统
          </button>
        </div>
      </div>

      <div class="topbar-right">
        <button
          class="action-btn"
          :class="{ active: autoScroll }"
          @click="autoScroll = !autoScroll"
          title="切换自动滚动 [S]"
        >
          [S] 滚屏: {{ autoScroll ? 'ON' : 'OFF' }}
        </button>

        <button class="action-btn danger" @click="clearTerminal" title="一键清屏 [C]">
          [C] 清屏
        </button>

        <button class="action-btn" @click="copyLogs" title="复制日志 [E]">
          [E] 复制
        </button>

        <button class="action-btn" @click="refreshAll" :disabled="loadingTerminal || loadingAudit" title="重新对齐 [R]">
          [R] 刷新
        </button>
      </div>
    </header>

    <!-- 主体 TUI 分割视口：左 75% 纯净日志流，右 25% 紧凑审计 -->
    <main class="tui-split-workspace">
      <!-- ===== 左侧 3/4：纯净实时日志流 (无多余标题横幅，第一行直接看数据) ===== -->
      <section class="pane-stream" ref="systemLogScreenRef" @scroll="handleUserScroll">
        <div class="log-stream">
          <div
            v-for="item in filteredLogs"
            :key="item.id"
            class="log-line"
            :class="item.level.toLowerCase()"
          >
            <!-- 仅保留时分秒微秒，去掉重复年月日 -->
            <span class="l-time">{{ formatTimeOnly(item.timestamp) }}</span>

            <!-- 平常 INFO 隐藏不占位，只高亮 WARN / ERROR -->
            <span v-if="item.level !== 'INFO'" class="l-level" :class="item.level.toLowerCase()">
              [{{ item.level }}]
            </span>

            <!-- 业务标签 -->
            <span class="l-tag" :class="formatTagClass(item.tag)">
              [{{ formatShortTag(item.tag) }}]
            </span>

            <!-- 日志消息主体 -->
            <span class="l-msg">{{ item.message }}</span>
          </div>

          <div v-if="filteredLogs.length === 0" class="log-empty-tip">
            终端静默中，等待微信消息与系统事件流推送...
          </div>
        </div>
      </section>

      <!-- ===== 右侧 1/4：紧凑高密度操作审计日志 ===== -->
      <section class="pane-audit">
        <div class="audit-header">
          <span class="audit-title">审计流水 ({{ auditLogs.length }})</span>
        </div>

        <div class="audit-list">
          <div
            v-for="log in auditLogs"
            :key="log.id"
            class="audit-row"
          >
            <div class="audit-meta-line">
              <span class="audit-time">{{ formatTimeOnly(log.created_at) }}</span>
              <span class="audit-id">#{{ log.id }}</span>
              <span class="audit-act" :class="formatActionClass(log.action)">
                [{{ log.action }}]
              </span>
              <span class="audit-operator">{{ log.operator }}</span>
            </div>
            <div class="audit-detail" :title="log.details">
              ↳ {{ log.details }}
            </div>
          </div>

          <div v-if="auditLogs.length === 0" class="audit-empty-tip">
            暂无操作审计记录
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { apiClient, systemLogsApi } from '../api/client';

const terminalLogs = ref<any[]>([]);
const auditLogs = ref<any[]>([]);
const loadingTerminal = ref(false);
const loadingAudit = ref(false);
const autoScroll = ref(true);
const filterTag = ref('ALL');
const systemLogScreenRef = ref<HTMLDivElement | null>(null);

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

function formatTimeOnly(timeStr: string) {
  if (!timeStr) return '--:--:--';
  // 如果是 '2026-10-02 17:32:58.590'，截取时分秒部分
  if (timeStr.includes(' ')) {
    return timeStr.split(' ')[1] || timeStr;
  }
  // 如果是 ISO 字符串
  try {
    const d = new Date(timeStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return timeStr;
  }
}

function formatShortTag(tag: string) {
  if (tag === 'RECV:GROUP') return 'RECV';
  if (tag === 'RECV:PRIV') return 'PRIV';
  if (tag === 'SEND:MSG') return 'SEND';
  if (tag === 'SEND:ACTION') return 'ACTION';
  return tag;
}

function formatTagClass(tag: string) {
  if (tag.startsWith('RECV')) return 'tag-recv';
  if (tag.startsWith('SEND')) return 'tag-send';
  if (tag.includes('GATEWAY')) return 'tag-gateway';
  if (tag.includes('POLICY')) return 'tag-policy';
  if (tag.includes('SYSTEM')) return 'tag-system';
  if (tag.includes('AUTH')) return 'tag-auth';
  return 'tag-default';
}

function formatActionClass(action: string) {
  if (action === 'POLICY_UPDATE') return 'act-policy';
  if (action.includes('CLEAN') || action.includes('REMOVE')) return 'act-danger';
  if (action.includes('LOGIN')) return 'act-auth';
  return 'act-default';
}

function scrollToBottom() {
  if (!autoScroll.value) return;
  nextTick(() => {
    if (systemLogScreenRef.value) {
      systemLogScreenRef.value.scrollTop = systemLogScreenRef.value.scrollHeight;
    }
  });
}

function handleUserScroll() {
  if (!systemLogScreenRef.value) return;
  const { scrollTop, scrollHeight, clientHeight } = systemLogScreenRef.value;
  const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 50;
  if (!isNearBottom && autoScroll.value) {
    autoScroll.value = false;
  }
}

async function fetchSystemLogs() {
  loadingTerminal.value = true;
  try {
    const res: any = await systemLogsApi.getLogs(200);
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

async function fetchAuditLogs() {
  loadingAudit.value = true;
  try {
    const res: any = await apiClient.get('/audit');
    auditLogs.value = res.logs || [];
  } catch {
    // handled
  } finally {
    loadingAudit.value = false;
  }
}

async function refreshAll() {
  await Promise.all([fetchSystemLogs(), fetchAuditLogs()]);
  ElMessage.success('日志已刷新');
}

async function clearTerminal() {
  try {
    await systemLogsApi.clearLogs();
    terminalLogs.value = [];
    ElMessage.success('屏幕已清空');
  } catch (err: any) {
    ElMessage.error(err.message || '清屏失败');
  }
}

function copyLogs() {
  const content = filteredLogs.value
    .map((l) => `[${formatTimeOnly(l.timestamp)}] [${l.level.padEnd(5)}] [${l.tag.padEnd(10)}] ${l.message}`)
    .join('\n');
  navigator.clipboard.writeText(content).then(() => {
    ElMessage.success(`已复制 ${filteredLogs.value.length} 条日志`);
  }).catch(() => {
    ElMessage.error('复制失败');
  });
}

// 键盘快捷键监听
function handleKeyDown(e: KeyboardEvent) {
  if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

  const key = e.key.toLowerCase();
  if (key === '1') filterTag.value = 'ALL';
  else if (key === '2') filterTag.value = 'MSG';
  else if (key === '3') filterTag.value = 'GATEWAY';
  else if (key === '4') filterTag.value = 'POLICY';
  else if (key === '5') filterTag.value = 'SYSTEM';
  else if (key === 's') autoScroll.value = !autoScroll.value;
  else if (key === 'c') clearTerminal();
  else if (key === 'r') refreshAll();
  else if (key === 'e') copyLogs();
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
    fetchAuditLogs();
  });

  eventSource.addEventListener('group_removed', () => {
    fetchAuditLogs();
  });
}

onMounted(() => {
  fetchSystemLogs();
  fetchAuditLogs();
  setupSse();
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
/* 全屏 TUI 视口容器 */
.tui-viewport {
  height: calc(100vh - 112px);
  display: flex;
  flex-direction: column;
  background-color: #050811;
  border: 1px solid #1e293b;
  border-radius: 8px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

/* 顶部极简状态与控制栏 */
.tui-topbar {
  height: 38px;
  background-color: #090e1a;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  flex-shrink: 0;
  user-select: none;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.live-status-pill {
  font-size: 11px;
  font-weight: 600;
  color: #4ade80;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(34, 197, 94, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(34, 197, 94, 0.25);
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 6px #22c55e;
  animation: pulse 1.8s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.2); }
}

.filter-group {
  display: flex;
  gap: 2px;
  background: #0f172a;
  padding: 2px;
  border-radius: 5px;
  border: 1px solid #1e293b;
}
.filter-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-family: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.12s;
}
.filter-btn:hover {
  color: #f8fafc;
  background-color: #1e293b;
}
.filter-btn.active {
  background-color: #0284c7;
  color: #ffffff;
  font-weight: 600;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.action-btn {
  background: #0f172a;
  border: 1px solid #1e293b;
  color: #cbd5e1;
  font-family: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
}
.action-btn:hover {
  border-color: #38bdf8;
  color: #f8fafc;
}
.action-btn.active {
  border-color: #22c55e;
  color: #4ade80;
  background-color: rgba(34, 197, 94, 0.08);
}
.action-btn.danger:hover {
  border-color: #ef4444;
  color: #f87171;
  background-color: rgba(239, 68, 68, 0.08);
}

/* 主体分屏 */
.tui-split-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧 75% 纯净日志屏幕 */
.pane-stream {
  width: 75%;
  height: 100%;
  overflow-y: auto;
  padding: 10px 14px;
  background-color: #050811;
  border-right: 1px solid #1e293b;
  scroll-behavior: smooth;
}
.log-stream {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.log-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  transition: background-color 0.1s;
}
.log-line:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.l-time {
  color: #64748b;
  font-size: 11px;
  flex-shrink: 0;
}
.l-level {
  font-weight: 700;
  font-size: 11px;
  flex-shrink: 0;
}
.l-level.warn {
  color: #f59e0b;
}
.l-level.error {
  color: #ef4444;
}

.l-tag {
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
}
.tag-recv {
  color: #c084fc;
}
.tag-send {
  color: #38bdf8;
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

.l-msg {
  color: #f1f5f9;
}

.log-empty-tip {
  color: #64748b;
  font-style: italic;
  padding: 60px 0;
  text-align: center;
}

/* 右侧 25% 紧凑审计面板 */
.pane-audit {
  width: 25%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #070b16;
  overflow: hidden;
}
.audit-header {
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background-color: #0b1120;
  border-bottom: 1px solid #1e293b;
  flex-shrink: 0;
}
.audit-title {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

.audit-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.audit-row {
  border-bottom: 1px dashed #1e293b;
  padding-bottom: 6px;
  transition: all 0.15s;
}
.audit-row:hover {
  background-color: rgba(255, 255, 255, 0.02);
}
.audit-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  margin-bottom: 2px;
}
.audit-time {
  color: #64748b;
}
.audit-id {
  color: #475569;
}
.audit-act {
  font-weight: 700;
  font-size: 10.5px;
}
.act-policy {
  color: #f59e0b;
}
.act-danger {
  color: #ef4444;
}
.act-auth {
  color: #38bdf8;
}
.act-default {
  color: #a855f7;
}

.audit-operator {
  margin-left: auto;
  color: #38bdf8;
}
.audit-detail {
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.4;
  word-break: break-all;
}

.audit-empty-tip {
  color: #64748b;
  text-align: center;
  font-style: italic;
  padding: 40px 0;
  font-size: 11px;
}
</style>

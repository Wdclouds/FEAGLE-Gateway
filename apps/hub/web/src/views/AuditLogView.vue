<template>
  <div class="tui-viewport">
    <!-- 顶部 TUI 状态与操作栏 (Cockpit Status Bar) -->
    <header class="tui-topbar">
      <div class="topbar-left">
        <span class="tui-badge brand">FEAGLE-TUI</span>
        <span class="tui-badge live">
          <span class="live-pulse"></span>
          LIVE STREAMING
        </span>
        <span class="tui-meta-item">
          HOST: <code>Linux WSL</code>
        </span>
        <span class="tui-meta-item">
          GATEWAY: <code>BRIDGE_SYNC</code>
        </span>
      </div>

      <div class="topbar-center">
        <!-- TUI 快捷键指示标签 / 快速过滤 -->
        <div class="tui-filter-keys">
          <button
            class="tui-key-btn"
            :class="{ active: filterTag === 'ALL' }"
            @click="filterTag = 'ALL'"
          >
            <span class="key">[1]</span> 全部
          </button>
          <button
            class="tui-key-btn"
            :class="{ active: filterTag === 'MSG' }"
            @click="filterTag = 'MSG'"
          >
            <span class="key">[2]</span> 消息收发
          </button>
          <button
            class="tui-key-btn"
            :class="{ active: filterTag === 'GATEWAY' }"
            @click="filterTag = 'GATEWAY'"
          >
            <span class="key">[3]</span> 网关
          </button>
          <button
            class="tui-key-btn"
            :class="{ active: filterTag === 'POLICY' }"
            @click="filterTag = 'POLICY'"
          >
            <span class="key">[4]</span> 策略
          </button>
          <button
            class="tui-key-btn"
            :class="{ active: filterTag === 'SYSTEM' }"
            @click="filterTag = 'SYSTEM'"
          >
            <span class="key">[5]</span> 系统
          </button>
        </div>
      </div>

      <div class="topbar-right">
        <button
          class="tui-action-btn"
          :class="{ active: autoScroll }"
          @click="autoScroll = !autoScroll"
          title="切换自动滚动 [S]"
        >
          <span class="key">[S]</span> 自动滚屏: {{ autoScroll ? 'ON' : 'OFF' }}
        </button>

        <button class="tui-action-btn danger" @click="clearTerminal" title="一键清屏 [C]">
          <span class="key">[C]</span> 清屏
        </button>

        <button class="tui-action-btn" @click="copyLogs" title="复制当前日志 [E]">
          <span class="key">[E]</span> 复制
        </button>

        <button class="tui-action-btn" @click="refreshAll" :disabled="loadingTerminal || loadingAudit" title="重新拉取 [R]">
          <span class="key">[R]</span> 刷新
        </button>
      </div>
    </header>

    <!-- 主体 TUI 分割视口 (左 3/4 正常日志，右 1/4 操作审计日志) -->
    <main class="tui-split-workspace">
      <!-- ===== 左侧 3/4：正常系统日志与消息收发流水终端 ===== -->
      <section class="tui-pane pane-system-logs">
        <div class="pane-header">
          <div class="pane-title-box">
            <span class="pane-corner">┌──</span>
            <span class="pane-name">PANE 1: SYSTEM &amp; WECHAT MESSAGE STREAM (75%)</span>
            <span class="pane-badge-count">{{ filteredLogs.length }} LINES</span>
          </div>
          <div class="pane-header-tools">
            <span class="filter-indicator">FILTER: {{ filterTag }}</span>
            <span class="pane-corner">──┐</span>
          </div>
        </div>

        <div class="pane-screen" ref="systemLogScreenRef" @scroll="handleUserScroll">
          <!-- ASCII 欢迎横幅 -->
          <div class="terminal-banner">
            <pre class="ascii-title">
   ______ ______ ___   ______ __     ______   __  __ __  __ ____ 
  / ____// ____//   | / ____// /    / ____/  / / / // / / // __ )
 / /_   / __/  / /| |/ / __ / /    / __/    / /_/ // / / // __  |
/ __/  / /___ / ___ / /_/ // /___ / /___   / __  // /_/ // /_/ / 
/_/   /_____//_/  |_\____//_____//_____/  /_/ /_/ \____//_____/  
                                              [Kernel v2.0-Live]</pre>
            <div class="banner-subtext">
              Active Connection: Direct Bridge Sync · WebSocket Engine: Ready · Buffer: {{ terminalLogs.length }}/500
            </div>
          </div>

          <!-- 日志流水行 -->
          <div class="log-stream">
            <div
              v-for="item in filteredLogs"
              :key="item.id"
              class="log-line"
              :class="item.level.toLowerCase()"
            >
              <span class="l-time">{{ item.timestamp }}</span>
              <span class="l-level" :class="item.level.toLowerCase()">[{{ item.level.padEnd(5) }}]</span>
              <span class="l-tag" :class="formatTagClass(item.tag)">[{{ item.tag.padEnd(10) }}]</span>
              <span class="l-msg">{{ item.message }}</span>
            </div>

            <div v-if="filteredLogs.length === 0" class="log-empty-state">
              [SYSTEM] 终端就绪，等待入站消息与系统事件推流...
            </div>
          </div>

          <!-- 终端光标行 -->
          <div class="tui-prompt-row">
            <span class="tui-prompt">feagle@hub:~$</span>
            <span class="tui-cursor">█</span>
          </div>
        </div>

        <div class="pane-footer">
          <span class="pane-corner">└──</span>
          <span class="footer-meta">
            STREAM: ACTIVE · CLIENTS: 1 · AUTO-SCROLL: {{ autoScroll ? 'ENABLED' : 'PAUSED' }}
          </span>
          <span class="pane-corner">──┘</span>
        </div>
      </section>

      <!-- ===== 右侧 1/4：操作审计日志 (Operation Audit Log) ===== -->
      <section class="tui-pane pane-audit-logs">
        <div class="pane-header">
          <div class="pane-title-box">
            <span class="pane-corner">┌──</span>
            <span class="pane-name">PANE 2: AUDIT LOG (25%)</span>
            <span class="pane-badge-count">{{ auditLogs.length }} EVENTS</span>
          </div>
          <div class="pane-header-tools">
            <span class="pane-corner">──┐</span>
          </div>
        </div>

        <div class="pane-screen audit-screen">
          <div class="audit-list">
            <div
              v-for="log in auditLogs"
              :key="log.id"
              class="audit-card"
            >
              <div class="audit-top">
                <span class="audit-id">#{{ log.id }}</span>
                <span
                  class="audit-act"
                  :class="formatActionClass(log.action)"
                >
                  [{{ log.action }}]
                </span>
                <span class="audit-op">{{ log.operator }}</span>
              </div>
              <div class="audit-desc" :title="log.details">
                {{ log.details }}
              </div>
              <div class="audit-time">
                {{ formatDateTime(log.created_at) }}
              </div>
            </div>

            <div v-if="auditLogs.length === 0" class="audit-empty-state">
              [AUDIT] 暂无管理审计记录
            </div>
          </div>
        </div>

        <div class="pane-footer">
          <span class="pane-corner">└──</span>
          <span class="footer-meta">
            AUDIT RECORDS: {{ auditLogs.length }} TOTAL
          </span>
          <span class="pane-corner">──┘</span>
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

function formatDateTime(iso: string) {
  if (!iso) return '--';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  // 如果用户手动往上翻阅超过 60px，暂时暂停自动吸底
  const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 60;
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
  ElMessage.success('TUI 双面板数据已对齐最新状态');
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

function copyLogs() {
  const content = filteredLogs.value
    .map((l) => `[${l.timestamp}] [${l.level.padEnd(5)}] [${l.tag.padEnd(10)}] ${l.message}`)
    .join('\n');
  navigator.clipboard.writeText(content).then(() => {
    ElMessage.success(`已复制 ${filteredLogs.value.length} 条终端日志到剪贴板`);
  }).catch(() => {
    ElMessage.error('复制失败');
  });
}

// 键盘快捷键监听
function handleKeyDown(e: KeyboardEvent) {
  // 如果当前焦点在输入框中则不触发
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
/* 全屏 TUI 容器：占满可视区，彻底杜绝外层页面滚动条 */
.tui-viewport {
  height: calc(100vh - 112px);
  display: flex;
  flex-direction: column;
  background-color: #050811;
  border: 1px solid #1e293b;
  border-radius: 10px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
}

/* 顶部 TUI 状态与操作栏 */
.tui-topbar {
  height: 44px;
  background-color: #0a0f1d;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  user-select: none;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tui-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}
.tui-badge.brand {
  background-color: #0284c7;
  color: #ffffff;
}
.tui-badge.live {
  background-color: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.live-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 6px #22c55e;
  animation: tui-pulse 1.8s infinite;
}
@keyframes tui-pulse {
  0% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0.6; transform: scale(0.9); }
}
.tui-meta-item {
  font-size: 11px;
  color: #64748b;
}
.tui-meta-item code {
  color: #38bdf8;
  background: #0f172a;
  padding: 1px 5px;
  border-radius: 3px;
}

/* 中间快捷过滤按键 */
.topbar-center {
  display: flex;
  align-items: center;
}
.tui-filter-keys {
  display: flex;
  gap: 4px;
  background: #0f172a;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid #1e293b;
}
.tui-key-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-family: inherit;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.tui-key-btn:hover {
  color: #f8fafc;
  background-color: #1e293b;
}
.tui-key-btn.active {
  background-color: #0284c7;
  color: #ffffff;
  font-weight: 600;
}
.tui-key-btn .key {
  color: #38bdf8;
}
.tui-key-btn.active .key {
  color: #e0f2fe;
}

/* 右侧控制键 */
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tui-action-btn {
  background: #0f172a;
  border: 1px solid #1e293b;
  color: #cbd5e1;
  font-family: inherit;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tui-action-btn:hover {
  border-color: #38bdf8;
  color: #f8fafc;
}
.tui-action-btn.active {
  border-color: #22c55e;
  color: #4ade80;
  background-color: rgba(34, 197, 94, 0.08);
}
.tui-action-btn.danger:hover {
  border-color: #ef4444;
  color: #f87171;
  background-color: rgba(239, 68, 68, 0.08);
}
.tui-action-btn .key {
  color: #38bdf8;
  font-weight: 700;
}

/* 主体 TUI 分割视口 */
.tui-split-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* 通用窗格样式 */
.tui-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.pane-system-logs {
  width: 75%; /* 左侧 3/4 */
  border-right: 1px solid #1e293b;
}
.pane-audit-logs {
  width: 25%; /* 右侧 1/4 */
}

/* 窗格头部 */
.pane-header {
  height: 32px;
  background-color: #080d19;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11.5px;
  color: #64748b;
  flex-shrink: 0;
  user-select: none;
}
.pane-title-box {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pane-corner {
  color: #38bdf8;
  font-weight: 700;
}
.pane-name {
  color: #e2e8f0;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.pane-badge-count {
  font-size: 10px;
  background: #1e293b;
  color: #38bdf8;
  padding: 1px 6px;
  border-radius: 10px;
}
.pane-header-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-indicator {
  font-size: 10.5px;
  color: #94a3b8;
}

/* 窗格底部 */
.pane-footer {
  height: 26px;
  background-color: #080d19;
  border-top: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 10.5px;
  color: #475569;
  flex-shrink: 0;
  user-select: none;
}
.footer-meta {
  color: #64748b;
  letter-spacing: 0.5px;
}

/* 窗格正文屏幕 (滚动区) */
.pane-screen {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  background-color: #050811;
  scroll-behavior: smooth;
}

/* 左侧系统日志流 */
.terminal-banner {
  margin-bottom: 14px;
  user-select: none;
}
.ascii-title {
  color: #0284c7;
  font-size: 10px;
  line-height: 1.15;
  margin: 0;
}
.banner-subtext {
  font-size: 11px;
  color: #475569;
  border-bottom: 1px dashed #1e293b;
  padding: 6px 0 8px 0;
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
  line-height: 1.6;
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
.l-level.info {
  color: #22c55e;
}
.l-level.warn {
  color: #f59e0b;
}
.l-level.error {
  color: #ef4444;
}
.l-level.debug {
  color: #38bdf8;
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

.l-msg {
  color: #f1f5f9;
}

.log-empty-state {
  color: #64748b;
  font-style: italic;
  padding: 40px 0;
  text-align: center;
}

.tui-prompt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: #38bdf8;
  font-size: 12px;
}
.tui-prompt {
  font-weight: 600;
}
.tui-cursor {
  animation: tui-blink 1s step-start infinite;
  color: #38bdf8;
}
@keyframes tui-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 右侧操作审计日志列表 */
.audit-screen {
  background-color: #060914;
  padding: 10px;
}
.audit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.audit-card {
  background: #0a0f1d;
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 8px 10px;
  transition: all 0.15s;
}
.audit-card:hover {
  border-color: #334155;
  background-color: #0d1527;
}
.audit-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.audit-id {
  color: #64748b;
  font-size: 10.5px;
}
.audit-act {
  font-size: 11px;
  font-weight: 700;
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

.audit-op {
  margin-left: auto;
  font-size: 10.5px;
  color: #38bdf8;
  background: #0f172a;
  padding: 1px 5px;
  border-radius: 3px;
}
.audit-desc {
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.45;
  margin-bottom: 4px;
  word-break: break-all;
}
.audit-time {
  font-size: 10px;
  color: #475569;
  text-align: right;
}

.audit-empty-state {
  color: #64748b;
  text-align: center;
  font-style: italic;
  padding: 40px 0;
  font-size: 11px;
}
</style>

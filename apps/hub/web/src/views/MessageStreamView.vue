<template>
  <div class="stream-container">
    <el-card shadow="never" class="stream-card">
      <template #header>
        <div class="header-bar">
          <div class="left-box">
            <span class="card-title">全双工实时消息流 (Live Stream)</span>
            <span class="status-indicator">
              <span class="dot" :class="{ online: isSseConnected }"></span>
              {{ isSseConnected ? 'SSE 实时推流监听中' : '正在重新连接...' }}
            </span>
          </div>

          <div class="right-box">
            <el-input
              v-model="keyword"
              placeholder="搜索发言人或消息内容..."
              size="small"
              clearable
              style="width: 200px"
            />
            <el-button size="small" @click="messages = []">清空屏幕</el-button>
          </div>
        </div>
      </template>

      <!-- 实时消息列表 -->
      <div class="messages-scroll-box" ref="scrollBoxRef">
        <div v-if="filteredMessages.length === 0" class="empty-state">
          <span>暂无匹配的实时消息流（等待微信群/私聊入站事件）</span>
        </div>

        <div
          v-for="msg in filteredMessages"
          :key="msg.id"
          class="message-bubble"
          :class="{ 'group-type': msg.type === 'group' }"
        >
          <div class="msg-header">
            <div class="msg-meta">
              <el-tag size="small" :type="msg.type === 'group' ? 'warning' : 'info'">
                {{ msg.type === 'group' ? (msg.groupName || '群聊') : '私聊' }}
              </el-tag>
              <span class="sender-name">{{ msg.sender }}</span>
            </div>
            <span class="msg-time">{{ formatTime(msg.time) }}</span>
          </div>
          <div class="msg-content">{{ msg.text }}</div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

interface StreamMessage {
  id: number | string;
  type: string;
  groupId?: string | null;
  groupName?: string;
  sender: string;
  text: string;
  time: string;
}

const messages = ref<StreamMessage[]>([]);
const isSseConnected = ref(false);
const keyword = ref('');
const scrollBoxRef = ref<HTMLDivElement>();
let eventSource: EventSource | null = null;

const filteredMessages = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return messages.value;
  return messages.value.filter(
    (m) =>
      m.text.toLowerCase().includes(kw) ||
      m.sender.toLowerCase().includes(kw) ||
      (m.groupName && m.groupName.toLowerCase().includes(kw)),
  );
});

function formatTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollBoxRef.value) {
      scrollBoxRef.value.scrollTop = scrollBoxRef.value.scrollHeight;
    }
  });
}

function initSse() {
  if (eventSource) eventSource.close();

  const token = localStorage.getItem('hub_token') || '';
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

  eventSource.onopen = () => {
    isSseConnected.value = true;
  };

  eventSource.addEventListener('init', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.recentMessages)) {
        messages.value = [...data.recentMessages];
        scrollToBottom();
      }
    } catch {
      // ignore
    }
  });

  eventSource.addEventListener('message', (e) => {
    try {
      const msg: StreamMessage = JSON.parse(e.data);
      messages.value.push(msg);
      if (messages.value.length > 200) messages.value.shift();
      scrollToBottom();
    } catch {
      // ignore
    }
  });

  eventSource.onerror = () => {
    isSseConnected.value = false;
  };
}

onMounted(() => {
  initSse();
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});
</script>

<style scoped>
.stream-container {
  height: calc(100vh - 112px);
  display: flex;
  flex-direction: column;
}
.stream-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.stream-card :deep(.el-card__body) {
  flex: 1;
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
}
.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.left-box {
  display: flex;
  align-items: center;
  gap: 16px;
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
}
.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #64748b;
}
.dot.online {
  background-color: #22c55e;
  box-shadow: 0 0 8px #22c55e;
}
.right-box {
  display: flex;
  gap: 12px;
}
.messages-scroll-box {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 8px;
}
.empty-state {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 13px;
}
.message-bubble {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 12px 16px;
  transition: border-color 0.2s;
}
.message-bubble:hover {
  border-color: #38bdf8;
}
.message-bubble.group-type {
  border-left: 3px solid #eab308;
}
.msg-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sender-name {
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
}
.msg-time {
  font-size: 11px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}
.msg-content {
  font-size: 13.5px;
  color: #cbd5e1;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

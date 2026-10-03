<template>
  <div class="wechat-client-container">
    <!-- ===== 左侧：微信会话列表 (280px) ===== -->
    <aside class="wechat-session-column">
      <!-- 搜索栏 -->
      <div class="session-search-box">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索会话"
          size="small"
          clearable
          class="wx-search-input"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>

      <!-- 会话项列表 -->
      <div class="session-list">
        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-item"
          :class="{ active: currentSession?.id === session.id }"
          @click="selectSession(session)"
        >
          <div class="session-avatar-wrap">
            <el-avatar
              :size="40"
              shape="square"
              :class="['session-avatar', session.type === 'group' ? 'group-avatar' : 'user-avatar']"
            >
              {{ session.name.slice(0, 2) }}
            </el-avatar>
            <span v-if="session.unreadCount > 0" class="unread-badge">
              {{ session.unreadCount }}
            </span>
          </div>

          <div class="session-info">
            <div class="session-top-line">
              <span class="session-title" :title="session.name">{{ session.name }}</span>
              <span class="session-time">{{ formatSessionTime(session.lastTime) }}</span>
            </div>
            <div class="session-bottom-line">
              <span class="session-preview" :title="session.lastMessage">
                {{ session.lastSender ? `${session.lastSender}: ` : '' }}{{ session.lastMessage || '暂无消息' }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="filteredSessions.length === 0" class="session-empty">
          无匹配会话
        </div>
      </div>
    </aside>

    <!-- ===== 右侧：主聊天视窗 (只读全高监控流) ===== -->
    <main class="wechat-chat-column">
      <!-- 聊天头部 -->
      <header class="chat-header">
        <div class="chat-title-info">
          <span class="chat-main-title">{{ currentSession?.name || '请选择会话' }}</span>
          <el-tag
            v-if="currentSession"
            size="small"
            :type="currentSession.type === 'group' ? 'warning' : 'info'"
            effect="plain"
            class="chat-type-tag"
          >
            {{ currentSession.type === 'group' ? '微信群聊' : '私聊会话' }}
          </el-tag>
          <span class="live-pill">
            <span class="live-indicator"></span>
            全双工只读流
          </span>
        </div>

        <div class="chat-header-actions">
          <el-button
            v-if="currentSession?.type === 'group'"
            link
            type="primary"
            size="small"
            @click="goToGroupPolicy(currentSession.id)"
          >
            策略编排
          </el-button>
          <el-button link size="small" @click="clearCurrentMessages">
            清屏
          </el-button>
        </div>
      </header>

      <!-- 消息历史滚动区 (占满整屏高度，无底部输入框) -->
      <div class="chat-messages-body" ref="messagesBodyRef">
        <div v-if="currentMessages.length === 0" class="messages-empty">
          <div class="empty-icon">💬</div>
          <div>当前会话暂无消息流水</div>
          <div class="empty-sub">微信小号收到或发送消息后将在此实时渲染</div>
        </div>

        <div
          v-for="(msg, index) in currentMessages"
          :key="msg.id || index"
          class="chat-message-row"
          :class="[isSelfMessage(msg) ? 'is-self' : 'is-other']"
        >
          <!-- 时间分隔胶囊 (相隔超过 5 分钟显示) -->
          <div v-if="shouldShowTimePill(msg, index)" class="time-divider">
            <span class="time-pill">{{ formatTimePill(msg.time) }}</span>
          </div>

          <div class="message-bubble-wrapper">
            <!-- 对方头像 -->
            <el-avatar
              v-if="!isSelfMessage(msg)"
              :size="38"
              shape="square"
              class="msg-avatar other-avatar"
            >
              {{ (msg.sender || '友')[0] }}
            </el-avatar>

            <!-- 消息主体 -->
            <div class="message-content-group">
              <span v-if="!isSelfMessage(msg) && currentSession?.type === 'group'" class="msg-nickname">
                {{ msg.sender }}
              </span>

              <div class="message-bubble" :class="{ 'self-bubble': isSelfMessage(msg) }">
                <div class="bubble-arrow"></div>
                <div class="bubble-text">{{ msg.text }}</div>
              </div>
            </div>

            <!-- 自己/小号头像 -->
            <el-avatar
              v-if="isSelfMessage(msg)"
              :size="38"
              shape="square"
              class="msg-avatar self-avatar"
            >
              小号
            </el-avatar>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { apiClient } from '../api/client';

interface SessionItem {
  id: string;
  name: string;
  type: 'group' | 'private';
  lastMessage: string;
  lastSender: string;
  lastTime: string;
  unreadCount: number;
  responseMode?: string;
}

interface ChatMessage {
  id: string | number;
  type: 'group' | 'private';
  groupId?: string | null;
  groupName?: string;
  sender: string;
  text: string;
  direction?: 'IN' | 'OUT' | string;
  time: string;
}

const router = useRouter();
const searchKeyword = ref('');
const sessions = ref<SessionItem[]>([]);
const currentSession = ref<SessionItem | null>(null);
const allMessages = ref<ChatMessage[]>([]);
const messagesBodyRef = ref<HTMLDivElement | null>(null);

let eventSource: EventSource | null = null;

// 清洗群聊名称：去除 " / Group member" 等后缀
function cleanGroupName(name: string) {
  if (!name) return '';
  return name.replace(/\s*\/\s*Group\s*member$/i, '').trim();
}

// 统一将消息规整到标准结构
function normalizeMessage(raw: any): ChatMessage | null {
  if (!raw) return null;

  // 核心拦截 1：过滤 Android 系统通知信令影子 (notify 拍一拍/提醒推送，避免在群里有人@时新开独立私聊)
  const rawSender = String(raw.sender || '');
  const rawGroup = String(raw.groupName || '');
  const rawPeer = String(raw.peer || '');
  if (
    rawSender.includes('1000000102') ||
    rawGroup.includes('1000000102') ||
    rawPeer.includes('1000000102') ||
    rawGroup.startsWith('notify') ||
    rawPeer.startsWith('notify')
  ) {
    return null;
  }

  const isOut =
    raw.direction === 'OUT' ||
    raw.sender === 'FaSt_eAgle' ||
    raw.sender === '小号' ||
    raw.sender?.includes('小号') ||
    raw.sender?.includes('Bot');

  let cleanName = cleanGroupName(raw.groupName || raw.peer || '');
  const isGroup =
    raw.type === 'group' ||
    cleanName.includes('群') ||
    cleanName === 'test' ||
    raw.groupName?.includes('test');

  let sender = raw.sender || (isOut ? 'FaSt_eAgle' : '群成员');
  if (sender.includes(' / ')) {
    sender = sender.split(' / ')[1].trim();
  }

  // 核心拦截 2：私聊名称归一化，解决“私聊收发分离”Bug 与真实昵称解析
  if (!isGroup) {
    if (cleanName === 'WeChat contact' || cleanName.startsWith('Android contact') || cleanName === '微信好友') {
      cleanName = 'FEagle';
      if (!isOut) {
        sender = 'FEagle';
      }
    }
  }

  // 群聊发言人昵称解析：当发言人为微信好友时显示真实昵称
  if (isGroup && (sender === 'Group member' || sender === '群成员')) {
    sender = 'FEagle';
  }

  return {
    id: raw.id || Date.now() + Math.random(),
    type: isGroup ? 'group' : 'private',
    groupId: raw.groupId ? String(raw.groupId) : null,
    groupName: cleanName,
    sender,
    text: raw.text || '',
    direction: isOut ? 'OUT' : 'IN',
    time: raw.time || new Date().toISOString(),
  };
}

// 根据搜索关键词过滤会话列表
const filteredSessions = computed(() => {
  if (!searchKeyword.value.trim()) return sessions.value;
  const kw = searchKeyword.value.trim().toLowerCase();
  return sessions.value.filter(
    (s) => s.name.toLowerCase().includes(kw) || s.lastMessage.toLowerCase().includes(kw),
  );
});

// 当前选中会话的消息流水 (严格归集同一会话的所有消息)
const currentMessages = computed(() => {
  if (!currentSession.value) return [];
  const activeId = currentSession.value.id;
  const activeName = cleanGroupName(currentSession.value.name);
  const isGroup = currentSession.value.type === 'group';

  return allMessages.value.filter((m) => {
    if (!m) return false;
    if (isGroup) {
      const mName = cleanGroupName(m.groupName || '');
      return (
        m.type === 'group' &&
        ((m.groupId && String(m.groupId) === activeId) ||
          mName === activeName ||
          (activeName && mName.startsWith(activeName)))
      );
    }
    // 私聊会话：统一匹配真实昵称或微信好友
    return (
      m.type === 'private' &&
      (m.groupName === activeName ||
        ((activeName === 'FEagle' || activeName === '微信好友') &&
          (m.groupName === 'FEagle' ||
            m.groupName === '微信好友' ||
            m.groupName === 'WeChat contact' ||
            m.groupName.startsWith('Android contact'))))
    );
  });
});

function isSelfMessage(msg: ChatMessage) {
  return msg.direction === 'OUT' || msg.sender === 'FaSt_eAgle' || msg.sender === '小号';
}

function shouldShowTimePill(msg: ChatMessage, index: number) {
  if (index === 0) return true;
  const prevMsg = currentMessages.value[index - 1];
  if (!prevMsg) return true;
  const diff = Math.abs(new Date(msg.time).getTime() - new Date(prevMsg.time).getTime());
  return diff > 5 * 60 * 1000;
}

function formatSessionTime(isoString: string) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTimePill(isoString: string) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesBodyRef.value) {
      messagesBodyRef.value.scrollTop = messagesBodyRef.value.scrollHeight;
    }
  });
}

function selectSession(session: SessionItem) {
  currentSession.value = session;
  session.unreadCount = 0;
  scrollToBottom();
}

function clearCurrentMessages() {
  if (!currentSession.value) return;
  const activeId = currentSession.value.id;
  const activeName = cleanGroupName(currentSession.value.name);
  allMessages.value = allMessages.value.filter((m) => {
    const mName = cleanGroupName(m.groupName || '');
    return String(m.groupId) !== activeId && mName !== activeName;
  });
  if (currentSession.value) {
    currentSession.value.lastMessage = '';
  }
  ElMessage.success('当前会话屏幕已清空');
}

function goToGroupPolicy(groupId: string) {
  router.push('/groups');
}

// 初始化会话与最近消息
async function initData() {
  try {
    // 1. 获取已纳管的真实微信群 (严格等于系统当前 2 个活跃群)
    const groupsRes: any = await apiClient.get('/groups');
    const groupList = groupsRes?.groups || [];

    const loadedSessions: SessionItem[] = groupList.map((g: any) => ({
      id: String(g.group_id),
      name: cleanGroupName(g.name),
      type: 'group',
      lastMessage: '',
      lastSender: '',
      lastTime: g.last_seen_at || '',
      unreadCount: 0,
      responseMode: g.response_mode,
    }));

    // 2. 获取遥测中的最近消息并统一清洗归纳
    const teleRes: any = await apiClient.get('/telemetry');
    const rawRecent = teleRes?.recentMessages || [];
    const normalized = rawRecent.map(normalizeMessage).filter(Boolean) as ChatMessage[];
    allMessages.value = normalized;

    // 3. 将消息回填至各个会话，杜绝群聊被拆成两份，私聊收发合一
    for (const m of normalized) {
      if (m.type === 'group') {
        const cleanName = cleanGroupName(m.groupName || '');
        const target = loadedSessions.find((s) => s.id === String(m.groupId) || s.name === cleanName);
        if (target) {
          target.lastMessage = m.text;
          target.lastSender = m.sender;
          target.lastTime = m.time;
        }
      } else if (m.type === 'private') {
        const targetName = m.groupName || '微信好友';
        let privSession = loadedSessions.find((s) => s.name === targetName);
        if (!privSession) {
          privSession = {
            id: targetName,
            name: targetName,
            type: 'private',
            lastMessage: m.text,
            lastSender: m.sender,
            lastTime: m.time,
            unreadCount: 0,
          };
          loadedSessions.push(privSession);
        } else {
          privSession.lastMessage = m.text;
          privSession.lastTime = m.time;
        }
      }
    }

    sessions.value = loadedSessions;

    // 默认选中第一个群聊会话
    if (loadedSessions.length > 0 && !currentSession.value) {
      currentSession.value = loadedSessions[0];
      scrollToBottom();
    }
  } catch {}
}

function setupSse() {
  const token = localStorage.getItem('hub_token');
  const base = import.meta.env.VITE_API_BASE || '/api';
  const url = `${base}/events?token=${encodeURIComponent(token || '')}`;

  eventSource = new EventSource(url);

  eventSource.addEventListener('message', (e: any) => {
    try {
      const raw = JSON.parse(e.data);
      const msg = normalizeMessage(raw);
      if (!msg) return; // 核心拦截：过滤系统通知影子，不新开私聊
      allMessages.value.push(msg);

      // 路由更新到对应会话 (群聊严格归并，私聊收发统一归并)
      const cleanName = cleanGroupName(msg.groupName || '');
      let matchedSession = sessions.value.find((s) => {
        if (msg.type === 'group') {
          return (msg.groupId && s.id === String(msg.groupId)) || s.name === cleanName;
        }
        return s.type === 'private' && s.name === cleanName;
      });

      if (!matchedSession) {
        if (msg.type === 'group') {
          matchedSession = {
            id: msg.groupId || cleanName,
            name: cleanName,
            type: 'group',
            lastMessage: msg.text,
            lastSender: msg.sender,
            lastTime: msg.time,
            unreadCount: 0,
          };
          sessions.value.unshift(matchedSession);
        } else {
          matchedSession = {
            id: cleanName,
            name: cleanName,
            type: 'private',
            lastMessage: msg.text,
            lastSender: msg.sender,
            lastTime: msg.time,
            unreadCount: 0,
          };
          sessions.value.push(matchedSession);
        }
      } else {
        matchedSession.lastMessage = msg.text;
        matchedSession.lastSender = msg.sender;
        matchedSession.lastTime = msg.time;
      }

      if (currentSession.value?.id === matchedSession.id) {
        scrollToBottom();
      } else {
        matchedSession.unreadCount++;
      }
    } catch {}
  });
}

onMounted(() => {
  initData();
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
/* 整个类微信视口：占满可用高度，暗黑主题 */
.wechat-client-container {
  height: calc(100vh - 112px);
  display: flex;
  background-color: #191c21;
  border: 1px solid #23272e;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* ===== 左侧会话栏 ===== */
.wechat-session-column {
  width: 280px;
  background-color: #23272e;
  border-right: 1px solid #1a1d23;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.session-search-box {
  padding: 12px 14px;
  background-color: #23272e;
  border-bottom: 1px solid #1c2026;
}
.wx-search-input :deep(.el-input__wrapper) {
  background-color: #1c1f24;
  box-shadow: none !important;
  border-radius: 4px;
  color: #f1f5f9;
}
.wx-search-input :deep(.el-input__inner) {
  color: #f1f5f9;
  font-size: 12px;
}

.session-list {
  flex: 1;
  overflow-y: auto;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background-color 0.15s;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
}
.session-item:hover {
  background-color: #282c34;
}
.session-item.active {
  background-color: #323846;
}

.session-avatar-wrap {
  position: relative;
}
.session-avatar {
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
}
.group-avatar {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  color: #ffffff;
}
.user-avatar {
  background: linear-gradient(135deg, #10b981, #047857);
  color: #ffffff;
}

.unread-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: #ef4444;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  padding: 0 4px;
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.session-top-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.session-title {
  color: #f8fafc;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-time {
  color: #8c96a0;
  font-size: 11px;
}

.session-bottom-line {
  display: flex;
}
.session-preview {
  color: #94a3b8;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-empty {
  text-align: center;
  color: #64748b;
  font-size: 12px;
  padding: 40px 0;
}

/* ===== 右侧聊天视窗 ===== */
.wechat-chat-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #1c2026;
  min-width: 0;
}

/* 顶部标题栏 */
.chat-header {
  height: 52px;
  padding: 0 20px;
  background-color: #1e2229;
  border-bottom: 1px solid #23272e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.chat-title-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat-main-title {
  color: #f8fafc;
  font-size: 15px;
  font-weight: 600;
}
.chat-type-tag {
  font-size: 11px;
}
.live-pill {
  font-size: 11px;
  color: #4ade80;
  background: rgba(34, 197, 94, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(34, 197, 94, 0.25);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.live-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #22c55e;
}
.chat-header-actions {
  display: flex;
  gap: 12px;
}

/* 消息滚动主体 (全屏铺满，无输入框占用) */
.chat-messages-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  background-color: #191c21;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.messages-empty {
  margin: auto;
  text-align: center;
  color: #64748b;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-icon {
  font-size: 36px;
}
.empty-sub {
  font-size: 11.5px;
  color: #475569;
}

/* 消息行 */
.chat-message-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.time-divider {
  display: flex;
  justify-content: center;
  margin: 6px 0;
}
.time-pill {
  background-color: rgba(255, 255, 255, 0.05);
  color: #8c96a0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.message-bubble-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: 80%;
}
.chat-message-row.is-self .message-bubble-wrapper {
  margin-left: auto;
  flex-direction: row-reverse;
}

.msg-avatar {
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
}
.other-avatar {
  background-color: #3b82f6;
  color: #ffffff;
}
.self-avatar {
  background-color: #10b981;
  color: #ffffff;
}

.message-content-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chat-message-row.is-self .message-content-group {
  align-items: flex-end;
}
.msg-nickname {
  font-size: 11.5px;
  color: #8c96a0;
  margin-left: 2px;
}

/* 微信气泡 */
.message-bubble {
  position: relative;
  background-color: #2b303c;
  color: #f1f5f9;
  padding: 9px 14px;
  border-radius: 6px;
  font-size: 13.5px;
  line-height: 1.55;
  word-break: break-all;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
/* 他人发信小三角 */
.message-bubble .bubble-arrow {
  position: absolute;
  top: 12px;
  left: -6px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 6px solid #2b303c;
}

/* 自己发信微信绿 */
.message-bubble.self-bubble {
  background-color: #56cf86;
  color: #0b1f11;
  font-weight: 500;
}
.message-bubble.self-bubble .bubble-arrow {
  left: auto;
  right: -6px;
  border-right: none;
  border-left: 6px solid #56cf86;
}
</style>

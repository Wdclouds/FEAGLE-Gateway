<template>
  <el-container class="hub-layout">
    <!-- 左侧导航栏 -->
    <el-aside width="240px" class="hub-aside">
      <div class="brand-box">
        <div class="brand-logo">🦅</div>
        <div class="brand-text">
          <div class="brand-title">FEAGLE Hub</div>
          <div class="brand-sub">Agent Control Plane</div>
        </div>
      </div>

      <el-menu
        :default-active="activeRoute"
        class="hub-menu"
        background-color="#0f172a"
        text-color="#94a3b8"
        active-text-color="#38bdf8"
        router
      >
        <el-menu-item index="/dashboard">
          <el-icon><Monitor /></el-icon>
          <span>网关遥测大盘</span>
        </el-menu-item>
        <el-menu-item index="/connection">
          <el-icon><Share /></el-icon>
          <span>网关节点连接</span>
        </el-menu-item>
        <el-menu-item index="/groups">
          <el-icon><Connection /></el-icon>
          <span>多群策略编排</span>
        </el-menu-item>
        <el-menu-item index="/messages">
          <el-icon><ChatDotRound /></el-icon>
          <span>实时对话流</span>
        </el-menu-item>
        <el-menu-item index="/audit">
          <el-icon><Document /></el-icon>
          <span>操作审计日志</span>
        </el-menu-item>
      </el-menu>

      <div class="aside-footer">
        <div class="version-tag">v2.0 · Enterprise Dual-Mode</div>
      </div>
    </el-aside>

    <!-- 右侧主体内容 -->
    <el-container>
      <el-header height="64px" class="hub-header">
        <div class="header-left">
          <span class="route-title">{{ currentTitle }}</span>
        </div>
        <div class="header-right">
          <!-- Gateway 胶囊：明确展示监听模式与端口/目标 -->
          <div
            class="status-capsule gateway-capsule"
            :title="gatewayTooltip"
            @click="goToConnection"
          >
            <span class="dot" :class="{ online: telemetry.gateway?.connected }"></span>
            <span>Gateway: {{ gatewayLabel }}</span>
          </div>

          <!-- Hermes 智能体胶囊 -->
          <div class="status-capsule" :title="telemetry.hermes?.endpoint || 'http://127.0.0.1:18080'">
            <span class="dot" :class="{ online: telemetry.hermes?.connected }"></span>
            <span>Hermes: {{ telemetry.hermes?.connected ? 'READY' : 'OFFLINE' }}</span>
          </div>

          <!-- 管理员下拉菜单 -->
          <el-dropdown trigger="click">
            <div class="user-badge">
              <el-avatar :size="32" style="background-color: #0284c7;">
                {{ (authStore.user?.username || 'A')[0].toUpperCase() }}
              </el-avatar>
              <span class="user-name">{{ authStore.user?.username || 'Admin' }}</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="authStore.logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="hub-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Monitor, Connection, ChatDotRound, Document, Share } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { apiClient } from '../api/client';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const activeRoute = computed(() => route.path);
const currentTitle = computed(() => (route.meta.title as string) || '控制中台');

const telemetry = ref<any>(({
  gateway: { connected: false, mode: 'server', listenPort: 6199, endpoint: '', statusText: '' },
  hermes: { connected: false, endpoint: '' },
}));

let timer: any = null;

const gatewayLabel = computed(() => {
  const g = telemetry.value.gateway;
  if (!g) return 'OFFLINE';
  if (g.mode === 'bridge_sync') {
    return g.connected ? `云端直连 (${g.accountName || '已连'})` : '云端直连 (离线)';
  }
  if (g.mode === 'client') {
    return g.connected ? '远程已连' : '远程重连中';
  }
  // server mode
  const port = g.listenPort || 6199;
  return g.connected ? `本地 :${port} (已连)` : `本地 :${port} (监听中)`;
});

const gatewayTooltip = computed(() => {
  const g = telemetry.value.gateway;
  if (!g) return '网关未连接';
  const modeName = g.mode === 'bridge_sync' ? '云端Bridge直连模式' : (g.mode === 'client' ? '远程WS客户端' : '本地监听模式');
  return `【${modeName}】\n端点: ${g.endpoint || '--'}\n状态: ${g.statusText || '--'}`;
});

function goToConnection() {
  if (route.path !== '/connection') {
    router.push('/connection');
  }
}

async function fetchTelemetry() {
  try {
    const res: any = await apiClient.get('/telemetry');
    telemetry.value.gateway = res.gateway || { connected: false };
    telemetry.value.hermes = res.hermes || { connected: false };
  } catch {
    // ignore
  }
}

onMounted(() => {
  fetchTelemetry();
  timer = setInterval(fetchTelemetry, 6000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.hub-layout {
  height: 100vh;
  background-color: #0b0f19;
}
.hub-aside {
  background-color: #0f172a;
  border-right: 1px solid #1e293b;
  display: flex;
  flex-direction: column;
}
.brand-box {
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #1e293b;
}
.brand-logo {
  font-size: 28px;
}
.brand-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.5px;
}
.brand-sub {
  font-size: 11px;
  color: #64748b;
}
.hub-menu {
  border-right: none;
  flex: 1;
}
.hub-menu :deep(.el-menu-item) {
  height: 50px;
  margin: 4px 12px;
  border-radius: 8px;
  font-weight: 500;
}
.hub-menu :deep(.el-menu-item.is-active) {
  background-color: #1e293b !important;
}
.aside-footer {
  padding: 16px;
  border-top: 1px solid #1e293b;
  text-align: center;
}
.version-tag {
  font-size: 11px;
  color: #475569;
}
.hub-header {
  background-color: #0f172a;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.route-title {
  font-size: 16px;
  font-weight: 600;
  color: #f8fafc;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.status-capsule {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1e293b;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #334155;
  transition: all 0.2s;
}
.gateway-capsule {
  cursor: pointer;
}
.gateway-capsule:hover {
  border-color: #38bdf8;
  color: #f8fafc;
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
.user-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
}
.user-badge:hover {
  background-color: #1e293b;
}
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: #e2e8f0;
}
.hub-main {
  background-color: #0b0f19;
  padding: 24px;
  overflow-y: auto;
}
</style>

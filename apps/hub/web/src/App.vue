<template>
  <el-config-provider>
    <!-- 全局自愈唤醒开屏层 -->
    <transition name="fade">
      <div v-if="!isReady" class="startup-splash">
        <div class="splash-card">
          <div class="splash-brand">
            <span class="brand-icon">🦅</span>
            <span class="brand-title">FEAGLE <span class="highlight">HUB</span></span>
          </div>
          <div class="splash-status">
            <div class="status-spinner"></div>
            <span class="status-text">{{ statusMessage }}</span>
          </div>
          <div class="splash-meta">
            <span>本地控制端点: <code>http://127.0.0.1:6200</code></span>
            <span v-if="retryCount > 3" class="retry-hint">
              如果长时间未响应，正在执行自动自愈拉起 (重试 {{ retryCount }}/15)...
            </span>
          </div>
        </div>
      </div>
    </transition>

    <!-- 正常主业务视图 -->
    <router-view v-if="isReady" />
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElConfigProvider } from 'element-plus';
import { resolveApiBase } from './api/client';

const isReady = ref(false);
const statusMessage = ref('正在连接本地控制中枢...');
const retryCount = ref(0);

async function checkHealth(): Promise<boolean> {
  try {
    const base = resolveApiBase();
    const res = await fetch(`${base}/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok || res.status === 401; // 401 说明后端已存活，仅需登录
  } catch {
    return false;
  }
}

async function startHealthPolling() {
  const maxRetries = 15;
  for (let i = 1; i <= maxRetries; i++) {
    retryCount.value = i;
    const ok = await checkHealth();
    if (ok) {
      statusMessage.value = '连接成功，正在展开大盘...';
      setTimeout(() => {
        isReady.value = true;
      }, 250);
      return;
    }
    statusMessage.value = `正在唤醒后台中枢进程 (${i}/${maxRetries})...`;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // 最终兜底：即便自愈未测通，也允许用户进入界面查看配置或手动填入公网 IP
  isReady.value = true;
}

onMounted(() => {
  startHealthPolling();
});
</script>

<style>
/* 全局暗色重置 */
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  background-color: #0b0f19;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 开屏层样式 */
.startup-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background-color: #0b0f19;
  display: flex;
  align-items: center;
  justify-content: center;
}

.splash-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 40px 60px;
  background: rgba(17, 24, 39, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.splash-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  font-size: 36px;
  filter: drop-shadow(0 0 12px rgba(14, 165, 233, 0.6));
}

.brand-title {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #f8fafc;
}

.brand-title .highlight {
  color: #0ea5e9;
}

.splash-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(14, 165, 233, 0.2);
  border-top-color: #0ea5e9;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.status-text {
  font-size: 14px;
  color: #94a3b8;
  font-weight: 500;
}

.splash-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.splash-meta code {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.retry-hint {
  color: #f59e0b;
  font-size: 11px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

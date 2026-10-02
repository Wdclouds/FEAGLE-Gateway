<template>
  <div class="connect-view-container">
    <!-- 顶部状态大看板 -->
    <el-card shadow="never" class="status-banner-card" :class="{ 'is-online': activeState.connected }">
      <div class="banner-inner">
        <div class="banner-left">
          <div class="indicator-ring" :class="{ online: activeState.connected }">
            <span class="indicator-dot"></span>
          </div>
          <div class="banner-info">
            <div class="banner-title-line">
              <span class="banner-title">{{ activeState.connected ? '微信网关服务已在线就绪' : '当前网关未连接 / 离线中' }}</span>
              <el-tag size="small" :type="activeState.connected ? 'success' : 'danger'" effect="dark">
                {{ activeState.connected ? 'ONLINE · 全双工' : 'OFFLINE · 断开' }}
              </el-tag>
              <el-tag size="small" effect="plain" class="mode-tag">
                {{ formatMode(activeState.mode) }}
              </el-tag>
            </div>
            <div class="banner-sub-line">
              当前端点: <code>{{ activeState.endpoint || '未配置' }}</code>
              <span class="split">|</span>
              当前账号: <b>{{ activeState.accountName || '无' }}</b>
              <span v-if="activeState.selfId" class="wxid-label">({{ activeState.selfId }})</span>
              <span class="split">|</span>
              状态详情: <span class="detail-text">{{ activeState.statusText || '等待检测' }}</span>
            </div>
          </div>
        </div>
        <div class="banner-right">
          <el-button :icon="Refresh" circle @click="loadCurrentState" :loading="refreshing" />
        </div>
      </div>
    </el-card>

    <el-row :gutter="20" class="main-content-row">
      <!-- 左侧：连接目标节点表单 (核心操作区) -->
      <el-col :span="14">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span class="panel-title">接入新节点 / 切换目标 IP</span>
              <span class="panel-desc">直接输入目标机器 IP 或域名，无需敲命令行建立隧道</span>
            </div>
          </template>

          <el-form :model="form" label-position="top" class="connect-form">
            <!-- 接入模式选择 -->
            <el-form-item label="网关接入模式">
              <el-radio-group v-model="form.gatewayMode" class="full-radios">
                <el-radio-button label="bridge_sync">
                  🟢 云端/局域网直连 (免隧道·推荐)
                </el-radio-button>
                <el-radio-button label="server">
                  🔵 本地 WS 监听 (Server)
                </el-radio-button>
                <el-radio-button label="client">
                  🟣 远程 WS 客户端 (Client)
                </el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 模式说明条 -->
            <div class="mode-hint-box">
              <div v-if="form.gatewayMode === 'bridge_sync'">
                💡 <b>云端直连模式</b>：直接输入运行 WeChat Bridge 的服务器公网 IP 或域名，Hub 将自动通过 REST & SSE 实时流同步微信状态、头像与消息流。
              </div>
              <div v-else-if="form.gatewayMode === 'server'">
                💡 <b>本地监听模式</b>：Hub 作为 OneBot v11 反向 WebSocket 服务端，在本地机器监听指定端口，等待 Bridge 连入。
              </div>
              <div v-else>
                💡 <b>远程 WS 模式</b>：Hub 作为客户端主动连入远程已暴露的正向/反向 WebSocket 端点。
              </div>
            </div>

            <!-- 云端直连参数 -->
            <div v-if="form.gatewayMode === 'bridge_sync'" class="form-section">
              <el-form-item label="Bridge 服务器 IP 或完整地址">
                <el-input
                  v-model="form.bridgeUrl"
                  placeholder="例如 39.97.255.91:6190 或 http://your-domain.com:6190"
                  size="large"
                  clearable
                >
                  <template #prepend>http://</template>
                </el-input>
              </el-form-item>
            </div>

            <!-- 本地监听模式参数 -->
            <div v-else-if="form.gatewayMode === 'server'" class="form-section">
              <el-form-item label="本地监听端口 (Listen Port)">
                <el-input-number v-model="form.gatewayServerPort" :min="1024" :max="65535" size="large" />
                <span class="inline-tip">生效地址: <code>ws://0.0.0.0:{{ form.gatewayServerPort }}/ws</code></span>
              </el-form-item>
            </div>

            <!-- 远程 WS 参数 -->
            <div v-else class="form-section">
              <el-form-item label="远程 WebSocket 地址 (WS URL)">
                <el-input v-model="form.gatewayRemoteUrl" placeholder="ws://127.0.0.1:6199/ws" size="large" clearable />
              </el-form-item>
              <el-form-item label="鉴权 Token (可选)">
                <el-input v-model="form.gatewayToken" placeholder="若远程服务开启了 Token 保护请输入" show-password />
              </el-form-item>
            </div>

            <!-- 连通性测试结果面板 (Probe Result) -->
            <div v-if="probeResult" class="probe-result-box" :class="{ success: probeResult.ok, fail: !probeResult.ok }">
              <div class="probe-header">
                <span>{{ probeResult.ok ? '✔ 目标节点网络与微信探活成功！' : '✖ 无法连通目标节点' }}</span>
                <span v-if="probeResult.ok" class="ping-tag">{{ probeResult.pingMs }} ms</span>
              </div>
              <div v-if="probeResult.ok" class="probe-detail-grid">
                <div>微信在线状态: <b>{{ probeResult.wechatStatus }}</b></div>
                <div>微信小号昵称: <b>{{ probeResult.accountName }}</b></div>
                <div>已发现群组: <b>{{ probeResult.discoveredGroupsCount }} 个</b></div>
                <div>节点状态: <span>{{ probeResult.detail }}</span></div>
              </div>
              <div v-else class="probe-err-msg">
                错误详情: {{ probeResult.error }}
              </div>
            </div>

            <!-- 操作按钮行 -->
            <div class="action-buttons-bar">
              <el-button
                size="large"
                :icon="Search"
                :loading="probing"
                @click="runProbeTest"
              >
                连通性测试 (Probe)
              </el-button>

              <el-button
                type="primary"
                size="large"
                :icon="Check"
                :loading="saving"
                @click="applyAndConnect"
              >
                立即保存并连接
              </el-button>

              <el-button
                size="large"
                :icon="FolderAdd"
                @click="openSaveNodeDialog"
              >
                存为常用节点
              </el-button>
            </div>
          </el-form>
        </el-card>
      </el-col>

      <!-- 右侧：常用节点矩阵与快捷切换 -->
      <el-col :span="10">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span class="panel-title">常用节点收藏夹 (快捷切换)</span>
              <span class="panel-desc">保存你的生产、测试与开发服务器</span>
            </div>
          </template>

          <div class="saved-nodes-list">
            <div
              v-for="node in savedNodes"
              :key="node.id || node.url"
              class="node-card"
              :class="{ 'is-current': isCurrentNode(node) }"
            >
              <div class="node-main-info">
                <div class="node-title-line">
                  <span class="node-name">{{ node.name }}</span>
                  <el-tag v-if="isCurrentNode(node)" size="small" type="success" effect="dark">
                    当前使用中
                  </el-tag>
                </div>
                <div class="node-url-line">
                  <code>{{ node.url }}</code>
                </div>
                <div class="node-meta-line">
                  模式: {{ formatMode(node.mode) }}
                </div>
              </div>

              <div class="node-actions">
                <el-button
                  v-if="!isCurrentNode(node)"
                  type="primary"
                  size="small"
                  plain
                  @click="quickSwitchNode(node)"
                >
                  接入
                </el-button>
                <el-button
                  type="danger"
                  size="small"
                  link
                  @click="removeSavedNode(node)"
                >
                  删除
                </el-button>
              </div>
            </div>

            <div v-if="savedNodes.length === 0" class="empty-nodes">
              暂无已保存节点，在左侧配置后可一键存入。
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 另存节点弹窗 -->
    <el-dialog v-model="saveNodeDialogVisible" title="保存到常用节点库" width="420px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="节点备注名称" required>
          <el-input v-model="newNodeName" placeholder="例如：阿里云生产服务器 / 宿舍平板测试" />
        </el-form-item>
        <el-form-item label="节点地址">
          <el-input :model-value="form.gatewayMode === 'bridge_sync' ? form.bridgeUrl : form.gatewayRemoteUrl" disabled />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="saveNodeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSaveNode">确认保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Refresh, Search, Check, FolderAdd } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { gatewayApi } from '../api/client';

const refreshing = ref(false);
const probing = ref(false);
const saving = ref(false);
const probeResult = ref<any>(null);

const activeState = ref<any>({
  connected: false,
  mode: 'bridge_sync',
  endpoint: '',
  accountName: '',
  selfId: '',
  statusText: '',
});

const form = ref({
  gatewayMode: 'bridge_sync',
  bridgeUrl: '127.0.0.1:6190',
  gatewayServerPort: 6199,
  gatewayRemoteUrl: 'ws://127.0.0.1:6199/ws',
  gatewayToken: '',
});

const savedNodes = ref<any[]>([]);
const saveNodeDialogVisible = ref(false);
const newNodeName = ref('');

function formatMode(mode: string) {
  if (mode === 'bridge_sync') return '云端直连';
  if (mode === 'server') return '本地监听';
  if (mode === 'client') return '远程WS';
  return '未初始化';
}

function isCurrentNode(node: any) {
  if (!node) return false;
  const currentEndpoint = (activeState.value.endpoint || '').toLowerCase().replace(/\/+$/, '');
  const nodeUrl = (node.url || '').toLowerCase().replace(/\/+$/, '');
  return currentEndpoint.includes(nodeUrl) || nodeUrl.includes(currentEndpoint);
}

async function loadCurrentState() {
  refreshing.value = true;
  try {
    const res: any = await gatewayApi.getConfig();
    if (res?.state) {
      activeState.value = { ...res.state };
    }
    if (res?.config) {
      form.value.gatewayMode = res.config.gatewayMode || 'bridge_sync';
      let bUrl = res.config.bridgeUrl || '127.0.0.1:6190';
      bUrl = bUrl.replace(/^https?:\/\//, '');
      form.value.bridgeUrl = bUrl;
      form.value.gatewayServerPort = res.config.gatewayServerPort || 6199;
      form.value.gatewayRemoteUrl = res.config.gatewayRemoteUrl || 'ws://127.0.0.1:6199/ws';
      form.value.gatewayToken = res.config.gatewayToken || '';
      savedNodes.value = res.config.savedNodes || [];
    }
  } catch {
    // handled
  } finally {
    refreshing.value = false;
  }
}

async function runProbeTest() {
  probing.value = true;
  probeResult.value = null;
  try {
    const payload = {
      gatewayMode: form.value.gatewayMode,
      bridgeUrl: form.value.bridgeUrl,
      gatewayRemoteUrl: form.value.gatewayRemoteUrl,
      gatewayToken: form.value.gatewayToken,
    };
    const res: any = await gatewayApi.probe(payload);
    probeResult.value = res;
    if (res.ok) {
      ElMessage.success(`探测成功！延时 ${res.pingMs}ms，微信状态: ${res.wechatStatus}`);
    } else {
      ElMessage.warning(`探测不通: ${res.error || '连接被拒绝'}`);
    }
  } catch (err: any) {
    probeResult.value = { ok: false, error: err.message };
  } finally {
    probing.value = false;
  }
}

async function applyAndConnect() {
  saving.value = true;
  try {
    const payload = {
      gatewayMode: form.value.gatewayMode,
      bridgeUrl: form.value.bridgeUrl,
      gatewayServerPort: form.value.gatewayServerPort,
      gatewayRemoteUrl: form.value.gatewayRemoteUrl,
      gatewayToken: form.value.gatewayToken,
      savedNodes: savedNodes.value,
    };
    const res: any = await gatewayApi.saveConfig(payload);
    ElMessage.success(res.message || '网关节点已成功切换并连接！');
    await loadCurrentState();
  } catch (err: any) {
    ElMessage.error(err.message || '连接切换失败');
  } finally {
    saving.value = false;
  }
}

function openSaveNodeDialog() {
  newNodeName.value = form.value.gatewayMode === 'bridge_sync'
    ? `服务器 (${form.value.bridgeUrl})`
    : `节点 (${form.value.gatewayRemoteUrl})`;
  saveNodeDialogVisible.value = true;
}

async function confirmSaveNode() {
  if (!newNodeName.value.trim()) {
    ElMessage.warning('请输入节点名称');
    return;
  }
  const url = form.value.gatewayMode === 'bridge_sync' ? form.value.bridgeUrl : form.value.gatewayRemoteUrl;
  const newNode = {
    id: 'node_' + Date.now(),
    name: newNodeName.value.trim(),
    url,
    mode: form.value.gatewayMode,
  };
  savedNodes.value.push(newNode);
  saveNodeDialogVisible.value = false;

  await gatewayApi.saveConfig({ savedNodes: savedNodes.value });
  ElMessage.success(`已保存节点 [${newNode.name}]`);
}

async function quickSwitchNode(node: any) {
  form.value.gatewayMode = node.mode;
  if (node.mode === 'bridge_sync') {
    form.value.bridgeUrl = (node.url || '').replace(/^https?:\/\//, '');
  } else {
    form.value.gatewayRemoteUrl = node.url;
  }
  await applyAndConnect();
}

async function removeSavedNode(node: any) {
  savedNodes.value = savedNodes.value.filter((n) => n.id !== node.id);
  await gatewayApi.saveConfig({ savedNodes: savedNodes.value });
  ElMessage.success(`已移除节点 [${node.name}]`);
}

onMounted(() => {
  loadCurrentState();
});
</script>

<style scoped>
.connect-view-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.status-banner-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
  transition: all 0.3s;
}
.status-banner-card.is-online {
  border-color: rgba(34, 197, 94, 0.4);
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.05) 0%, rgba(15, 23, 42, 1) 100%);
}
.banner-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.banner-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.indicator-ring {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #475569;
}
.indicator-ring.online {
  border-color: #22c55e;
  box-shadow: 0 0 14px rgba(34, 197, 94, 0.4);
}
.indicator-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: #64748b;
}
.indicator-ring.online .indicator-dot {
  background-color: #22c55e;
}
.banner-title-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.banner-title {
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
}
.mode-tag {
  background: #1e293b;
  border-color: #334155;
  color: #38bdf8;
}
.banner-sub-line {
  font-size: 13px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 8px;
}
.banner-sub-line code {
  color: #38bdf8;
  background: #1e293b;
  padding: 2px 6px;
  border-radius: 4px;
}
.banner-sub-line .split {
  color: #475569;
}
.wxid-label {
  color: #64748b;
  font-size: 12px;
}
.detail-text {
  color: #cbd5e1;
}

.panel-card {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
}
.panel-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
}
.panel-desc {
  font-size: 12px;
  color: #64748b;
}

.full-radios {
  display: flex;
  width: 100%;
}
.full-radios :deep(.el-radio-button) {
  flex: 1;
}
.full-radios :deep(.el-radio-button__inner) {
  width: 100%;
}

.mode-hint-box {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  color: #cbd5e1;
  line-height: 1.6;
  margin-bottom: 20px;
}

.form-section {
  margin-bottom: 16px;
}
.inline-tip {
  font-size: 12px;
  color: #64748b;
  margin-left: 12px;
}
.inline-tip code {
  color: #38bdf8;
}

.probe-result-box {
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 20px;
  font-size: 13px;
}
.probe-result-box.success {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}
.probe-result-box.fail {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.probe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.ping-tag {
  background: #1e293b;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
}
.probe-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
}
.probe-err-msg {
  font-size: 12px;
  color: #fca5a5;
}

.action-buttons-bar {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.saved-nodes-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.node-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s;
}
.node-card.is-current {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.05);
}
.node-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.node-name {
  font-weight: 600;
  color: #f8fafc;
  font-size: 14px;
}
.node-url-line code {
  color: #38bdf8;
  font-size: 12px;
}
.node-meta-line {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}
.empty-nodes {
  text-align: center;
  color: #64748b;
  font-size: 13px;
  padding: 40px 0;
}
</style>

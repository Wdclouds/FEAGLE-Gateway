<template>
  <div class="groups-container">
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="card-header-bar">
          <div>
            <span class="card-title">多群 AI 策略与权限编排矩阵</span>
            <span class="card-desc">为不同微信群独立设定人设 Prompt、响应触发条件与 AI 工具执行权限</span>
          </div>
          <div class="header-btns">
            <el-button type="danger" plain :icon="Delete" @click="handleCleanStaleGroups" :loading="cleaning">
              清理超期已退群
            </el-button>
            <el-button type="primary" :icon="Refresh" @click="fetchGroups(true)" :loading="loading">
              刷新群列表
            </el-button>
          </div>
        </div>
      </template>

      <!-- 群组表格 -->
      <el-table :data="groups" v-loading="loading" style="width: 100%" empty-text="当前未发现群聊（待网关上报或新消息触发）">
        <el-table-column prop="group_id" label="群聊 ID" width="160">
          <template #default="{ row }">
            <code>{{ row.group_id }}</code>
          </template>
        </el-table-column>

        <el-table-column prop="name" label="微信群名称" min-width="180">
          <template #default="{ row }">
            <div class="group-name-col">
              <span class="group-name">{{ row.name }}</span>
              <el-tag v-if="isStaleGroup(row.last_seen_at)" size="small" type="danger" effect="plain" class="stale-tag">
                超期未活跃
              </el-tag>
            </div>
            <span class="msg-count-badge">({{ row.message_count }} 条互动)</span>
          </template>
        </el-table-column>

        <el-table-column prop="response_mode" label="响应模式" width="130">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.response_mode === 'SMART' ? 'success' : (row.response_mode === 'MENTION_ONLY' ? 'warning' : 'info')"
            >
              {{ row.response_mode === 'SMART' ? '🟢 智能回复' : (row.response_mode === 'MENTION_ONLY' ? '🟡 仅@回复' : '⚪ 静默观察') }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="allowed_tools" label="授权 AI 工具矩阵" min-width="220">
          <template #default="{ row }">
            <div class="tools-tags">
              <el-tag
                v-for="tool in row.allowed_tools"
                :key="tool"
                size="small"
                effect="plain"
                class="tool-tag"
              >
                {{ formatToolName(tool) }}
              </el-tag>
              <span v-if="!row.allowed_tools || row.allowed_tools.length === 0" class="no-tools">
                无可用工具 (纯语言对话)
              </span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="policy_version" label="策略版本" width="100">
          <template #default="{ row }">
            <el-tag size="small" type="info">v{{ row.policy_version || 1 }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="last_seen_at" label="最后活跃" width="160">
          <template #default="{ row }">
            {{ formatRelativeTime(row.last_seen_at) }}
          </template>
        </el-table-column>

        <el-table-column label="管理操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDrawer(row)">
              编排策略
            </el-button>
            <el-popconfirm
              title="确定移除该群？该群将被永久加入防复活隔离表，网关同步不再展示。"
              confirm-button-text="确认移除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              width="260"
              @confirm="handleDeleteGroup(row)"
            >
              <template #reference>
                <el-button size="small" type="danger" link>
                  移除已退群
                </el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 策略编辑抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="编排群聊 AI 治理策略"
      size="560px"
      direction="rtl"
      custom-class="policy-drawer"
    >
      <div v-if="editingGroup" class="drawer-content">
        <div class="drawer-target-info">
          <h3>{{ editingGroup.name }}</h3>
          <p>群 ID: <code>{{ editingGroup.group_id }}</code> · 当前策略版本: v{{ editingGroup.policy_version }}</p>
        </div>

        <el-form label-position="top" class="policy-form">
          <!-- 响应模式 -->
          <el-form-item label="群响应触发策略">
            <el-radio-group v-model="policyForm.responseMode" size="default">
              <el-radio-button label="SMART">智能自由回复</el-radio-button>
              <el-radio-button label="MENTION_ONLY">仅被 @ 时回复</el-radio-button>
              <el-radio-button label="OFF">静默观察模式</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <!-- 艾特限制 -->
          <el-form-item label="前置 @ 唤醒约束">
            <el-switch
              v-model="policyForm.requireAt"
              active-text="发言开头必须包含 @ 机器人"
              inactive-text="无需 @"
            />
          </el-form-item>

          <!-- AI 工具矩阵开关 -->
          <el-form-item label="允许该群调用的 AI 工具能力 (Tools Matrix)">
            <el-checkbox-group v-model="policyForm.allowedTools" class="tools-checkbox-grid">
              <el-checkbox label="web_search">联网实时检索 (web_search)</el-checkbox>
              <el-checkbox label="code_exec">代码安全沙箱 (code_exec)</el-checkbox>
              <el-checkbox label="terminal">终端指令执行 (terminal)</el-checkbox>
              <el-checkbox label="doc_vault">知识库检索召回 (doc_vault)</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <!-- 预设模板快捷填充 -->
          <div class="prompt-preset-row">
            <span class="label">预设人设模板:</span>
            <el-button size="small" link type="primary" @click="applyTemplate('tech')">极客工程师</el-button>
            <el-button size="small" link type="primary" @click="applyTemplate('assistant')">简练助手</el-button>
            <el-button size="small" link type="primary" @click="applyTemplate('warm')">温暖陪伴</el-button>
          </div>

          <!-- System Prompt 编辑器 -->
          <el-form-item label="该群专用 System Prompt (人设注入)">
            <el-input
              v-model="policyForm.systemPrompt"
              type="textarea"
              :rows="6"
              placeholder="请输入注入给大模型的人设与行为规范指令..."
            />
          </el-form-item>
        </el-form>

        <div class="drawer-actions">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitPolicy">
            保存并热下发策略
          </el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { Refresh, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { apiClient } from '../api/client';

const groups = ref<any[]>([]);
const loading = ref(false);
const cleaning = ref(false);
const drawerVisible = ref(false);
const editingGroup = ref<any>(null);
const saving = ref(false);

const policyForm = reactive({
  responseMode: 'SMART',
  requireAt: true,
  allowedTools: ['web_search'],
  systemPrompt: '',
});

function formatToolName(tool: string) {
  const map: Record<string, string> = {
    web_search: '🌐 联网搜索',
    terminal: '💻 终端执行',
    code_exec: '🐍 代码沙箱',
    doc_vault: '📚 知识库',
  };
  return map[tool] || tool;
}

function formatRelativeTime(isoString: string) {
  if (!isoString) return '--';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return new Date(isoString).toLocaleDateString('zh-CN');
}

function applyTemplate(type: string) {
  if (type === 'tech') {
    policyForm.systemPrompt = '你是一名资深全栈工程师与架构导师。回答硬核精准、直击本质，必要时给出代码样例，不废话。';
    policyForm.allowedTools = ['web_search', 'code_exec'];
  } else if (type === 'assistant') {
    policyForm.systemPrompt = '你是由 Hermes 驱动的群聊智能助理，回答简练准确、温和专业，帮助群友快速解答日常疑问。';
    policyForm.allowedTools = ['web_search'];
  } else if (type === 'warm') {
    policyForm.systemPrompt = '你是一个温暖、机敏、充满活力的 AI 伴侣。说话轻快生动，善于倾听和开导群友，富有人格魅力。';
    policyForm.allowedTools = [];
  }
}

async function fetchGroups(isManualRefresh = false) {
  loading.value = true;
  try {
    if (isManualRefresh) {
      const res: any = await apiClient.post('/groups/refresh');
      groups.value = res.groups || [];
      ElMessage.success(res.message || `群列表已与网关同步完成，当前共纳管 ${groups.value.length} 个微信群`);
    } else {
      const res: any = await apiClient.get('/groups');
      groups.value = res.groups || [];
    }
  } catch {
    // handled
  } finally {
    loading.value = false;
  }
}

function openDrawer(group: any) {
  editingGroup.value = group;
  policyForm.responseMode = group.response_mode || 'SMART';
  policyForm.requireAt = Boolean(group.require_at);
  policyForm.allowedTools = Array.isArray(group.allowed_tools) ? [...group.allowed_tools] : ['web_search'];
  policyForm.systemPrompt = group.system_prompt || '';
  drawerVisible.value = true;
}

async function submitPolicy() {
  if (!editingGroup.value) return;
  saving.value = true;
  try {
    const gid = editingGroup.value.group_id;
    await apiClient.post(`/groups/${encodeURIComponent(gid)}/policy`, {
      responseMode: policyForm.responseMode,
      requireAt: policyForm.requireAt,
      allowedTools: policyForm.allowedTools,
      systemPrompt: policyForm.systemPrompt,
    });
    ElMessage.success(`群 [${editingGroup.value.name}] 策略已更新并热下发`);
    drawerVisible.value = false;
    fetchGroups();
  } catch {
    // handled
  } finally {
    saving.value = false;
  }
}

function isStaleGroup(isoString: string) {
  if (!isoString) return false;
  const diff = Date.now() - new Date(isoString).getTime();
  return diff > 30 * 86400_000; // 超过 30 天未活跃
}

async function handleDeleteGroup(group: any) {
  try {
    const gid = group.group_id;
    const res: any = await apiClient.delete(`/groups/${encodeURIComponent(gid)}`);
    ElMessage.success(res.message || `已成功移除群聊 [${group.name}]`);
    fetchGroups();
  } catch (err: any) {
    ElMessage.error(err.message || '移除群聊失败');
  }
}

async function handleCleanStaleGroups() {
  cleaning.value = true;
  try {
    const res: any = await apiClient.post('/groups/cleanup-stale', { days: 30 });
    ElMessage.success(res.message || `已自动清理归档 ${res.cleanedCount || 0} 个超期已退群聊`);
    fetchGroups();
  } catch (err: any) {
    ElMessage.error(err.message || '清理群聊失败');
  } finally {
    cleaning.value = false;
  }
}

onMounted(() => {
  fetchGroups();
});
</script>

<style scoped>
.groups-container {
  display: flex;
  flex-direction: column;
}
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
.header-btns {
  display: flex;
  gap: 10px;
}
.group-name-col {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stale-tag {
  font-size: 10px;
  height: 18px;
  line-height: 16px;
  padding: 0 4px;
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
.group-name {
  font-weight: 600;
  color: #f1f5f9;
}
.msg-count-badge {
  font-size: 11px;
  color: #64748b;
  margin-left: 6px;
}
.tools-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tool-tag {
  background: #1e293b;
  border-color: #334155;
  color: #38bdf8;
}
.no-tools {
  font-size: 12px;
  color: #64748b;
}
:deep(.el-table) {
  background-color: transparent !important;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #1e293b;
  --el-table-border-color: #1e293b;
  color: #cbd5e1;
}
.drawer-content {
  padding: 0 12px;
}
.drawer-target-info {
  background: #1e293b;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  border: 1px solid #334155;
}
.drawer-target-info h3 {
  margin: 0 0 6px 0;
  color: #f8fafc;
}
.drawer-target-info p {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
}
.drawer-target-info code {
  color: #38bdf8;
}
.tools-checkbox-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.prompt-preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px 0;
  font-size: 12px;
}
.prompt-preset-row .label {
  color: #94a3b8;
}
.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid #1e293b;
}
</style>

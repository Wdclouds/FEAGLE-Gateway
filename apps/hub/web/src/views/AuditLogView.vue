<template>
  <div class="audit-container">
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="card-header-bar">
          <div>
            <span class="card-title">系统操作审计日志 (Audit Log)</span>
            <span class="card-desc">记录管理端策略热变更、权限下发与系统安全事件</span>
          </div>
          <el-button type="primary" :icon="Refresh" @click="fetchLogs" :loading="loading">
            刷新日志
          </el-button>
        </div>
      </template>

      <el-table :data="logs" v-loading="loading" style="width: 100%" empty-text="暂无审计事件记录">
        <el-table-column prop="id" label="事件 ID" width="90">
          <template #default="{ row }">
            <code>#{{ row.id }}</code>
          </template>
        </el-table-column>

        <el-table-column prop="action" label="操作行为" width="160">
          <template #default="{ row }">
            <el-tag size="small" :type="row.action === 'POLICY_UPDATE' ? 'warning' : 'primary'">
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
import { ref, onMounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { apiClient } from '../api/client';

const logs = ref<any[]>([]);
const loading = ref(false);

function formatDateTime(iso: string) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
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

onMounted(() => {
  fetchLogs();
});
</script>

<style scoped>
.audit-container {
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

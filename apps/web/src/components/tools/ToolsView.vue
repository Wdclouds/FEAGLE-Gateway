<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToolStore } from '../../stores/toolStore';
import ToolCard from './ToolCard.vue';
import SchemaViewer from './SchemaViewer.vue';
import ModalDialog from '../common/ModalDialog.vue';
import type { ToolDefinition } from '../../types/tools';

const toolStore = useToolStore();

const activeTool = ref<ToolDefinition | null>(null);
const showSchemaModal = ref(false);

// 新增自定义工具表单
const showCreateModal = ref(false);
const newToolName = ref('');
const newToolDesc = ref('');
const newToolEndpoint = ref('');
const isSubmitting = ref(false);

onMounted(async () => {
  await toolStore.fetchTools();
});

function handleViewSchema(tool: ToolDefinition) {
  activeTool.value = tool;
  showSchemaModal.value = true;
}

function openCreateModal() {
  newToolName.value = '';
  newToolDesc.value = '';
  newToolEndpoint.value = '';
  showCreateModal.value = true;
}

async function submitCreateTool() {
  const name = newToolName.value.trim();
  const description = newToolDesc.value.trim();
  if (!name) {
    alert('请输入工具英文名称（例如 query_order, member_points）');
    return;
  }
  if (!description) {
    alert('请输入工具功能描述，大模型根据描述自动判断调用时机');
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    alert('工具名称仅支持英文字母、数字、下划线及横杠');
    return;
  }

  isSubmitting.value = true;
  try {
    await toolStore.addCustomTool({
      name,
      description,
      endpoint: newToolEndpoint.value.trim() || undefined,
    });
    showCreateModal.value = false;
    alert(`自定义工具【${name}】已成功注册至网关！`);
  } catch (err: any) {
    alert(`注册工具失败: ${err.message}`);
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteTool(name: string) {
  try {
    await toolStore.removeTool(name);
    alert(`自定义工具【${name}】已成功注销。`);
  } catch (err: any) {
    alert(`删除工具失败: ${err.message}`);
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- 顶部说明与注册按钮 -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-white/[0.08]">
      <div>
        <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">工具目录</h2>
        <p class="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          已注册的大模型函数调用 (Function Calling) 工具，根据社群白名单在对话中由大模型自动按需唤起。
        </p>
      </div>

      <button
        type="button"
        class="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors whitespace-nowrap flex items-center gap-1.5 shadow-xs"
        @click="openCreateModal"
      >
        <span>+ 注册自定义工具</span>
      </button>
    </div>

    <!-- 工具卡片网格 -->
    <div v-if="toolStore.tools.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <ToolCard
        v-for="t in toolStore.tools"
        :key="t.name"
        :tool="t"
        @view-schema="handleViewSchema"
        @delete-tool="handleDeleteTool"
      />
    </div>

    <div v-else class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-16 text-center text-slate-400 dark:text-zinc-500 shadow-xs">
      <p class="text-base font-medium">正在读取网关注册的工具列表...</p>
    </div>

    <!-- 参数定义弹窗 -->
    <SchemaViewer
      :show="showSchemaModal"
      :tool="activeTool"
      @close="showSchemaModal = false"
    />

    <!-- 注册自定义工具弹窗 -->
    <ModalDialog
      :show="showCreateModal"
      title="注册自定义 Function Calling 工具"
      max-width="max-w-xl"
      @close="showCreateModal = false"
    >
      <div class="space-y-4">
        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            工具唯一标识名称 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="newToolName"
            type="text"
            placeholder="例如: weather_lookup, member_points"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <span class="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 block">仅限英文、数字、下划线。该标识将直接注入大模型 tools 声明。</span>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            工具语义描述 (Description) <span class="text-rose-500">*</span>
          </label>
          <textarea
            v-model="newToolDesc"
            rows="3"
            placeholder="例如: 根据城市名称或行政区划查询实时天气预报和气温空气指数"
            class="w-full p-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-xs text-slate-900 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] leading-relaxed"
          />
          <span class="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 block">精准的描述能帮助大模型在用户相关提问时准确唤起该工具。</span>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            Webhook 执行回调 URL (可选)
          </label>
          <input
            v-model="newToolEndpoint"
            type="text"
            placeholder="例如: http://127.0.0.1:8000/api/tools/weather"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <span class="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 block">若提供 HTTP POST 地址，网关将在大模型调用该工具时代为转发并透传执行结果；若留空则返回调试确认回执。</span>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          @click="showCreateModal = false"
        >
          取消
        </button>
        <button
          type="button"
          class="px-6 py-2 text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors shadow-xs"
          :disabled="isSubmitting"
          @click="submitCreateTool"
        >
          {{ isSubmitting ? '注册中...' : '确认注册' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

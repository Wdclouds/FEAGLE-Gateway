<script setup lang="ts">
import { computed } from 'vue';
import type { ToolDefinition } from '../../types/tools';

const props = defineProps<{
  tool: ToolDefinition;
}>();

const emit = defineEmits<{
  (e: 'view-schema', tool: ToolDefinition): void;
  (e: 'delete-tool', name: string): void;
}>();

const isBuiltin = computed(() => {
  return ['web_search', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article'].includes(props.tool.name);
});

function getSecurityLevel(name: string) {
  if (name === 'web_search') return { level: '核心内置', desc: '实时网页检索 (只读安全)' };
  if (name === 'group_remind') return { level: '核心内置', desc: '社群定时提醒入库' };
  if (name === 'palace_memo') return { level: '核心内置', desc: 'SQLite 记忆宫殿持久化' };
  if (name === 'generate_image') return { level: '核心内置', desc: '大模型生图与微信发送' };
  if (name === 'read_wechat_article') return { level: '核心内置', desc: '公众号/网页文章解析阅读' };
  return { level: '自定义扩展', desc: 'Webhook 外部接口 / 扩展动作' };
}

function handleDelete() {
  if (isBuiltin.value) {
    alert('系统核心内置工具不可删除。');
    return;
  }
  if (confirm(`确定要注销并删除工具【${props.tool.name}】吗？`)) {
    emit('delete-tool', props.tool.name);
  }
}
</script>

<template>
  <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-6 transition-colors shadow-xs">
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-base font-bold font-mono text-slate-900 dark:text-white flex items-center gap-2">
            <span>{{ tool.name }}</span>
            <span
              v-if="!isBuiltin"
              class="px-1.5 py-0.5 text-[10px] font-sans font-semibold bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
            >
              扩展
            </span>
          </h3>
          <span class="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 block">
            {{ isBuiltin ? '网关核心内置工具' : '自定义 Webhook 工具' }}
          </span>
        </div>

        <span
          class="px-2.5 py-0.5 text-xs font-medium"
          :class="isBuiltin ? 'bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'"
        >
          {{ getSecurityLevel(tool.name).level }}
        </span>
      </div>

      <p class="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed min-h-[3rem]">
        {{ tool.description }}
      </p>

      <div class="space-y-2 pt-3 border-t border-slate-100 dark:border-white/[0.04] text-xs text-slate-500 dark:text-zinc-400">
        <div class="flex justify-between">
          <span>安全类型:</span>
          <span class="text-slate-700 dark:text-zinc-300">{{ getSecurityLevel(tool.name).desc }}</span>
        </div>
        <div class="flex justify-between font-mono">
          <span>参数定义:</span>
          <span class="text-slate-800 dark:text-zinc-200">
            {{ Object.keys(tool.parameters?.properties || {}).length }} 个属性
          </span>
        </div>
      </div>
    </div>

    <!-- 底部操作按钮 -->
    <div class="pt-4 border-t border-slate-100 dark:border-white/[0.04] flex items-center gap-2">
      <button
        type="button"
        class="flex-1 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors text-center"
        @click="emit('view-schema', tool)"
      >
        查看参数定义
      </button>
      <button
        v-if="!isBuiltin"
        type="button"
        class="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 dark:bg-white/[0.04] dark:hover:bg-rose-950/60 dark:hover:text-rose-300 dark:text-zinc-400 transition-colors"
        title="注销此自定义工具"
        @click="handleDelete"
      >
        删除
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolDefinition } from '../../types/tools';
import ModalDialog from '../common/ModalDialog.vue';

const props = defineProps<{
  show: boolean;
  tool: ToolDefinition | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const formattedSchema = computed(() => {
  if (!props.tool) return '';
  return JSON.stringify(props.tool.parameters, null, 2);
});

function copyJson() {
  navigator.clipboard.writeText(formattedSchema.value);
  alert('参数定义已复制。');
}
</script>

<template>
  <ModalDialog
    :show="show"
    :title="`工具参数规范 · ${tool?.name || ''}`"
    max-width="max-w-2xl"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <p class="text-sm text-slate-500 dark:text-zinc-400">
          函数调用参数结构规范：
        </p>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors"
          @click="copyJson"
        >
          复制内容
        </button>
      </div>

      <pre class="w-full bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] p-4 font-mono text-sm text-slate-900 dark:text-zinc-200 overflow-x-auto leading-relaxed"><code>{{ formattedSchema }}</code></pre>
    </div>
  </ModalDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useChannelStore } from '../../stores/channelStore';
import ModalDialog from '../common/ModalDialog.vue';
import type { MemberProfile } from '../../types/gateway';

const props = defineProps<{
  show: boolean;
  chatId: string;
  wxid: string;
  profile: MemberProfile;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const channelStore = useChannelStore();

const role = ref('');
const tagsInput = ref('');
const notes = ref('');
const isSaving = ref(false);

watch(
  () => props.profile,
  (p) => {
    if (p) {
      role.value = p.role || '';
      tagsInput.value = (p.tags || []).join(', ');
      notes.value = p.notes || '';
    }
  },
  { immediate: true }
);

async function handleSave() {
  if (!props.chatId || !props.wxid) return;
  isSaving.value = true;
  try {
    const tags = tagsInput.value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    await channelStore.updateMember(props.chatId, props.wxid, {
      role: role.value.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      notes: notes.value.trim() || undefined,
    });
    alert('成员画像已更新。');
    emit('close');
  } catch (err: any) {
    alert(`更新失败: ${err.message}`);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :show="show"
    :title="`编辑成员画像 · ${profile.name || wxid}`"
    max-width="max-w-lg"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">身份角色</label>
        <input
          v-model="role"
          type="text"
          placeholder="例如: 群主 / 架构师 / 前端负责人"
          class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <p class="text-xs text-slate-400 dark:text-zinc-500 mt-1">
          设置该成员在群内的角色，大模型在回应时将据此调整认知与语气。
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">关注偏好与标签</label>
        <input
          v-model="tagsInput"
          type="text"
          placeholder="多个标签用逗号隔开，如: 架构, 性能优化, 发布"
          class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">关键特征与备注记忆</label>
        <textarea
          v-model="notes"
          rows="5"
          placeholder="记录关于该成员的关键偏好、重要项目或历史约定..."
          class="w-full p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] leading-relaxed"
        />
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        type="button"
        class="px-6 py-2 text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors shadow-xs"
        :disabled="isSaving"
        @click="handleSave"
      >
        {{ isSaving ? '保存中...' : '保存画像' }}
      </button>
    </template>
  </ModalDialog>
</template>

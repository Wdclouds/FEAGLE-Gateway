<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useChannelStore } from '../../stores/channelStore';
import ModalDialog from '../common/ModalDialog.vue';
import MemberEditDrawer from './MemberEditDrawer.vue';
import type { MemberProfile } from '../../types/gateway';

const props = defineProps<{
  show: boolean;
  chatId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const channelStore = useChannelStore();
const searchQuery = ref('');

const editingMember = ref<{ wxid: string; profile: MemberProfile } | null>(null);
const showEditDrawer = ref(false);

watch(
  () => props.show,
  async (open) => {
    if (open && props.chatId) {
      await channelStore.loadMembers(props.chatId);
    }
  }
);

const memberList = computed(() => {
  const map = channelStore.activeMembers || {};
  return Object.entries(map).map(([wxid, profile]) => ({
    wxid,
    profile,
  }));
});

const filteredMembers = computed(() => {
  if (!searchQuery.value.trim()) return memberList.value;
  const q = searchQuery.value.trim().toLowerCase();
  return memberList.value.filter(
    (m) =>
      m.wxid.toLowerCase().includes(q) ||
      m.profile.name.toLowerCase().includes(q) ||
      (m.profile.role && m.profile.role.toLowerCase().includes(q)) ||
      (m.profile.tags && m.profile.tags.some((t) => t.toLowerCase().includes(q)))
  );
});

function openEdit(member: { wxid: string; profile: MemberProfile }) {
  editingMember.value = member;
  showEditDrawer.value = true;
}

function formatDate(ts: number) {
  if (!ts) return '无发言';
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div>
    <ModalDialog
      :show="show"
      :title="`群成员画像管理 · ${chatId}`"
      max-width="max-w-4xl"
      @close="emit('close')"
    >
      <div class="space-y-4">
        <!-- 搜索检索栏 -->
        <div class="flex items-center justify-between gap-4">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="按微信昵称、微信号、身份或标签快速检索..."
            class="flex-1 px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] font-mono transition-colors"
          />
          <span class="text-sm text-slate-500 dark:text-zinc-400 whitespace-nowrap">
            已收录 {{ filteredMembers.length }} 位成员
          </span>
        </div>

        <!-- 成员数据列表 -->
        <div class="overflow-x-auto border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-black">
          <table class="w-full text-left text-sm text-slate-800 dark:text-slate-300">
            <thead class="bg-slate-50 dark:bg-white/[0.04] text-xs text-slate-500 dark:text-zinc-400 border-b border-slate-200 dark:border-white/[0.06]">
              <tr>
                <th class="py-3 px-4">成员信息</th>
                <th class="py-3 px-4">身份角色</th>
                <th class="py-3 px-4">关注标签</th>
                <th class="py-3 px-4">发言次数</th>
                <th class="py-3 px-4">最后发言</th>
                <th class="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-white/[0.04]">
              <tr
                v-for="m in filteredMembers"
                :key="m.wxid"
                class="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
              >
                <td class="py-3 px-4">
                  <div class="font-medium text-slate-900 dark:text-white">{{ m.profile.name || '未命名成员' }}</div>
                  <div class="text-xs text-slate-400 dark:text-zinc-500 font-mono">{{ m.wxid }}</div>
                </td>

                <td class="py-3 px-4">
                  <span
                    v-if="m.profile.role"
                    class="px-2 py-0.5 text-xs font-semibold bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                  >
                    {{ m.profile.role }}
                  </span>
                  <span v-else class="text-xs text-slate-400 dark:text-zinc-600">普通成员</span>
                </td>

                <td class="py-3 px-4">
                  <div class="flex flex-wrap gap-1.5 max-w-[200px]">
                    <span
                      v-for="tag in m.profile.tags || []"
                      :key="tag"
                      class="px-1.5 py-0.5 text-xs bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300"
                    >
                      {{ tag }}
                    </span>
                    <span v-if="!m.profile.tags || m.profile.tags.length === 0" class="text-xs text-slate-400 dark:text-zinc-600">
                      无
                    </span>
                  </div>
                </td>

                <td class="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-200">
                  {{ m.profile.interactions || 0 }}
                </td>

                <td class="py-3 px-4 font-mono text-xs text-slate-500 dark:text-zinc-400">
                  {{ formatDate(m.profile.lastSeen) }}
                </td>

                <td class="py-3 px-4 text-right">
                  <button
                    type="button"
                    class="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors"
                    @click="openEdit(m)"
                  >
                    编辑画像
                  </button>
                </td>
              </tr>

              <tr v-if="filteredMembers.length === 0">
                <td colspan="6" class="py-12 text-center text-slate-400 dark:text-zinc-500 text-sm">
                  暂无匹配成员数据
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          @click="emit('close')"
        >
          关闭
        </button>
      </template>
    </ModalDialog>

    <!-- 编辑单个成员画像 -->
    <MemberEditDrawer
      v-if="editingMember"
      :show="showEditDrawer"
      :chat-id="chatId"
      :wxid="editingMember.wxid"
      :profile="editingMember.profile"
      @close="showEditDrawer = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useChannelStore } from '../../stores/channelStore';
import { useToolStore } from '../../stores/toolStore';
import ChannelCard from './ChannelCard.vue';
import ChannelDrawer from './ChannelDrawer.vue';
import MemberTableModal from './MemberTableModal.vue';
import ModalDialog from '../common/ModalDialog.vue';

const channelStore = useChannelStore();
const toolStore = useToolStore();
const searchQuery = ref('');

const selectedChatId = ref<string>('');
const showSandboxDrawer = ref(false);
const showMemberModal = ref(false);

// 新增沙箱表单
const showCreateModal = ref(false);
const newChatId = ref('');
const newGroupName = ref('');
const newPersona = ref('');
const newRules = ref('');
const newTools = ref<string[]>([]);
const isCreating = ref(false);

onMounted(async () => {
  await channelStore.fetchChannels();
  if (toolStore.tools.length === 0) {
    await toolStore.fetchTools();
  }
});

const filteredChannels = computed(() => {
  if (!searchQuery.value.trim()) return channelStore.channels;
  const q = searchQuery.value.trim().toLowerCase();
  return channelStore.channels.filter((c) =>
    (c.name && c.name.toLowerCase().includes(q)) ||
    c.chatId.toLowerCase().includes(q) ||
    c.tools.some((t) => t.toLowerCase().includes(q))
  );
});

function handleEditSandbox(chatId: string) {
  selectedChatId.value = chatId;
  showSandboxDrawer.value = true;
}

function handleViewMembers(chatId: string) {
  selectedChatId.value = chatId;
  showMemberModal.value = true;
}

async function handleDeleteSandbox(chatId: string) {
  try {
    await channelStore.deleteSandbox(chatId);
    alert(`社群沙箱【${chatId}】已成功移除。`);
  } catch (err: any) {
    alert(`删除沙箱失败: ${err.message}`);
  }
}

function openCreateModal() {
  newChatId.value = '';
  newGroupName.value = '';
  newPersona.value = '';
  newRules.value = '';
  newTools.value = toolStore.tools.map(t => t.name); // 默认授权全部可用工具
  showCreateModal.value = true;
}

function toggleNewTool(toolName: string) {
  const idx = newTools.value.indexOf(toolName);
  if (idx > -1) {
    newTools.value.splice(idx, 1);
  } else {
    newTools.value.push(toolName);
  }
}

async function submitCreateSandbox() {
  const chatId = newChatId.value.trim();
  if (!chatId) {
    alert('请输入群聊 ID（如 12345678@chatroom）');
    return;
  }
  isCreating.value = true;
  try {
    await channelStore.createSandbox({
      chatId,
      name: newGroupName.value.trim() || undefined,
      personaText: newPersona.value,
      rulesText: newRules.value,
      tools: newTools.value,
    });
    showCreateModal.value = false;
    alert(`群沙箱【${chatId}】创建成功！`);
  } catch (err: any) {
    alert(`创建沙箱失败: ${err.message}`);
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- 顶部标题与操作栏 -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-white/[0.08]">
      <div>
        <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">社群沙箱</h2>
        <p class="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          每个微信群均运行在独立的物理沙箱环境中，工具调用严格受白名单安全限制。
        </p>
      </div>

      <!-- 右侧：搜索框与新建沙箱按钮 -->
      <div class="flex items-center gap-3 w-full sm:w-auto">
        <div class="w-full sm:w-64">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="检索群 ID 或工具..."
            class="w-full px-4 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] font-mono transition-colors"
          />
        </div>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors whitespace-nowrap flex items-center gap-1.5 shadow-xs"
          @click="openCreateModal"
        >
          <span>+ 新建沙箱</span>
        </button>
      </div>
    </div>

    <!-- 群聊沙箱列表网格 -->
    <div v-if="filteredChannels.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <ChannelCard
        v-for="c in filteredChannels"
        :key="c.chatId"
        :channel="c"
        @edit-sandbox="handleEditSandbox"
        @view-members="handleViewMembers"
        @delete-sandbox="handleDeleteSandbox"
      />
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-16 text-center text-slate-500 dark:text-zinc-400 space-y-4 shadow-xs"
    >
      <p class="text-base font-semibold text-slate-800 dark:text-zinc-200">暂无活跃的群聊沙箱</p>
      <p class="text-sm text-slate-400 dark:text-zinc-500 max-w-lg mx-auto leading-relaxed">
        当微信群内初次接收消息或被 @提及 时系统将自动初始化沙箱，您也可以直接点击上方「+ 新建沙箱」手动预置。
      </p>
      <button
        type="button"
        class="px-5 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors"
        @click="openCreateModal"
      >
        立即新建第一个群沙箱
      </button>
    </div>

    <!-- 弹窗抽屉 -->
    <ChannelDrawer
      :show="showSandboxDrawer"
      :chat-id="selectedChatId"
      @close="showSandboxDrawer = false"
    />

    <MemberTableModal
      :show="showMemberModal"
      :chat-id="selectedChatId"
      @close="showMemberModal = false"
    />

    <!-- 新建群沙箱弹窗 -->
    <ModalDialog
      :show="showCreateModal"
      title="新建社群沙箱环境"
      max-width="max-w-2xl"
      @close="showCreateModal = false"
    >
      <div class="space-y-4">
        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            微信群聊 ID <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="newChatId"
            type="text"
            placeholder="例如: 1234567890@chatroom"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <span class="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 block">微信群聊通常以 @chatroom 结尾，系统将为其创建专属数据存储目录。</span>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            群名称 / 别名 (可选)
          </label>
          <input
            v-model="newGroupName"
            type="text"
            placeholder="例如: FEAGLE 核心架构攻坚群"
            class="w-full px-4 py-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-sans focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <span class="text-[11px] text-slate-400 dark:text-zinc-500 mt-1 block">若不填写，系统将在收到微信消息时自动从微信通讯录同步真实群名。</span>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            初始授权工具
          </label>
          <div class="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08]">
            <div
              v-for="tool in toolStore.tools"
              :key="tool.name"
              class="flex items-center gap-2 p-2 hover:bg-slate-100 dark:hover:bg-white/[0.04] cursor-pointer text-xs"
              @click="toggleNewTool(tool.name)"
            >
              <input
                type="checkbox"
                :checked="newTools.includes(tool.name)"
                @click.stop="toggleNewTool(tool.name)"
              />
              <span class="font-mono text-slate-800 dark:text-zinc-200">{{ tool.name }}</span>
            </div>
          </div>
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            专属人设提示词 (可选)
          </label>
          <textarea
            v-model="newPersona"
            rows="3"
            placeholder="# 本群专属人设设定..."
            class="w-full p-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-xs text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block mb-1">
            安全群规 (可选)
          </label>
          <textarea
            v-model="newRules"
            rows="3"
            placeholder="# 本群安全边界守则..."
            class="w-full p-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-xs text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
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
          :disabled="isCreating"
          @click="submitCreateSandbox"
        >
          {{ isCreating ? '创建中...' : '确认创建' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

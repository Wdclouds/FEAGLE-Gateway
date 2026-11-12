<script setup lang="ts">
import { ref, watch } from 'vue';
import { useChannelStore } from '../../stores/channelStore';
import { useToolStore } from '../../stores/toolStore';
import ModalDialog from '../common/ModalDialog.vue';

const props = defineProps<{
  show: boolean;
  chatId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const channelStore = useChannelStore();
const toolStore = useToolStore();

const groupName = ref('');
const personaText = ref('');
const rulesText = ref('');
const selectedTools = ref<string[]>([]);
const isSaving = ref(false);
const activeTab = ref<'tools' | 'persona' | 'rules' | 'session' | 'perception'>('tools');

// 15分钟会话衰减状态
const sessionRemainingTtl = ref(0);
const sessionTurns = ref<Array<{ role: string; content: string; sender?: string; timestamp: number }>>([]);
const isLoadingSession = ref(false);

// 群聊背景感知流水
const backgroundText = ref('');
const isLoadingBackground = ref(false);

// 微信群聊引用回复预览
const previewSender = ref('张三');
const previewQuestion = ref('@Nox 明天上午十点的会议是在第三会议室吗？');
const previewAnswer = ref('是的，明天上午 10:00 会议在第三会议室准时召开，请携带笔记本电脑。');

watch(
  () => props.show,
  async (open) => {
    if (open && props.chatId) {
      if (toolStore.tools.length === 0) {
        await toolStore.fetchTools();
      }
      const sb = await channelStore.loadSandbox(props.chatId);
      if (sb) {
        groupName.value = sb.name || '';
        personaText.value = sb.personaText || '';
        rulesText.value = sb.rulesText || '';
        selectedTools.value = [...(sb.tools || [])];
      }
      await refreshSessionInfo();
      await refreshBackgroundInfo();
    }
  }
);

async function refreshSessionInfo() {
  if (!props.chatId) return;
  isLoadingSession.value = true;
  try {
    const res = await channelStore.getSession(props.chatId);
    sessionRemainingTtl.value = res.remainingTtlSec || 0;
    sessionTurns.value = res.turns || [];
  } catch {
    sessionRemainingTtl.value = 0;
    sessionTurns.value = [];
  } finally {
    isLoadingSession.value = false;
  }
}

async function refreshBackgroundInfo() {
  if (!props.chatId) return;
  isLoadingBackground.value = true;
  try {
    const res = await channelStore.getBackground(props.chatId);
    backgroundText.value = res.backgroundText || '';
  } catch {
    backgroundText.value = '';
  } finally {
    isLoadingBackground.value = false;
  }
}

async function handleResetSession() {
  if (!confirm(`确定要重置群【${props.chatId}】的当前会话吗？这将清空 15 分钟衰减环内的问答轮次。`)) return;
  try {
    await channelStore.resetSession(props.chatId);
    await refreshSessionInfo();
    alert('会话轮次已重置。下一次发言将开启全新会话。');
  } catch (err: any) {
    alert(`重置会话失败: ${err.message}`);
  }
}

function formatRemainingTime(sec: number) {
  if (sec <= 0) return '已归档/无活跃会话';
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  return `${mins} 分 ${remainingSecs} 秒 (共 ${sec} 秒)`;
}

function formatQuotePreview(sender: string, question: string, answer: string): string {
  const name = (sender || '群友').trim();
  let snippet = (question || '').trim().replace(/^@[^\/\r\n\s  ]+[\s  ]*/, '').trim();
  if (snippet.length > 35) snippet = snippet.slice(0, 35) + '...';
  if (!snippet) snippet = '消息';
  return `「${name}：${snippet}」\n- - - - - - - - - - - - - - -\n@${name} ${answer}`;
}

function toggleTool(toolName: string) {
  const idx = selectedTools.value.indexOf(toolName);
  if (idx > -1) {
    selectedTools.value.splice(idx, 1);
  } else {
    selectedTools.value.push(toolName);
  }
}

async function handleSave() {
  if (!props.chatId) return;
  isSaving.value = true;
  try {
    await channelStore.saveSandbox(props.chatId, {
      name: groupName.value.trim() || undefined,
      personaText: personaText.value,
      rulesText: rulesText.value,
      tools: selectedTools.value,
    });
    alert('社群沙箱配置已保存并生效。');
    emit('close');
  } catch (err: any) {
    alert(`保存失败: ${err.message}`);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <ModalDialog
    :show="show"
    :title="`配置社群沙箱 · ${groupName || chatId}`"
    max-width="max-w-3xl"
    @close="emit('close')"
  >
    <div class="space-y-6">
      <!-- 顶部：群名称与基础信息 -->
      <div class="p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex-1 space-y-1">
          <label class="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider block">
            群真实名称 / 自定义别名
          </label>
          <input
            v-model="groupName"
            type="text"
            placeholder="群真实名称或自定义别名（留空自动同步微信通讯录）"
            class="w-full px-3 py-1.5 bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </div>
        <div class="sm:text-right text-xs text-slate-500 dark:text-zinc-400">
          <span class="block font-mono text-[11px] text-slate-400 dark:text-zinc-500">底层协议 ID</span>
          <span class="font-mono text-slate-700 dark:text-zinc-300">{{ chatId }}</span>
        </div>
      </div>

      <!-- 标签页导航 -->
      <div class="flex items-center gap-1 border-b border-slate-200 dark:border-white/[0.08] pb-3 overflow-x-auto">
        <button
          type="button"
          class="px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
          :class="activeTab === 'tools' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'tools'"
        >
          工具授权 ({{ selectedTools.length }})
        </button>
        <button
          type="button"
          class="px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
          :class="activeTab === 'persona' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'persona'"
        >
          专属人设
        </button>
        <button
          type="button"
          class="px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
          :class="activeTab === 'rules' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'rules'"
        >
          安全群规
        </button>
        <button
          type="button"
          class="px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
          :class="activeTab === 'session' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'session'"
        >
          <span>会话衰减环</span>
          <span
            v-if="sessionRemainingTtl > 0"
            class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
            title="会话活跃中"
          />
        </button>
        <button
          type="button"
          class="px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
          :class="activeTab === 'perception' ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'"
          @click="activeTab = 'perception'"
        >
          背景感知与引用
        </button>
      </div>

      <!-- 选项卡 1：工具授权勾选 -->
      <div v-show="activeTab === 'tools'" class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-zinc-400">
          勾选此群允许调用的工具。未勾选的工具在大模型调用时将被网关拦截。
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            v-for="tool in toolStore.tools"
            :key="tool.name"
            class="p-4 bg-slate-50 dark:bg-black flex items-start gap-3 cursor-pointer select-none transition-colors border"
            :class="selectedTools.includes(tool.name) ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]' : 'border-slate-200 dark:border-white/[0.08] hover:bg-slate-100 dark:hover:bg-white/[0.04]'"
            @click="toggleTool(tool.name)"
          >
            <input
              type="checkbox"
              :checked="selectedTools.includes(tool.name)"
              class="mt-1"
              @click.stop="toggleTool(tool.name)"
            />
            <div class="space-y-1">
              <span class="font-bold text-sm text-slate-900 dark:text-white font-mono block">{{ tool.name }}</span>
              <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">{{ tool.description }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 选项卡 2：人设 Prompt -->
      <div v-show="activeTab === 'persona'" class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-slate-700 dark:text-zinc-200">群专属人设提示词</label>
          <span class="text-xs text-slate-400 dark:text-zinc-500">优先级高于全局默认人设</span>
        </div>
        <textarea
          v-model="personaText"
          rows="12"
          placeholder="# 在此输入针对该微信群的专属人设定义..."
          class="w-full p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </div>

      <!-- 选项卡 3：安全铁律 Rules -->
      <div v-show="activeTab === 'rules'" class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-slate-700 dark:text-zinc-200">群专属安全铁律与边界守则</label>
          <span class="text-xs text-slate-400 dark:text-zinc-500">将在系统提示词最底端强调</span>
        </div>
        <textarea
          v-model="rulesText"
          rows="12"
          placeholder="# 在此输入本群不可违背的安全铁律与规则..."
          class="w-full p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] text-sm text-slate-900 dark:text-zinc-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </div>

      <!-- 选项卡 4：15分钟自然衰减会话环 -->
      <div v-show="activeTab === 'session'" class="space-y-4">
        <div class="p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">会话自然衰减窗口 (15分钟TTL)</span>
              <span class="text-sm font-medium text-slate-900 dark:text-white mt-1 block font-mono">
                {{ formatRemainingTime(sessionRemainingTtl) }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-xs bg-white dark:bg-white/[0.06] border border-slate-200 dark:border-transparent hover:bg-slate-100 dark:hover:bg-white/[0.12] text-slate-700 dark:text-zinc-300 transition-colors"
                :disabled="isLoadingSession"
                @click="refreshSessionInfo"
              >
                刷新状态
              </button>
              <button
                v-if="sessionRemainingTtl > 0"
                type="button"
                class="px-3 py-1.5 text-xs bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:text-rose-300 dark:border-transparent transition-colors"
                @click="handleResetSession"
              >
                清空会话
              </button>
            </div>
          </div>

          <!-- TTL 进度条 -->
          <div class="w-full bg-slate-200 dark:bg-white/[0.08] h-2 overflow-hidden">
            <div
              class="h-full transition-all duration-500"
              :class="sessionRemainingTtl > 300 ? 'bg-emerald-500' : sessionRemainingTtl > 60 ? 'bg-amber-500' : 'bg-rose-500'"
              :style="{ width: `${Math.min(100, Math.max(0, (sessionRemainingTtl / 900) * 100))}%` }"
            />
          </div>

          <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
            核心机制：群内连续对话在 15 分钟内自动继承多轮上下文；若群友超过 15 分钟未 @ 机器人，该会话自动归档清空，下一次对话从干净上下文开始，避免长期对话导致的记忆膨胀。
          </p>
        </div>

        <!-- 历史对话轮次展示 -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
            <span>活跃对话问答轮次 (当前保留 {{ sessionTurns.length }} 条)</span>
            <span class="text-slate-400 dark:text-zinc-500">上限 8 条 (4 轮)</span>
          </div>

          <div v-if="sessionTurns.length > 0" class="space-y-2 max-h-72 overflow-y-auto pr-1">
            <div
              v-for="(turn, idx) in sessionTurns"
              :key="idx"
              class="p-3 text-xs font-mono space-y-1"
              :class="turn.role === 'user' ? 'bg-blue-50/70 dark:bg-[#141923] border-l-2 border-blue-500 text-slate-900 dark:text-zinc-100' : 'bg-emerald-50/70 dark:bg-[#0e121a] border-l-2 border-emerald-500 text-slate-900 dark:text-zinc-100'"
            >
              <div class="flex items-center justify-between text-slate-500 dark:text-zinc-400">
                <span class="font-bold" :class="turn.role === 'user' ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'">
                  {{ turn.role === 'user' ? (turn.sender ? `用户 (${turn.sender})` : '群友提问') : 'Nox 回复' }}
                </span>
                <span class="text-[11px] text-slate-400 dark:text-zinc-500">{{ new Date(turn.timestamp).toLocaleTimeString() }}</span>
              </div>
              <p class="whitespace-pre-wrap break-words leading-relaxed">{{ turn.content }}</p>
            </div>
          </div>

          <div v-else class="p-8 text-center text-xs text-slate-400 dark:text-zinc-500 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08]">
            当前无活跃问答。群友在微信群内 @ 机器人提问后，此处将实时展示连贯问答流水。
          </div>
        </div>
      </div>

      <!-- 选项卡 5：群背景感知流水与微信引用预览 -->
      <div v-show="activeTab === 'perception'" class="space-y-4">
        <!-- 背景感知流水 -->
        <div class="p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">群聊背景感知环 (Rolling 20 Buffer)</span>
              <span class="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 block">监听最近 30 分钟内群友非 @ 闲聊流水，注入背景感知</span>
            </div>
            <button
              type="button"
              class="px-3 py-1.5 text-xs bg-white dark:bg-white/[0.06] border border-slate-200 dark:border-transparent hover:bg-slate-100 dark:hover:bg-white/[0.12] text-slate-700 dark:text-zinc-300 transition-colors"
              :disabled="isLoadingBackground"
              @click="refreshBackgroundInfo"
            >
              刷新流水
            </button>
          </div>

          <div v-if="backgroundText" class="p-3 bg-white dark:bg-[#050505] border border-slate-200 dark:border-zinc-800 font-mono text-xs text-slate-800 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {{ backgroundText }}
          </div>
          <div v-else class="p-6 text-center text-xs text-slate-400 dark:text-zinc-500 bg-white dark:bg-[#050505] border border-slate-200 dark:border-zinc-800">
            暂无群聊背景消息（当群内产生普通闲聊但未提及机器人时，系统自动维护最近 20 条消息流水）。
          </div>
        </div>

        <!-- 微信原生引用回复格式模拟器 -->
        <div class="p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/[0.08] space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">微信原生引用回复气泡预览</span>
            <span class="text-[11px] text-slate-400 dark:text-zinc-500 font-mono">formatQuoteReply 输出</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="space-y-1">
              <label class="text-slate-600 dark:text-zinc-400 font-medium">提问人昵称</label>
              <input
                v-model="previewSender"
                type="text"
                class="w-full px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div class="space-y-1">
              <label class="text-slate-600 dark:text-zinc-400 font-medium">群友原消息/引用源</label>
              <input
                v-model="previewQuestion"
                type="text"
                class="w-full px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div class="sm:col-span-2 space-y-1">
              <label class="text-slate-600 dark:text-zinc-400 font-medium">机器人生成回复</label>
              <input
                v-model="previewAnswer"
                type="text"
                class="w-full px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
          </div>

          <!-- 实际渲染效果预览 -->
          <div class="mt-3 p-3 bg-slate-900 dark:bg-black border border-slate-800 dark:border-zinc-800 space-y-1 font-mono text-xs">
            <span class="text-[11px] text-emerald-400 block mb-1 font-sans font-medium">真实发送至微信群的格式预览：</span>
            <pre class="text-emerald-300 whitespace-pre-wrap leading-relaxed select-all">{{ formatQuotePreview(previewSender, previewQuestion, previewAnswer) }}</pre>
          </div>
        </div>
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
        {{ isSaving ? '保存中...' : '保存配置' }}
      </button>
    </template>
  </ModalDialog>
</template>

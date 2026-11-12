<script setup lang="ts">
import type { ChannelSummary } from '../../types/gateway';

const props = defineProps<{
  channel: ChannelSummary;
}>();

const emit = defineEmits<{
  (e: 'edit-sandbox', chatId: string): void;
  (e: 'view-members', chatId: string): void;
  (e: 'delete-sandbox', chatId: string): void;
}>();

function copyChatId(chatId: string) {
  navigator.clipboard.writeText(chatId);
  alert(`群聊 ID 已复制: ${chatId}`);
}

function handleDelete(chatId: string) {
  const displayName = props.channel.name ? `【${props.channel.name}】(${chatId})` : `【${chatId}】`;
  if (confirm(`确定要移除群沙箱${displayName}吗？对应的人设和配置将被清空。`)) {
    emit('delete-sandbox', chatId);
  }
}
</script>

<template>
  <div class="bg-white dark:bg-[#080808] border border-slate-200 dark:border-white/[0.08] p-6 flex flex-col justify-between space-y-6 transition-colors shadow-xs">
    <div class="space-y-4">
      <!-- 头部：群名称 / ID 与 成员统计 -->
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <!-- 真实群名称（如有） -->
          <h3 class="font-bold text-base text-slate-900 dark:text-white truncate" :title="channel.name || channel.chatId">
            {{ channel.name || channel.chatId }}
          </h3>
          <!-- 协议ID及复制按钮 -->
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs font-mono text-slate-500 dark:text-zinc-400 truncate max-w-[180px] sm:max-w-[220px]" :title="channel.chatId">
              {{ channel.chatId }}
            </span>
            <button
              type="button"
              class="text-xs text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
              title="复制群聊 ID"
              @click.stop="copyChatId(channel.chatId)"
            >
              复制
            </button>
          </div>
        </div>

        <span class="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300 whitespace-nowrap">
          {{ channel.memberCount }} 名成员
        </span>
      </div>

      <!-- 已启用工具 -->
      <div class="space-y-2">
        <span class="text-xs text-slate-500 dark:text-zinc-400 block">已授权工具</span>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tool in channel.tools"
            :key="tool"
            class="px-2.5 py-1 text-xs font-mono bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-zinc-300"
          >
            {{ tool }}
          </span>
          <span v-if="!channel.tools || channel.tools.length === 0" class="text-xs text-slate-400 dark:text-zinc-500">
            未授权工具（仅对话）
          </span>
        </div>
      </div>

      <!-- 人设与群规状态 -->
      <div class="flex items-center gap-3 text-xs pt-3 border-t border-slate-100 dark:border-white/[0.04]">
        <span
          class="px-2 py-0.5 font-medium"
          :class="channel.hasPersona ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.04] dark:text-zinc-500'"
        >
          {{ channel.hasPersona ? '专属人设' : '默认人设' }}
        </span>
        <span
          class="px-2 py-0.5 font-medium"
          :class="channel.hasRules ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.04] dark:text-zinc-500'"
        >
          {{ channel.hasRules ? '专属群规' : '通用群规' }}
        </span>
      </div>
    </div>

    <!-- 底部操作按钮 -->
    <div class="grid grid-cols-3 gap-2 pt-4 border-t border-slate-100 dark:border-white/[0.04]">
      <button
        type="button"
        class="py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors text-center cursor-pointer"
        @click="emit('edit-sandbox', channel.chatId)"
      >
        配置沙箱
      </button>
      <button
        type="button"
        class="py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:text-zinc-200 transition-colors text-center cursor-pointer"
        @click="emit('view-members', channel.chatId)"
      >
        群成员画像
      </button>
      <button
        type="button"
        class="py-2 text-xs font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 dark:bg-white/[0.04] dark:hover:bg-rose-950/60 dark:hover:text-rose-300 dark:text-zinc-400 transition-colors text-center cursor-pointer"
        @click="handleDelete(channel.chatId)"
      >
        删除沙箱
      </button>
    </div>
  </div>
</template>

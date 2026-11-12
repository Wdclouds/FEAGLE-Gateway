<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
  maxWidth?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 dark:bg-black/85 backdrop-blur-xs"
        @click.self="emit('close')"
      >
        <div
          class="bg-white dark:bg-[#0a0a0a] text-slate-900 dark:text-zinc-100 w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-white/[0.08] overflow-hidden"
          :class="maxWidth || 'max-w-2xl'"
        >
          <!-- 弹窗顶栏 -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.08]">
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">
              <span>{{ title }}</span>
            </h3>
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <!-- 弹窗主体内容 -->
          <div class="p-6 overflow-y-auto space-y-4 text-slate-700 dark:text-zinc-200">
            <slot />
          </div>

          <!-- 弹窗底部操作条 -->
          <div v-if="$slots.footer" class="px-6 py-4 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-black flex items-center justify-end gap-3">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

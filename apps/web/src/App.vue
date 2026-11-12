<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppHeader from './components/layout/AppHeader.vue';
import PairDeviceModal from './components/pairing/PairDeviceModal.vue';
import { useBridgeStore } from './stores/bridgeStore';
import { useGatewayStore } from './stores/gatewayStore';

const bridgeStore = useBridgeStore();
const gatewayStore = useGatewayStore();
const showPairModal = ref(false);

onMounted(() => {
  bridgeStore.fetchStatus();
  bridgeStore.initSse();
  gatewayStore.fetchHealth();
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-[#f8fafc] dark:bg-black text-slate-900 dark:text-zinc-100 transition-colors selection:bg-[var(--color-accent-subtle)] selection:text-[var(--color-accent)]">
    <!-- 顶部统一导航与状态栏 -->
    <AppHeader @open-pair="showPairModal = true" />

    <!-- 沉浸式主视图内容区 -->
    <main
      class="flex-1 w-full"
      :class="$route.path === '/logs' ? 'p-0 h-[calc(100vh-65px)] flex flex-col overflow-hidden' : 'max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8'"
    >
      <RouterView />
    </main>

    <!-- 设备配对向导弹窗 -->
    <PairDeviceModal
      :show="showPairModal"
      @close="showPairModal = false"
    />
  </div>
</template>

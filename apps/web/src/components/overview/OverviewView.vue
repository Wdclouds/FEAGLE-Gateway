<script setup lang="ts">
import WechatHeroCard from './WechatHeroCard.vue';
import NodeHealthGrid from './NodeHealthGrid.vue';
import TelemetryMetrics from './TelemetryMetrics.vue';
</script>

<template>
  <div class="space-y-6">
    <!-- Top Hero Section -->
    <WechatHeroCard />

    <!-- 4-Card Service Grid -->
    <NodeHealthGrid />

    <!-- Telemetry Statistics -->
    <TelemetryMetrics />
  </div>
</template>

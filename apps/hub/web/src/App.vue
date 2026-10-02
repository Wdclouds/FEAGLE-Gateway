<template>
  <el-config-provider>
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { ElConfigProvider } from 'element-plus';
</script>

<style>
/* 全局暗色重置 */
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  background-color: #0b0f19;
  color: #f1f5f9;
}
</style>

<template>
  <div class="app-shell">
    <!-- 三维画布（底层） -->
    <MapView />

    <!-- HUD 浮层（上层，z-index 由 .hud 统一控制） -->
    <HudPanel />
    <AlarmLog />

    <!-- 建筑信息弹窗：跟随相机实时定位，放最后保证在最上层 -->
    <BuildingPopup />
  </div>
</template>

<script setup>
/**
 * 根组件
 * ------------------------------------------------------------------
 * 作用：搭建页面骨架。地图在下，HUD 浮层在上，互不干扰。
 * 说明：这里只负责布局，不放任何业务逻辑。
 */

import MapView from '@/components/MapView.vue'
import HudPanel from '@/components/HudPanel.vue'
import AlarmLog from '@/components/AlarmLog.vue'
import BuildingPopup from '@/components/BuildingPopup.vue'
import { useThemeStore } from '@/stores/theme'

// 在子组件挂载前把用户上次选的强调色写进 CSS 变量，
// 否则首帧会闪一下默认青色再跳到用户色，看起来像 bug。
useThemeStore().applyCss()
</script>

<style scoped>
.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>

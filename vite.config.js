/**
 * Vite 构建配置
 * ------------------------------------------------------------------
 * 作用：注册 Vue 与 Cesium 插件、配置路径别名、开发服务器与构建参数。
 * 说明：vite-plugin-cesium 会自动完成两件事——
 *   1. 开发/构建时把 Cesium 的静态资源（Workers / Assets / Widgets）拷到
 *      可访问路径，并注入 window.CESIUM_BASE_URL
 *   2. 构建时把 cesium 外置成全局变量，产物因此只有几十 KB
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), cesium()],

  resolve: {
    alias: {
      // '@' 指向 src，避免层层 ../../ 的相对路径
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },

  server: {
    port: 5173,
    host: true
  },

  build: {
    // Cesium 体积大，放宽告警阈值，避免构建日志刷警告
    chunkSizeWarningLimit: 4000
  }
})

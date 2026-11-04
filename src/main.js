/**
 * 应用入口
 * ------------------------------------------------------------------
 * 作用：创建 Vue 应用、安装 Pinia、挂载根组件。
 * 说明：Pinia 必须在 mount 之前安装，否则组件 setup 里拿不到 store。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

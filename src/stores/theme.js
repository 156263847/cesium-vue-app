/**
 * 主题 Store
 * ------------------------------------------------------------------
 * 作用：保存用户选中的强调色，并把它同时写进两个地方——
 *       1. CSS 变量（UI 侧：按钮、数值、描边、面板边线）
 *       2. Cesium 材质（三维侧：围栏、路线、车辆、选中建筑）
 * 调用顺序：App.vue setup 里先 applyCss()（首帧就是对的颜色），
 *           MapView onMounted 里再 syncToScene()（此时模块才存在）。
 * 注意：不要在这里操作 Viewer，只通过 runtime 里的模块句柄改颜色。
 */

import { defineStore } from 'pinia'
import { ACCENT_PRESETS, DEFAULT_ACCENT, STORAGE_KEYS } from '@/config/theme'
import { deriveAccent, normalizeHex } from '@/utils/color'
import { runtime } from '@/runtime'

/** 读取上次的选择；localStorage 在隐私模式下可能抛异常，必须兜住 */
function loadAccent() {
  try {
    return normalizeHex(localStorage.getItem(STORAGE_KEYS.accent)) || DEFAULT_ACCENT
  } catch (e) {
    return DEFAULT_ACCENT
  }
}

function persistAccent(hex) {
  try {
    localStorage.setItem(STORAGE_KEYS.accent, hex)
  } catch (e) {
    /* 存不了就算了，不影响本次会话 */
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    accent: loadAccent()
  }),

  getters: {
    /** 当前强调色派生出的整套令牌 */
    tokens: (state) => deriveAccent(state.accent),

    presets: () => ACCENT_PRESETS,

    /** 当前色是否命中了某个预设（用于色块选中态） */
    activePreset: (state) => {
      const hit = ACCENT_PRESETS.find(
        (p) => p.value.toUpperCase() === state.accent.toUpperCase()
      )
      return hit ? hit.value : ''
    }
  },

  actions: {
    /**
     * 写 CSS 变量
     * 变量名与 global.css 一一对应，改这里必须同步改那边
     */
    applyCss() {
      const t = this.tokens
      const el = document.documentElement
      el.style.setProperty('--c-primary', t.primary)
      el.style.setProperty('--c-primary-weak', t.weak)
      el.style.setProperty('--c-primary-mid', t.mid)
      el.style.setProperty('--panel-line', t.line)
      el.style.setProperty('--c-model-hover', t.hover)
      el.style.setProperty('--c-model-selected', t.primary)
    },

    /** 把强调色下发给三维模块；模块未创建时静默跳过 */
    syncToScene() {
      const t = this.tokens
      runtime.city?.setAccent(t.primary)
      runtime.fence?.setAccent(t.primary)
      runtime.track?.setAccent(t.primary)
    },

    /** 设置强调色：一处调用，CSS + 三维同时生效并持久化 */
    setAccent(hex) {
      const valid = normalizeHex(hex)
      if (!valid || valid === this.accent) return
      this.accent = valid
      this.applyCss()
      this.syncToScene()
      persistAccent(valid)
    },

    resetAccent() {
      this.setAccent(DEFAULT_ACCENT)
    }
  }
})

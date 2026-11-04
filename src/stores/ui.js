/**
 * UI 状态 Store
 * ------------------------------------------------------------------
 * 作用：管理"界面本身"的状态——面板是否收起、围栏/路线是否显示。
 *       这些东西不属于业务数据，也不属于三维场景，单独放一个 store。
 * 约定：折叠状态持久化到 localStorage，刷新后保持用户习惯；
 *       图层显隐直接调用 runtime 里的模块，不写进 Pinia 的三维对象。
 */

import { defineStore } from 'pinia'
import { STORAGE_KEYS } from '@/config/theme'
import { runtime } from '@/runtime'

function loadCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEYS.panel) === '1'
  } catch (e) {
    return false
  }
}

function persistCollapsed(v) {
  try {
    localStorage.setItem(STORAGE_KEYS.panel, v ? '1' : '0')
  } catch (e) {
    /* 忽略：无痕模式下写不进去 */
  }
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    panelCollapsed: loadCollapsed(),
    fenceVisible: true,
    routeVisible: true
  }),

  actions: {
    togglePanel() {
      this.setPanel(!this.panelCollapsed)
    },

    setPanel(collapsed) {
      this.panelCollapsed = collapsed
      persistCollapsed(collapsed)
    },

    toggleFence() {
      this.fenceVisible = !this.fenceVisible
      runtime.fence?.setVisible(this.fenceVisible)
    },

    toggleRoute() {
      this.routeVisible = !this.routeVisible
      runtime.track?.setVisible(this.routeVisible)
    },

    /** 场景重建后把当前显隐状态重新应用一遍 */
    syncToScene() {
      runtime.fence?.setVisible(this.fenceVisible)
      runtime.track?.setVisible(this.routeVisible)
    }
  }
})

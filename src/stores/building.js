/**
 * 建筑选中状态 Store
 * ------------------------------------------------------------------
 * 作用：保存"当前被点选的建筑"的可序列化信息，驱动信息弹窗显隐与内容。
 * 注意：只存 { code, name, height, floors, area, status } 这类纯数据；
 *       建筑的笛卡尔坐标（弹窗定位用）放在 runtime.selectedBuilding，
 *       避免 Cesium 对象进入响应式系统。
 */

import { defineStore } from 'pinia'

export const useBuildingStore = defineStore('building', {
  state: () => ({
    selected: null
  }),

  getters: {
    hasSelection: (state) => !!state.selected,

    /** 编码是甲方最关心的字段，单独提一个 getter 方便模板直接用 */
    selectedCode: (state) => state.selected?.code ?? '-'
  },

  actions: {
    /** 传入建筑记录（或 null 表示取消选中），只摘取纯数据 */
    select(record) {
      if (!record) {
        this.selected = null
        return
      }
      this.selected = {
        code: record.code,
        name: record.name,
        height: record.height,
        floors: record.floors,
        area: record.area,
        status: record.status
      }
    },

    clear() {
      this.selected = null
    }
  }
})

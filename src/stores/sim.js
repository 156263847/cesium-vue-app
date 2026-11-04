/**
 * 仿真状态 Store
 * ------------------------------------------------------------------
 * 作用：保存与三维场景无关、但 UI 需要的可序列化状态——
 *       播放状态、倍速、帧率、实体数、围栏状态、报警次数。
 * 性能提醒：帧率/实体数由 MapView 每 500ms 采样一次再写入，
 *           千万不要每帧 set，否则等于每秒触发 60 次组件更新。
 */

import { defineStore } from 'pinia'

export const useSimStore = defineStore('sim', {
  state: () => ({
    playing: true,
    speed: 1,
    fps: 0,
    entityCount: 0,
    insideFence: true,
    alarmCount: 0
  }),

  getters: {
    fenceLabel: (state) => (state.insideFence ? '正常' : '越界')
  },

  actions: {
    setPlaying(v) {
      this.playing = v
    },
    setSpeed(v) {
      this.speed = v
    },
    setFps(v) {
      this.fps = v
    },
    setEntityCount(v) {
      this.entityCount = v
    },
    setInsideFence(v) {
      this.insideFence = v
    },
    incAlarm() {
      this.alarmCount += 1
    },
    resetCounters() {
      this.alarmCount = 0
      this.insideFence = true
      this.speed = 1
      this.playing = true
    }
  }
})

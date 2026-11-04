/**
 * 报警日志 Store
 * ------------------------------------------------------------------
 * 作用：维护告警队列（倒序、限长），并提供最新一条告警供 Toast 使用。
 * 说明：list 只保留最近 MAX_ROWS 条，避免长时间运行后 DOM 节点无限增长。
 */

import { defineStore } from 'pinia'

const MAX_ROWS = 40

export const useAlarmStore = defineStore('alarm', {
  state: () => ({
    list: [],
    count: 0,
    latest: null
  }),

  actions: {
    /**
     * 追加一条日志
     * @param {string} text 内容
     * @param {'info'|'danger'} level 级别：info 普通，danger 报警
     */
    push(text, level = 'info') {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
        text,
        level
      }

      this.list.unshift(row)
      if (this.list.length > MAX_ROWS) this.list.length = MAX_ROWS

      if (level === 'danger') {
        this.count += 1
        this.latest = row
      }
      return row
    },

    clear() {
      this.list = []
      this.count = 0
      this.latest = null
    }
  }
})

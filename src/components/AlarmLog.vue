<template>
  <!-- 右上角告警日志：倒序展示最近 40 条，并负责越界 Toast -->
  <div class="hud panel">
    <h2>实时告警日志</h2>
    <div class="list">
      <transition-group name="row">
        <div v-for="item in alarms.list" :key="item.id" class="row">
          <span class="t">{{ item.time }}</span>
          <span class="m" :class="item.level">{{ item.text }}</span>
        </div>
      </transition-group>
      <p v-if="!alarms.list.length" class="empty">暂无记录</p>
    </div>
  </div>

  <transition name="toast">
    <div v-if="toastVisible" class="toast">⚠ {{ toastText }}</div>
  </transition>
</template>

<script setup>
/**
 * 告警日志组件
 * ------------------------------------------------------------------
 * 作用：展示报警流水，并在新增报警时弹出顶部提示条。
 * 说明：监听 alarmStore.count 而不是 list 长度，
 *       因为只有 danger 级别才需要弹 Toast，普通 info 只入列表。
 */

import { ref, watch } from 'vue'
import { useAlarmStore } from '@/stores/alarm'

const alarms = useAlarmStore()

const toastVisible = ref(false)
const toastText = ref('')
let timer = null

watch(
  () => alarms.count,
  () => {
    if (!alarms.latest) return
    toastText.value = alarms.latest.text
    toastVisible.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (toastVisible.value = false), 2600)
  }
)
</script>

<style scoped>
.panel {
  right: 20px;
  top: 20px;
  width: 300px;
  max-height: 46vh;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}

h2 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 1px;
}

.list {
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.7;
}

.row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
}

.t {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.m.info {
  color: var(--c-primary);
}

.m.danger {
  color: var(--c-danger);
}

.empty {
  color: var(--text-muted);
  font-size: 12px;
}

.row-enter-active {
  transition: all 0.28s ease;
}

.row-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.toast {
  position: absolute;
  left: 50%;
  top: 82px;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  background: rgba(255, 107, 94, 0.16);
  border: 1px solid rgba(255, 107, 94, 0.5);
  color: #ffb3ac;
  font-size: 13px;
  z-index: 20;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}
</style>

/**
 * 建筑信息弹窗组件
 * ------------------------------------------------------------------
 * 作用：点击白模后在建筑上方浮出一个信息卡，展示编码、名称、层数、高度、
 *       建筑面积与状态；并随相机移动实时跟随建筑位置。
 * 实现要点：
 *   1. 位置不写死，每帧用 SceneTransforms.worldToWindowCoordinates 把
 *      建筑的笛卡尔坐标投影成屏幕坐标，所以旋转/缩放时弹窗会跟着走。
 *   2. 投影结果为 undefined 表示建筑在相机背面，此时隐藏弹窗。
 *   3. 边界钳制：靠近屏幕边缘时自动内收，不会被裁掉。
 */

<template>
  <transition name="pop">
    <div
      v-if="building.hasSelection"
      class="popup hud"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @click.stop
    >
      <div class="head">
        <span class="code">{{ building.selected.code }}</span>
        <button class="close" title="关闭" @click="onClose">✕</button>
      </div>

      <h3>{{ building.selected.name }}</h3>

      <ul class="rows">
        <li>
          <span class="k">建筑高度</span>
          <span class="v">{{ building.selected.height }} m</span>
        </li>
        <li>
          <span class="k">楼层数</span>
          <span class="v">{{ building.selected.floors }} 层</span>
        </li>
        <li>
          <span class="k">建筑面积</span>
          <span class="v">{{ building.selected.area.toLocaleString() }} ㎡</span>
        </li>
        <li>
          <span class="k">运行状态</span>
          <span class="v" :class="{ active: building.selected.status !== '正常' }">
            {{ building.selected.status }}
          </span>
        </li>
      </ul>

      <p class="tip">编码已同步至巡检台账</p>
    </div>
  </transition>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import * as Cesium from 'cesium'
import { runtime } from '@/runtime'
import { useBuildingStore } from '@/stores/building'

const building = useBuildingStore()

// 弹窗左上角屏幕坐标（相对应用容器）
const pos = reactive({ x: 0, y: 0 })

const POPUP_W = 240
const POPUP_H = 210

function syncPosition() {
  const viewer = runtime.viewer
  const record = runtime.selectedBuilding
  if (!viewer || viewer.isDestroyed() || !record) return

  const win = Cesium.SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    record.center
  )

  // 投影失败：建筑在相机背后，直接移出可视区
  if (!win) {
    pos.x = -9999
    pos.y = -9999
    return
  }

  const maxX = window.innerWidth - POPUP_W - 16
  const maxY = window.innerHeight - POPUP_H - 16

  pos.x = Math.min(Math.max(win.x + 18, 12), maxX)
  pos.y = Math.min(Math.max(win.y - 90, 12), maxY)
}

let removeListener = null

onMounted(() => {
  const viewer = runtime.viewer
  if (!viewer) return
  // 用 postRender 而不是定时器：相机一动就同步，避免弹窗"飘"
  removeListener = viewer.scene.postRender.addEventListener(syncPosition)
})

onBeforeUnmount(() => {
  if (removeListener) removeListener()
  removeListener = null
})

// 选中变化时先算一次位置，避免弹窗第一帧闪现在左上角
watch(
  () => building.selected,
  () => syncPosition()
)

function onClose() {
  runtime.city?.setSelected(null)
  runtime.selectedBuilding = null
  building.clear()
}
</script>

<style scoped>
.popup {
  width: 240px;
  padding: 12px 14px;
  pointer-events: auto;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

/* 编码用主题色描边小标签，视觉上区分于标题 */
.code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--c-primary);
  border: 1px solid var(--panel-line);
  background: var(--c-primary-weak);
  border-radius: 4px;
  padding: 2px 6px;
}

.close {
  background: transparent !important;
  border: none !important;
  color: var(--text-muted);
  font-size: 13px;
  padding: 2px 4px;
  line-height: 1;
}

.close:hover {
  color: var(--text);
}

h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.rows li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
}

.k {
  color: var(--text-muted);
}

.v {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.v.active {
  color: var(--c-primary);
}

.tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}

.pop-enter-active,
.pop-leave-active {
  transition: all 0.18s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>

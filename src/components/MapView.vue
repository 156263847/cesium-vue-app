<template>
  <!-- Cesium 画布容器：必须显式定位，Viewer 会以它为基准计算尺寸 -->
  <div id="cesiumContainer" ref="containerRef"></div>
</template>

<script setup>
/**
 * 三维场景容器组件
 * ------------------------------------------------------------------
 * 作用：整个应用唯一的"装配层"——按顺序创建 Viewer、底图、白模、围栏、
 *       报警看门狗、轨迹、拾取交互，并在卸载时按相反顺序全部销毁。
 * 原则：本组件只做装配与生命周期管理，不写业务算法（算法在 modules/ 里）。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

import { createViewer, destroyViewer, flyHome, observeResize } from '@/cesium/viewer'
import { addBaseLayer } from '@/cesium/layers'
import { createCityBase } from '@/modules/cityBase'
import { createFence } from '@/modules/fence'
import { createTrack } from '@/modules/track'
import { createAlarmWatch } from '@/modules/alarm'
import { createPicker } from '@/modules/picker'
import { BASE_LAYER, FENCE_RING, ROUTE } from '@/config/scene'
import { runtime } from '@/runtime'
import { useSimStore } from '@/stores/sim'
import { useAlarmStore } from '@/stores/alarm'
import { useBuildingStore } from '@/stores/building'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'

const containerRef = ref(null)

const sim = useSimStore()
const alarms = useAlarmStore()
const buildings = useBuildingStore()
const theme = useThemeStore()
const ui = useUiStore()

/** 卸载时要执行的清理函数，顺序入栈、顺序出栈 */
let cleanupFns = []

onMounted(() => {
  const viewer = createViewer(containerRef.value)
  runtime.viewer = viewer

  // 1. 底图
  const baseLayer = addBaseLayer(viewer, BASE_LAYER)

  // 2. 城市白模（每栋带唯一编码，支持悬停/选中）
  const city = createCityBase(viewer, { route: ROUTE })
  city.build()
  runtime.city = city

  // 3. 电子围栏
  const fence = createFence(viewer, FENCE_RING)
  runtime.fence = fence

  // 4. 报警看门狗：只在进出翻转时触发一次
  const watch = createAlarmWatch({
    fence,
    onLeave() {
      sim.setInsideFence(false)
      sim.incAlarm()
      alarms.push('越界报警：车辆驶出监管区域', 'danger')
    },
    onEnter() {
      sim.setInsideFence(true)
      alarms.push('车辆已返回围栏区域', 'info')
    }
  })

  // 5. 轨迹回放：每帧把车辆位置交给看门狗判定
  const track = createTrack(viewer, {
    route: ROUTE,
    onMove(cartesian) {
      watch.update(cartesian)
    }
  })
  runtime.track = track

  // 6. 拾取交互：悬停高亮 + 点击选中弹窗
  const picker = createPicker(viewer, {
    city,
    onHover(rec) {
      city.setHover(rec)
    },
    onSelect(rec) {
      city.setSelected(rec)
      runtime.selectedBuilding = rec
      buildings.select(rec)
    }
  })
  runtime.picker = picker

  // 7. 帧率与实体数统计：500ms 采样一次，避免高频写 store
  let frames = 0
  let last = performance.now()
  const removeFps = viewer.scene.preRender.addEventListener(() => {
    frames++
    const now = performance.now()
    if (now - last >= 500) {
      sim.setFps(Math.round((frames * 1000) / (now - last)))
      sim.setEntityCount(viewer.entities.values.length)
      frames = 0
      last = now
    }
  })

  // 8. 容器尺寸自适应（大屏侧栏收起、窗口缩放）
  const removeResize = observeResize(viewer, containerRef.value)

  // 9. 入场运镜
  flyHome(viewer)

  // 10. 把用户已保存的强调色 / 图层显隐同步到刚创建的三维模块
  //     （模块创建时只能用默认色，这里补齐"上次会话的选择"）
  theme.syncToScene()
  ui.syncToScene()

  // 清理顺序：先拆交互和业务模块，最后销毁 Viewer
  cleanupFns = [
    () => removeFps(),
    removeResize,
    () => picker.destroy(),
    () => track.destroy(),
    () => fence.destroy(),
    () => city.destroy(),
    () => baseLayer.remove(),
    () => destroyViewer()
  ]

  sim.setPlaying(true)
  alarms.push('系统就绪，点击任意建筑查看编码与属性', 'info')
})

onBeforeUnmount(() => {
  cleanupFns.forEach((fn) => {
    try {
      fn()
    } catch (e) {
      console.warn('[cleanup]', e)
    }
  })
  cleanupFns = []
  runtime.viewer = null
  runtime.city = null
  runtime.fence = null
  runtime.track = null
  runtime.picker = null
  runtime.selectedBuilding = null
})
</script>

<style scoped>
#cesiumContainer {
  position: absolute;
  inset: 0;
}
</style>

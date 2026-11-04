/**
 * Viewer 单例模块
 * ------------------------------------------------------------------
 * 作用：创建并管理全局唯一的 Cesium.Viewer，统一初始化场景参数
 *       （背景色、大气、雾、深度测试等），并提供入场运镜与尺寸自适应。
 * 为什么必须单例：
 *   每个组件 new 一个 Viewer 是这类项目内存泄漏的头号原因——
 *   三维上下文不会被 GC 回收，切几次路由显存就满了。
 * 用法：createViewer(el) 拿实例；组件卸载时调 destroyViewer()。
 */

import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { CAMERA_HOME, THEME } from '@/config/scene'

let viewer = null

export function createViewer(container) {
  if (viewer && !viewer.isDestroyed()) return viewer

  viewer = new Cesium.Viewer(container, {
    baseLayer: false, // 不用 Cesium ion 底图，避免 token 依赖
    animation: false,
    timeline: false,
    fullscreenButton: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true
  })

  const scene = viewer.scene

  // 背面地球颜色与页面背景保持一致，避免飞出大气层时出现突兀的蓝色
  scene.globe.baseColor = Cesium.Color.fromCssColorString(THEME.bg)
  scene.globe.showGroundAtmosphere = true
  scene.skyAtmosphere.hueShift = -0.15
  scene.fog.enabled = true
  // 0.00018 是按 1.2km 园区视角调的；城区俯瞰高度 4km 时雾因子会到 0.53，
  // 远景整片发灰。降到 0.00006 后同高度雾因子约 0.22，既有纵深感又不糊。
  scene.fog.density = 0.00006
  scene.highDynamicRange = true

  // 白模不需要地形遮挡；关掉可省 20~40% 的深度计算
  scene.globe.depthTestAgainstTerrain = false

  scene.screenSpaceCameraController.maximumZoomDistance = 12000

  return viewer
}

export function getViewer() {
  return viewer && !viewer.isDestroyed() ? viewer : null
}

export function destroyViewer() {
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  viewer = null
}

/** 入场运镜：从高空斜俯冲进园区 */
export function flyHome(target, duration = 3.2) {
  target.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      CAMERA_HOME.lon,
      CAMERA_HOME.lat,
      CAMERA_HOME.height
    ),
    orientation: {
      heading: Cesium.Math.toRadians(CAMERA_HOME.heading),
      pitch: Cesium.Math.toRadians(CAMERA_HOME.pitch),
      roll: 0
    },
    duration
  })
}

/** 监听容器尺寸变化，大屏/侧边栏收起时必须调用，否则画面被拉伸 */
export function observeResize(target, container) {
  const ro = new ResizeObserver(() => {
    if (!target.isDestroyed()) target.resize()
  })
  ro.observe(container)
  return () => ro.disconnect()
}

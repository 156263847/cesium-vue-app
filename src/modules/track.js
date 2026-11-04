/**
 * 轨迹回放模块
 * ------------------------------------------------------------------
 * 作用：把一组经纬度航点插值成平滑路径，驱动车辆实体沿路径匀速运动，
 *       并通过 onMove 回调把每一帧的位置抛给上层（用于围栏判定等）。
 * 关键实现：
 *   1. 位置用 CallbackProperty 提供，不每帧重建实体（性能）
 *   2. 用 progress(0~1) 比例驱动，与帧率解耦，改倍速不影响轨迹形状
 *   3. dt 做上限钳制，避免切后台回来后车辆瞬移
 * 动态能力：setAccent 换强调色（路线/车辆描边/垂线一起换），
 *           setVisible 控制路线层显隐（车辆始终保持可见）。
 */

import * as Cesium from 'cesium'
import { THEME } from '@/config/scene'
import { catmullRom } from '@/cesium/coordinate'

export function createTrack(
  viewer,
  { route, label = '京A·巡检 01', samplesPerSegment = 32, baseSpeed = 0.0125, onMove }
) {
  // 把 10 个航点重采样成数百个点，形成平滑曲线
  const dense = catmullRom(route, samplesPerSegment)
  const flat = []
  dense.forEach((p) => flat.push(p[0], p[1]))
  const cartesians = Cesium.Cartesian3.fromDegreesArray(flat)

  let progress = 0
  let playing = true
  let speed = 1
  let current = cartesians[0]
  // 当前强调色
  let accent = THEME.primary

  // ---------- 轨迹线（发光路径） ----------
  const pathEntity = viewer.entities.add({
    polyline: {
      positions: cartesians,
      width: 4,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.22,
        color: Cesium.Color.fromCssColorString(accent).withAlpha(0.85)
      })
    }
  })

  // ---------- 车辆 ----------
  const vehicleEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty(() => current, false),
    point: {
      pixelSize: 12,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString(accent),
      outlineWidth: 4,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: label,
      font: '500 13px "PingFang SC", sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#E8F6FF'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString(THEME.bg).withAlpha(0.82),
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })

  // ---------- 车辆到地面的垂线，强化空间高度感 ----------
  const dropEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const carto = Cesium.Cartographic.fromCartesian(current)
        const ground = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0)
        return [ground, current]
      }, false),
      width: 1,
      material: Cesium.Color.fromCssColorString(accent).withAlpha(0.45)
    }
  })

  /**
   * 换强调色
   * 注意：PolylineGlowMaterialProperty 的颜色是整体材质的一部分，
   * 直接改 color 在部分 Cesium 版本上不刷新，这里整体替换材质对象更稳。
   */
  function setAccent(hex) {
    accent = hex
    const color = Cesium.Color.fromCssColorString(hex)
    pathEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
      glowPower: 0.22,
      color: color.withAlpha(0.85)
    })
    vehicleEntity.point.outlineColor = color
    dropEntity.polyline.material = color.withAlpha(0.45)
  }

  /** 路线层显隐：只隐藏"路径 + 垂线"，车辆本身始终可见 */
  function setVisible(visible) {
    pathEntity.show = visible
    dropEntity.show = visible
  }

  // ---------- 逐帧推进 ----------
  let lastTs = performance.now()
  const removeListener = viewer.scene.preRender.addEventListener(() => {
    const now = performance.now()
    const dt = Math.min((now - lastTs) / 1000, 0.12) // 钳制，防切后台瞬移
    lastTs = now

    if (!playing) return

    progress = (progress + dt * baseSpeed * speed) % 1
    const idx = Math.floor(progress * (cartesians.length - 1))
    current = cartesians[idx]
    onMove && onMove(current, progress)
  })

  function play() {
    playing = true
  }
  function pause() {
    playing = false
  }
  function toggle() {
    playing = !playing
    return playing
  }
  function setSpeed(v) {
    speed = v
  }
  function reset() {
    progress = 0
    current = cartesians[0]
  }

  function destroy() {
    removeListener()
    viewer.entities.remove(pathEntity)
    viewer.entities.remove(vehicleEntity)
    viewer.entities.remove(dropEntity)
  }

  return {
    play,
    pause,
    toggle,
    setSpeed,
    reset,
    setAccent,
    setVisible,
    destroy,
    get playing() {
      return playing
    },
    get speed() {
      return speed
    },
    get progress() {
      return progress
    }
  }
}

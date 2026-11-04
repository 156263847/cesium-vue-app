/**
 * 电子围栏模块
 * ------------------------------------------------------------------
 * 作用：绘制立体围栏区域，提供"点是否在围栏内"的判定与报警视觉状态。
 * 职责边界：只负责几何与外观，不做报警逻辑（逻辑在 alarm.js），
 *           这样换围栏形状不影响报警规则，反之亦然。
 * 动态能力：setAccent 换强调色、setVisible 控制显隐，两者都不重建实体，
 *           只改材质属性——重建实体等于每换一次色就掉一次帧。
 */

import * as Cesium from 'cesium'
import { THEME } from '@/config/scene'
import { pointInPolygon } from '@/cesium/coordinate'

export function createFence(viewer, ring, { height = 6 } = {}) {
  const positions = Cesium.Cartesian3.fromDegreesArray(
    ring.reduce((acc, p) => acc.concat(p), [])
  )

  // 当前强调色：默认取色板，用户可在控制面板里改
  let accent = THEME.primary
  // 是否处于报警态：换色时必须保留这个状态，否则一换色报警就"消失"了
  let alerting = false

  const entity = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      height: 0,
      extrudedHeight: height,
      // 初始材质，随后由 paint() 统一刷新
      material: Cesium.Color.fromCssColorString(accent).withAlpha(0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(accent).withAlpha(0.9)
    }
  })

  /** 按"当前强调色 + 当前报警态"刷新材质，唯一的外观写入口 */
  function paint() {
    const color = alerting ? THEME.danger : accent
    entity.polygon.material = Cesium.Color.fromCssColorString(color).withAlpha(
      alerting ? 0.24 : 0.14
    )
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color).withAlpha(0.95)
  }

  /** 切报警态：只改材质与描边色，实体本身不重建 */
  function setAlert(value) {
    if (alerting === value) return
    alerting = value
    paint()
  }

  /** 换强调色：报警中则保持红色，恢复后再用新色 */
  function setAccent(hex) {
    accent = hex
    paint()
  }

  /** 显隐：整块围栏一起隐藏，判定逻辑不受影响 */
  function setVisible(visible) {
    entity.show = visible
  }

  /** 判断笛卡尔坐标是否落在围栏内（内部转经纬度做射线法） */
  function contains(cartesian) {
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    return pointInPolygon(
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude),
      ring
    )
  }

  function destroy() {
    viewer.entities.remove(entity)
  }

  return {
    entity,
    contains,
    setAlert,
    setAccent,
    setVisible,
    destroy,
    get alerting() {
      return alerting
    }
  }
}

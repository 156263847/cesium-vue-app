/**
 * 拾取交互模块
 * ------------------------------------------------------------------
 * 作用：把"鼠标/手指在三维场景里的动作"翻译成业务事件——
 *       悬停到哪栋建筑、点击选中哪栋、点空白处取消选中。
 * 依赖：cityBase 提供的 isBuilding / getRecord（只认白模，不误判其他实体）
 * 说明：ScreenSpaceEventHandler 必须手动 destroy，否则切路由后会残留并报错。
 */

import * as Cesium from 'cesium'

export function createPicker(viewer, { city, onHover, onSelect }) {
  const canvas = viewer.scene.canvas
  const handler = new Cesium.ScreenSpaceEventHandler(canvas)

  let hovered = null

  /**
   * 拾取结果三态：
   *   Entity  → 命中了某栋建筑
   *   null    → 命中了别的东西 / 空白
   *   undefined → 命中的是悬停标签本身，应忽略（否则会闪）
   */
  function pickBuilding(position) {
    const picked = viewer.scene.pick(position)
    if (!Cesium.defined(picked) || !picked.id) return null

    const entity = picked.id
    if (entity === city.hoverLabelEntity) return undefined
    if (!city.isBuilding(entity)) return null
    return entity
  }

  handler.setInputAction((movement) => {
    const entity = pickBuilding(movement.endPosition)
    if (entity === undefined) return

    const rec = entity ? city.getRecord(entity) : null
    if (rec === hovered) return

    hovered = rec
    canvas.style.cursor = rec ? 'pointer' : 'default'
    onHover && onHover(rec)
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  handler.setInputAction((click) => {
    const entity = pickBuilding(click.position)
    if (entity === undefined) return

    const rec = entity ? city.getRecord(entity) : null
    onSelect && onSelect(rec)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  function destroy() {
    handler.destroy()
    canvas.style.cursor = 'default'
    hovered = null
  }

  return { destroy }
}

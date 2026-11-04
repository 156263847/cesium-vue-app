/**
 * 城市白模模块
 * ------------------------------------------------------------------
 * 作用：在指定经纬度范围内程序化生成一片"白色建筑体块"，为每栋建筑分配
 *       唯一编码与业务属性，并负责三种视觉状态（常态 / 悬停 / 选中）的切换。
 * 输出：createCityBase() 返回 { build, destroy, setHover, setSelected, ... }
 * 说明：真实项目中 build() 内部换成 Cesium3DTileset 即可，其余接口不变，
 *       上层（交互、弹窗、报警）一行都不用改。
 */

import * as Cesium from 'cesium'
import {
  BUILDING_CODE_PREFIX,
  BUILDING_GRID,
  CAMPUS_SPAN,
  CENTER,
  THEME
} from '@/config/scene'
import { deriveAccent } from '@/utils/color'

// 每度经纬度对应的米数（用于估算建筑面积，北京纬度下近似值）
const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180)

export function createCityBase(viewer, { route = [], prefix = BUILDING_CODE_PREFIX } = {}) {
  /** 建筑记录：既存 Cesium 实体，也存可序列化的业务属性 */
  const records = []
  /** entity → record 的索引，pick 之后 O(1) 反查 */
  const byEntity = new Map()

  let hovered = null
  let selected = null
  let hoverLabel = null

  // 当前强调色派生的令牌（选中色 / 悬停色），随控制面板切换
  let accentToken = deriveAccent(THEME.modelSelected)

  // ---------- 颜色状态 ----------

  function stateColor(rec) {
    if (rec === selected) return accentToken.primary
    if (rec === hovered) return accentToken.hover
    return THEME.model
  }

  function stateAlpha(rec) {
    return rec === selected ? 0.98 : 0.95
  }

  /** 按当前状态重绘单栋建筑（只改材质，不重建实体） */
  function paint(rec) {
    if (!rec || !rec.entity) return
    rec.entity.polygon.material = Cesium.Color.fromCssColorString(
      stateColor(rec)
    ).withAlpha(stateAlpha(rec))
    rec.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(
      rec === selected ? accentToken.primary : THEME.modelEdge
    ).withAlpha(rec === selected ? 1 : 0.75)
  }

  /**
   * 换强调色
   * 只重绘"正在悬停/选中"的那一两栋，而不是遍历全部实体——
   * 160 栋逐个重设材质在低端机上是肉眼可见的卡顿。
   */
  function setAccent(hex) {
    accentToken = deriveAccent(hex)
    if (selected) paint(selected)
    if (hovered) paint(hovered)
    if (hoverLabel) {
      hoverLabel.label.backgroundColor = Cesium.Color.fromCssColorString(
        accentToken.primary
      ).withAlpha(0.95)
    }
  }

  // ---------- 悬停提示标签（复用一个实体，避免 160 个标签拖性能） ----------

  function ensureHoverLabel() {
    if (hoverLabel) return hoverLabel
    hoverLabel = viewer.entities.add({
      show: false,
      position: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 0),
      label: {
        text: '',
        font: '500 13px "PingFang SC", sans-serif',
        fillColor: Cesium.Color.fromCssColorString(THEME.bg),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(accentToken.primary).withAlpha(
          0.95
        ),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    return hoverLabel
  }

  // ---------- 生成 ----------

  function nearRoute(lon, lat, threshold = 0.00055) {
    return route.some(([rlon, rlat]) => {
      const dx = lon - rlon
      const dy = lat - rlat
      return Math.sqrt(dx * dx + dy * dy) < threshold
    })
  }

  function build({ cols = BUILDING_GRID.cols, rows = BUILDING_GRID.rows } = {}) {
    const dLon = CAMPUS_SPAN.lon / cols
    const dLat = CAMPUS_SPAN.lat / rows
    const lon0 = CENTER.lon - CAMPUS_SPAN.lon / 2
    const lat0 = CENTER.lat - CAMPUS_SPAN.lat / 2

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // 随机留白，制造街道肌理
        if (Math.random() < 0.18) continue

        const bx = lon0 + c * dLon + dLon * 0.16
        const by = lat0 + r * dLat + dLat * 0.16
        if (nearRoute(bx + dLon * 0.34, by + dLat * 0.34)) continue

        const w = dLon * (0.5 + Math.random() * 0.18)
        const h = dLat * (0.5 + Math.random() * 0.18)

        // 越靠近中心越高的"CBD 感"
        const distToCenter = Math.hypot(bx - CENTER.lon, by - CENTER.lat)
        const height =
          14 + Math.random() * 42 + Math.max(0, 70 - distToCenter * 9000) * Math.random()

        // ---------- 编码与业务属性 ----------
        const rowLetter = String.fromCharCode(65 + (r % 26))
        const colNum = String(c + 1).padStart(2, '0')
        const code = `${prefix}-${rowLetter}${colNum}`

        const widthM = w * M_PER_DEG_LON
        const depthM = h * M_PER_DEG_LAT
        const area = Math.round(widthM * depthM * 0.72) // 0.72 为容积占位系数
        const floors = Math.max(1, Math.round(height / 3.6))
        const status = Math.random() < 0.12 ? '巡检中' : '正常'

        const entity = viewer.entities.add({
          // 把业务字段挂到实体上，导出/对接时可直接读
          properties: new Cesium.PropertyBag({
            code,
            name: `${rowLetter}${c + 1} 号楼`,
            height: Math.round(height),
            floors,
            area,
            status
          }),
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray([
                bx,
                by,
                bx + w,
                by,
                bx + w,
                by + h,
                bx,
                by + h
              ])
            ),
            height: 0,
            extrudedHeight: height,
            // 白模：纯白填充 + 浅灰描边，靠颜色区分体块边界
            material: Cesium.Color.fromCssColorString(THEME.model).withAlpha(0.95),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(THEME.modelEdge).withAlpha(0.75)
          }
        })

        const record = {
          entity,
          code,
          name: `${rowLetter}${c + 1} 号楼`,
          height: Math.round(height),
          floors,
          area,
          status,
          // 弹窗锚点：建筑中心偏上
          center: Cesium.Cartesian3.fromDegrees(
            bx + w / 2,
            by + h / 2,
            height * 0.55
          )
        }

        records.push(record)
        byEntity.set(entity, record)
      }
    }

    ensureHoverLabel()
    return records.length
  }

  // ---------- 交互状态 ----------

  function setHover(rec) {
    if (hovered === rec) return
    const prev = hovered
    hovered = rec

    if (prev) paint(prev)
    if (rec) paint(rec)

    const label = ensureHoverLabel()
    if (rec) {
      label.position = new Cesium.ConstantPositionProperty(rec.center)
      label.label.text = rec.code
      label.show = true
    } else {
      label.show = false
    }
  }

  function setSelected(rec) {
    if (selected === rec) return
    const prev = selected
    selected = rec

    if (prev) paint(prev)
    if (rec) paint(rec)
  }

  // ---------- 对外查询 ----------

  function getRecord(entity) {
    return byEntity.get(entity) || null
  }

  function isBuilding(entity) {
    return byEntity.has(entity)
  }

  function clear() {
    setHover(null)
    setSelected(null)
  }

  function destroy() {
    clear()
    records.forEach((rec) => viewer.entities.remove(rec.entity))
    records.length = 0
    byEntity.clear()
    if (hoverLabel) {
      viewer.entities.remove(hoverLabel)
      hoverLabel = null
    }
  }

  return {
    build,
    destroy,
    setHover,
    setSelected,
    setAccent,
    getRecord,
    isBuilding,
    getAll: () => records,
    get hoverLabelEntity() {
      return hoverLabel
    },
    get selected() {
      return selected
    },
    get count() {
      return records.length
    }
  }
}

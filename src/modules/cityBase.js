/**
 * 城市白模模块
 * ------------------------------------------------------------------
 * 作用：生成"白色建筑体块"并管理三态视觉（常态/悬停/选中）。
 * 两条数据路径，最终走同一个 addBuilding() 入口，下游（编码/拾取/弹窗）
 * 完全无感知数据从哪来：
 *   1. buildFromOsm(bbox)：Overpass 拉取真实建筑轮廓（推荐，demo 说服力强）
 *   2. build()：程序化生成网格体块（OSM 失败时的降级，保证场景永远有东西）
 * 高度补全策略（OSM 中国区大量缺 height）：
 *   tags.height > tags["building:levels"]×3.2 > 按建筑类型+位置启发式推算
 * 说明：真实项目中 buildFromOsm 内部换成 Cesium3DTileset 即可，其余接口不变。
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
import { fetchOsmBuildings } from '@/cesium/overpass'

// 每度经纬度对应的米数（用于面积/距离估算，北京纬度下近似值）
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
   * 数百栋逐个重设材质在低端机上是肉眼可见的卡顿。
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

  // ---------- 悬停提示标签（复用一个实体，避免 N 个标签拖性能） ----------

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

  // ---------- 通用工具 ----------

  function nearRoute(lon, lat, threshold = 0.00055) {
    return route.some(([rlon, rlat]) => {
      const dx = lon - rlon
      const dy = lat - rlat
      return Math.sqrt(dx * dx + dy * dy) < threshold
    })
  }

  /** 鞋带公式求多边形面积（平方米，经纬度先转米；末点自动回绕到首点） */
  function ringArea(ring) {
    let sum = 0
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[(i + 1) % n] // 末点回绕，环不闭合也能算
      sum += x1 * M_PER_DEG_LON * (y2 * M_PER_DEG_LAT) - x2 * M_PER_DEG_LON * (y1 * M_PER_DEG_LAT)
    }
    return Math.abs(sum) / 2
  }

  /** 环的包围盒中心 */
  function ringCenter(ring) {
    let minLon = Infinity
    let maxLon = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
  }

  /**
   * OSM 高度补全（核心策略，四级递进）
   * 中国区的 OSM 建筑大多只有轮廓没有高度，直接拉伸全是平的，demo 会很难看
   */
  function completeHeight(tags, areaM2, distToCenter) {
    // 1. 显式 height，兼容 "25" / "25 m" / "25米" 写法
    const rawH = parseFloat(String(tags.height || '').replace(/[^\d.]/g, ''))
    if (rawH > 2 && rawH < 900) return rawH

    // 2. 层数 × 3.2（中国常规层高）
    const levels = parseFloat(tags['building:levels'])
    if (levels > 0 && levels < 150) return levels * 3.2

    // 3. 按建筑类型给基准（启发式）
    const type = tags.building || ''
    let base
    if (/house|detached|residential|apartments|terrace|dormitory/.test(type)) {
      base = 12 + Math.random() * 18 // 住宅
    } else if (/commercial|office|hotel|civic|government/.test(type)) {
      base = 12 + Math.random() * 22 // 商办
    } else if (/industrial|warehouse|garage|shed|roof|hut/.test(type)) {
      base = 5 + Math.random() * 6 // 厂房/附属
    } else {
      base = 9 + Math.random() * 24 // 未标注
    }

    // 4. 中心区加成：越靠 CBD 越容易出高层（与程序生成同一套公式）
    base += Math.max(0, 60 - distToCenter * 9000) * Math.random()

    // 大底盘建筑（厂房/商场）压低一点，避免巨大扁块
    if (areaM2 > 5000) base = Math.min(base, 20)
    return Math.max(6, base)
  }

  // ---------- 统一的建筑创建入口 ----------

  /**
   * 添加一栋建筑（两条数据路径共用）
   * @param {number[][]} ring 闭合经纬度环
   * @param {number} height 建筑高度（米）
   * @param {string} name 名称
   * @param {string} code 唯一编码
   */
  function addBuilding({ ring, height, name, code }) {
    // 关键：Cesium 的三角化器（earcut）要求环不闭合——
    // 首尾重复点会产生零长度边，三角化失败，整个面直接不渲染。
    // GeoJSON/OSM 的环按规范是闭合的，这里统一剥掉闭合点兜底。
    const pts = ring.slice()
    if (pts.length > 3) {
      const first = pts[0]
      const last = pts[pts.length - 1]
      if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
        pts.pop()
      }
    }

    const flat = []
    pts.forEach(([lon, lat]) => flat.push(lon, lat))

    const area = Math.round(ringArea(ring))
    const floors = Math.max(1, Math.round(height / 3.6))
    const status = Math.random() < 0.12 ? '巡检中' : '正常'

    const [cx, cy] = ringCenter(ring)

    const entity = viewer.entities.add({
      // 把业务字段挂到实体上，导出/对接时可直接读
      properties: new Cesium.PropertyBag({
        code,
        name,
        height: Math.round(height),
        floors,
        area,
        status
      }),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(flat)
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
      name,
      height: Math.round(height),
      floors,
      area,
      status,
      // 弹窗锚点：建筑中心偏上
      center: Cesium.Cartesian3.fromDegrees(cx, cy, height * 0.55)
    }

    records.push(record)
    byEntity.set(entity, record)
  }

  /** 编码：序号 → 行字母(每 99 栋进位) + 两位列号，例如 WG-A01 / WG-B37 */
  function codeByIndex(idx) {
    const letter = String.fromCharCode(65 + (Math.floor(idx / 99) % 26))
    const num = String((idx % 99) + 1).padStart(2, '0')
    return `${prefix}-${letter}${num}`
  }

  // ---------- 数据路径 1：OSM 真实轮廓 ----------

  /**
   * 从 Overpass 加载真实建筑（异步）
   * @returns {Promise<number>} 加载的建筑数；失败时抛错，由调用方降级
   */
  async function buildFromOsm({ bbox } = {}) {
    const list = await fetchOsmBuildings(bbox)
    let idx = 0

    for (const { ring, tags } of list) {
      const [cx, cy] = ringCenter(ring)
      const area = ringArea(ring)
      // 过滤：太小的是车棚/垃圾房，挡路的是巡检路线
      if (area < 30) continue
      if (nearRoute(cx, cy)) continue

      const dist = Math.hypot(cx - CENTER.lon, cy - CENTER.lat)
      const height = completeHeight(tags, area, dist)
      const name = tags.name || tags['name:zh'] || `建筑 ${idx + 1}`

      addBuilding({ ring, height, name, code: codeByIndex(idx) })
      idx++
    }

    ensureHoverLabel()
    return records.length
  }

  // ---------- 数据路径 2：程序化生成（降级用） ----------

  function build({ cols = BUILDING_GRID.cols, rows = BUILDING_GRID.rows } = {}) {
    const dLon = CAMPUS_SPAN.lon / cols
    const dLat = CAMPUS_SPAN.lat / rows
    const lon0 = CENTER.lon - CAMPUS_SPAN.lon / 2
    const lat0 = CENTER.lat - CAMPUS_SPAN.lat / 2
    let idx = 0

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

        const rowLetter = String.fromCharCode(65 + (r % 26))
        const code = `${prefix}-${rowLetter}${String(c + 1).padStart(2, '0')}`

        addBuilding({
          ring: [
            [bx, by],
            [bx + w, by],
            [bx + w, by + h],
            [bx, by + h]
          ],
          height,
          name: `${rowLetter}${c + 1} 号楼`,
          code
        })
        idx++
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
    buildFromOsm,
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

/**
 * 城市白模模块
 * ------------------------------------------------------------------
 * 作用：生成"白色建筑体块"并管理三态视觉（常态/悬停/选中）。
 * 两条数据路径，最终走同一个 addBuilding() 入口，下游（编码/拾取/弹窗）
 * 完全无感知数据从哪来：
 *   1. buildFromOsm()：本地快照 / Overpass 拉取真实建筑轮廓
 *   2. build()：程序化生成网格体块（数据失败时的降级，保证场景永远有东西）
 *
 * 渲染方式（2026-11 改造）：
 *   原来"每栋一个 Entity"在 133 栋时没问题，但城区级白模有 7000+ 栋，
 *   Entity 每栋都要独立 geometry + draw call，实测会掉到个位数帧率。
 *   现在改成 Cesium.Primitive 合批：把建筑切成若干 GeometryInstance 批次，
 *   每个批次一个 Primitive、一次 draw call；悬停/选中用两个 overlay 实体覆盖显示，
 *   交互能力一点没少，实体总数从 7000+ 降到个位数。
 *
 * 高度补全策略（OSM 中国区大量缺 height）：
 *   render_height > tags.height > building:levels×3.2 > 按类型+位置启发式推算
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
import { fetchLocalBuildings, fetchOsmBuildings } from '@/cesium/overpass'

/** 本地建筑快照默认路径（public/data/buildings-osm.json） */
const LOCAL_BUILDINGS_URL = '/data/buildings-osm.json'

/** 每个 Primitive 承载的建筑数：批次太大则首帧卡、太小则 draw call 多 */
const BATCH_SIZE = 1200

// 每度经纬度对应的米数（用于面积/距离估算，随 CENTER 纬度变化）
const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180)

export function createCityBase(viewer, { route = [], prefix = BUILDING_CODE_PREFIX } = {}) {
  /** 建筑记录：存业务属性 + 几何点位（不再持有 Entity） */
  const records = []
  /** record 集合，用于 pick 结果反查（O(1)） */
  const known = new Set()

  /** 待合批队列 */
  let pending = []
  /** 已加入的 Primitive，销毁时按序移除 */
  const primitives = []

  let hovered = null
  let selected = null
  let hoverLabel = null
  let hoverOverlay = null
  let selectOverlay = null

  /** 数据来源：'local'（本地快照）/ 'osm'（Overpass 网络）/ 'generated'（程序生成） */
  let dataSource = 'generated'

  /** 已销毁标记：异步加载返回时组件可能已经卸载，避免往已销毁的 viewer 里加东西 */
  let disposed = false

  // 当前强调色派生的令牌（选中色 / 悬停色），随控制面板切换
  let accentToken = deriveAccent(THEME.modelSelected)

  // ---------- 合批渲染 ----------

  /**
   * 把待合批队列切成若干批次加入场景
   * 用 setTimeout 分片，让出主线程：7000 栋一次性建几何会把页面冻住好几秒。
   * Primitive 设为 asynchronous，几何计算跑在 Cesium 的 worker 里。
   */
  function flush(force = false) {
    if (disposed || !pending.length) return
    const batch = pending.splice(0, BATCH_SIZE)
    const instances = []

    for (const rec of batch) {
      if (!rec.positions || rec.positions.length < 3) continue
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(rec.positions),
            height: 0,
            extrudedHeight: rec.height,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          // 合批后不能逐栋改材质，统一给白色；高亮靠 overlay 实体覆盖
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(THEME.model)
            )
          },
          // 关键：id 挂 record 本身，scene.pick 拿到的就是它
          id: rec
        })
      )
    }

    if (instances.length) {
      const primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: false, // 保留法线光照，白模才有体块明暗
          translucent: false,
          closed: true
        }),
        asynchronous: true,
        releaseGeometryInstances: false // 保留 id 映射，pick 才能用
      })
      // 注意：Cesium 1.147 的 Viewer 上没有 primitives 属性，只能走 scene.primitives
      primitives.push(viewer.scene.primitives.add(primitive))
    }

    if (pending.length) setTimeout(flush, 0)
    else if (force) ensureHoverLabel()
  }

  // ---------- 颜色状态 ----------

  /**
   * 三态高亮：合批后无法逐栋换色，改为在建筑上方叠一个同形状的 overlay 实体。
   * overlay 只维护 2 个（悬停 / 选中），与建筑总数无关，性能恒定。
   */
  function ensureOverlays() {
    if (hoverOverlay) return
    const make = () =>
      viewer.entities.add({
        show: false,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([]),
          height: 0,
          extrudedHeight: 10,
          material: Cesium.Color.WHITE.withAlpha(0.9),
          outline: true,
          outlineColor: Cesium.Color.WHITE
        }
      })
    hoverOverlay = make()
    selectOverlay = make()
  }

  /** 把 overlay 贴到某栋建筑上；rec 传 null 表示隐藏 */
  function syncOverlay(kind, rec) {
    ensureOverlays()
    const overlay = kind === 'selected' ? selectOverlay : hoverOverlay
    if (!rec) {
      overlay.show = false
      return
    }
    const color =
      kind === 'selected' ? accentToken.primary : accentToken.hover
    overlay.polygon.hierarchy = new Cesium.PolygonHierarchy(rec.positions)
    // 整体上移 0.4m：与合批白模共面会 z-fighting 闪烁
    overlay.polygon.height = 0.4
    overlay.polygon.extrudedHeight = rec.height + 0.4
    overlay.polygon.material = Cesium.Color.fromCssColorString(color).withAlpha(0.92)
    overlay.polygon.outlineColor = Cesium.Color.fromCssColorString(color)
    overlay.show = true
  }

  /**
   * 换强调色
   * 只重绘"正在悬停/选中"的那一两栋 overlay，不遍历全部建筑。
   */
  function setAccent(hex) {
    accentToken = deriveAccent(hex)
    if (selected) syncOverlay('selected', selected)
    if (hovered) syncOverlay('hover', hovered)
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
   * OSM 高度补全（四级递进）
   * 中国区的 OSM 建筑大多只有轮廓没有高度，直接拉伸全是平的，demo 会很难看
   */
  function completeHeight(tags, areaM2, distToCenterDeg) {
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

    // 4. 中心区加成：越靠中心越容易出高层。
    //    半径用米算（原来用"度×9000"，在 4km 量级下系数失真，加成恒为 0）
    const distM = distToCenterDeg * M_PER_DEG_LAT
    base += Math.max(0, 1200 - distM) / 1200 * 40 * Math.random()

    // 大底盘建筑（厂房/商场）压低一点，避免巨大扁块
    if (areaM2 > 5000) base = Math.min(base, 20)

    // 兜底：任一项算成 NaN 时 Math.max 会把它继续传下去（Math.max(6, NaN) === NaN），
    // 而 extrudedHeight 为 NaN 的建筑会被 Cesium 静默丢弃——不报错、也看不见。
    const h = Math.max(6, base)
    return Number.isFinite(h) ? h : 12
  }

  // ---------- 统一的建筑创建入口 ----------

  /**
   * 登记一栋建筑（两条数据路径共用），几何延后到 flush 统一合批
   * @param {number[][]} ring 经纬度环
   * @param {number} height 建筑高度（米）
   * @param {string} name 名称
   * @param {string} code 唯一编码
   */
  function addBuilding({ ring, height, name, code }) {
    if (disposed) return
    if (!Array.isArray(ring) || ring.length < 3) return

    // 高度兜底：NaN / 非正数会让 extrudedHeight 失效，建筑被 Cesium 静默丢弃
    const h = Number.isFinite(height) && height > 0 ? height : 12

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
    const floors = Math.max(1, Math.round(h / 3.6))
    const status = Math.random() < 0.12 ? '巡检中' : '正常'
    const [cx, cy] = ringCenter(ring)

    const rec = {
      code,
      name,
      height: Math.round(h),
      floors,
      area,
      status,
      /** 经纬度环（overlay 高亮时复用） */
      ring: pts,
      /** 世界坐标顶点（PolygonHierarchy / 弹窗锚点复用，避免重复换算） */
      positions: Cesium.Cartesian3.fromDegreesArray(flat),
      /** 弹窗锚点：建筑中心偏上 */
      center: Cesium.Cartesian3.fromDegrees(cx, cy, h * 0.55)
    }

    records.push(rec)
    known.add(rec)
    pending.push(rec)
  }

  /** 编码：序号 → 分组字母（每 999 栋进位）+ 三位序号，例如 WG-A001 / WG-B037 */
  function codeByIndex(idx) {
    const letter = String.fromCharCode(65 + (Math.floor(idx / 999) % 26))
    const num = String((idx % 999) + 1).padStart(3, '0')
    return `${prefix}-${letter}${num}`
  }

  // ---------- 数据路径 1：真实建筑轮廓 ----------

  /**
   * 加载真实建筑轮廓（异步）
   * 数据取用顺序：本地快照（public/data/buildings-osm.json）→ Overpass 网络 → 抛错降级
   * --------------------------------------------------------------
   * 本地快照由 scripts/fetch-buildings.mjs 生成，走的是 OpenFreeMap 矢量瓦片，
   * 断网也能跑；只有本地文件缺失时才去碰网络，所以演示现场不会被限流拖死。
   * @returns {Promise<number>} 登记的建筑数；失败时抛错，由调用方降级
   */
  async function buildFromOsm({ bbox, localUrl = LOCAL_BUILDINGS_URL } = {}) {
    const list = await resolveBuildingList({ bbox, localUrl })
    let idx = 0

    for (const { ring, tags } of list) {
      if (disposed) break
      const [cx, cy] = ringCenter(ring)
      const area = ringArea(ring)
      // 过滤：太小的是车棚/垃圾房，挡路的是巡检路线
      if (!(area >= 30)) continue
      if (nearRoute(cx, cy)) continue

      const dist = Math.hypot(cx - CENTER.lon, cy - CENTER.lat)
      const height = completeHeight(tags || {}, area, dist)
      const name = tags?.name || tags?.['name:zh'] || `建筑 ${idx + 1}`

      addBuilding({ ring, height, name, code: codeByIndex(idx) })
      idx++
    }

    flush()
    return records.length
  }

  /**
   * 取建筑原始数据：本地优先，网络兜底
   * 两级都失败才向上抛错（触发程序生成降级）。
   */
  async function resolveBuildingList({ bbox, localUrl }) {
    if (localUrl) {
      try {
        const local = await fetchLocalBuildings(localUrl)
        dataSource = 'local'
        return local
      } catch (e) {
        console.info('[city] 本地建筑快照不可用，回退网络：', e.message)
      }
    }
    const net = await fetchOsmBuildings(bbox)
    dataSource = 'osm'
    return net
  }

  // ---------- 数据路径 2：程序化生成（降级用） ----------

  function build({ cols = BUILDING_GRID.cols, rows = BUILDING_GRID.rows } = {}) {
    dataSource = 'generated'
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
        const code = `${prefix}-${rowLetter}${String(c + 1).padStart(3, '0')}`

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

    flush()
    return records.length
  }

  // ---------- 交互状态 ----------

  function setHover(rec) {
    if (hovered === rec) return
    hovered = rec

    syncOverlay('hover', rec)

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
    selected = rec
    syncOverlay('selected', rec)
  }

  // ---------- 对外查询 ----------

  /** pick 拿到的 id 就是 record 本身，这里做存在性校验 */
  function getRecord(id) {
    return known.has(id) ? id : null
  }

  function isBuilding(id) {
    return known.has(id)
  }

  /** hover/选中用的 overlay 实体：pick 命中它们时要当作"没点到东西"，否则高亮会闪 */
  function isOverlay(id) {
    return id === hoverOverlay || id === selectOverlay || id === hoverLabel
  }

  function clear() {
    setHover(null)
    setSelected(null)
  }

  function destroy() {
    disposed = true
    clear()
    primitives.forEach((p) => viewer.scene.primitives.remove(p))
    primitives.length = 0
    records.length = 0
    known.clear()
    pending = []
    ;[hoverOverlay, selectOverlay, hoverLabel].forEach((e) => {
      if (e) viewer.entities.remove(e)
    })
    hoverOverlay = null
    selectOverlay = null
    hoverLabel = null
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
    isOverlay,
    getAll: () => records,
    get hoverLabelEntity() {
      return hoverLabel
    },
    get selected() {
      return selected
    },
    get count() {
      return records.length
    },
    /** 合批后的 Primitive 数量，用于 HUD 的渲染批次指标 */
    get batchCount() {
      return primitives.length
    },
    /** 实际生效的数据来源：'local' | 'osm' | 'generated' */
    get dataSource() {
      return dataSource
    }
  }
}

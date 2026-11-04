/**
 * 建筑白模数据导出脚本
 * ------------------------------------------------------------------
 * 作用：从 OpenFreeMap 的矢量瓦片（OSM 数据，免 key）里抽出指定范围的建筑轮廓，
 *       转成 cityBase 认的 { ring, tags } 结构，落到 public/data/buildings-osm.json。
 * 为什么不用 Overpass：本机网络对 *.overpass-api.de 全返回 406，kumi/mail.ru 超时。
 * 用法：
 *   node scripts/fetch-buildings.mjs              # 默认 z14
 *   node scripts/fetch-buildings.mjs --z 13       # 范围大时降到 z13
 *   node scripts/fetch-buildings.mjs --out x.json
 * 产物：契约与 fetchOsmBuildings() 完全一致，下游零改动。
 * 许可：数据来自 OpenStreetMap，ODbL，页面必须展示 "© OpenStreetMap contributors"。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { OSM_BBOX } from '../src/config/scene.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const Z = Number(arg('z', 14))
const OUT = path.resolve(ROOT, arg('out', 'public/data/buildings-osm.json'))
// --bbox s,w,n,e 可临时覆盖 scene.js 的 OSM_BBOX（用于试算不同城市/尺度）
const BBOX_ARG = arg('bbox', '')
const TILEJSON = 'https://tiles.openfreemap.org/planet'
// TileJSON 拿不到时的兜底模板（实测可用，2026-11）
const FALLBACK_TILE = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf'

const [south, west, north, east] = BBOX_ARG
  ? BBOX_ARG.split(',').map(Number)
  : OSM_BBOX

// ---------- Web Mercator 瓦片编号 ----------
function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  )
}

// ---------- 取瓦片模板 ----------
async function getTileTemplate() {
  try {
    const res = await fetch(TILEJSON, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`)
    const json = await res.json()
    const tpl = json.tiles?.[0]
    if (!tpl) throw new Error('TileJSON 里没有 tiles 模板')
    return tpl
  } catch (e) {
    console.warn(`[warn] TileJSON 获取失败（${e.message}），使用内置模板`)
    return FALLBACK_TILE
  }
}

// ---------- 几何工具 ----------
const round7 = (n) => Math.round(n * 1e7) / 1e7

/** 去重 + 剥掉闭合点；返回 [lon,lat] 数组 */
function cleanRing(coords) {
  const out = []
  for (const [lon, lat] of coords) {
    const p = [round7(lon), round7(lat)]
    const prev = out[out.length - 1]
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue
    out.push(p)
  }
  if (out.length > 3) {
    const a = out[0]
    const b = out[out.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) out.pop()
  }
  return out
}

/** 环的包围盒中心（与 cityBase 的 ringCenter 同口径） */
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

/** 鞋带公式面积（㎡，与 cityBase 同口径） */
const M_LAT = 110540
// 经度方向每度米数随纬度变化：用 bbox 中心纬度换算，换城市后面积阈值才不会失真
const M_LON = 111320 * Math.cos((((south + north) / 2) * Math.PI) / 180)
function ringArea(ring) {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    sum += x1 * M_LON * (y2 * M_LAT) - x2 * M_LON * (y1 * M_LAT)
  }
  return Math.abs(sum) / 2
}

const inBbox = ([lon, lat]) =>
  lon >= west && lon <= east && lat >= south && lat <= north

// ---------- 主流程 ----------
async function main() {
  const template = await getTileTemplate()
  const x0 = lon2tile(west, Z)
  const x1 = lon2tile(east, Z)
  const y0 = lat2tile(north, Z) // 纬度越大 y 越小
  const y1 = lat2tile(south, Z)

  const jobs = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) jobs.push({ x, y })
  }
  console.log(`[1/3] 范围 z=${Z}，瓦片 ${jobs.length} 个：x ${x0}..${x1}, y ${y0}..${y1}`)

  const seen = new Set()
  const items = []
  let rawCount = 0
  let droppedArea = 0
  let droppedOutside = 0

  for (const { x, y } of jobs) {
    const url = template
      .replace('{z}', Z)
      .replace('{x}', x)
      .replace('{y}', y)

    let buf
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) {
        console.warn(`[warn] ${x}/${y} HTTP ${res.status}`)
        continue
      }
      buf = Buffer.from(await res.arrayBuffer())
    } catch (e) {
      console.warn(`[warn] ${x}/${y} ${e.message}`)
      continue
    }
    if (!buf.length) {
      console.warn(`[warn] ${x}/${y} 空瓦片`)
      continue
    }

    const tile = new VectorTile(new PbfReader(buf))
    const layer = tile.layers.building
    if (!layer) {
      console.warn(`[warn] ${x}/${y} 没有 building 图层`)
      continue
    }

    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      rawCount++

      const geo = f.toGeoJSON(x, y, Z)
      const polys =
        geo.geometry.type === 'Polygon'
          ? [geo.geometry.coordinates]
          : geo.geometry.type === 'MultiPolygon'
            ? geo.geometry.coordinates
            : []

      // 只取外环；内环（天井）对白模意义不大，且会让三角化变复杂
      for (const poly of polys) {
        const ring = cleanRing(poly[0] || [])
        if (ring.length < 4) continue

        const center = ringCenter(ring)
        // 瓦片带 buffer，边界外的要素会重复出现：按中心点裁到 bbox 内
        if (!inBbox(center)) {
          droppedOutside++
          continue
        }
        // 跨瓦片重复的同一栋：用首个顶点 + 面积做指纹去重
        const key = `${ring[0][0]},${ring[0][1]},${ring.length}`
        if (seen.has(key)) continue
        seen.add(key)

        const area = ringArea(ring)
        if (area < 30) {
          droppedArea++
          continue
        }

        const h = Number(f.properties.render_height)
        const tags = { building: 'yes' }
        if (Number.isFinite(h) && h > 0) tags.height = String(Math.round(h))

        items.push({ ring, tags })
      }
    }
  }

  console.log(
    `[2/3] 原始要素 ${rawCount}，入库 ${items.length}` +
      `（过小丢弃 ${droppedArea}，范围外丢弃 ${droppedOutside}）`
  )

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(items))
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
  console.log(`[3/3] 已写入 ${path.relative(ROOT, OUT)}（${items.length} 栋 / ${kb} KB）`)
}

main().catch((e) => {
  console.error('[错误]', e)
  process.exit(1)
})

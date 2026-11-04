/**
 * Overpass 数据模块
 * ------------------------------------------------------------------
 * 作用：从 OpenStreetMap 的 Overpass API 拉取指定范围（bbox）内的真实建筑
 *       轮廓，解析成 { ring: [[lon,lat]...], tags } 数组，供 cityBase 渲染。
 * 可靠性设计（实测 Overpass 免费服务经常限流/超时，三层兜底缺一不可）：
 *   1. 多镜像依次尝试（kumi → mail.ru → 官方 de）
 *   2. 成功结果写入 localStorage 缓存（7 天有效），命中则零网络请求
 *   3. 全部失败向上抛错，由调用方决定降级策略（本项目降级为程序生成）
 * 注意：OSM 数据采用 ODbL 许可，商用必须展示署名
 *       "© OpenStreetMap contributors"，这不是可选项。
 */

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
]

/** 缓存有效期：7 天（OSM 建筑更新没那么快） */
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

function cacheKey(bbox) {
  return `osm-buildings:${bbox.map((n) => Number(n).toFixed(5)).join(',')}`
}

function readCache(bbox) {
  try {
    const raw = localStorage.getItem(cacheKey(bbox))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.data)) return null
    if (Date.now() - parsed.t > CACHE_TTL) return null
    return parsed.data
  } catch (e) {
    return null
  }
}

function writeCache(bbox, data) {
  try {
    localStorage.setItem(cacheKey(bbox), JSON.stringify({ t: Date.now(), data }))
  } catch (e) {
    /* 存不下就算了（无痕模式/超配额），不影响本次会话 */
  }
}

/**
 * 拉取 bbox 内全部建筑轮廓（带缓存）
 * @param {number[]} bbox [南, 西, 北, 东]（Overpass 官方顺序：south, west, north, east）
 * @param {object} opts timeoutMs 单镜像超时，useCache 命中缓存时直接返回
 * @returns {Promise<Array<{ring: number[][], tags: object}>>}
 */
export async function fetchOsmBuildings(bbox, { timeoutMs = 30000, useCache = true } = {}) {
  if (useCache) {
    const cached = readCache(bbox)
    if (cached) return cached
  }

  const [south, west, north, east] = bbox

  // out geom：直接在 way 上返回节点坐标，省去自行解析 node 引用的步骤
  const query = `[out:json][timeout:25];way["building"](${south},${west},${north},${east});out geom;`

  let lastError = null
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        // Overpass 约定用表单字段 data 传查询语句
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal
      })
      if (!res.ok) {
        lastError = new Error(`Overpass HTTP ${res.status} @ ${url}`)
        continue
      }
      const json = await res.json()
      const data = parseOsmResponse(json)
      if (!data.length) {
        lastError = new Error(`Overpass 返回空结果 @ ${url}`)
        continue
      }
      writeCache(bbox, data)
      return data
    } catch (e) {
      lastError = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('所有 Overpass 镜像均不可用')
}

/** 解析 Overpass JSON → 建筑环数组（只取封闭环，忽略太小与退化碎块） */
function parseOsmResponse(json) {
  const out = []
  const elements = (json && json.elements) || []

  for (const el of elements) {
    // relations（多轮廓复合楼）暂不处理：数量少、解析复杂，白模场景收益低
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue

    const ring = []
    for (const node of el.geometry) {
      if (!node) continue // geometry 里偶有 null 节点（未下载的引用）
      const prev = ring[ring.length - 1]
      // 去重相邻重复点，避免 Cesium 生成退化多边形
      if (
        prev &&
        Math.abs(prev[0] - node.lon) < 1e-9 &&
        Math.abs(prev[1] - node.lat) < 1e-9
      ) {
        continue
      }
      ring.push([node.lon, node.lat])
    }
    if (ring.length < 4) continue // 至少 4 点才可能构成面

    // 注意：不在这里闭合环。GeoJSON/OSM 的环规范上是闭合的，但 Cesium 的
    // 三角化器（earcut）要求首尾不重复，闭合交给 addBuilding 统一剥离。
    out.push({ ring, tags: el.tags || {} })
  }
  return out
}

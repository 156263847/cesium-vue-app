/**
 * 坐标与几何工具模块
 * ------------------------------------------------------------------
 * 作用：封装三类高频能力——
 *   1. 坐标转换：Cartesian3（ECEF）↔ 经纬度高程
 *   2. 空间判定：射线法判断点是否在多边形内
 *   3. 曲线插值：Catmull-Rom 样条，把稀疏航点变成平滑轨迹
 * 约定：对外一律使用 WGS84 经纬度（度），Cesium 内部用笛卡尔坐标。
 */

import * as Cesium from 'cesium'

/** Cartesian3 → { lon, lat, height }（单位：度 / 米） */
export function toLonLat(cartesian) {
  const c = Cesium.Cartographic.fromCartesian(cartesian)
  return {
    lon: Cesium.Math.toDegrees(c.longitude),
    lat: Cesium.Math.toDegrees(c.latitude),
    height: c.height
  }
}

/** 经纬度二维数组 → Cartesian3 数组（贴地） */
export function toCartesians(ring) {
  const flat = []
  ring.forEach(([lon, lat]) => flat.push(lon, lat))
  return Cesium.Cartesian3.fromDegreesArray(flat)
}

/** 经纬度二维数组 → 带高度的 Cartesian3 数组 */
export function toCartesiansWithHeight(ring, height = 0) {
  const flat = []
  ring.forEach(([lon, lat]) => flat.push(lon, lat, height))
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}

/**
 * 射线法判断点是否在多边形内（在经纬度平面上计算）。
 * 支持凹多边形，不引入三方几何库；围栏形状怎么改都不用动这里。
 */
export function pointInPolygon(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Catmull-Rom 样条插值（闭合曲线）。
 * 用途：GPS 原始点间隔 3~10 秒，直接连线是折线，肉眼一看就"假"；
 *       重采样后曲线平滑，且不改变原始航点位置。
 * @param {Array<[number, number]>} points 航点数组
 * @param {number} samplesPerSegment 每段采样数，越大越平滑
 */
export function catmullRom(points, samplesPerSegment = 32) {
  const out = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ])
    }
  }
  return out
}

/** 两点空间距离（米），用于轨迹抽稀、去重 */
export function distance(a, b) {
  return Cesium.Cartesian3.distance(a, b)
}

/**
 * 底图 / 地形管理模块
 * ------------------------------------------------------------------
 * 作用：集中提供影像底图与地形的挂载、卸载能力。
 * 坐标系提醒：
 *   esri / osm 为 WGS84，与业务数据天然对齐；
 *   gaode（高德）为 GCJ-02 火星坐标，与 WGS84 相差 300~600 米，
 *   仅在你已做数据纠偏的前提下使用。
 */

import * as Cesium from 'cesium'

const PROVIDERS = {
  // Esri 全球影像：免 key、WGS84，国内可直连
  esri: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 18,
      credit: 'Esri'
    }),

  // OpenStreetMap：矢量风格，加载更快，适合弱网演示
  osm: () =>
    new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/'
    }),

  // 高德路网（GCJ-02，慎用：数据会整体偏移）
  gaode: () =>
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      subdomains: ['1', '2', '3', '4'],
      maximumLevel: 18
    })
}

/** 挂载底图，返回 { layer, remove } —— remove() 用于组件卸载时清理 */
export function addBaseLayer(viewer, type = 'esri') {
  const factory = PROVIDERS[type] || PROVIDERS.esri
  const layer = viewer.imageryLayers.addImageryProvider(factory())
  return {
    layer,
    remove: () => viewer.imageryLayers.remove(layer, true)
  }
}

/** 挂载地形（离线地形服务地址由甲方提供） */
export function addTerrain(viewer, url) {
  return Cesium.CesiumTerrainProvider.fromUrl(url).then((provider) => {
    viewer.terrainProvider = provider
    return provider
  })
}

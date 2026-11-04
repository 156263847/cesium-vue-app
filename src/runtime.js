/**
 * 运行时句柄
 * ------------------------------------------------------------------
 * 作用：存放 Viewer、各业务模块实例、当前选中的建筑对象。
 * 为什么不用 Pinia：
 *   Cesium 的三维对象被 Vue 响应式代理包一层后，性能明显下降，
 *   且代理会持有引用导致内存无法释放。这里用普通对象存，不参与响应式。
 * 约定：只放"非序列化"的东西；业务数字/字符串请放 Pinia。
 */

export const runtime = {
  viewer: null,
  city: null,
  fence: null,
  track: null,
  picker: null,
  /** 当前选中的建筑记录（含 center 笛卡尔坐标，弹窗定位用） */
  selectedBuilding: null
}

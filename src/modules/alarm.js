/**
 * 报警看门狗模块
 * ------------------------------------------------------------------
 * 作用：监听车辆位置与围栏的关系，在"进/出"翻转的瞬间触发一次回调。
 * 为什么必须用边沿触发：
 *   越界时若每帧判断，60fps 下会瞬间刷出几十条重复报警，
 *   日志被冲垮、报警数虚高，甲方第一眼就会判定系统不可靠。
 * 额外保护：冷却时间 cooldownMs，防止在边界反复抖动导致刷屏。
 */

export function createAlarmWatch({ fence, onEnter, onLeave, cooldownMs = 1500 }) {
  let inside = true
  let lastLeaveAt = 0

  /** 重置状态机（点"重置"按钮时调用） */
  function reset() {
    inside = true
    lastLeaveAt = 0
  }

  /** 每帧调用一次，传入车辆当前笛卡尔坐标 */
  function update(cartesian) {
    const isInside = fence.contains(cartesian)

    // 状态没变，什么都不做
    if (isInside === inside) return

    inside = isInside

    if (!isInside) {
      const now = Date.now()
      if (now - lastLeaveAt < cooldownMs) return
      lastLeaveAt = now
      fence.setAlert(true)
      onLeave && onLeave()
    } else {
      fence.setAlert(false)
      onEnter && onEnter()
    }
  }

  return {
    update,
    reset,
    get inside() {
      return inside
    }
  }
}

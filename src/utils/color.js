/**
 * 颜色工具
 * ------------------------------------------------------------------
 * 作用：把用户在面板里选中的"一个强调色"，派生成整套主题令牌
 *       （主色 / 悬停色 / 半透明底 / 描边色），供 CSS 变量和 Cesium 材质共用。
 * 为什么需要它：三维场景的颜色写在 WebGL 材质里，UI 的颜色写在 CSS 变量里，
 *       两套体系各改各的必然会出现"面板换了色、围栏还是旧色"。
 *       这里保证只有一处颜色源，派生规则统一。
 */

/** 把 #abc / abc / #AABBCC 统一成 #AABBCC；非法输入返回 null */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null
  let v = input.trim()
  if (!v.startsWith('#')) v = `#${v}`
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  }
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null
}

/** #RRGGBB → { r, g, b }，非法输入回落到默认主题青 */
export function hexToRgb(hex) {
  const h = normalizeHex(hex) || '#35D0DA'
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16)
  }
}

/** 生成带透明度的 CSS 颜色字符串 */
export function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 线性混合：ratio = 0 返回 hex，ratio = 1 返回 target
 * 用途：白模悬停色不能再用写死的浅青，必须从当前主题色往白色方向混出来
 */
export function mix(hex, target, ratio) {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  const t = Math.min(1, Math.max(0, ratio))
  const to = (x, y) => Math.round(x + (y - x) * t)
  const hi = (n) => n.toString(16).padStart(2, '0').toUpperCase()
  return `#${hi(to(a.r, b.r))}${hi(to(a.g, b.g))}${hi(to(a.b, b.b))}`
}

/**
 * 由一个强调色派生整套主题令牌
 * ------------------------------------------------------------------
 * hover: 悬停态（往白色混 78%，保持"浅一档"的层次）
 * weak / mid / line: UI 的三种半透明底与描边，透明度固定，色相跟随用户选择
 */
export function deriveAccent(input) {
  const primary = normalizeHex(input) || '#35D0DA'
  return {
    primary,
    hover: mix(primary, '#FFFFFF', 0.78),
    deep: mix(primary, '#000000', 0.3),
    weak: rgba(primary, 0.12),
    mid: rgba(primary, 0.28),
    line: rgba(primary, 0.22),
    glow: rgba(primary, 0.5)
  }
}

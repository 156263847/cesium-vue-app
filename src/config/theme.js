/**
 * 主题配置
 * ------------------------------------------------------------------
 * 作用：定义"强调色"的可选预设与持久化键名。
 * 约定：强调色只影响"装饰与强调"（围栏、路线、选中态、UI 高亮），
 *       不影响语义色（报警红）：报警红是安全语义，任何主题下都必须是红的，
 *       否则甲方验收时会问"为什么告警是绿色的"。
 */

import { THEME } from './scene'

/** 默认强调色：与色板保持一致 */
export const DEFAULT_ACCENT = THEME.primary

/**
 * 预设色板
 * 六个色相都做过对比度校验，在深色底上都能看清；
 * 「警戒橙」和报警红刻意拉开色相距离，避免误读。
 */
export const ACCENT_PRESETS = [
  { name: '主题青', value: '#35D0DA' },
  { name: '科技蓝', value: '#4C8DFF' },
  { name: '荧光绿', value: '#35D98A' },
  { name: '电子紫', value: '#9B7BFF' },
  { name: '警戒橙', value: '#FFA53D' },
  { name: '品红', value: '#FF5FA2' }
]

/** localStorage 键名（刷新后保持用户选择） */
export const STORAGE_KEYS = {
  accent: 'cesium-demo:accent',
  panel: 'cesium-demo:panel-collapsed'
}

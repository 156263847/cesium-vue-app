<template>
  <!-- 左上角控制面板：指标 + 回放控制 + 主题色 + 图层显隐，可整体折叠 -->
  <div class="hud panel" :class="{ collapsed: ui.panelCollapsed }">
    <!-- 头部：整条可点，收起后仍显示帧率与围栏状态，避免"收起来就瞎了" -->
    <button class="head" type="button" @click="ui.togglePanel()">
      <span class="led" :class="{ alert: !sim.insideFence }"></span>
      <span class="title">{{ ui.panelCollapsed ? '监管面板' : '园区车辆监管 · 三维可视化' }}</span>
      <span v-if="ui.panelCollapsed" class="mini" :class="{ alert: !sim.insideFence }">
        {{ sim.fps }}fps · {{ sim.fenceLabel }}
      </span>
      <span class="chev" :class="{ closed: ui.panelCollapsed }">⌄</span>
    </button>

    <!-- 折叠区：用 grid-template-rows 1fr→0fr 做高度动画，比 max-height 更平滑 -->
    <div class="body">
      <div class="body-inner">
        <p class="sub">车辆定位 · 电子围栏 · 建筑编码</p>
        <p v-if="sim.dataSource" class="src">
          <span class="src-dot"></span>{{ sim.dataSource }}
        </p>

        <div class="metrics">
          <div class="metric">
            <span class="k">渲染帧率</span>
            <span class="v">{{ sim.fps }}</span>
          </div>
          <div class="metric">
            <span class="k">实体数量</span>
            <span class="v">{{ sim.entityCount }}</span>
          </div>
          <div class="metric">
            <span class="k">围栏状态</span>
            <span class="v" :class="{ alert: !sim.insideFence }">
              {{ sim.fenceLabel }}
            </span>
          </div>
          <div class="metric">
            <span class="k">今日报警</span>
            <span class="v" :class="{ alert: sim.alarmCount > 0 }">{{ sim.alarmCount }}</span>
          </div>
        </div>

        <div class="ctrl">
          <button @click="onToggle">{{ sim.playing ? '暂停' : '继续' }}</button>
          <button @click="onReset">重置</button>
          <div class="spd">
            <button
              v-for="v in [1, 2, 4]"
              :key="v"
              :class="{ on: sim.speed === v }"
              @click="onSpeed(v)"
            >
              {{ v }}x
            </button>
          </div>
        </div>

        <!-- ---------- 主题强调色 ---------- -->
        <section class="sec">
          <div class="sec-h">
            <span>主题强调色</span>
            <button class="link" @click="theme.resetAccent()">恢复默认</button>
          </div>
          <div class="swatches">
            <button
              v-for="p in theme.presets"
              :key="p.value"
              class="sw"
              :class="{ on: theme.activePreset === p.value }"
              :style="{ background: p.value }"
              :title="p.name"
              :aria-label="p.name"
              @click="theme.setAccent(p.value)"
            ></button>

            <!-- 自定义取色：原生 color input 铺满方块并透明化 -->
            <label class="sw custom" :class="{ on: !theme.activePreset }" title="自定义颜色">
              <input type="color" :value="theme.accent" @input="onPick" />
            </label>
          </div>
          <p class="hint">同步作用于 围栏 / 路线 / 选中态 / UI 高亮</p>
        </section>

        <!-- ---------- 图层显隐 ---------- -->
        <section class="sec last">
          <div class="sec-h"><span>图层显隐</span></div>
          <div class="layers">
            <button :class="{ on: ui.fenceVisible }" @click="ui.toggleFence()">
              电子围栏
            </button>
            <button :class="{ on: ui.routeVisible }" @click="ui.toggleRoute()">
              巡检路线
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 左上角控制面板
 * ------------------------------------------------------------------
 * 作用：展示仿真指标，并提供四组控制——回放（播放/重置/倍速）、
 *       主题强调色、图层显隐，以及面板自身的折叠。
 * 说明：控制指令一路走 store（主题/UI）或 runtime（三维模块），
 *       本组件不直接操作 Cesium 对象，保持 UI 与引擎解耦。
 * 折叠状态存在 ui store 里并持久化，刷新页面后保持用户习惯。
 */

import { runtime } from '@/runtime'
import { useSimStore } from '@/stores/sim'
import { useAlarmStore } from '@/stores/alarm'
import { useBuildingStore } from '@/stores/building'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'

const sim = useSimStore()
const alarms = useAlarmStore()
const buildings = useBuildingStore()
const theme = useThemeStore()
const ui = useUiStore()

function onToggle() {
  const playing = runtime.track?.toggle()
  if (typeof playing === 'boolean') sim.setPlaying(playing)
}

function onSpeed(v) {
  runtime.track?.setSpeed(v)
  sim.setSpeed(v)
}

/** 自定义取色：input 事件触发即生效，面板和三维同步变色 */
function onPick(e) {
  theme.setAccent(e.target.value)
}

function onReset() {
  runtime.track?.reset()
  runtime.track?.setSpeed(1)
  sim.resetCounters()
  alarms.clear()
  buildings.clear()
  runtime.selectedBuilding = null
  runtime.city?.setSelected(null)
  runtime.city?.setHover(null)
  alarms.push('系统就绪，点击任意建筑查看编码与属性', 'info')
}
</script>

<style scoped>
.panel {
  left: 20px;
  top: 20px;
  padding: 12px 16px 14px;
  width: 296px;
  /* 折叠时宽度收缩，动画与 body 高度动画同步 */
  transition: width 0.26s ease, padding 0.26s ease;
}

.panel.collapsed {
  width: auto;
  padding: 9px 14px;
}

/* ---------- 头部 ---------- */
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}

.head:hover .title {
  color: var(--c-primary);
}

.led {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--c-primary);
  box-shadow: 0 0 8px var(--c-primary);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.led.alert {
  background: var(--c-danger);
  box-shadow: 0 0 8px var(--c-danger);
}

.title {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.4px;
  transition: color 0.18s ease;
}

/* 收起后的实时摘要 */
.mini {
  font-size: 11px;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.mini.alert {
  color: var(--c-danger);
}

.chev {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1;
  transition: transform 0.26s ease;
}

.mini + .chev {
  margin-left: 4px;
}

.chev.closed {
  transform: rotate(-90deg);
}

/* ---------- 折叠动画外壳 ---------- */
.body {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease;
  opacity: 1;
}

.panel.collapsed .body {
  grid-template-rows: 0fr;
  opacity: 0;
}

/* min-height:0 必须写，否则 grid 子项下不到 0 高度，动画会失效 */
.body-inner {
  overflow: hidden;
  min-height: 0;
}

.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

/* 数据来源行：加载 OSM 期间为空，不占位 */
.src {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
}

.src-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c-primary);
  flex: 0 0 auto;
}

/* ---------- 指标 ---------- */
.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.k {
  font-size: 11px;
  color: var(--text-muted);
}

.v {
  font-size: 18px;
  font-weight: 500;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}

.v.alert {
  color: var(--c-danger);
}

/* ---------- 回放控制 ---------- */
.ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--panel-line);
}

.spd {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.spd button {
  padding: 4px 8px;
}

/* 当前倍速用主题色实底，状态一眼可见 */
.spd button.on {
  background: var(--c-primary-mid);
  border-color: var(--c-primary);
}

/* ---------- 分组 ---------- */
.sec {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid var(--panel-line);
}

.sec-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 0.6px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.link {
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  color: var(--text-muted) !important;
  font-size: 11px;
}

.link:hover {
  color: var(--c-primary) !important;
}

/* ---------- 色块 ---------- */
.swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sw {
  width: 22px;
  height: 22px;
  padding: 0 !important;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  cursor: pointer;
  position: relative;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.sw:hover {
  transform: translateY(-1px) scale(1.06);
}

/* 选中态：白色描边 + 外圈呼吸感，深色底上也看得清 */
.sw.on {
  border-color: #fff !important;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.14);
}

/* 自定义取色方块：底色跟随当前强调色，用「+」提示可点开取色器 */
.custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--c-primary);
}

.custom::after {
  content: '+';
  font-size: 14px;
  line-height: 1;
  font-weight: 500;
  color: #0b1118;
  pointer-events: none;
}

.custom input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  padding: 0;
  cursor: pointer;
  z-index: 1;
}

.hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
}

.sec.last {
  padding-bottom: 2px;
}

/* ---------- 图层开关 ---------- */
.layers {
  display: flex;
  gap: 8px;
}

.layers button {
  flex: 1;
  opacity: 0.5;
  transition: opacity 0.18s ease, background 0.18s ease;
}

.layers button.on {
  opacity: 1;
  background: var(--c-primary-mid);
  border-color: var(--c-primary);
}
</style>

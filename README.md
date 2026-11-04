# 三维可视化前端框架 · Vue3 + Vite + Cesium + Pinia

可直接跑起来的 Cesium 工程骨架。功能是一个「园区车辆监管」的最小闭环：
白模底图 → 轨迹回放 → 电子围栏 → 越界报警 → 大屏 HUD。

**重点不是这几个功能，而是这套结构**——后面接 3D Tiles、接业务后端、接大屏，都往这个骨架上加，不用重构。

---

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物在 dist/
npm run preview
```

已验证：Node 22 / Vite 5.4 / Cesium 1.147 / Vue 3.5，`npm run build` 通过。

---

## 目录结构

```
src/
├─ main.js                  # 挂载 + Pinia
├─ App.vue                  # 布局壳
├─ runtime.js               # 非响应式运行时句柄（三维对象放这里，别放 Pinia）
├─ config/
│  ├─ scene.js              # 唯一的配置入口：中心点、围栏、路线、底图类型、主题色
│  └─ theme.js              # 强调色预设色板 + localStorage 键名
├─ utils/
│  └─ color.js              # 颜色派生：一个强调色 → 整套主题令牌（CSS 与 Cesium 共用）
├─ cesium/
│  ├─ viewer.js             # Viewer 单例 + 入场运镜 + resize 监听
│  ├─ layers.js             # 底图 / 地形 管理（esri / osm / gaode）
│  └─ coordinate.js         # 坐标转换、射线法、Catmull-Rom 插值
│  └─ overpass.js           # Overpass API：拉取 OSM 真实建筑轮廓（多镜像+缓存）
├─ modules/                 # 业务模块，统一 { create → destroy } 工厂形态
│  ├─ cityBase.js           # 建筑白模：OSM 真实轮廓优先 / 程序生成降级 + 编码 + 三态配色
│  ├─ picker.js             # 鼠标拾取：悬停高亮 / 点击选中
│  ├─ fence.js              # 电子围栏：几何 + 视觉状态
│  ├─ track.js              # 轨迹回放：路径 + 车辆 + 逐帧推进
│  └─ alarm.js              # 报警看门狗：状态边沿触发
├─ stores/
│  ├─ sim.js                # 仿真状态：播放、倍速、帧率、实体数
│  ├─ alarm.js              # 报警列表、计数
│  ├─ building.js           # 当前选中建筑的可序列化信息
│  ├─ theme.js              # 强调色：写 CSS 变量 + 下发三维模块，持久化
│  └─ ui.js                 # 面板折叠、围栏/路线显隐，持久化
└─ components/
   ├─ MapView.vue           # 只负责创建/销毁模块，不写业务逻辑
   ├─ HudPanel.vue          # 可折叠控制面板：指标 + 回放 + 主题色 + 图层显隐
   ├─ AlarmLog.vue          # 日志流 + Toast
   └─ BuildingPopup.vue     # 建筑信息弹窗（跟随相机实时定位）
```

---

## 四个关键约定（改代码前先看这个）

### 1. Viewer 必须单例

```js
// ✅
import { createViewer } from '@/cesium/viewer'
const viewer = createViewer(el)

// ❌ 每个组件 new 一个，切三次路由内存就爆
const viewer = new Cesium.Viewer(el)
```

`createViewer` 内部做了 `isDestroyed()` 判断，重复调用返回同一个实例。
组件卸载时统一走 `destroyViewer()`。

### 2. 业务模块一律「工厂 + destroy」

每个模块返回一个对象，必须带 `destroy()`，且只清理自己加进场景的东西：

```js
const city = createCityBase(viewer, { route })
city.build()
// 卸载时
city.destroy()
```

**不要图省事写 `viewer.entities.removeAll()`**——多模块共存时会把别人的实体一起删掉，排查起来极其痛苦。

### 3. 三维对象不进 Pinia

`Viewer`、`Cesium3DTileset`、`Entity` 这些对象被 Vue 的响应式代理包一层后，性能会掉、内存也回收不掉。
统一放 `runtime.js`，Pinia 只存**可序列化的业务状态**（数字、布尔、数组）。

### 4. 高频更新必须节流

帧率、实体数这类指标 500ms 采样一次写 store。
每帧写 store 会触发 60 次/秒的组件更新，比渲染本身还慢。

---

## 已经踩过的三个坑（代码里已处理）

| 坑 | 现象 | 处理 |
|---|---|---|
| **每帧改 `entity.position`** | 实体一多就掉帧 | 用 `CallbackProperty`，位置变了不改实体结构 |
| **切后台回来车辆瞬移** | 标签页失焦后 `dt` 变成几秒，进度直接跳一大段 | `dt = Math.min(dt, 0.12)` 钳制上限 |
| **报警刷屏** | 越界一秒钟刷 60 条日志 | 状态边沿触发 + 1.5s 冷却，只在翻转时回调一次 |

---

## 配色与建筑交互

### 统一色板

只有一个色相（青）+ 一个语义色（红），其余全是白/灰阶。**强调色运行时可切换**
（控制面板 → 主题强调色），切换后 CSS 与三维材质同步变色。默认色板：

| 用途 | 色值 | 是否随主题切换 |
|---|---|---|
| 建筑常态 | `#FFFFFF` 纯白 | 否 |
| 建筑悬停 | 主题色往白混 78%（动态派生） | 是 |
| 建筑选中 | 当前强调色 | 是 |
| 围栏 / 路线 / UI 强调 | 当前强调色 | 是 |
| 报警 | `#FF6B5E` | **否，永远是红** |

### 强调色切换的实现链路

```
面板选色 → theme.setAccent(hex)
            ├─ deriveAccent(hex) 派生整套令牌（hover/weak/mid/line）
            ├─ 写 CSS 变量（--c-primary 等六项）→ UI 即时变色
            ├─ city.setAccent / fence.setAccent / track.setAccent → 三维同步变色
            └─ localStorage 持久化 → 刷新后保持
```

要点：

- **颜色只有一个源头**。换色时不是"挨个把硬编码颜色改掉"，而是所有模块
  从 `setAccent` 拿令牌重绘自己；新增模块照这个约定接，主题切换自动生效。
- **悬停色是派生的，不是配置的**。`utils/color.js` 的 `mix(主题色, 白, 0.78)`
  保证无论用户选什么色相，悬停态永远比选中态"浅一档"。
- **报警红不参与主题**。语义色被主题覆盖是安防大屏的大忌——换紫色主题后
  告警变紫，验收时一定会被打回。
- 模块创建时只能用默认色，`MapView` 装配完会调 `theme.syncToScene()` 补上
  用户上次的选择；图层显隐同理（`ui.syncToScene()`）。
- `setAccent` 只重绘正在悬停/选中的建筑，不遍历全部实体；围栏换色会保留
  当前报警态（报警中换色仍保持红色，恢复后用新色）。

### 建筑编码

每栋建筑在生成时分配唯一编码 `{园区前缀}-{行字母}{列两位}`，例如 `WG-A01`。
编码同时写进两个地方：

- `entity.properties.code` —— 挂在 Cesium 实体上，导出 / 对接后台时直接读
- `record.code` —— 业务记录里，供弹窗和 Pinia 使用

改前缀只需改 `config/scene.js` 的 `BUILDING_CODE_PREFIX`。

### 三态切换与弹窗

```
mouse move → picker 拾取 → city.setHover(rec)   → 材质换浅青 + 显示编码标签
left click → picker 拾取 → city.setSelected(rec) → 材质换主题青（常驻）
                                                   ↓
                                        runtime.selectedBuilding = rec
                                                   ↓
                                        Pinia building.select(rec)
                                                   ↓
                                        BuildingPopup 显示 + 每帧跟随定位
点空白处   → onSelect(null) → 全部复位、弹窗关闭
```

弹窗位置不是写死的，而是每帧用 `SceneTransforms.worldToWindowCoordinates()`
把建筑中心的笛卡尔坐标投影成屏幕坐标。所以旋转、缩放、飞行时弹窗会跟着建筑走，
投影返回 `undefined`（建筑在相机背面）时自动隐藏。

**性能注意**：160 个悬停标签会拖垮帧率，所以全程只复用一个标签实体，
悬停时改它的 `position` 和 `text`。

---

## 下一步怎么扩

### 接真实 3D Tiles

替换 `modules/cityBase.js` 的 `build()`：

```js
const tileset = await Cesium.Cesium3DTileset.fromUrl('/data/campus/tileset.json', {
  maximumScreenSpaceError: 16,
  skipLevelOfDetail: true,
  preferLeaves: true,
  cullWithChildrenBounds: true
})
viewer.scene.primitives.add(tileset)
```

把 `city.destroy()` 改成 `viewer.scene.primitives.remove(tileset)` 即可，其他模块不用动。

### 接后端实时数据（Java）

```js
// 建议后端先做抽稀（Douglas-Peucker）再下发，前端渲染压力降一个量级
const ws = new WebSocket('ws://host/ws/track')
ws.onmessage = (e) => {
  const p = JSON.parse(e.data)
  // 推给 track 模块，替换 progress 驱动方式
}
```

### 海量实体（> 2000）

`Entity` 换成 `Primitive` + `GeometryInstance` 批渲染，实测有 10–50 倍差距。

### 离线 / 内网部署

- 把 `node_modules/cesium/Build/Cesium` 整个拷到 `public/cesium`
- 地形 / 影像换成本地瓦片服务
- 去掉一切外网 CDN 依赖（当前 `viewer.js` 已全部走 npm 包，无外链）

### 大屏适配

不要用 rem/vw。1920×1080 设计稿，外层套一层 `transform: scale()` 最稳：

```js
const scale = Math.min(innerWidth / 1920, innerHeight / 1080)
```

---

## 真实建筑数据（OSM）

启动时优先从 Overpass API 拉取 `config/scene.js` 里 `OSM_BBOX` 范围的真实建筑
轮廓，失败自动降级为程序生成白模，两条路径走同一个 `addBuilding()` 入口，
编码/拾取/弹窗/主题色完全无感知数据来源。

```
MapView.loadCity()
  ├─ city.buildFromOsm({ bbox })   ← overpass.js：kumi → mail.ru → de 三镜像
  │                                  成功后写入 localStorage 缓存（7 天）
  └─ catch → city.build()          ← 程序生成网格体块，日志与面板均有提示
```

- **高度补全**：中国区 OSM 大量缺高度，按 `height` → `building:levels×3.2`
  → 类型启发式（住宅/商办/厂房）→ 中心区加成 四级递进
- **过滤**：面积 < 30㎡（车棚等）与巡检路线避让范围内的建筑不加载
- **许可**：OSM 数据为 ODbL，商用必须在页面上展示
  "© OpenStreetMap contributors"（当前通过告警日志展示了一条，正式项目
  请放到页脚常驻）
- **限流**：Overpass 是公益服务，别高频刷新；缓存命中后零网络请求
- 换城市：改 `config/scene.js` 的 `CENTER` 即可，`OSM_BBOX` 自动联动

## 坐标系提醒


全链路约定 **WGS84**。

如果底图换成高德 / 腾讯（GCJ-02，火星坐标），业务点位会整体偏移 300–600 米。
**这不是 bug，是国内 GIS 项目第一大坑。** 处理方式二选一：

1. 找无偏移的影像源（天地图 CGCS2000、Esri WGS84）
2. 对业务数据做 WGS84 → GCJ-02 纠偏后再上图

`config/scene.js` 里 `BASE_LAYER` 支持 `'esri' | 'osm' | 'gaode'`，切换即改。

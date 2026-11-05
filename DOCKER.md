# 容器化 Runbook · cesium-vue-app

> 目标：把 Vite + Vue3 + Cesium 项目打成 nginx 镜像，一条命令在本地起服务。
> 配套文件：`Dockerfile`、`deploy/nginx.conf`、`docker-compose.yml`、`.dockerignore`

---

## 0. 前置条件（本机当前未安装 Docker）

本机 `docker` 命令不存在，需要先装：

1. Windows 开启 WSL2：管理员 PowerShell 执行 `wsl --install`，重启。
2. BIOS 里开启虚拟化（Intel VT-x / AMD-V）。
3. 安装 Docker Desktop，启动后确认左下角显示 **Engine running**。
4. 验证：`docker version` 能打印 Client 与 Server 两段。

> Docker Desktop 与 VMware Workstation 同时使用时，若开了 Windows「内存完整性 / VBS」，
> 两者可能互相抢占虚拟化层导致变慢，需要时关掉其一。

---

## 1. 三条命令跑起来

```bash
# 在 E:\work\workBuddy_file\cesium-vue-app 下
docker compose up -d --build      # 构建镜像 + 后台启动
docker compose logs -f            # 看构建/启动日志（健康检查结果也在这里）
docker compose down               # 停止并移除容器
```

访问：<http://localhost:8080>

等价的原始命令（不依赖 compose）：

```bash
docker build -t cesium-vue-app:1.0.0 .
docker run -d -p 8080:80 --name cesium cesium-vue-app:1.0.0
docker logs -f cesium
docker rm -f cesium
```

`package.json` 里已挂好快捷脚本：`npm run docker:build / docker:up / docker:logs / docker:down`。

---

## 2. 镜像结构

| 阶段 | 基础镜像 | 作用 | 是否进最终镜像 |
|---|---|---|---|
| builder | `node:22-alpine` | `npm ci` + `vite build` | 否 |
| runtime | `nginx:1.27-alpine` | 托管 `dist`，做 gzip 与缓存 | 是 |

最终镜像 ≈ **nginx 基础层（约 50MB）+ dist（15MB）≈ 65MB**，不含 node、不含 `node_modules`、不含源码。

依赖层利用缓存：`package.json` / `package-lock.json` 先单独 COPY，改业务代码不会触发重新装包。

---

## 3. nginx 侧做了哪些事

| 路径 | 缓存策略 | 原因 |
|---|---|---|
| `/assets/` | `max-age=31536000, immutable` | 文件名带内容哈希，可永久缓存 |
| `/cesium/` | `max-age=2592000` | Cesium 的 Workers/Assets 是固定名，随镜像 tag 更新，30 天 |
| `/data/` | `max-age=3600` | 建筑白模 JSON 可能被替换，短缓存 |
| `/` 及其它 | `no-cache, must-revalidate` | 入口页 + SPA 回退，发版后立刻生效 |

其余：`gzip` 覆盖 js/css/json/wasm/svg；`X-Content-Type-Options: nosniff`（wasm 必须）；`server_tokens off`；`try_files ... /index.html` 保证刷新子路由不 404。

---

## 4. 验证清单（对照实测数据）

本机无 Docker，以下第 1、2 项已用"干净副本 + 本地静态服务"复现验证；第 3 项待装 Docker 后跑。

**① 构建阶段（已实测）**

```
复制源码（按 .dockerignore 排除 node_modules/dist/.git/docs/scripts）
→ npm ci    : added 139 packages in 22s
→ npm run build: 46 modules transformed，built in 1.46s
```

产物：`dist` 15MB，其中 `cesium/` 14MB、`assets/` 136KB。
主 JS 105.70 kB（gzip 42.35 kB），主 CSS 32.67 kB（gzip 7.32 kB）。

**② 托管行为（已实测，模拟 nginx 规则）**

| 请求 | 状态 | Cache-Control |
|---|---|---|
| `/` | 200 text/html | `no-cache, must-revalidate` |
| `/assets/index-*.js` | 200 application/javascript | `public, max-age=31536000, immutable` |
| `/cesium/Cesium.js` | 200 application/javascript | `public, max-age=2592000` |
| `/data/buildings-osm.json` | 200 application/json | `public, max-age=3600` |
| `/scene/city/detail`（不存在） | 200 返回 index.html | `no-cache` |

压缩实测：

| 资源 | 原始 | gzip | 降幅 |
|---|---|---|---|
| `Cesium.js` | 6.10 MB | 1.79 MB | -71% |
| `buildings-osm.json` | 1.28 MB | 217 KB | -83% |

**③ 容器阶段（待执行，装好 Docker 后按此验收）**

```bash
docker compose up -d --build
docker compose ps                       # STATUS 应为 healthy
curl -I http://localhost:8080/          # 200，含 Cache-Control: no-cache
curl -I http://localhost:8080/cesium/Cesium.js
curl -H "Accept-Encoding: gzip" -s -o /dev/null -w "%{size_download}\n" \
  http://localhost:8080/cesium/Cesium.js   # 应接近 1.79MB 而不是 6.1MB
docker images cesium-vue-app --format "{{.Repository}}:{{.Tag}} {{.Size}}"
```

浏览器打开 `http://localhost:8080`，地球能加载、建筑白模能显示，即端到端跑通。

---

## 5. 排错对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm ci` 报 lock 不同步 | `package.json` 改了但 lock 没更新 | 本地 `npm install --package-lock-only` 后重新构建 |
| 构建卡在下载 | 走官方源慢 | 默认已用 npmmirror；换源 `--build-arg NPM_REGISTRY=https://registry.npmjs.org` |
| 8080 被占用 | 其它服务占用 | 改 `docker-compose.yml` 的 `published` 端口，如 `9090:80` |
| 页面白屏、控制台 404 `/cesium/...` | 构建产物没搬全 | 检查 `COPY --from=builder /app/dist`，不要只拷 `assets` |
| wasm 报 MIME 错误 | 缺 `application/wasm` | nginx 1.27 的 `mime.types` 已内置；仍报错则在 `conf.d` 里补 `types` |
| 刷新子路由 404 | 少了 SPA 回退 | 确认 `try_files $uri $uri/ /index.html` 存在 |
| 容器 `unhealthy` | nginx 没起来或端口不对 | `docker logs cesium-vue-app` 看 nginx 报错，`docker compose config` 查配置 |

---

## 6. 生产化可选的下一步

- 多架构构建：`docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/cesium-vue-app:1.0.0 --push .`
- 推私仓：打上 `<registry>/<ns>/cesium-vue-app:1.0.0` 再 `docker push`。
- 离线分发：`docker save -o cesium-vue-app.tar cesium-vue-app:1.0.0`，目标机 `docker load -i` 后 `docker run`。
- 想再压体积：runtime 改用 `nginx:alpine` + 只装必要模块，或换 `caddy`/`busybox httpd`；`dist/cesium` 的 14MB 是硬成本，除非按需裁剪 Assets。

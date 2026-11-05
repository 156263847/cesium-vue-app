# ------------------------------------------------------------------
# cesium-vue-app 容器化：两阶段构建
#   阶段 1 builder：装依赖 + vite 构建，产出 dist（含 Cesium 静态资源）
#   阶段 2 runtime：只放 nginx + 构建产物，不带 node、不带 node_modules
# 构建：docker build -t cesium-vue-app:1.0.0 .
# 运行：docker run -d -p 8080:80 --name cesium cesium-vue-app:1.0.0
# ------------------------------------------------------------------

# ---------- 阶段 1：构建 ----------
FROM node:22-alpine AS builder

WORKDIR /app

# 国内网络默认走 npmmirror；npm 9+ 的 replace-registry-host 会把 lock 里的
# registry.npmjs.org 自动替换成本地配置的源，所以不必改 package-lock.json。
# 需要官方源时：--build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "$NPM_REGISTRY" \
 && npm config set fund false \
 && npm config set audit false

# 先只拷依赖清单：依赖不变时这一层直接命中缓存，改源码不会重装依赖
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 再拷源码构建
COPY . .
RUN npm run build


# ---------- 阶段 2：运行 ----------
FROM nginx:1.27-alpine AS runtime

# 覆盖默认站点配置（gzip / 缓存策略 / SPA 回退）
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# 只搬构建产物：14MB 左右，不含 node_modules 与源码
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# 容器自身探活：能取到首页即算健康
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

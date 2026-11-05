# Docker 安装步骤 · Windows 11 家庭版

> 适用本机：Windows 11 家庭版 10.0.26200 / 内存 15.2GB / C 盘剩余 48.2GB
> 本机实测前置状态：BIOS 虚拟化 **已开启** ✓　Hyper-V 平台 **未启用** ✗　WSL2 **未安装** ✗
> 结论：可以直接装，**不需要进 BIOS**。家庭版不用装 Hyper-V，走 WSL2 后端即可。

---

## 步骤 0：确认前提（已替你确认）

| 检查项 | 要求 | 本机实际 |
|---|---|---|
| 系统版本 | Win10 2004+ / Win11 | Win11 26200 ✓ |
| 内存 | ≥ 8GB | 15.2GB ✓ |
| 磁盘剩余 | ≥ 20GB | 48.2GB ✓（偏紧，见步骤 3 的迁移） |
| BIOS 虚拟化 | 开启 | 已开启 ✓ |
| 管理员权限 | 需要 | 用「以管理员身份运行」的 PowerShell |

---

## 步骤 1：安装 WSL2（Docker 的底座，必须先做）

**以管理员身份**打开 PowerShell（开始菜单搜 PowerShell → 右键 → 以管理员身份运行）：

```powershell
wsl --install --no-distribution
```

`--no-distribution` 表示只装 WSL 内核，不装 Ubuntu 之类的发行版——跑容器不需要。

然后**重启电脑**（这一步不能省，不重启虚拟化平台不生效）。

重启后验证：

```powershell
wsl --version
wsl --set-default-version 2
```

正常输出会包含 WSL 版本号、内核版本，且默认版本为 2。

> 如果提示 `wsl 不是内部或外部命令`，说明 Windows 功能没启用成功，改用：
> ```powershell
> dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
> dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
> ```
> 再重启。

---

## 步骤 2：安装 Docker Desktop

**方式 A：命令行（推荐，省点击）**

```powershell
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
```

**方式 B：图形安装包**

下载地址：<https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe>
双击运行，安装选项保持默认（家庭版会自动选 WSL 2 后端，不要勾 Hyper-V）。

安装完成后**注销或重启一次**，然后从开始菜单启动 Docker Desktop：

1. 接受服务协议。
2. 出现登录窗口时点 **Skip / Continue without signing in**（本地用不需要账号）。
3. 左下角状态变成 **Engine running** 即启动成功。

---

## 步骤 3：首次配置（国内网络必做，否则拉不动镜像）

打开 Docker Desktop → 右上角齿轮 **Settings**：

### 3.1 Resources → Advanced（保护 C 盘）

| 项 | 建议值 | 原因 |
|---|---|---|
| Disk image location | 改到 `D:\Docker` | WSL 虚拟磁盘默认放 C 盘，会持续增长；本机 C 盘只剩 48GB |
| Memory | 4GB | 托管静态站点够用，别把 15GB 全给它 |
| CPUs | 4 | 同上 |

改磁盘位置会重建虚拟磁盘，**在第一次拉镜像之前改**，否则要重新下载。

### 3.2 Resources → Proxies（国内拉镜像的关键）

本机装了 TNTCloud（监听 `127.0.0.1:7890`），Docker Hub 直连基本拉不动，两个办法二选一：

- **用现有代理**：开启 Manual proxy configuration，HTTP / HTTPS 都填 `http://127.0.0.1:7890`。
- **用镜像加速器**：Settings → Docker Engine，在 JSON 里加
  ```json
  "registry-mirrors": ["https://docker.m.daocloud.io"]
  ```
  注意：2024 年后大量公共加速器已下线，哪个能用要以实测为准，不行就回到代理方案。

> ⚠️ 提醒：之前排查过 TNTCloud 异常退出会残留系统代理，导致浏览器断网。
> Docker 这边同理——代理挂了之后 `docker pull` 会超时。出问题时先跑 `tools/proxy-off.bat` 再试。

### 3.3 Resources → WSL Integration

勾选 **Enable integration with my default WSL distro**，这样 WSL 里也能直接用 `docker` 命令。

改完点 **Apply & restart**。

---

## 步骤 4：验证安装

```powershell
docker version
docker compose version
docker run --rm hello-world
```

预期：

- `docker version` 打印 Client 和 Server 两段（只有 Client 说明引擎没起来）。
- `docker compose version` 打印 v2.x。
- `hello-world` 输出 `Hello from Docker!` 并自动删除容器。

---

## 步骤 5：跑通你的项目

```powershell
cd E:\work\workBuddy_file\cesium-vue-app
docker compose up -d --build
docker compose ps
```

`ps` 里 STATUS 显示 `healthy` 即成功，浏览器打开 <http://localhost:8080>。

完整验收清单见项目里的 `DOCKER.md` 第 4 节。

---

## 常见卡点对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `wsl --install` 报 0x8007019e | WSL 功能未启用 | 跑步骤 1 里的 dism 两条命令后重启 |
| Docker Desktop 一直 Starting | 虚拟化没生效 | 重启电脑；`Get-CimInstance Win32_ComputerSystem` 看 HypervisorPresent 应为 True |
| `docker pull` 卡在 Waiting / 超时 | 网络 | 配步骤 3.2 的代理或加速器 |
| `Error response from daemon: ... 7890` | 代理已失效但 Docker 还在用 | 关掉代理设置或换可用端口 |
| 8080 端口被占用 | 别的服务占了 | 改 `docker-compose.yml` 的端口映射，如 `9090:80` |
| C 盘突然少几 GB | WSL vhdx 增长 | 步骤 3.1 迁移 Disk image location；或 `docker system prune -a` 清无用镜像 |
| 家庭版提示需要 Hyper-V | 装了错误版本 | 家庭版只能用 WSL2 后端，不要手动启用 Hyper-V |
| `docker` 命令在 WSL 里不可用 | 没开 WSL Integration | 步骤 3.3 勾选 |

---

## 卸载

1. 设置 → 应用 → 卸载 Docker Desktop。
2. 管理员 PowerShell：`wsl --unregister docker-desktop`（如存在）。
3. 删除残留目录：`C:\Users\<用户名>\AppData\Local\Docker`、`AppData\Roaming\Docker`。
4. 若不再需要 WSL：`wsl --uninstall`。

---

## 时间与体积预估

| 项 | 大小 | 耗时（视网络） |
|---|---|---|
| WSL2 内核 | ~200MB | 3–10 分钟（含重启） |
| Docker Desktop 安装包 | ~600MB | 5–15 分钟 |
| 安装后占用 | ~2.5GB | — |
| 首次拉 nginx:alpine + node:22-alpine | ~300MB | 5–20 分钟（有代理 1–3 分钟） |

全程约 **20–40 分钟**，其中下载占大头。

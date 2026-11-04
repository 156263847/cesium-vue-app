# Git 操作记录

> 本文件记录本项目从零到推送到 GitHub 的完整 Git 操作过程，供回溯和换机器时参考。
> 日期：2026-11-04　远程仓库：https://github.com/156263847/cesium-vue-app.git

## 一、首次提交与推送（本次实际执行）

```bash
# 1. 进入项目目录
cd E:/work/workBuddy_file/cesium-vue-app

# 2. 初始化仓库，主分支命名为 main（git 默认是 master，GitHub 现在推荐 main）
git init -b main

# 3. 暂存全部文件（.gitignore 会自动排除 node_modules / dist）
git add -A

# 4. 查看暂存了哪些文件，确认没有把依赖提交进去
git status --short

# 5. 创建首次提交
git commit -m "feat: Vue3 + Vite + Cesium 园区三维监管 demo

- 白模城市 + 建筑唯一编码（WG-Axx），悬停/点击三态高亮 + 信息弹窗
- Catmull-Rom 平滑轨迹回放（CallbackProperty 驱动，与帧率解耦）
- 电子围栏射线法越界检测，边沿触发报警 + 日志流
- 主题强调色运行时可切换（CSS 与 Cesium 材质同步），localStorage 持久化
- 控制面板可折叠，图层显隐可控"

# 6. 关联远程仓库（origin 是远程仓库的默认别名）
git remote add origin https://github.com/156263847/cesium-vue-app.git

# 7. 确认远程地址
git remote -v

# 8. 首次推送并建立跟踪关系（-u 之后就能直接 git push / git pull）
git push -u origin main
```

## 二、日常开发流程（以后每次改完代码）

```bash
git add -A              # 暂存所有改动（或 git add <具体文件>）
git status --short      # 快速看改了什么
git commit -m "fix: 修复 xxx"   # 提交，写清楚做了什么
git push                # 推送到 GitHub（已建立跟踪，不用再带参数）
```

## 三、常用查询命令

```bash
git log --oneline -10   # 最近 10 次提交，一行一条
git diff                # 看还没暂存的改动
git diff --staged       # 看已暂存、未提交的改动
git branch -vv          # 本地分支及其跟踪关系
```

## 四、常见问题

### 提交时出现 LF → CRLF 警告

```
warning: in the working copy of 'xxx.js', LF will be replaced by CRLF ...
```

Windows 下的正常现象（换行符自动转换），不影响内容，可忽略。
想消除警告可以统一换行符策略：

```bash
git config core.autocrlf input   # 仓库级：提交时转 LF，检出时不转
```

### 误把 node_modules 提交进去了

```bash
git rm -r --cached node_modules   # 只从 git 索引里移除，磁盘文件不动
git commit -m "chore: 移除 node_modules"
```

然后确认 `.gitignore` 里有 `node_modules`。

### push 提示需要登录

GitHub 已不支持密码推送，用以下方式之一：

- **HTTPS + 凭据管理器**：首次 push 会弹浏览器授权（本机已配置，直接成功）
- **SSH**：生成密钥 `ssh-keygen`，把公钥加到 GitHub → Settings → SSH keys，
  远程地址换成 `git@github.com:156263847/cesium-vue-app.git`

### 想撤销上一次还没 push 的提交

```bash
git reset --soft HEAD~1   # 撤销提交，改动保留在暂存区
```

> 注意：`--hard` 会丢掉改动，不确定时用 `--soft`。

## 五、当前仓库信息

| 项 | 值 |
|---|---|
| 远程地址 | https://github.com/156263847/cesium-vue-app.git |
| 主分支 | main（跟踪 origin/main） |
| 首次提交内容 | 30 个文件（全部源码 + README + package-lock.json） |
| 已忽略 | node_modules、dist、dist-ssr、*.local、*.log、.vscode |

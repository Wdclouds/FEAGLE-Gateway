# FEAGLE Gateway

<p align="center">
  <b>Ultra-lightweight WeChat 8.0.78 LSPosed Driver & OneBot v11 Protocol Gateway</b><br>
  物理硬件拦截 · OneBot v11 标准双向转译 · 指数退避与防刷风控 · 100% 单元测试覆盖
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WeChat-8.0.78-07C160?logo=wechat&logoColor=white" alt="WeChat">
  <img src="https://img.shields.io/badge/Protocol-OneBot%20v11-blue" alt="OneBot">
  <img src="https://img.shields.io/badge/Runtime-Node.js%2022%2B-green?logo=node.js" alt="Node">
  <img src="https://img.shields.io/badge/Tests-55%2F55%20PASS-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/License-MIT-orange" alt="License">
</p>

---

## 📖 项目简介

**FEAGLE Gateway** 是专为微信智能体生态打造的**极简高性能协议网关**。

不同于传统易被风控封号的 Web 协议（wechat4u/puppeteer）或逆向私有 iPad 协议，FEAGLE Gateway 采用**物理真机 Hook + 标准化协议解耦**路线：
1. **物理驱动层 (Driver)**：在三星平板或物理安卓机上通过 LSPosed/Xposed 注入真实微信 8.0.78，只做最纯粹的底层报文拦截与物理发信；
2. **协议网关层 (Bridge)**：在 Linux 云端服务器运行超轻量 Node.js 微服务，将微信私有报文实时转译为行业通用的 **OneBot v11** 标准协议，供上层大模型框架（AstrBot、Hermes Agent 或任意 OneBot 客户端）消费；
3. **治理控制层 (Hub)**：配套独立的桌面管理大盘 [FEAGLE-Hub](https://github.com/Wdclouds/FEAGLE-Hub)，实现端到端监控与多群 Prompt 编排。

---

## 🏗️ 架构全景

```text
┌───────────────────────┐          WebSocket (:6191)         ┌─────────────────────────────────────┐
│ 📱 物理驱动层 (Driver) │ ─────────────────────────────────> │ ☁️ 协议网关层 (FEAGLE-Bridge)        │
│ 三星平板 (SM-X200)    │                                    │ 运行于云端 ECS / Linux 服务器       │
│ WeChat 8.0.78 (Hook)  │ <───────────────────────────────── │ 1. 消息清洗与 wxid ⇄ 数字 ID 双向映射 │
│ • 物理发信与事件拦截  │           发送回执 / 指令下发        │ 2. OneBot v11 反向/正向 WebSocket   │
└───────────────────────┘                                    │ 3. 毫秒级频控防刷与安全门禁 (Guard) │
                                                             └──────────────────┬──────────────────┘
                                                                                │
                                              ┌─────────────────────────────────┴───────────────────────────────┐
                                              │ OneBot v11 反向 WS (:6199)                                      │ HTTP / SSE (:6190)
                                              ▼                                                                 ▼
                                 ┌─────────────────────────┐                                       ┌─────────────────────────┐
                                 │ 🧠 上层 AI 决策大脑     │                                       │ 🖥️ 桌面中枢控制台       │
                                 │ AstrBot / Hermes Agent  │                                       │ FEAGLE-Hub (Vue 3 + TS) │
                                 └─────────────────────────┘                                       └─────────────────────────┘
```

---

## ✨ 核心特性

- 🛡️ **真机物理级防封**：依托 Android LSPosed Vector 框架拦截微信 8.0.78 原生事件，发信完全模拟真机行为，彻底告别 Web 协议大面积封号风险。
- 🔄 **OneBot v11 标准全双工通信**：
  - 原生支持私聊文本、群聊文本、@成员、表情包（Type 47）、名片、位置等多类型报文；
  - 采用 SQLite（WAL 模式）维护 `wxid` / `chatroom` 与 OneBot 32位数字 ID 的双向稳定映射，重启不漂移。
- ⚡ **工业级连接与风控加固**：
  - **指数退避与抖动**：内置 `calculateReconnectDelay`（1s~30s + Full Jitter），拒绝断网重连风暴；
  - **TCP 假死自愈**：底层 Ping/Pong 探活，遇到半开连接自动调用 `ws.terminate()` 强制回收；
  - **防刷风控门禁 (Message Guard)**：自动拦截毫秒级超高频输入，保护微信小号免遭腾讯拦截封禁；
  - **零内存泄漏**：严格解绑 EventEmitter 与定时器，常驻内存仅数十兆。
- 📜 **完整 TypeScript 类型契约**：在 `packages/protocol` 提供完整的 OneBot v11 与 Feagle Android 契约声明与自动检查工具。
- 🧪 **55 项单元自动化测试 100% 通过**：全量回归测试套件守护（`hermes verify`）。

---

## 📁 目录结构与模块说明

```text
FEAGLE-Gateway/
├── apps/
│   ├── android-agent/    # 📱 物理驱动层：Android 微信 8.0.78 LSPosed Hook 驱动源码 (Java)
│   ├── bridge/           # ☁️ 协议网关层：Node.js 极简协议网关微服务 (OneBot v11 / REST / SSE)
│   ├── hub/              # 🖥️ 治理中枢：FEAGLE-Hub v2 桌面可视化控制大盘 (Vue 3 + TS + Tauri v2 原生桌面壳)
│   └── plugins/          # 🧩 插件槽位：支持自定义智能体能力与业务扩展
├── packages/
│   └── protocol/         # 📜 协议契约：OneBot v11 & Android Bridge 跨端 TypeScript 契约与校验器
├── docs/                 # 📚 核心文档：微信 8.0.78 协议逆向、真机配置与全平台部署指南
├── scripts/              # 🛠️ 运维脚本：国内镜像加速测速、一键脱敏打包备份、CI/CD 发布打包工具
├── tools/                # 🔧 调试工具：图片解析测试、Windows 桥接与 Android ADB 辅助脚本
├── archive/              # 🗄️ 归档目录：历史旧版架构（Electron 壳、旧部署编排）归档封存
├── feagle.cmd / .ps1     # 💻 命令行中枢：Windows 环境下的统一运维管理 CLI
├── setup-windows.bat     # ⚡ 引导脚本：Windows 开发环境与工具链一键初始化
├── install.sh            # 🐧 Linux 引导：Ubuntu / Debian / 云服务器纯终端一键交互安装
└── README.md             # 📖 项目总览与核心架构说明
```

---

## 🚀 快速启动指南

### 1. 服务端 Bridge 部署 (Ubuntu / Debian / ECS)

推荐部署在具备公网 IP 的 Linux 服务器上（如阿里云 ECS）：

```bash
# 1. 确保安装了 Node.js 22.0.0+
node -v

# 2. 安装依赖并启动
cd apps/bridge
npm install
npm start
```

服务默认监听以下端口：
* **`6190`**：Bridge 控制台与 REST / SSE 遥测端点（供 Hub 直连）；
* **`6191`**：Android Agent WebSocket 接入端点（`/android`）；
* **`6199`**：OneBot v11 反向 WebSocket 连接端点（`/ws`）。

> **推荐使用 systemd 守护进程**：可配置 `hermes-wxbridge.service` 实现开机自启与崩溃秒级拉起。

### 2. 平板端驱动配对 (Android SM-X200)

1. 在已 Root 的设备上安装并激活 **LSPosed**；
2. 编译并安装 `apps/android-agent` 生成的 APK，在 LSPosed 作用域中勾选 **微信 (WeChat 8.0.78)** 并重启微信；
3. 打开 FEAGLE Driver 应用，在设置中配置你的服务器端点与鉴权 Token：
   ```text
   ws://<你的服务器公网IP>:6191/android
   ```
4. 握手成功后，状态将呈现 **`CONNECTED 🟢`**，网关即可开始全双工收发。

### 3. 连接 AI 大脑与桌面中枢

* **对接 AI 智能体 (AstrBot / Hermes)**：在 AI 框架的 OneBot v11 配置中，将反向 WebSocket 连接指向 `ws://127.0.0.1:6199/ws`；
* **桌面可视化治理 (FEAGLE-Hub)**：打开 [FEAGLE-Hub](https://github.com/Wdclouds/FEAGLE-Hub)，在连接配置中填入 `http://<你的服务器公网IP>:6190` 即可免隧道直连大盘！

---

## 🧪 自动化测试验证

本项目拥有严格的企业级测试套件，在根目录下执行：

```bash
# 验证协议契约与 Bridge 单测 (55 项全绿)
npm --prefix apps/bridge test
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。

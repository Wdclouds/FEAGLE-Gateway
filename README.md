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
1. **物理驱动层 (Driver)**：在三星平板或安卓真机上通过 LSPosed 注入真实微信 8.0.78，只做最纯粹的底层报文拦截与物理硬件发信；
2. **协议网关层 (Bridge)**：在 Linux 云端服务器运行超轻量 Node.js 微服务，将微信私有报文实时双向转译为行业通用的 **OneBot v11** 标准协议，供各类上层大模型框架消费：
   - **🤖 AstrBot 用户**：即插即用，通过 OneBot 反向 WS（`:6199`）直接接入，在 AstrBot 原生 Web 后台管理，无需安装任何额外客户端；
   - **⚡ Hermes Agent 用户**：原生消费 OneBot 协议流，亦可选配专供 Hermes 打造的独立桌面控制中枢 [FEAGLE-Hub](https://github.com/Wdclouds/FEAGLE-Hub)（拓扑大盘、群策略编排、Mnemosyne 记忆桥接）。

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
                                              │ OneBot v11 反向 WS (:6199)                                      │ REST / SSE (:6190)
                                              ▼                                                                 ▼
                              ┌──────────────────────────────┐                                    ┌──────────────────────────────┐
                              │ 🧠 通用 AI 大脑 (直接对接)   │                                    │ 🖥️ Hermes 专供桌面控制中枢   │
                              │ • AstrBot (原生 6185 WebUI)  │                                    │ [FEAGLE-Hub 独立项目]        │
                              │ • Hermes Agent / NoneBot     │                                    │ (Vue 3 + Tauri 跨端客户端)   │
                              └──────────────────────────────┘                                    └──────────────────────────────┘
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
│   └── plugins/          # 🧩 插件槽位：支持自定义智能体能力与业务扩展
├── packages/
│   └── protocol/         # 📜 协议契约：OneBot v11 & Android Bridge 跨端 TypeScript 契约与校验器
├── docs/                 # 📚 核心文档：微信 8.0.78 协议逆向、真机配置与全平台部署指南
├── scripts/              # 🛠️ 运维与CLI：自动化测速、打包工具及 feagle.ps1 核心实现
├── tools/                # 🔧 调试工具：包含 Windows 本地工具链与 Android ADB 辅助脚本
├── feagle.cmd            # 💻 Windows 入口：双击或终端统一命令行中枢（自动调起 scripts/feagle.ps1）
├── install.sh            # 🐧 Linux 入口：Ubuntu / Debian / 云服务器纯终端一键交互安装
├── docker-compose.yml    # 🐳 容器编排：云端轻量化多 Profile 部署编排
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

#### 📥 获取驱动 APK 安装包 (469 KB)
* ⚡ **国内网盘高速通道（推荐，免翻墙）**：[蓝奏云下载直链](https://wwbpz.lanzout.com/ij5Aw4avhhni)（提取码：`9qt0`）
* 🌐 **GitHub Releases 官方通道**：[v0.8.0 发布页](https://github.com/Wdclouds/FEAGLE-Gateway/releases/tag/v0.8.0) | [APK 原生直链](https://github.com/Wdclouds/FEAGLE-Gateway/releases/download/v0.8.0/feagle-driver-v0.8.0.apk)
* 🚀 **国内 CDN 镜像加速通道**：[ghfast 加速直链](https://ghfast.top/https://github.com/Wdclouds/FEAGLE-Gateway/releases/download/v0.8.0/feagle-driver-v0.8.0.apk)
* 💻 **源码本地自编译**：运行 `.\feagle.cmd android build-agent` 即可在本地全自动编译最新驱动。

#### 📱 安装与激活步骤
1. 在已 Root 的设备上安装并激活 **LSPosed**（或 KernelSU / Vector）；
2. 安装下载好的 `feagle-driver-v0.8.0.apk`，在 LSPosed 模块作用域中**只勾选「微信 (com.tencent.mm)」**；
3. 彻底划掉微信后台进程并重新打开微信，让 Hook 驱动注入生效；
4. 电脑浏览器访问 Bridge Web 控制台（`http://<服务器公网IP>:6190`），点击右上角【连接设备】；
5. 在平板打开 FEAGLE Driver，点击【扫码连接服务器】对准电脑屏幕扫码一键配对，握手成功后指示灯呈 **`CONNECTED 🟢`**。

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

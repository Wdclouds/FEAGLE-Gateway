# FEAGLE Hub

<p align="center">
  <b>AI Agent 多群治理中台与桌面控制中心</b><br>
  4-Stage 全链路驾驶舱 · 类微信沉浸式视窗 · 多群人设与工具权限矩阵 · 零 Electron 绿色桌面模式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Vue%203%20%2B%20TypeScript-42b883?logo=vuedotjs" alt="Vue3">
  <img src="https://img.shields.io/badge/UI-Element%20Plus-409EFF?logo=elementplus" alt="ElementPlus">
  <img src="https://img.shields.io/badge/Backend-Node.js%2022%20(node%3Asqlite)-339933?logo=node.js" alt="Node22">
  <img src="https://img.shields.io/badge/Desktop-Native%20Edge%20App%20(0MB)-0078D7?logo=microsoftedge" alt="EdgeApp">
  <img src="https://img.shields.io/badge/License-MIT-orange" alt="License">
</p>

---

## 🌟 项目定位

**FEAGLE Hub** 是专为微信智能体生态打造的**现代化全栈可视化中控台**。

在 FEAGLE 双子星架构中：
* 底层由 [FEAGLE-Gateway](https://github.com/Wdclouds/FEAGLE-Gateway)（Android LSPosed Hook + 云端 Bridge）承担硬件微信报文拦截与 OneBot 协议翻译；
* **FEAGLE Hub** 则作为桌面司令部，全权负责 **AI 决策调度、多群 Prompt 差异化编排、工具调用白名单权限管控、全链路遥测监控与类微信沉浸式消息视窗**。

追求**极致轻量、零臃肿 Electron 依赖、开箱即用、免隧道直连**。

---

## 🚀 四大核心功能视窗

### 1. 📱☁️🖥️🧠 4-Stage 端到端全链路驾驶舱 (`/dashboard`)
顶部流式串联整套系统的 4 大核心微服务节点，**100% 由后端真实 API 驱动，拒绝静态写死数据**：
- **节点 1：物理驱动层 (Driver)** ➔ 实时回显三星平板 `CONNECTED 🟢` 状态、真机掩码 ID、LSPosed Hook 挂载状态与毫秒级长连接心跳；
- **节点 2：协议网关层 (Bridge)** ➔ 实时拉取云端 ECS 微信小号（`FaSt_eAgle`）在线状态与直连端点；
- **节点 3：控制中枢层 (Hub)** ➔ 本地纳管群总数与 SQLite 24h 消息吞吐聚合折线图；
- **节点 4：智能与记忆 (Hermes)** ➔ 本地 Mnemosyne 记忆宫殿探针动态探测（实测时延 `80 ~ 91ms`）。

### 2. 💬 类微信沉浸式只读视窗 (`/messages`)
- 真实还原 PC 微信原生布局（左侧最新会话列表，右侧气泡消息流）；
- 结合底层 SQLite 通讯录，**动态还原微信好友与群聊真实昵称**（告别 `WeChat contact` 占位符）；
- **纯粹只读观察设计**：关闭高危发信入口，群聊与私聊收发气泡自洽归一，彻底过滤通知幽灵影子。

### 3. 🎛️ 多群 AI 策略编排与防死尸群矩阵 (`/groups`)
针对不同的微信群，按需下发独立人设与安全策略：
- **群专属 Prompt**：技术交流群设定“严谨代码架构师”，水友群设定“轻松幽默管家”；
- **AI 工具调用 Matrix**：精细化勾选授权（如技术群允许 `terminal` 执行与 `web_search` 搜索，普通群全禁）；
- **三种响应模式**：`SMART`（🟢 智能回复）/ `MENTION_ONLY`（🟡 仅@小号触发）/ `OBSERVE`（⚪ 静默旁路记录）；
- **墓碑隔离机制 (Tombstone)**：群聊被踢出或解散时自动标记墓碑，杜绝已退历史群死灰复燃。

### 4. 💻 全屏 TUI 终端审计日志 (`/audit`)
- 专为极客开发者设计的全屏双视窗控制台；
- **上部 3/4**：原生终端暗黑流式系统日志控制台（带 ASCII 鹰标）；
- **下部 1/4**：每一笔策略更新与管理动作的不可篡改审计流水。

---

## ⚡ 极速免隧道云端直连 (Bridge Sync)

告别烦琐的 SSH 隧道或内网穿透打洞！
进入左侧 **「网关节点连接 (/connection)」** 页面：
1. 直接输入你的云端服务器地址（如 `http://39.97.255.91:6190`）；
2. 点击 **【🔍 连通性测试 (Probe)】**：内置 42ms 极速探针，立即检测云端网关网络健康、微信登录态与纳管群数；
3. 保存后，Hub 将自动通过 HTTP REST & SSE 实时流无缝接管云端消息。

---

## 🛠️ 技术选型与工程优势

| 维度 | FEAGLE-Hub 选型 | 传统方案痛点对比 |
| :--- | :--- | :--- |
| **前端架构** | **Vue 3 + TypeScript + Vite + Element Plus + Pinia** | 规避老旧模板与无类型 JavaScript 代码混乱 |
| **桌面运行时** | **Windows Edge 原生应用模式 (`--app`)** | **0 MB** 安装包体积，常驻内存仅数十兆，秒杀数百兆的 Electron |
| **后端持久化** | **Node.js 22 原生 `node:sqlite` (WAL 模式)** | 零 C++ 编译失败风险，无需依赖臃肿的 Docker 或 MySQL/PostgreSQL |
| **资源防泄漏** | **全生命周期定时器与 Socket 显式回收** | 彻底根除 Node.js 常见的 EventEmitter 监听器堆积与假死问题 |

---

## 🚀 快速上手

### 1. 安装与构建

确保本地安装了 **Node.js 22.0.0+**：

```bash
# 安装依赖
npm install

# 构建前端产物 (SPA)
npm run build
```

### 2. 启动服务

```bash
# 启动 Hub 本地中台 (默认监听 http://127.0.0.1:6200)
npm start
```

> **Windows 桌面用户**：直接双击根目录的 **`FEAGLE Hub.bat`**，即可启动零边框、原生窗口、带独立图标的桌面中控台！

### 3. 初始登录

打开浏览器访问 `http://127.0.0.1:6200`：
* **默认账号**：`admin`
* **默认密码**：`admin123`

---

## 🧪 自动化测试验证

```bash
# 运行双模网关与集成测试
npm test
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。

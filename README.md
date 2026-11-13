# FEAGLE WxBot (FEAGLE-Gateway)

<p align="center">
  <b>物理硬件级隔离 · 官方微信 8.0.79 / 8.0.78 原生 LSPosed 驱动 · 四层漏斗智能网关 · DeepSeek Harness (ACP) 引擎 · Mnemosyne OS v9.1.3 · 全量 91 项单测守护</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WeChat-8.0.79%20%7C%208.0.78-07C160?logo=wechat&logoColor=white" alt="WeChat">
  <img src="https://img.shields.io/badge/Engine-DeepSeek%20Harness%20(DSH%20ACP)-5B6EFF" alt="DSH ACP">
  <img src="https://img.shields.io/badge/Memory-Mnemosyne%20OS%20v9.1.3-8A2BE2" alt="Mnemosyne">
  <img src="https://img.shields.io/badge/Protocol-OneBot%20v11%20%7C%20ACP%20v1%20%7C%20MCP-cyan" alt="Protocol">
  <img src="https://img.shields.io/badge/Runtime-Node.js%2022%2B%20%26%2024%2B-green?logo=node.js" alt="Runtime">
  <img src="https://img.shields.io/badge/Console-Vue%203.5%20(OLED%20Dark)-orange?logo=vuedotjs" alt="Vue">
  <img src="https://img.shields.io/badge/Tests-91%2F91%20PASS%20(100%25)-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/License-MIT-orange" alt="License">
</p>

---

## 📖 项目简介与设计哲学

**FEAGLE WxBot**（FEAGLE-Gateway）是专为企业级高可用微信智能体生态打造的**全栈物理硬件级安全隔离微信机器人中枢系统**。

在微信生态中构建长期稳定、拟人化、可执行复杂工程任务的 AI 机器人，传统技术路线普遍面临严重死穴：
- **Web 网页协议（如 wechat4u / Puppeteer）**：微信官方已全面封禁新老账号的 Web 登录权限，极易遭拦截封号；
- **逆向 iPad / Mac 私有协议**：协议脆弱且极易被微信安全风控的行为指纹（TLS 特征、心跳异常、固定发信节奏）识别并封禁；
- **PC 注入式 Hook**：Windows 端微信更新频繁、内存偏移多变，易引发崩溃并遭系统安全策略查杀；
- **全局会话混杂与额度黑洞**：传统单体机器人无会话物理隔离，群聊极易串话；面对恶意刷屏或超长任务无法熔断，极易烧毁高昂的模型额度。

### 🌟 五大核心设计原则
1. **物理硬件级安全隔离 (Hardware-Level Physical Isolation)**：选用官方原生 Android 14 三星物理平板硬件（SM-X200），搭载官方 64 位微信客户端（最新实测 **8.0.79**，兼容 8.0.78），通过系统级 Magisk + Zygisk + LSPosed 模块进行底层事件监听与模拟注入。在腾讯风控视角，所有网络行为均来自一台真实、合法的移动设备；
2. **四层漏斗流水线分流 (Funneling Pipeline)**：`L0 规则与硬指令 -> L1 语义路由与多模态直答 -> L2 DeepSeek Harness (dsh --profile acp) 受控单例 -> L3 微信原生引用出站防风控`。层层过滤分流，绝不无脑调用高成本大模型；
3. **ACP 原生执行前审批与模型容灾**：L2 基于标准 **ACP v1 (JSON-RPC 2.0)** 驱动 `dsh`，支持 `session/request_permission` 原生执行前挂起并桥接微信 `Y/N` 审批，并在主力模型限流时自动切换备选模型兜底；
4. **社群物理沙箱与记忆空间隔离**：每个群聊分配专属物理隔离目录（`data/channels/<chatId>/`），人设 Prompt、安全红线、工具白名单与成员画像互不越权；Mnemosyne 记忆检索在数据库层执行 `chat_id` 与 `include_test: false` 硬隔离；
5. **单端口极简接入与透明反代**：后端由 Bridge 统一将 Vue 3 控制台、SSE 遥测流、REST API 及网关端口在 **`6190`** 单端口完成原生流式反代收敛，零跨域、免复杂运维。

---

## 🏗️ 全栈系统拓扑架构

```text
┌─────────────────────────────────────────────────────────────┐
│ 📱 物理驱动层 (apps/android-agent - APK v0.8.4)             │
│ 三星平板 (SM-X200 Android 14) + Magisk + LSPosed            │
│ 官方微信 8.0.79 / 8.0.78 64位客户端 (com.tencent.mm)        │
│ • NetSceneSendMsg 纯净无头出站队列                          │
│ • 大图 HTTP 流式直拉 (OutboundImageStore 解决队头阻塞)      │
│ • 发图两阶段 ACK 握手 / 75s 心跳自愈保活                    │
│ • 动态 Ticket / Token 5分钟时效扫码免密配对                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket 加密长连接 (:6191/android)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ ☁️ 协议中继与网络聚合层 (apps/bridge)                        │
│ 运行于云端 ECS / Linux 服务器 (Node.js 22+)                 │
│ ├─ DashboardServer (:6190 外部唯一管理控制台入口)            │
│ │   ├─ 托管 Vue 3 生产构建产物 (赛博毛玻璃 / OLED 纯黑)     │
│ │   ├─ SSE 实时日志流 (/logs) 与状态快照 (/events)          │
│ │   └─ 原生流式反代: /api/channels*, /api/tools, /api/gateway│
│ ├─ OneBot v11 协议标准中继 (:6199 反向 WS)                  │
│ │   └─ SQLite WAL 模式维护 wxid ⇄ 数字 ID 稳定映射          │
│ └─ 出站队列 (:6192): 拟人化随机延迟 (300~1500ms) 串行发信    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP POST /inbound (内部高速环回)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 🧠 四层漏斗智能网关 (apps/gateway - feagle-wx-gateway)       │
│ 监听 127.0.0.1:6185 (REST & Inbound Pipeline)               │
│                                                             │
│ ├─ L0 规则拦截层: 0 Token 0 延迟，硬指令集 / 黑名单 / 防注入 │
│ ├─ L1 语义路由层: Gemini 3.8 Flash，W/S/X/T/C/R 分流、      │
│ │   超长任务额度熔断(R)、15分钟自然衰减环与群聊背景感知     │
│ ├─ L2 DSH 执行层: dsh-manager.ts (Node 24 隔离运行时)        │
│ │   ├─ 标准 ACP v1 stdio 驱动 `dsh --profile acp`           │
│ │   ├─ session/resume 跨回收恢复 · /cd 会话级工作区切换     │
│ │   ├─ session/request_permission ──▶ 微信 Y/N 原生预审批    │
│ │   ├─ 503/429 限流自动切 deepseek-flash 容灾并回切主模型    │
│ │   └─ 动态注入 mcp__mnemosyne__* (16工具) + gateway-ctl    │
│ ├─ L3 原生出站层: 微信原生引用气泡回复、敏感凭证脱敏         │
│ └─ 社群物理沙箱: data/channels/<chatId>/ (人设/红线/工具)    │
└───────────────────┬─────────────────┬───────────────────────┘
                    │                 │
                    ▼                 ▼
   ┌───────────────────────────┐ ┌───────────────────────────────────┐
   │ 🤖 外部 AI 框架直连接入    │ │ 🌐 上游大模型与长期记忆中枢        │
   │ • AstrBot (原生 6199 接入)│ │ • Antigravity (Gemini 3.8 Flash)  │
   │ • Hermes Agent / NoneBot  │ │ • DeepSeek Official (自动容灾备路) │
   │ • FEAGLE-Hub 桌面控制中枢 │ │ • Google Imagen 3 图像生成         │
   └───────────────────────────┘ │ • Mnemosyne OS v9.1.3 (:18010)    │
                                 │   (火山方舟向量 + TMT蒸馏 + 记忆回归)│
                                 └───────────────────────────────────┘
```

---

## ✨ 核心特性矩阵

### 1. 📱 深度适配官方微信 8.0.79 真机驱动
- **多版本无缝兼容**：针对微信官方 64 位版本（`arm64-v8a`）进行了底层偏移量与特征自适应，原生针对 **`8.0.79`** 全面优化，同时完全兼容 `8.0.78` 与历史 `8.0.70`；
- **全类型原生报文解析**：精准识别私聊与群聊文本、@成员提及、表情包（Type 47）、名片、位置、图片、以及微信公众号图文分享卡片（XML 解析与正文直链提取）；
- **出站大图流式直拉与两阶段 ACK**：针对大模型生成的 1MB+ 高清图片，首创 `OutboundImageStore` 动态 Ticket HTTP 流式直拉机制，彻底消除 WebSocket 队头阻塞；配套两阶段 ACK 队列确保图片真实送达；
- **免密扫码配对与全自动网络自愈**：浏览器打开 Web 控制台生成动态二维码（5 分钟时效 Ticket/Token），平板扫码一键握手；内置 75s 心跳探活与指数退避（1s~30s + Full Jitter）。

### 2. 🧠 四层漏斗网关流水线 (apps/gateway)
- **L0 规则与硬指令层 (0 Token, 0 延迟, 纯 TypeScript)**：
  - 毫秒级匹配 `/help`, `/sid`, `/stats`, `/history`, `/mode`, `/block`, `/unblock`, `/status`, `/persona`, `/sh`, `/cd`, `/cron`, `/save`, `/load`, `/stop`, `/new`, `/approve`, `/deny`, `/prune` 等全套硬指令；
  - 支持三大运行模式切换：`/mode chat`（正常交互）、`/mode sentry`（静默哨兵观测 + 紧急事件私信 OP + 社交关系图谱入库）、`/mode mute`（彻底静音）；
  - 内置提示词注入与越狱投毒防火墙（`isPromptInjectionOrToxic`），零成本阻断并记录审计日志。
- **L1 智能语义路由与直答层 (Gemini 3.8 Flash)**：
  - 极速单字母意图判决分流（`W` 延长等待 / `S` 补充引导 / `X` 打断 / `T` 闲聊直答 / `C` 唤醒 DSH 工程执行 / `R` 额度保护拒单）；
  - **群聊绝对表人设硬锁**：无论发言人是否为 OP 管理员，群聊统一强制锁定为 `l1_only` + 禁用 Shell，彻底杜绝公共群聊越权与信息泄露；
  - **15 分钟自然衰减对话环与群聊背景感知**：无需每句都 `@`，静默记录群内近期普通发言作为背景上下文，支持原生多模态看图直答。
- **L2 DeepSeek Harness (`dsh --profile acp`) 工程引擎**：
  - **双 Node 隔离运行**：Gateway 主体运行于 `Node 22`（常驻约 `86 MB`），按需拉起隔离的 `Node 24`（`>=24.9.0`）运行 `@deepseek-ai/dsh@0.2.2-rc.1 --profile acp`，闲置 **3 分钟自动回收**以守护低配 ECS 内存；
  - **标准 ACP v1 持久会话**：每次任务将 `{ sessionId, cwd }` 持久化至 SQLite `sessions.dsh_session`，进程回收或重启后自动 `session/resume` 接回上下文；`/cd` 切换目录直接重建该会话 `cwd`，无需杀整个子进程；
  - **原生执行前预审批 (`session/request_permission`)**：`dsh` 申请受限/越界执行时直接挂起，通过网关 `requestApproval()` 在微信端回复 **`Y` / `N`**（120 秒有效）原地放行或拒绝；同时在 `tool_call` 事件流保留 `HARD_BLOCK_PATTERNS` 与 `allow_shell` 实时拦截守卫；
  - **主备模型无感容灾**：默认主力为 `antigravity/gemini-3.8-flash`（支持多模态），上游触发 `503/429` 冷却限流时自动调用 `session/set_config_option` 切换 `deepseek-official/deepseek-flash` 完成本轮并切回主配置；
  - **忙时补充排队**：内置 `queuedFollowups` 队列，执行过程中收到的 `S` 追加引导会自动排队接力，不丢消息。
- **L3 原生出站与防风控直发层**：
  - **微信原生引用回复气泡 (`formatQuoteReply`)**：构造引用原文气泡与精准 `@`，解决多人并发聊天混乱；
  - **安全脱敏与无损分片**：自动抹去 `sk-*` / JWT / `ghp_*` / `AIza*` 等敏感凭据，按代码块与段落边界切片并注入 `300~1500ms` 拟人延迟。

### 3. 🧰 六大 L1 内置工具 + DSH/MCP 长期记忆中枢
网关 L1 内置经过严格沙箱隔离的 Function Calling 工具引擎：

| 工具名称 | 对应名称 | 核心能力与工程亮点 |
|---|---|---|
| 🌐 **联网搜索** | `web_search` | 多源智能调度（Tavily 多 Key 轮询容灾池、Bing、Hugging Face 开源模型探测等），权威源分级清洗（T0/T1）、反投毒过滤。 |
| 🔍 **事实核验** | `fact_check` | 支持纯文本主张与公众号链接核验，并行裁决、严格“未核实”零幻觉准则，输出三段式求证报告。 |
| 📰 **公众号解析** | `read_wechat_article` | 微信公众号卡片与文章高保真解析器，与密集核验解耦，长文解析仅需 ~1.5s。 |
| 🎨 **AI 绘图直发** | `generate_image` | 集成 Google Imagen 3 原生绘图，生成高清图片并直接通过微信真机通道无头秒发入群。 |
| ⏰ **定时提醒器** | `group_remind` | 解析相对/绝对时间（如“10m / 2小时后”），持久化入 SQLite `jobs` 调度并在群内精准唤醒。 |
| 🏛️ **记忆宫殿** | `palace_memo` | 社群级备忘录存取，联动 Mnemosyne 记忆库并带本地沙箱兜底。 |

同时，L2 (`dsh`) 自动挂载 **Mnemosyne OS v9.1.3**（`mcp__mnemosyne__*` 16 工具）与 **`gateway-ctl`** MCP：
- **空间物理隔离**：`memories_search` 默认强制 `include_test: false`，并自动读取网关当前活跃 `chat_id` 进行群聊/私聊隔离过滤；
- **全自动记忆回归闭环**（`tmt-consolidate.sh` 覆盖 `eagle / cli / default / weixin`）：每日自动串联 **TMT 金字塔蒸馏**（`session → daily → weekly → monthly`）→ **`reflect` 热度衰减/回温与 L1~L4 分层迁移** → **`palace/archive` 宫殿建卡归档** → **`drawer_pipeline` 冷冻去噪、相似记忆合并去重与向量重算**；
- **向量引擎**：对接火山方舟 `doubao-embedding-vision-251215`（1024 维，标准推理接口 + 本地磁盘 LRU 缓存），配合本地 `jieba` BM25 与 RRF 融合排序。

### 4. 🛡️ 社群物理沙箱与成员画像治理
- **物理隔离目录 (`data/channels/<chatId>/`)**：每个私聊或群聊独立生成沙箱，包含 `persona.md`（专属人设）、`rules.md`（安全红线）、`tools.json`（工具白名单）与 `members.json`（成员画像/标签/互动计数），修改毫秒级热加载。

### 5. 🖥️ 统一 Web 现代化管理控制台 (apps/web)
- 基于 **Vue 3.5 + Vite 6 + TypeScript 5.6 严格模式 + Tailwind CSS**；
- 支持赛博毛玻璃与 **OLED 纯黑夜间模式**，在 `:6190` 单端口统一反代全部网关 API 与 SSE 实时日志流。

---

## 📁 Monorepo 目录结构

```text
FEAGLE-Gateway/
├── apps/
│   ├── android-agent/    # 📱 物理驱动层：Android 微信 8.0.79/8.0.78 LSPosed Hook 驱动源码 (Java, APK 0.8.4)
│   ├── bridge/           # ☁️ 协议中继层：Node.js 协议网关、OneBot v11、Android WS、单端口反代 (:6190/:6191/:6192/:6199)
│   ├── gateway/          # 🧠 智能网关层：四层漏斗流水线、dsh-manager (ACP)、社群物理沙箱、6大内置工具、MCP 桥接
│   ├── web/              # 🖥️ 前端控制台：Vue 3.5 + TypeScript 5.6 严格模式现代化毛玻璃管理后台
│   └── plugins/          # 🧩 插件槽位：自定义业务 Skill 扩展槽位
├── packages/
│   └── protocol/         # 📜 跨端契约：OneBot v11 & Android Bridge 跨端 TypeScript 协议声明
├── docs/                 # 📚 生产工程文档体系 (01~08 章节规范与 RPD 全栈规格说明书)
├── scripts/              # 🛠️ 运维与 CLI：自动化测速、冒烟校验、构建打包及 feagle.ps1 核心实现
├── tools/                # 🔧 调试辅助：Windows 本地运维工具链与 Android ADB 批处理脚本
├── feagle.cmd            # 💻 Windows 入口：双击或终端统一命令行中枢
├── install.sh            # 🐧 Linux 入口：Ubuntu / Debian 一键式生产环境交互安装脚本
├── docker-compose.yml    # 🐳 容器编排：云端轻量化部署配置
├── VERSION               # 🏷️ 当前发布版本号 (0.8.4)
└── README.md             # 📖 项目总览与核心架构说明
```

---

## 🚀 快速启动指南

### 1. 服务端部署 (Ubuntu / Debian / 阿里云 ECS)

- **Bridge & Gateway 主进程**：`Node.js >= 22.5.0`
- **DSH 引擎子进程（可选隔离安装）**：`Node.js >= 24.9.0` + `@deepseek-ai/dsh@0.2.2-rc.1`

```bash
# 1. 检查 Node.js 运行环境
node -v

# 2. 安装依赖并构建
cd apps/bridge && npm install
cd ../gateway && npm install && npm run build
cd ../web && npm install && npm run build

# 3. 安装 DSH 运行时（若系统默认是 Node 22，建议把 Node 24 隔离装在 /opt/node24）
# 通过环境变量 DSH_NODE_BIN / DSH_BIN / DSH_HOME 指定 DSH 路径
/opt/node24/bin/npm --prefix /opt/dsh install @deepseek-ai/dsh@0.2.2-rc.1

# 4. 启动服务（生产环境推荐配置 systemd）
npm --prefix apps/bridge start
npm --prefix apps/gateway start
```

服务端口一览：
* **`6190`**：**统一外部入口**（Web 现代化管理控制台、REST 接口、SSE 遥测流、网关透明代理）；
* **`6191`**：Android Agent WebSocket 通信接入端点（`/android`）；
* **`6192`**：GatewayClient 出站拟人化排队发信端点（`/gw/outbound`）；
* **`6199`**：OneBot v11 反向 WebSocket 连接端点（`/ws`，供 AstrBot / Hermes 消费）；
* **`6185`**：Gateway 内部服务端口（已由 6190 自动透明反向代理）。

生产推荐 `systemd` 服务编排（详见 [`docs/08-deployment-and-operations.md`](docs/08-deployment-and-operations.md)）：
- `hermes-wxbridge.service`（`:6190` Web 控制台与反代、`:6191` Android WS、`:6192` 出站队列、`:6199` OneBot WS）
- `feagle-wx-gateway.service`（`:6185` 四层漏斗网关，按需拉起 `dsh --profile acp`，`MemoryHigh=450M / MemoryMax=640M`）
- `antigravity-tools.service`（`:8045` 多模态大模型代理）
- `mnemosyne.service`（`:18010` Mnemosyne OS v9.1.3 记忆中枢，`MemoryMax=220M`）

---

### 2. 平板端驱动配对 (Android 真机)

#### 📥 获取驱动 APK 安装包 (v0.8.4 - 469 KB)
* ⚡ **国内网盘高速通道（推荐，免翻墙）**：[蓝奏云下载直链](https://wwbpz.lanzout.com/ij5Aw4avhhni)（提取码：`9qt0`）
* 🌐 **GitHub Releases 官方通道**：[Releases 发布页](https://github.com/Wdclouds/FEAGLE-Gateway/releases)
* 💻 **源码本地构建**：执行 `.\feagle.cmd android build-agent` 即可在本地通过 Gradle 自动编译最新 APK。

#### 📱 安装与激活步骤
1. **环境准备**：准备一台已安装 Magisk / KernelSU 并激活 **LSPosed (或 Vector)** 的 Android 设备（推荐 Samsung SM-X200，搭载官方微信 64 位 **8.0.79** 或 **8.0.78**）；
2. **加载模块**：安装 `feagle-driver-v0.8.4.apk`，在 LSPosed 作用域中**只勾选「微信 (com.tencent.mm)」**；
3. **重启生效**：划掉微信后台进程并重新打开微信，让 Hook 驱动注入生效；
4. **一键配对**：电脑浏览器打开 Web 控制台（`http://<服务器IP>:6190`），点击【连接设备】生成配对二维码；在平板端 FEAGLE Driver 点击【扫码连接】，状态呈 **`CONNECTED 🟢`** 即大功告成！

---

### 3. 接入上游智能体与客户端

* **🤖 接入 AstrBot 等 OneBot 框架**：在 OneBot v11 配置中，将反向 WebSocket 连接指向 `ws://127.0.0.1:6199/ws`；
* **⚡ 接入 Hermes Agent / DSH / 本地大模型**：通过 OneBot 协议流或网关 `/inbound` 接口直接驱动；
* **🖥️ 桌面中枢治理 (FEAGLE-Hub)**：打开 [FEAGLE-Hub](https://github.com/Wdclouds/FEAGLE-Hub) 桌面端，填入 `http://<服务器IP>:6190` 即可实时查看拓扑监控与群策略。

---

## 🧪 自动化测试验证 (91 项 100% 通过)

系统拥有完整的自动化测试套件，覆盖协议双向转译、DSH ACP 生命周期与预审批/容灾、沙箱隔离、检索核验等核心路径：

```bash
# 1. 验证 Bridge 协议与传输层 (60 项全绿)
npm --prefix apps/bridge test

# 2. 验证 Gateway 漏斗、DSH ACP 驱动、沙箱与工具层 (31 项全绿)
npm --prefix apps/gateway test
```

全部测试运行结果：
```text
✔ apps/bridge:  60/60 tests pass (0 failed, 100% passing)
✔ apps/gateway: 31/31 tests pass (0 failed, 100% passing)
=========================================================
Total: 91 passed, 0 failed, 0 flakiness
```

---

## 📚 完整工程文档索引

若需深入理解系统细节与底层逆向原理，请参阅 [`docs/`](docs/) 目录下的分章节规格手册：

| 章节编号 | 文档名称 | 核心主题 |
|:---:|---|---|
| **01** | [项目定位与系统愿景](docs/01-overview.md) | 微信机器人死穴剖析、五大底层哲学与能力对比矩阵 |
| **02** | [全栈系统拓扑与网络协议](docs/02-architecture-and-topology.md) | 软硬件全栈拓扑、网络端口矩阵、单端口透明反代 |
| **03** | [四层漏斗网关与大模型引擎](docs/03-four-layer-funnel-gateway.md) | L0~L3 漏斗算法、意图分流决策机、15分钟自然衰减环 |
| **04** | [工具体系与技能热拔插规范](docs/04-tools-and-skill-ecosystem.md) | 六大内置 Function Calling 工具、原子工具与复合技能定义 |
| **05** | [社群物理沙箱与成员画像](docs/05-channel-sandbox-and-profiles.md) | `data/channels/<chatId>/` 物理隔离、人设/红线与画像沉淀 |
| **06** | [Web 统一管理控制台规格](docs/06-web-management-console.md) | Vue 3.5 + TS 5.6 严格模式、赛博毛玻璃与 OLED 纯黑模式 |
| **07** | [移动硬件拦截与协议桥接](docs/07-android-hardware-hook.md) | 微信 8.0.79 真机 Hook 原理、大图流式直拉与扫码配对 |
| **08** | [生产部署与运维实战手册](docs/08-deployment-and-operations.md) | Linux ECS 生产基线、systemd 编排、全量 `.env` 字典与应急预案 |
| **汇总**| [全量单文件工程规格书](docs/RPD_FULLSTACK_SPEC.md) | 适合离线查阅或全文字符串检索的全量大单页规格手册 |

---

## 📄 开源许可证

本项目遵循 [MIT License](LICENSE) 开源协议。

# FEAGLE WxBot 全栈工程架构与产品规格说明书 (RPD)
> **文档版本**：v5.1 (Production Baseline)  
> **编写时间**：2026-11-12  
> **基准代码**：FEAGLE-Gateway / apps/gateway / apps/bridge / apps/web / apps/android-agent  
> **文档属性**：全栈工程架构与落地产品规格说明书（基于当前生产代码严格核对编制，唯一真相源）

---

## 目录
- [1. 系统愿景与核心架构哲学](#1-系统愿景与核心架构哲学)
- [2. 整体拓扑与网络通信规格](#2-整体拓扑与网络通信规格)
- [3. 四层漏斗网关与大模型引擎规格](#3-四层漏斗网关与大模型引擎规格)
- [4. 技能与工具体系与热拔插安全规范](#4-技能与工具体系与热拔插安全规范)
- [5. 社群物理沙箱与成员画像系统](#5-社群物理沙箱与成员画像系统)
- [6. Web 统一管理控制台规格](#6-web-统一管理控制台规格)
- [7. 移动硬件拦截与协议桥接规格](#7-移动硬件拦截与协议桥接规格)
- [8. 生产部署、配置矩阵与运维规范](#8-生产部署配置矩阵与运维规范)

---

## 1. 系统愿景与核心架构哲学

### 1.1 痛点与破局
传统微信机器人方案普遍面临三大死穴：
1. **封号高危**：Web 网页端协议（如 wechat4u、Puppeteer）已被微信官方彻底封杀；私有 iPad/Mac 逆向协议特征明显，极易触发人脸识别与封禁。
2. **缺乏沙箱隔离与额度黑洞**：传统机器人多为单体对话，群聊之间共享会话上下文，导致“张三问话李四接着聊”的严重串话现象；遇到群友发送巨量论文或复杂长难任务时，模型额度瞬间被烧光。
3. **运维割裂与缺乏管控**：没有独立的群规边界控制、工具授权白名单、以及可视化实时遥测后台。

### 1.2 核心设计哲学
FEAGLE WxBot 确立了五大核心架构哲学：
* **物理硬件隔离拦截**：通过真实三星平板（Samsung Galaxy Tab A8）搭载 Android 14 与 LSPosed Hook 微信 8.0.78 官方客户端，仅作物理底层事件拦截与原生发信，从根源上杜绝封号风控。
* **四层漏斗逐步分流（Funneling Pipeline）**：从 L0（规则/硬指令）、L1（轻量路由/直答/额度保护）、L2（Pi 工程执行）、到 L3（出站拟人化切片），越靠前的层级耗费越低，90% 以上的日常消息在 0 成本或极低成本层被快速收敛。
* **物理级社群沙箱（Per-Chat Physical Sandbox）**：每一个微信群均落盘为独立目录（`data/channels/<chatId>/`），拥有专属提示词、专属安全铁律、独立工具白名单与 15 分钟自然衰减会话环。
* **带权属生命周期的技能体系（Skill Ownership & Zero-Orphan Lifecycle）**：所有原子工具（Tools）与未来复合技能（Skills）均由沙箱白名单精确约束，具备原子注销能力，关停即彻底从内存清除，零孤儿指令残留。
* **现代化零配置统一控制台**：纯 TypeScript 强类型保障，Vue 3.5 单页应用通过原生 Node.js 反向代理实现单端口托管，支持 OLED 纯黑与高亮主题，实时呈现网络拓扑、沙箱状态与终端流式日志。

---

## 2. 整体拓扑与网络通信规格

### 2.1 系统服务拓扑图

```text
[ 物理平板 / Android Agent (SM-X200) ]
        │  WeChat 8.0.78 (LSPosed/Vector)
        │  WebSocket (:6191/android 加密流)
        ▼
┌────────────────────────────────────────────────────────┐
│ apps/bridge (hermes-wxbridge.service)                  │
│                                                        │
│ ├─ DashboardServer (:6190 外部管理后台入口)              │
│ │   ├─ 托管 Vue 3 生产构建产物 (index.html, assets)    │
│ │   ├─ SSE: /events (状态快照) 与 /logs (实时日志流)    │
│ │   ├─ 反向代理: /api/channels* -> :6185 (Gateway)     │
│ │   ├─ 反向代理: /api/tools     -> :6185 (Gateway)     │
│ │   └─ 反向代理: /gw/outbound   -> :6192 (GatewayClient)
│ │                                                      │
│ ├─ AndroidWechatClient (:6191 WS 接入端点)              │
│ │   ├─ 扫码免密配对 (PairingStore / 动态 Ticket)        │
│ │   ├─ 事件解码: 文本、原生图片、wxgf HEVC转码为 JPEG  │
│ │   └─ 实体双向映射 (mapping.sqlite: wxid ⇄ 数字 ID)    │
│ │                                                      │
│ └─ GatewayClient (:6192 HTTP 出站队列)                 │
│     ├─ 接收出站批次 (POST /gw/outbound)                │
│     └─ 同会话串行化拟人延迟下发 (item.t 文本 / item.img 图片)
└──────────────────────────┬─────────────────────────────┘
                           │ POST /inbound (入站投递)
                           ▼
┌────────────────────────────────────────────────────────┐
│ apps/gateway (pi-wx-gateway.service)                   │
│                                                        │
│ ├─ 端口监听: 127.0.0.1:6185 (REST & Inbound)           │
│ ├─ 四层漏斗调度 (Pipeline):                             │
│ │   ├─ L0: commands.ts (硬指令), sanitizer.ts (防投毒)  │
│ │   ├─ L1: llm.ts (Gemini 3.8 Flash 路由/直答/衰减环)   │
│ │   ├─ L2: pi-manager.ts (Pi 子进程工程任务, 闲置3min回收)│
│ │   └─ L3: dialog.ts (微信原生引用回复), sanitizer.ts   │
│ ├─ 工具注册中心 (tools.ts):                             │
│ │   ├─ web_search (Bing 实时检索)                      │
│ │   ├─ group_remind (定时提醒调度 jobs)                │
│ │   ├─ palace_memo (Mnemosyne 记忆存取)                │
│ │   ├─ generate_image (Gemini Imagen 生图与直发)       │
│ │   └─ read_wechat_article (公众号/卡片文章免登解析)  │
│ ├─ 控制面 (control.ts): 沙箱、人设、Cron、审批、成员画像 │
│ └─ 存储底座:                                           │
│     ├─ SQLite: data/gateway.db (WAL 模式)              │
│     └─ 文件系统: data/channels/<chatId>/ (沙箱配置)     │
└────────────┬─────────────────────────────┬─────────────┘
             │                             │
             ▼                             ▼
┌────────────────────────────┐ ┌─────────────────────────┐
│ Antigravity Tools (:8045)  │ │ Mnemosyne (:18010)      │
│ (antigravity-tools.service)│ │ (mnemosyne.service)     │
│ ├─ /v1/chat/completions    │ │ 语义向量数据库与长期记忆 │
│ │  (gemini-3.8-flash)      │ │ 社交图谱提取沉淀         │
│ └─ /v1/images/generations  │ └─────────────────────────┘
│    (gemini-3.1-flash-image)│
└────────────────────────────┘
```

### 2.2 核心服务端口与协议矩阵

| 服务单元 | 监听地址 | 传输协议 | 访问权限 | 核心职责 |
|---|---|---|---|---|
| **DashboardServer** | `0.0.0.0:6190` | HTTP / SSE | 外部授权访问 | 托管 Vue 3 管理后台、SSE 实时状态与日志流、原生 API 代理 |
| **Android Gateway** | `0.0.0.0:6191` | WebSocket (WSS) | 凭证/Token认证 | 平板端微信 Hook Agent 物理长连接接入、报文双向传输 |
| **Bridge Outbound** | `127.0.0.1:6192` | HTTP REST | 本机回环 | 接收来自 Gateway 的出站批次，串行调度平板发信与发图 |
| **Gateway REST/API**| `127.0.0.1:6185` | HTTP REST | 本机/Bridge代理 | 网关入站接收、沙箱配置 REST API、工具与成员画像管理 |
| **Antigravity Proxy**| `127.0.0.1:8045` | HTTP OpenAI 规范| 本地内部鉴权 | Google Gemini 账号池代理，提供 3.8 Flash 对话与 Imagen 生图 |
| **Mnemosyne 记忆**  | `127.0.0.1:18010`| HTTP REST | 本机回环 | 长期记忆语义检索、工作快照存储与人际图谱维护 |

---

## 3. 四层漏斗网关与大模型引擎规格

系统采用从外至内逐级精细化处理的漏斗流水线，保证低成本、高并发与严密安全。

### 3.1 漏斗各层级职责一览表

```text
[微信消息入站] ──> [滑动窗口防抖 (2.5秒聚合同用户连续消息)]
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ L0 规则拦截与硬指令层 (0 Token, 0 延迟, 纯 TypeScript)   │
│ • 集中硬指令集匹配 (/help, /mode, /status, /cron...)   │
│ • 越狱攻击与提示词投毒检测 (isPromptInjectionOrToxic)   │
│ • 高危敏感操作挂起审批优先裁决 (审批未结阻断其他操作) │
│ • 运行模式过滤: mute (彻底静默) / sentry (只听不答)   │
└────────────────────────┬───────────────────────────────┘
                         │ (未命中 L0，放行进入 L1)
                         ▼
┌────────────────────────────────────────────────────────┐
│ L1 智能语义路由与直答层 (Gemini 3.8 Flash, 响应 < 1.5s)│
│ • 意图决策单字母分流 (W/S/X/T/C/R)                     │
│ • 额度熔断保护 (R: 判定超长任务拒绝执行并给出分步建议) │
│ • 闲聊与即时问答 (T: 结合 15分钟衰减环与背景感知直答)  │
│ • 原生多模态视觉转述 (自动识别图片 base64 转述为上下文)│
│ • 哨兵模式离线语义提取 (紧急告警直推 OP, 社交图谱沉淀) │
└────────────────────────┬───────────────────────────────┘
                         │ (仅当 decision='C' 且人设为工程模式时)
                         ▼
┌────────────────────────────────────────────────────────┐
│ L2 复杂任务引擎与 Pi 单例调度 (Pi CLI Sub-process)      │
│ • 本地文件读写、Shell 执行、Git 管理                   │
│ • 全局单例保护 + 租约锁 (Lease)，杜绝并发踩踏          │
│ • 闲置 3 分钟自动焚毁回收内存 (V8 256MB 硬限)          │
│ • 遇到高危操作拦截并触发 120s 微信审批挂起             │
└────────────────────────┬───────────────────────────────┘
                         │ (生成最终待发文本 / 工具生成待发图片)
                         ▼
┌────────────────────────────────────────────────────────┐
│ L3 出站合成与防风控直发层 (Outbound Delivery)           │
│ • 微信原生引用回复气泡包装 (formatQuoteReply)          │
│ • 敏感凭证与绝对路径自动脱敏 (desensitize)             │
│ • 语义无损分片切分 (splitChunks: 段落/标点优先切分)    │
│ • 拟人化随机延迟注入 (300ms ~ 1500ms 随机等待防风控)   │
│ • 构造批次抛送至 Bridge :6192 串行发出                 │
└────────────────────────────────────────────────────────┘
```

### 3.2 L0 硬指令集规格 (Hard Commands)
所有以 `/` 开头的指令在 L0 层拦截，即使在群聊中以 `@Nox /cmd` 或 `@Nox/cmd` 形式出现，网关也会自动剥离提及前缀，精准命中并秒级返回。

| 指令名称 | 权限 | 参数范例 | 行为与输出规格 |
|---|---|---|---|
| `/help` | 普通 | 无 | 打印当前角色可用的所有指令列表及说明，文末附带执行提示。 |
| `/sid` | 普通 | 无 | 打印统一会话 ID、用户标识、昵称、会话类型（群聊/私聊）、权限级别与当前模式。 |
| `/stats` | 普通 | 无 | 查询 SQLite 审计数据库，展示当前会话 Traces、全系统会话数、总调用流水与运行统计。 |
| `/history` | 普通 | 无 | 打印当前活跃会话的多轮问答上下文（15分钟衰减环内数据）以及待处理窗口缓冲区。 |
| `/mode` | 普通 | `chat` / `sentry` / `mute` | 切换群运行模式：`chat`(正常互动)；`sentry`(哨兵观测模式：静默监听群聊，识别紧急事件私聊 OP 报警并提取人际图谱入库)；`mute`(大模型彻底静音)。 |
| `/block` | 管理员 | `<wxid \| 群ID> [原因]` | 将指定用户或微信群加入黑名单，网关层彻底丢弃该对象所有消息。管理员不可被屏蔽。 |
| `/unblock` | 管理员 | `<wxid \| 群ID>` | 从黑名单中解除对指定目标的屏蔽。 |
| `/name` | 管理员 | `<自定义别名>` | 为当前群聊或私聊会话设置别名（持久化至沙箱 `meta.json`）。 |
| `/op` | 管理员 | `<wxid>` | 在线热提权指定用户为管理员 (OP)。 |
| `/deop` | 管理员 | `<wxid>` | 撤销指定用户的管理员权限（不可撤销自身）。 |
| `/save` | 管理员 | `<快照名>` | 抓取当前 Git HEAD 与工作区上下文，写入 Mnemosyne 记忆宫殿。 |
| `/load` | 管理员 | `<快照名>` | 从记忆宫殿调取指定快照，注入当前会话并唤醒任务重放。 |
| `/cd` | 管理员 | `<绝对路径>` | 动态切换 Pi 底层执行工作目录，若当前空闲则立即回收进程以便在新目录冷启动。 |
| `/cron` | 管理员 | `list` / `add` / `del` | 定时任务管理。支持 Cron 5段式（如 `/cron add daily 0 9 * * 1-5 晨会提醒`）或相对毫秒延迟。 |
| `/audit` | 管理员 | `[条数]` | 实时反查底层 `trace_logs` 审计表最近 N 条流水，标明放行状态与风险标记。 |
| `/approve` | 管理员 | 无 | 针对被拦截的高危操作颁发 60 秒临时金牌权限并唤醒重放。 |
| `/deny` | 管理员 | 无 | 显式拒绝挂起的高危命令审批，终止任务执行。 |
| `/prune` | 管理员 | 无 | 联动 Bridge 自动清理已退出的群聊和测试实体，收敛系统会话总数。 |

### 3.3 L1 意图路由信号与额度保护 (Quota Guard)
* **W (Wait)**：用户话未说完（断句/并列连词/排版未完），滑动窗口自动延长 2.5 秒等待下一段。
* **S (Steer)**：任务正在运行中时收到追加补充指令，向现有 Pi 会话直接追加引导而不打断进程。
* **X (Cancel)**：检测到用户表达“停止/别做了/算了我自己来”，立即中断底层 Pi 并释放租约。
* **T (Talk)**：纯日常问答、闲聊或情绪表达，不唤醒 Pi，由 Gemini 3.8 Flash 结合人设秒回。
* **C (Coding/Task)**：确凿的研发工程、脚本执行、多步排错任务，转入 L2 处理。
* **R (Refuse 额度保护)**：当大模型检测到提问规模庞大（如“帮我写一套完整电商系统含前端后端测试部署”），L1 自动拦截并给出礼貌拒绝与分步骤拆解建议，**坚决不调用 L2，避免瞬间烧尽 API 额度**。

### 3.4 15分钟自然衰减会话环与群聊背景感知 (DialogManager)
为了平衡“多轮上下文连贯性”与“长期对话记忆膨胀导致的幻觉与成本消耗”，网关实现了两项核心机制：
1. **15 分钟自然衰减会话环**：
   - 维护 `dialogManager.getTurns(chatId)`。群友连续提问在 15 分钟（900 秒）TTL 窗口内，自动继承前序问答（上限 8 条/4 轮）。
   - 一旦超过 15 分钟无人向机器人提问，环形缓冲自动清空归档。下一次 `@Nox` 提问将从全新上下文开始，杜绝跨时段话题干扰。
2. **群聊背景感知环 (Rolling 20 Buffer)**：
   - 当群内产生普通群友闲聊（未 `@机器人`）时，网关静默记录最近 20 条消息流水。
   - 当某群友突然 `@Nox` 发问（例如“刚刚他们聊的那个方案你怎么看？”），系统将背景流水作为只读上下文注入 Prompt，让 Nox 能够瞬间感知群内上下文，同时保证平时绝不插话打扰。

---

## 4. 技能与工具体系与热拔插安全规范

### 4.1 功能 (Tool) 与 技能 (Skill) 的层级界定
* **原子工具 (Tool)**：大模型在多轮思考中按需触发的函数调用单元（Function Call），接收参数并返回纯文本结果。
* **复合技能 (Skill/Plugin)**：高阶的业务单元包。一个技能可同时打包 **专属 Prompt 设定**、**多个微观 Tools**、以及 **面向用户的 L0 确定性硬指令（如 `/draw`, `/review`）**。

### 4.2 核心内置工具规格
网关当前注册了 4 款系统级内置工具（全局不可注销，受沙箱白名单精确授权）：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        网关核心工具注册表 (ToolRegistry)                │
├─────────────────┬──────────────────┬───────────────────────────────────┤
│ 工具名称 (name) │ 安全级别         │ 职责与实现逻辑                    │
├─────────────────┼──────────────────┼───────────────────────────────────┤
│ web_search      │ 核心内置 (只读)  │ Bing 实时搜索，自动解码 HTML 实体 │
│ group_remind    │ 核心内置 (状态写)│ 解析相对/绝对时间，注册 SQLite jobs│
│ palace_memo     │ 核心内置 (持久化)│ 读写 Mnemosyne 记忆宫殿与本地备忘 │
│ generate_image  │ 核心内置 (直发出)│ Google Imagen 生图，微信直发图片  │
│ read_wechat_article │ 核心内置 (只读)│ 公众号原生卡片与文章免登录正文解析│
└─────────────────┴──────────────────┴───────────────────────────────────┘
```

#### 工具 1：实时网页搜索 (`web_search`)
* **参数契约**：`{ query: string }`
* **实现原理**：通过 Bing 实时爬虫检索 Top 5 高权重网页摘要与标题，内置 `decodeHtmlEntities` 实体净化，供模型在回答实时新闻、时效事实时调用。

#### 工具 2：社群与个人定时提醒 (`group_remind`)
* **参数契约**：`{ time: string, content: string, target?: string }`
* **时间解析器 (`parseReminderTime`)**：
  - 相对时间：`10m`, `30s`, `2h`, `15分钟后`, `1小时后`。
  - 当日时刻：`15:30`, `09:00`（若已过当天时刻自动推算至次日）。
  - 绝对时间：`2026-11-15 10:00`。
* **底层机制**：解析为毫秒级时间戳，向 `jobs` 表插入待办任务，由 `control.ts` 的后台计时器在毫秒到期时唤醒管线并发送提醒。

#### 工具 3：记忆宫殿备忘录 (`palace_memo`)
* **参数契约**：`{ action: 'save' | 'search', content: string, category?: string }`
* **分类体系**：`knowledge`, `worklog`, `preference`, `project`, `pitfall`。
* **实现原理**：双轨存储。优先请求 `Mnemosyne:18010` 向量搜索引擎，同时本地在群目录 `memos.json` 保留最近 50 条文件级降级备份。

#### 工具 4：大模型生图与微信直发 (`generate_image`)
* **参数契约**：
  - `prompt` (string, 必须): 画面构图、主体、色彩、光影细节描述。
  - `aspect_ratio` (string, 可选): `1:1`, `3:4`, `4:3`, `9:16`, `16:9`。
* **执行流程与微信通道绑定**：
  1. 调用 `http://127.0.0.1:8045/v1/images/generations`，指定模型 `gemini-3.1-flash-image`，接收 `b64_json`。
  2. 落地存储为文件：`data/generated-images/gen-${Date.now()}-${rand}.png`（典型大小 1.3MB，避免在 Node 进程间传递巨型 Base64 字符串引爆内存）。
  3. 构建微信出站批次（`batch = { c: ctx.chatId, seq: [{ img: localFilePath, d: 300 }] }`），直接向 `config.bridgeOutUrl`（6192 端口）发起异步下发。
  4. 向 LLM 上下文返回成功确认，模型在下一步回复中输出友好的自然语言收尾，实现“图片+说明”连贯下发。

#### 工具 5：微信公众号文章与原生卡片解析 (`read_wechat_article`)
* **参数契约**：`{ url: string }`
* **微信原生卡片（AppMsg XML 消息类型 49）解析链路**：
  1. 用户在微信客户端直接转发公众号卡片（而非手工复制 URL）时，底层触发微信 AppMsg 协议（type 49, sub-type 5/1）。
  2. Android Hook 适配器（`Wechat8078Adapter.java:980`）拦截后提取 `<title>`、`<des>` 与标准 `<url>`，构造为 `[链接] 标题\n描述\nURL` 传入网关。
  3. L1 路由器识别公众号链接，或模型在人设提示下自主触发 `read_wechat_article` 工具。
  4. 网关使用桌面端 Chrome User-Agent 直接向 WeChat SSR 公开页面发起轻量 GET 请求，**无需微信登录态与 Cookie** 即可获取 `#js_content` 正文。
  5. 经过 DOM 剥离、HTML Entity 解码及 12,000 字上限截断，将干净正文注入 LLM 会话上下文，实现免人工复制、直接转发即读。

### 4.3 技能热拔插与硬指令零隐患注销规范 (Hot-Plug Specification)
为了满足未来从 GitHub 或外部生态引入 Skills，且必须保证**“装上即用、关掉即焚、源头零残留”**，确立如下架构标准：

```text
[外部 GitHub 技能 / 本地扩展包]
            │ 声明: manifest.json
            ▼
┌────────────────────────────────────────────────────────┐
│ Skill 生命周期管理器 (Skill Lifecycle Manager)          │
│                                                        │
│ 1. 挂载阶段:                                           │
│    • 注入带 Tag 的硬指令: command.skillId = 'draw_art' │
│    • 系统保留字冲突拦截 (禁止占用 /help, /op, /mode...)│
│    • 注册 Tool 契约至 ToolRegistry                     │
│                                                        │
│ 2. 执行期沙箱校验:                                     │
│    • 判断当前群沙箱 tools.json 是否显式包含该能力      │
│                                                        │
│ 3. 卸载/停用阶段 (Atomic Purge):                       │
│    • 遍历 HARD_COMMANDS: 删除所有 skillId 匹配的指令   │
│    • 遍历 ToolRegistry: 移除该 Skill 注册的所有工具     │
│    • 释放 require / import 缓存引用，触发 GC           │
│    • 结果: 再次调用报"未知指令", 无任何孤儿闭包残留     │
└────────────────────────────────────────────────────────┘
```

---

## 5. 社群物理沙箱与成员画像系统

### 5.1 沙箱物理目录设计规范
每一个群聊在网关数据目录中均拥有物理隔离的专属空间：`data/channels/<chatId>/`。

```text
data/channels/19827364501@chatroom/
├── meta.json       # 群自定义别名与基础元数据 {"name": "FEAGLE 核心架构攻坚群"}
├── persona.md      # 该群专属人设 Prompt（优先级最高，覆盖全局默认）
├── rules.md        # 该群专属安全铁律与红线守则（拼装在 Prompt 最底端强制约束）
├── tools.json      # 该群授权的工具白名单 ["web_search", "generate_image"]
├── members.json    # 群成员画像数据库 (按用户 wxid 索引)
└── memos.json      # 该群专用的本地备忘录降级存储 (最多保留 50 条)
```

### 5.2 微信真实群名实时解析与双层呈现
由于微信底层协议中，群聊 ID 均为无规则的十六进制字符串（如 `19827364501@chatroom`），直接展示极大损害管理体验：
1. **自动从协议层提取真实名称**：Android Hook 在同步通讯录时，将微信群的真实标题与成员数实时同步至 `data/wechat/mapping.sqlite` 的 `contacts` 表。
2. **多层回退决议器 (`resolveRealGroupName`)**：
   - 第一优先级：用户在控制台手动指定的自定义别名（`meta.json` 中的 `name`）。
   - 第二优先级：`mapping.sqlite` 中由 Hook 自动同步的微信真实群名。
   - 保底回退：原始 `@chatroom` 协议 ID。
3. **前端双层拟态设计**：在管理控制台卡片与抽屉顶部，高亮显示真实中文群名，并在下方配以等宽字体的协议 ID 与一键复制按钮，兼顾人性化体验与底层工程调试。

### 5.3 群成员画像标签系统 (Member Profiling)
在群聊沙箱中，系统对群内发言成员进行轻量级画像沉淀，并在 `@Nox` 被提及发问时，自动将发言者的画像标签提取注入至系统 Prompt 中：

```typescript
export interface MemberProfile {
  wxid: string;          // 成员微信底层 ID
  nickname?: string;     // 最近一次观察到的微信昵称
  role?: string;         // 角色身份 (如: "系统核心架构师", "前端负责人", "实习生")
  tags?: string[];       // 标签云 (如: ["Vue3", "TypeScript", "深度性能优化"])
  notes?: string;        // 关注点与协同备注 (如: "对代码类型安全要求极高，不要输出 any")
  interactionCount: number; // 累计互动发言次数
  lastActive: number;    // 最近一次活跃时间戳
}
```

* **自动化沉淀**：每次成员在群内发言，网关自动递增 `interactionCount` 并更新 `lastActive`。
* **上下文感知呈现**：当提问者被识别到画像时，Prompt 头部自动出现：
  ```text
  [提问者身份信息]
  提问者: 张三 (ID: wxid_xxx)
  群内设定角色: 前端负责人
  能力/关注标签: Vue3, 性能优化
  管理员批注: 对代码类型安全要求极高
  ```
  模型因此能够针对不同身份的群友给出定制化深度、贴合其技术背景的高质量回答。

---

## 6. Web 统一管理控制台规格

### 6.1 技术架构与设计语言
* **架构底座**：Vite 6 + Vue 3.5 + TypeScript 5.6 严格模式 + Pinia 2.2 + Tailwind CSS。
* **主题与设计规范**：
  - **赛博毛玻璃拟态（Cyberpunk Dark Glassmorphism）** 与 工业级白天模式（Light Mode）无缝平滑切换。
  - **夜间模式纯黑保障**：采用 OLED 纯黑底色（`#000000` 与 `#080808`），辅以 `border-white/[0.08]` 极细微边框，消除传统暗色界面的灰蒙感。
  - **数字工业字体**：引入 `DSEG7 Classic` 七段数码管字体呈现赛博跳动数字时钟。

### 6.2 五大核心业务视图规格

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        FEAGLE 控制台核心视图导航                        │
├─────────────────┬──────────────────────────────────────────────────────┤
│ 视图名称        │ 核心功能与指标呈现                                   │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 1. 系统总览     │ WeChat Hero 卡片、Bot 状态呼吸灯、4 项底层链路健康度、│
│    (Overview)   │ 7 项管道实时吞吐指标、微信运行模式快捷切换           │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 2. 社群沙箱     │ 真实群名网格搜索、沙箱配置抽屉(工具/人设/群规/TTL)、   │
│    (Channels)   │ 15分钟衰减环动态进度条、群成员画像标签表格与编辑模态 │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 3. 工具目录     │ 全局工具契约列表、核心内置与自定义标识、参数 Schema   │
│    (Tools)      │ 树形可视化查看器、自定义 Webhook 工具动态注册/注销   │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 4. 终端日志     │ SSE 实时日志流 (/logs)、级别高亮过滤 (INFO/WARN/ERR)、│
│    (Logs)       │ 实时文本高亮检索、锁屏暂停滚动、一键复制最新日志     │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 5. 桥接设置     │ 防风控频控滑块、静音时段校验、拟人化随机延迟范围调整 │
│    (Settings)   │                                                      │
└─────────────────┴──────────────────────────────────────────────────────┘
```

### 6.3 统一原生透明反向代理链路
为了消除前后端跨域并实现单端口极简访问，控制台所有请求统一走 `http://<服务器IP>:6190`：
* `GET /` ──> 直接伺服预编译的 Vue 3 SPA 单页应用；
* `/api/channels*` 与 `/api/tools` ──> DashboardServer 自动代理至内部 `127.0.0.1:6185` (Gateway)；
* `/gw/outbound` ──> 自动代理至内部 `127.0.0.1:6192` (GatewayClient)。
* **零公网暴露**：除 6190 与 6191 端口按需暴露外，核心网关 6185、出站 6192、以及大模型反代 8045 全部绑定于 `127.0.0.1`，具有极高的网络防护安全性。

---

## 7. 移动硬件拦截与协议桥接规格

### 7.1 物理真机基线配置
* **测试与生产基准设备**：Samsung Galaxy Tab A8 (`SM-X200`)。
* **操作系统**：Android 14 (One UI Core)。
* **ROOT 与框架**：Magisk 30.7 + Zygisk + LSPosed / Vector 框架模块。
* **宿主微信版本**：微信官方 64 位安装包 `8.0.78` (`arm64-v8a`)。
* **通信协议版本**：`feagle.android.v1` 加密流式 WebSocket。

### 7.2 核心事件流转机制
1. **消息进站清洗与拦截**：
   - 物理 Hook 截获微信底层 SQLite 写入事件，提取真实 `talker`、`content`、`createTime`、`msgSvrId`。
   - 过滤公众号（`gh_*`）、微信团队、文件传输助手等系统噪声，仅放行真实私聊与群聊。
   - 对微信原生私有格式（`wxgf` HEVC）图片，服务器端通过 `ffmpeg` 自动转码解码为标准 JPEG，保证多模态视觉模型 100% 兼容。
2. **免密扫码配对机制 (`PairingStore`)**：
   - 平板首次接入时，控制台动态生成局域网/公网 WS 配对二维码与 5 分钟安全 Token；
   - 平板端通过 Android Agent 扫码后将 Token 持久化至私有配置，后续自动进行加密心跳保活（75 秒心跳超时兜底）。
3. **出站大图分片安全分发 (`OutboundImageStore`)**：
   - 当向微信发送高清大图（如 1.3MB 生图）时，Bridge 生成短期随机 Streaming Ticket 并由平板按需分块拉取，严密防止 WebSocket 主信道被大文件阻塞（Head-of-Line Blocking）。

---

## 8. 生产部署、配置矩阵与运维规范

### 8.1 生产服务拓扑与进程守护
当前生产环境运行于阿里云 ECS 服务器（IP: `39.97.255.91`，Ubuntu 26.04），全部采用 systemd 原生单元进行守护监控：

```text
/etc/systemd/system/
├── pi-wx-gateway.service       # 四层漏斗主网关 (Node.js, 内存硬限 320M)
├── hermes-wxbridge.service     # 微信协议桥接与控制台 (:6190, :6191, :6192)
├── antigravity-tools.service   # Google Gemini 账号池代理 (:8045)
└── mnemosyne.service           # 语义记忆持久化检索服务 (:18010)
```

### 8.2 核心环境变量配置矩阵 (`.env`)

```ini
# 时区与基础设置
TZ=Asia/Shanghai
BOT_TIMEZONE=Asia/Shanghai
BOT_QUIET_HOURS=00:00-07:00

# 端口网络配置
DASHBOARD_HOST_PORT=6190
ANDROID_WS_BIND_HOST=0.0.0.0
ANDROID_WS_HOST_PORT=6191
GATEWAY_PORT=6185
GATEWAY_OUTBOUND_PORT=6192
BRIDGE_OUT_URL=http://127.0.0.1:6192/gw/outbound

# 大模型后端凭据 (Antigravity Proxy)
ANTIGRAVITY_BASE_URL=http://127.0.0.1:8045/v1
ANTIGRAVITY_KEY=sk-your-antigravity-api-key
ANTIGRAVITY_MODEL=gemini-3.8-flash
ANTIGRAVITY_TIMEOUT_MS=15000

# 记忆中枢 (Mnemosyne)
MNEMOSYNE_BASE_URL=http://127.0.0.1:18010
MN_USER_ID=eagle

# 防风控与防封参数 (Message Guard)
BOT_USER_RATE_LIMIT=3
BOT_USER_RATE_WINDOW_MS=30000
BOT_GLOBAL_RATE_LIMIT=30
BOT_GLOBAL_RATE_WINDOW_MS=60000
BOT_GROUP_REPLY_COOLDOWN_MS=5000
BOT_GROUP_JITTER_MIN_MS=1000
BOT_GROUP_JITTER_MAX_MS=3000
OUT_CHUNK_SIZE=800
OUT_MIN_DELAY=800
OUT_MAX_DELAY=1500
```

### 8.3 日常运维指令速查

* **查看核心服务运行状态**：
  ```bash
  systemctl status pi-wx-gateway.service hermes-wxbridge.service --no-pager
  ```
* **一键平滑重启网关与桥接**：
  ```bash
  systemctl restart pi-wx-gateway.service hermes-wxbridge.service
  ```
* **跟踪网关实时运行流水**：
  ```bash
  journalctl -u pi-wx-gateway.service -f -n 50
  ```
* **跟踪协议桥与发信日志**：
  ```bash
  journalctl -u hermes-wxbridge.service -f -n 50
  ```
* **快速验证核心工具集连通性**：
  ```bash
  curl -s http://127.0.0.1:6190/api/tools | jq .
  ```
* **前端工程增量重构与静态同步**：
  ```bash
  npm --prefix apps/web run build
  systemctl reload hermes-wxbridge.service
  ```

---
*（文档结束）*

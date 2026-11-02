# 03 控制面（Control Plane v2.0）

代码主体：`apps/gateway/src/control.ts`（~470 行）。

## 1. SQLite 五表（`data/gateway.db`，node:sqlite DatabaseSync）

| 表 | 用途 | 关键列 |
|---|---|---|
| sessions | 会话状态与模式 | chat_id, persona_id, workspace, turn_lease, pending_confirm_id, **mode (chat/sentry/mute)** |
| trace_logs | 裁剪审计 | layer, event, detail, latency_ms, req_id, source, risk_flag |
| personas | 人设注册 | id, name, sys_prompt, engine_mode(l1_only/auto), allow_shell, allowed_mcp_tools |
| skills | 技能注册 | （预留） |
| jobs | 定时任务 | cron(5字段或毫秒一次性), persona_id, payload, enabled, last_run |

迁移策略：migrate() 幂等 ALTER/CREATE；**启动自愈**：清孤儿 turn_lease=1、清 pending_confirm_id（防进程被杀后永久卡死）。

## 2. 三大运行模式（`sessions.mode`，OP 通过 `/mode` 切换）

1. **`chat` (正常交互模式，默认)**：
   群聊中仅在被 @ 艾特时触发大模型与任务；私聊直接回复。
2. **`mute` (彻底静音模式)**：
   群内无论是否 @ 均直接静默（0 Token 消耗），大模型完全闭嘴；仅 OP 管理员以 `/` 开头的 L0 硬指令可执行并回显。
3. **`sentry` (智能哨兵观测模式)**：
   群内所有发言静默汇入缓冲池（`sentryBuffers`），**在群内 100% 保持闭嘴**；后台批量异步执行轻量 AI 审判（`analyzeSentryTranscript`）：
   - **紧急告警直通车**：突发故障、删库宕机、违规风控或紧急呼叫群主，私信直推 OP 管理员；
   - **人际社交关系图谱沉淀**：自动提炼分工、协作与依赖关系，格式化为 `[CURRENT][RELATION]` 存入 Mnemosyne 记忆库。

## 3. 人设矩阵与里/表分权（面向普通用户 vs 管理员）

| 人设 | 级别 | engine_mode | allow_shell | 行为与可见性 |
|---|---|---|---|---|
| daily_assistant (灵动助手) | 🌐 表人设 | l1_only | 0 | 全员可见。聊天亲切自然、简短有分寸，查阅公共知识，不露底。 |
| secretary (精简秘书) | 🌐 表人设 | l1_only | 0 | 全员可见。回答极简克制，三句话内，仅查阅记忆，禁止写操作。 |
| architect (架构师) | 👑 里人设 | auto | 1 | **仅 OP 可见/可用**。资深架构师，直接给结论与 diff，支持 Shell。 |
| readonly_auditor (只读审计员) | 👑 里人设 | l1_only | 0 | **仅 OP 可见/可用**。仅检索与汇报系统/记忆状态，只读审计。 |

**安全规则**：普通用户输入 `/persona` 隐藏里人设；普通用户试图越权切换里人设时，网关在底层硬降级回 `daily_assistant`。

## 4. 集中硬指令注册表（`apps/gateway/src/commands.ts`）

所有硬指令集中收敛在 `commands.ts`，100% 纯 TS 原生分支执行，0 成本、0 延迟、绝不走 LLM：

| 指令 | 权限 | 功能说明 | 对应借鉴 (AstrBot) |
|---|---|---|---|
| `/help` | 全员 | 根据身份动态展示可用指令清单 | 经典内置 `/help` |
| `/sid` | 全员 | 查询当前消息源 UMO、UID、群ID、OP身份与模式 | AstrBot 核心定位 `/sid` |
| `/stats` | 全员 | 查看本会话日志数、全网关日志数、活跃会话数 | AstrBot `/stats` |
| `/history` | 全员 | 查看当前滑动窗口待发给大模型的对话栈 | AstrBot `/history` |
| `/mode <chat\|sentry\|mute>` | **OP** | 切换当前会话工作模式（正常/哨兵/静音，取代原 /llm） | 模式控制核心 |
| `/block <ID> [原因]` | **OP** | 将恶意用户(wxid)或群聊加入黑名单，底层物理静默丢弃 | 恶意防骚扰硬盾 |
| `/unblock <ID>` | **OP** | 解除对某人或群聊的黑名单屏蔽 | 黑名单管理 |
| `/sh <cmd>` | **OP** | 宿主机执行原生 Shell 并回显 stdout/stderr | 强执行力运维 |
| `/name <alias>` | **OP** | 为会话设置人类可读展示别名 | AstrBot `/name` |
| `/op` / `/deop` | **OP** | 在线热提权/撤销管理员 | AstrBot `/op` |
| `/status` | **OP** | 获取网关、Pi 引擎、租约与任务全局状态 | AstrBot 状态控制 |
| `/persona [id]` | **OP** | 查看/热切换人设（全量可见） | AstrBot `/persona` |
| `/stop` / `/new` | **OP** | 强杀智能体 / 开启全新会话清空上下文 | AstrBot `/stop` `/new` |
| `/save` / `/load` | **OP** | 工程快照保存到记忆宫殿与恢复重放 | 工程快照指令 |
| `/cd <path>` | **OP** | 切换工作区目录（验证目录+空闲回收） | 运维工作区控制 |
| `/cron add\|list\|del` | **OP** | 定时任务增删查（周期或一次性延迟） | AstrBot Cron 体系 |
| `/audit [n]` | **OP** | 查看全链路最近 n 条审计日志 | 审计追踪 |
| `/approve` / `/deny` | **OP** | 通道B高危命令放行重放（金牌60s）与拒绝 | 安全审批流 |

## 5. 防投毒与防越狱硬规则防火墙（`sanitizer.ts`）

在 L0 最外层对文本进行正则硬匹配拦截：
- 拦截“忽略所有规则/指令”、“输出系统提示词/prompt”、“进入开发者模式/dan/越狱”、“eval/exec/<script>”等；
- 命中后直接抛出 `L0 injection_blocked`（`risk_flag: 1`），回显 `🛡️ [安全拦截]`，**绝不调用大模型**。

## 6. 两阶段审批（高危命令防线）

- **通道A（主）**：Pi 调 MCP 工具 request_high_risk_exec → POST `/internal/confirm`（网关内端点，130s 长连接挂起）→ 微信 Y/N → resolveApproval 解 Map 挂起 → Pi 拿结果继续。Pi 全程不 abort。
- **通道B（兜底）**：通道A 超时/网关重启 → recordHazard 存档 + 微信提示 → 用户 `/approve` → grantOnce 金牌（命令精确匹配 + 60s 有效 + 用后即焚）→ runReplay 重放。
- 注：E2E 中通道B 未被真实触发过——Gemini 拒绝诱导绕过审批，属预期安全行为。

## 7. 网关内部端点（仅 127.0.0.1:6185）

| 端点 | 用途 |
|---|---|
| POST /inbound | bridge → 网关消息入口 |
| GET /health,/status | 健康检查 |
| POST /test/outbound | 出站自测 |
| POST /internal/confirm | 通道A 长连接 |
| GET /internal/context | 人设/会话上下文（MCP 查询） |
| GET /internal/persona-tools?chat= | 人设可用 MCP 工具 |
| GET /internal/approvals | 当前挂起审批 |

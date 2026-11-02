# Pi-WeChat-Gateway 文档包

微信机器人 AI 助理系统的唯一文档真相源（Single Source of Truth）。
本包由多个 Agent 轮流共享维护，更新纪律见 [AGENTS.md](AGENTS.md)。

## 文档导航

| 文件 | 内容 | 谁最常更新 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | 多 Agent 协作规范（更新纪律/职责矩阵） | 所有 Agent 必读 |
| [01-architecture.md](01-architecture.md) | 系统架构：部署拓扑、四层漏斗、模型矩阵、模式与上下文隔离 | 架构变更时 |
| [02-message-flow.md](02-message-flow.md) | 消息全链路：入站→硬指令→路由→执行→出站，哨兵与审批时序 | 管线改动时 |
| [03-control-plane.md](03-control-plane.md) | 控制面：里/表人设分权、L0集中硬指令表、三态模式切换、防投毒 | 控制面改动时 |
| [04-operations.md](04-operations.md) | 运维手册：启停/构建/监控/日志/备份/USB网络共享保活 | 每次运维操作 |
| [05-troubleshooting.md](05-troubleshooting.md) | 故障排查 + 历史 Bug 档案（含微信8.0.79锁屏发信暗坑） | 每次修 Bug |
| [06-config-reference.md](06-config-reference.md) | 配置参考：.env、端点、MCP 工具、模型清单 | 配置变更时 |
| [07-changelog.md](07-changelog.md) | 变更日志（按时间线） | 每次变更必追加 |
| [08-verification.md](08-verification.md) | E2E 验收记录（含 trace 证据） | 每次验收 |
| [09-qc-report-20261101.md](09-qc-report-20261101.md) | 质检报告：文档包零幻觉核验 | 独立质检时 |

## 新 Agent 上手顺序

1. 读本 README → AGENTS.md（协作纪律）
2. 读 01-architecture.md（知道系统长什么样，双轨会话模式）
3. 按任务需要跳读 02~06
4. 动手前必读 05 的"构建陷阱"节（PATH 污染坑）

## 系统一句话

你发微信消息 → wxbridge（ID 翻译/防抖）→ 网关四层漏斗
【L0 集中硬指令/安全拦截 → L1 Gemini 意图路由/表里人设 → L2 Pi(Gemini) 执行 → L3 无损切分】
→ wxbridge 拟人发回。
具备三大模式：`chat` 正常交互、`sentry` 智能哨兵观测（静默倾听+紧急私信OP+社交图谱沉淀）、`mute` 彻底静音；
硬指令独立收敛在 `commands.ts`（0 Token 消耗、OP 权限隔离、包含 `/sh`、`/sid`、`/mode` 等）；
记忆系统（Mnemosyne）零侵入解耦，支持半衰期衰减自动排除过时记忆。

## 遗留文档（项目脚手架原生，仍有效）

| 文件 | 内容 |
|---|---|
| project-overview.md | FEAGLEwxbot/Bridge 原项目介绍 |
| user-guide.md | Bridge 操作步骤说明书 |
| troubleshooting.md | Bridge 报错与日志积累 |
| android/ | 微信协议逆向：设备要求、微信 8.0.70 安装、Windows 工具链、agent 构建安装、8.0.78 消息类型逆向、quickstart |
| assets/ | 上述文档配图（2.3MB） |

## 关键端口速查

| 端口 | 服务 | 说明 |
|---|---|---|
| 6185 | pi-wx-gateway | 网关本体（仅 127.0.0.1） |
| 6192 | hermes-wxbridge | 微信桥（入站/出站） |
| 8045 | antigravity 反代 | Gemini/Claude 免费额度出口 |
| 18010 | Mnemosyne | 记忆宫殿 REST |
| 7890 | mihomo | 出海代理（NIM 专用） |

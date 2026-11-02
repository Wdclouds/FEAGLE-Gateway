# 01 系统架构

## 1. 部署拓扑（单机：阿里云 ECS Ubuntu 26.04，2核 / 1.6G 内存 / 40G 盘）

```
微信 ⇄ wxbridge(6192)
            │ 入站: ID翻译 + 2.5s防抖
            ▼
      pi-wx-gateway(6185) ── 四层漏斗 ──────────────┐
            │ L1路由      │ L2执行        │ L3切分   │
            ▼             ▼               │          │
    Antigravity反代(8045) Pi子进程         │          ├── Mnemosyne(18010) 记忆
    gemini-3.8-flash      gemini-3.8-flash │          │   └─ mihomo(7890) NIM出海
    (DeepSeek付费兜底)     (闲置3min即焚)  │          │
            │             │               ▼          └── SQLite: data/gateway.db
            └── 高危 ──→ Y/N审批挂起 ──→ wxbridge出站(按d延迟拟人发送)
```

> **命名说明**：微信桥的 systemd 单元名为 `hermes-wxbridge.service`（历史遗留命名，
> 描述 "Feagle WeChat Bridge (host mode, OneBot -> Hermes)"），应用本体在 `apps/bridge/`。
> 本文统一叫 wxbridge；操作服务时用 `systemctl ... hermes-wxbridge.service`。

零容器；全部 systemd 原生进程（gateway / wxbridge / mnemosyne）。

## 2. 四层漏斗（核心设计：越往前越便宜，绝大多数消息根本到不了 L2）

| 层 | 职责 | 成本 | 关键文件 |
|---|---|---|---|
| L0 规则拦截 | 集中硬指令注册表（`/mode` `/sh` `/sid` `/persona` `/cron` `/cd` `/approve` `/deny` `/audit` `/help` `/stats` `/history`）、防投毒安全防火墙、审批优先拦截 | 0（纯代码） | `apps/gateway/src/commands.ts`<br>`apps/gateway/src/sanitizer.ts`<br>`apps/gateway/src/pipeline.ts` |
| L1 智能路由 | 意图识别 W/S/X/T/C/**R**；图片先 NEMotron 转述；表/里人设动态绑定；闲聊 T 直接秒回；**巨量任务 R 拒单保护额度** | Gemini 3.8-flash 免费（DeepSeek 兜底） | `src/llm.ts` routeMessage |
| L2 Pi 执行 | 唤醒 Pi 子进程跑工程任务，15 个 MCP 工具，高危 Y/N 审批 | 内存 256M（闲置即焚回收） | `src/pi-manager.ts` |
| L3 无损直出 | 回复无损切分成微批次，组装 WxOutboundBatch，史官防腐打标写入记忆 | 0（TS 规则切分） | `src/sanitizer.ts` |
| 旁路 哨兵观测 | `sentry` 模式下的异步批审判，紧急故障私信 OP，人际关系图谱沉淀 | 极低（异步批处理） | `src/llm.ts` analyzeSentryTranscript |

## 3. 双轨混合会话隔离（方案 C：群内隔离 + 私聊随身穿透）

- **复合 Session Key**：
  ```typescript
  export const getSessionKey = (pkt: { c: string; u: string }): string =>
    pkt.c.endsWith('@chatroom') ? `${pkt.u}@${pkt.c}` : pkt.u;
  ```
  - **群聊**：按 `用户ID@群ID` 隔离独立防抖缓冲与多轮上下文，张三与李四在同一群艾特机器人绝不串台，租约锁互不干扰。
  - **私聊**：按 `用户ID` 全局单轨穿透，随身背包记忆无缝继承。

## 4. 记忆系统（Mnemosyne）零侵入解耦与时效净化

- **零侵入调用**：纯 REST 接口调用（`http://127.0.0.1:18010`），不修改上游 Python 源码，上游可自由 `git pull` 升级。
- **时间半衰期衰减与硬淘汰**：
  $$\text{Score} = \text{BaseScore} \times e^{-\lambda \times \Delta t_{\text{days}}}$$
  - 静态偏好（`preference`、`[PIN]`）：永久有效，无衰减；
  - 项目配置与临时排错：半衰期 7 天，超过 30 天未被激活且低分记录在检索层直接静默淘汰；
  - 时序仲裁：后发生的决策覆盖旧决策，带有 `[CURRENT]` 标签的记忆为有效基准。

## 5. 模型矩阵（一服务商俩模型不会乱：API 无状态，上下文由网关裁剪分发）

| 模型 | 角色 | 用途 | 价格 | 备注 |
|---|---|---|---|---|
| gemini-3.8-flash | L1 大脑 | 路由判断（含 R 额度保护拒单）/ l1_only 人设直答 / 史官记忆提炼 | 免费(Antigravity反代) | 实测 2~5s，价格低可放心用；JSON 直出可靠 |
| gemini-3.8-flash | L2 大脑 | Pi 工程任务执行 | 免费(同反代) | `/root/.pi/agent/settings.json` defaultModel |
| deepseek-chat | 兜底 | 反代挂/超时才顶上（L1三处调用同链路降级） | 付费 | trace 中 provider 字段可查实际走了谁 |
| nvidia/nemotron-3.5-super-vl-120b-a12b | 眼睛 | 微信图片转述（必须 `chat_template_kwargs:{thinking:false}`，走 mihomo 7890） | NIM key | 只当眼睛，路由判断力差（实测全判W） |

降级链：`Gemini → DeepSeek → 本地兜底(代码硬编码)`。

## 4. 内存红线（765MB 可用，硬约束）

| 进程 | 限额 | 实测 RSS |
|---|---|---|
| pi-wx-gateway | V8 `--max-old-space-size=192` | 30~80MB |
| Pi 子进程 | `--max-old-space-size=256` + 3min 闲置 SIGTERM | 峰值 ~200MB，即焚回收 |
| wxbridge / Mnemosyne / mihomo | 原生占用 | 合计 ~300MB |

严禁新容器、严禁常驻新进程。加功能先问内存。

## 5. 目录结构

```
/opt/FEAGLEwxbot/
├── apps/
│   ├── gateway/          # TypeScript 网关（本包主角）
│   │   ├── src/          # index/pipeline/llm/pi-manager/control/db/sanitizer/mnemosyne/protocol/config
│   │   ├── mcp/          # mnemosyne-mcp.mjs + gateway-ctl-mcp.mjs（stdio MCP，零依赖）
│   │   ├── data/         # gateway.db (SQLite) + audit_full.jsonl
│   │   └── .env
│   └── bridge/           # wxbridge（Node，微信协议桥）
├── docs/                 # 本文档包（git 真相源）
└── /root/.pi/agent/      # Pi 配置(models.json/settings.json/mcp.json)
```

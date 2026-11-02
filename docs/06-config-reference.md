# 06 配置参考

## 1. 网关 .env（`/opt/FEAGLEwxbot/apps/gateway/.env`）

| 键 | 当前值/默认 | 说明 |
|---|---|---|
| GATEWAY_PORT | 6185 | 网关监听（仅 127.0.0.1） |
| BRIDGE_OUT_URL | http://127.0.0.1:6192/gw/outbound | 出站到 bridge |
| ADMIN_WXIDS | wxid_nt3xb18o5uhl22 | 管理员白名单（逗号分隔） |
| GROUP_CHAT_ENABLED | 1 | 群聊开关 |
| PROXY_URL | http://127.0.0.1:7890 | mihomo（NIM 出海专用） |
| NVIDIA_NIM_KEY | nvapi-y1IB...（用户 key） | 识图 |
| NIM_MODEL | nvidia/nemotron-3.5-super-vl-120b-a12b | 识图模型 |
| NIM_ENABLED | 1 | |
| DEEPSEEK_KEY | sk-03f9... | 兜底用 |
| DEEPSEEK_MODEL | deepseek-chat | |
| ANTIGRAVITY_BASE_URL | http://127.0.0.1:8045/v1 | 反代（.env 里为空则走默认） |
| ANTIGRAVITY_MODEL | gemini-3.8-flash | L1 主力（价格低可放心用；降级兜底仍 deepseek-chat） |
| ANTIGRAVITY_TIMEOUT_MS | 15000 | |
| MN_USER_ID | eagle | Mnemosyne 用户 |
| PI_CWD | /opt/FEAGLEwxbot | Pi 默认工作区 |
| PI_IDLE_TIMEOUT_MS | 180000 | 闲置即焚 |
| PI_MAX_OLD_SPACE | 256 | Pi V8 限 |
| DEBOUNCE_MS | 2500 | 入站防抖 |
| OUT_CHUNK_SIZE / MIN/MAX_DELAY | 800 / 800 / 1500 | 出站批次参数 |

## 2. Pi 配置（/root/.pi/agent/）

- `settings.json`：defaultModel = **gemini-3.8-flash**
- `models.json`：baseUrl http://127.0.0.1:8045/v1（Antigravity 反代）
- `mcp.json`：注册 mnemosyne + gateway-ctl 两个 stdio MCP

## 3. Antigravity 反代可用模型（8045，2026-10-29 实测）

gemini-3.1-flash-lite / 3.5-flash-lite / 3.8-flash(-low/medium/high/tiered) / 4-argon(-low/medium/high) / 3.1-flash-image；claude-opus-4-6 / 5-5 / sonnet-4-6 / 5-5；gpt-oss-120b。
识图支持：全部 gemini/claude 支持 images；gpt-oss 不支持。

## 4. MCP 工具（15 个）

- mnemosyne-mcp.mjs：记忆读/写/搜/checkpoint（写操作经 personaWriteAllowed 过滤）
- gateway-ctl-mcp.mjs：任务上下文 + **request_high_risk_exec**（通道A，POST /internal/confirm 130s 长连接）

## 5. 关键文件路径速查

| 路径 | 内容 |
|---|---|
| apps/gateway/src/index.ts | HTTP 端点路由 |
| apps/gateway/src/pipeline.ts | 四层漏斗主裁判 |
| apps/gateway/src/llm.ts | routeMessage/directChat/distillMemories/describeImage（Gemini→DeepSeek 降级链） |
| apps/gateway/src/control.ts | Control Plane 全部逻辑 |
| apps/gateway/src/pi-manager.ts | Pi 生命周期/金牌 grantOnce/killIfIdle |
| apps/gateway/src/db.ts | SQLite（懒加载 stmt） |
| apps/gateway/src/sanitizer.ts | 无损切分 |
| apps/bridge/src/gateway-client.js | ID 映射/拟人发送/串行队列 |

# 02 消息全链路

## 1. 入站（微信 → 网关）

1. 微信收到消息 → hermes-wxbridge(6192)
2. bridge 做**双向 ID 映射**（微信内部数字ID ↔ 原始 wxid），`apps/bridge/src/gateway-client.js` reverseEntity/forwardEntity
3. 同 chat **2.5s 防抖窗口**合并连发
4. POST `http://127.0.0.1:6185/inbound`，包体 `WxInboundPkt`：
   `{id, c(hat), u(ser), n(ame), at, t(ext), img?, q?, ts?, rid?, persona_id?}`（`src/protocol.ts`）
5. 网关 receiveInbound（`src/pipeline.ts`）依序：
   - 生成 req_id（rid）→ 审计双写（trace_logs + audit_full.jsonl）
   - 鉴权（ADMIN_WXIDS 白名单 / 群开关）
   - **审批优先拦截**：会话有 pending_confirm 时，只放行 Y/N 与 /approve /deny（isApproveCmd），其余提示等待
   - L0 硬指令（见 03 文档指令表）
   - 防抖窗口（DEBOUNCE_MS=2500）

## 2. L1 路由（`src/llm.ts` routeMessage）

- 输入：压缩历史 + Pi busy 状态；有图先 describeImage() 转成文字
- 主力 gemini-3.8-flash（10s 超时）→ DeepSeek 兜底（8s）→ 本地 fallback（busy?S:C）
- 输出 CompactRouteDecision：`{s, c, g[], q, r}`

| s | 含义 | 去向 |
|---|---|---|
| W | 用户话没说完，等 | 静默等待 |
| S | 追加引导运行中任务 | steer 插话给 busy 的 Pi |
| X | 要求打断 | 打断当前任务 |
| T | 闲聊寒暄 | **L1 直接生成回复 → L3，不唤醒 Pi** |
| C | 工程/复杂任务 | 唤醒 Pi（L2） |
| R | **额度保护拒单**：任务规模过大（海量文件/全库重构/多阶段超长工程/批量生成） | **不唤醒 Pi**，礼貌拒绝 + 建议拆解分批提交；trace 记 `refuse_quota_guard`（risk_flag=1） |

## 3. L2 执行（`src/pi-manager.ts` + `src/pipeline.ts` runTaskCore）

- Turn Lease：sessions.turn_lease=1 + piManager.busy() 双保险，防同会话并发
- 人设（任务级 persona_id 优先于会话级）→ sys_prompt 注入；engine_mode=l1_only 的人设根本不进 L2
- workspace 传递：`piManager.prompt(text, undefined, workspace !== defaultCwd ? workspace : undefined)`
- Pi 输出 → runReplay 可重放（通道B）
- 高危命令 → 通道A 挂起等 Y/N（见下）
- 完成后异步：史官 distillMemories 提炼记忆 → Mnemosyne

## 4. 通道A 高危审批（长连接挂起，Pi 不 abort）

```
Pi(Gemini) --request_high_risk_exec--> gateway-ctl-mcp
   → POST /internal/confirm (130s 长连接挂起)
   → 微信收到"Y/N?"提示
用户回 Y/N → pipeline 审批拦截层捕获 → resolveApproval()
   → 挂起的 confirm 返回 approved/denied → Pi 继续/放弃
```
实测 5 秒闭环（confirm_requested→Y→approved→pi_done）。
超时/熔断走通道B：hazard 存档，用户发 `/approve` 60s 内一次性金牌（grantOnce）重放。

## 5. L3 出站（网关 → 微信）

- `src/sanitizer.ts` buildOutboundBatch：无损直出切分（单条 ≤800 字符）
- 包体 `WxOutboundBatch`：`{c, at_u?, seq:[{t?, img?, d(elay)}]}`
- bridge 按 seq[].d 延迟逐条发送（拟人节奏），同 chat 串行队列
- 回复你微信。

## 6. Cron 链路（`src/control.ts` startScheduler）

15s 轮询 jobs 表 → nextRun 到点 → **伪造 WxInboundPkt**（`u:'system_cron'`，带 job 的 persona_id）→ 走主管线同一漏斗 → 出站发微信。一次性任务（`<毫秒>` 格式）触发后 auto disable。

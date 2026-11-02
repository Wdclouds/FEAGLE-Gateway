# 08 E2E 验收记录

> 每次验收追加用例：目的/步骤/证据（trace 摘要或命令输出）/结论。

## V4 — L1 升级 3.8-flash + R 额度保护拒单（2026-10-31）

**目的**：路由主力换 gemini-3.8-flash；巨量任务在 L1 被拒（不唤醒 Pi、不烧额度），普通任务不误杀。

| 用例 | 输入 | 证据（trace_logs） | 结论 |
|---|---|---|---|
| 巨量任务拒单 | "把所有项目全部文件读一遍…全部重构成TS…写测试覆盖每一行代码" | `L1 route s=R c=0.99 provider=gemini 5203ms` → `L1 refuse_quota_guard risk:1`，回复含规模说明+拆解建议；**无 L2 task_start** | ✅ |
| 普通任务不误杀 | "看看磁盘占用情况" | `L1 route s=C c=0.95 provider=gemini 4528ms` → 正常 L2 task_start | ✅ |
| 闲聊 | "今天降温了，注意保暖呀" | `L1 route s=T c=0.99 provider=gemini 3103ms` → chitchat_direct | ✅ |

注：首次测巨量任务时误入 secretary（l1_only）会话导致绕过路由——切回 architect 后通过。测试残留人设是已知坑。

## V3 — L1 切换 Gemini（2026-10-29）

**目的**：验证路由/直答主力走 Gemini 免费，DeepSeek 仅兜底。

| 用例 | 输入 | 证据（trace_logs） | 结论 |
|---|---|---|---|
| 工程路由 | "帮我看看服务器磁盘为啥快满了…" | `L1 route provider=gemini s=C c=0.9 g=engineering 1200ms` | ✅ |
| l1_only 直答 | /persona secretary 后发闲聊 | `L1 persona_direct persona=secretary 1916ms`（无 L2 task_start，零 Pi 进程） | ✅ |
| 降级链路 | 模拟反代故障 | gem 失败自动落 deepseek（切换前旧 trace provider=deepseek 861ms 佐证链路本身可用） | ✅（链路验证） |
| 模型质量 | 闲聊/工程各 2 发 | T 判定+直答文案正确；C 判定+检索词正确；JSON 纯直出 | ✅ |

延迟参考：flash-lite 1.5~2.2s / 3.8-flash-low 3.4~6.2s / deepseek 0.9s。

## V2 — Control Plane v2.0 四项验收（2026-10-28）

| 用例 | 证据 | 结论 |
|---|---|---|
| 审批闭环（Y 路径） | confirm_requested→Y→approved→pi_done 全链 trace，5 秒完成 | ✅ |
| 审批闭环（/approve 路径） | L0 hard_command cmd=approve 命中 | ✅ |
| 人设隔离 | secretary 发危险指令 → persona_direct，全程零 Pi 进程 | ✅ |
| Cron 事件化 | 晨报任务全管线跑通；一次性任务触发后 auto disable | ✅ |
| 安全性 | 诱导 Gemini 绕过审批被拒 | ✅（超预期） |
| 通道B 金牌重放 | 代码完整，未真实触发（Gemini 拒硬跑高危） | ⏸ 观察项 |

## V1 — 主管线打通（2026-10-26）

大号发微信 → wxid 抓取（wxid_nt3xb18o5uhl22 入白名单）→ 入站 → 路由 → Pi → 出站回微信全链路 ✅
视觉链路：红色测试图正确识别 ✅

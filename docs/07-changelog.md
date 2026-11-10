# 07 变更日志

> Agent 每次变更在此追加一行（最新在上）。格式：`- 日期: 变更 [@署名]`，重大变更附文件路径。

- 2026-11-10: 微信 8.0.79 图片发图链路全量修复：Bridge 改 base64 下发（跨机路径）、Agent 改 Binder 100k 分片由微信进程落盘（去 root）、停止 l1.v 上传字段改写（修 errCode:-7）、改用相册发图场景 `chatting_send_img` + `extra.a=2` 与原图 `compressType=1`（修接收端“已过期”/`up_task_ret=-10012`）；Agent 0.8.1/17 [@dsh]（apps/bridge/src/android-client.js, gateway-client.js, android-agent/.../BridgeForegroundService.java, WechatHook.java, Wechat8078Adapter.java）
- 2026-11-10: 新增 CDN 诊断开关 `debug.feagle.cdn`（默认关闭，避免 LSPosed 日志膨胀），并撤销 Agent 进程的 Magisk root 授权（图片链路已不依赖 root） [@dsh]

- 2026-11-02: 落地双轨混合上下文（方案 C：群内隔离 + 私聊穿透），重构复合 SessionKey，杜绝多群多人并发串台 [@hermes]（protocol.ts, pipeline.ts）
- 2026-11-02: 落地集中硬指令注册表（借鉴 AstrBot 架构，独立收敛在 `src/commands.ts`），纯 TS 原生执行，新增 `/mode`、`/block`（黑名单物理静默丢弃）、`/unblock`、`/sh`、`/sid` 等强执行力指令 [@hermes]（src/commands.ts, control.ts）
- 2026-11-02: 新增三大运行模式（`chat` 正常交互 / `sentry` 智能哨兵观测 / `mute` 彻底静音），哨兵模式实现群内静默、紧急故障私信 OP 报警、社交图谱与人际关系提炼入库 [@hermes]（pipeline.ts, llm.ts, control.ts）
- 2026-11-02: 落地里/表人设硬分权（表人设面向全员，里人设仅 OP 可见/可用，越权调用硬降级）+ L0 防提示词投毒/越狱硬防火墙（0 成本阻断） [@hermes]（control.ts, sanitizer.ts）
- 2026-11-02: Mnemosyne 记忆系统零侵入解耦，实现 7 天半衰期衰减与 30 天低分硬淘汰，Prompt 时序仲裁规则彻底排除过时记忆 [@hermes]（mnemosyne.ts, pipeline.ts）
- 2026-11-02: 解决校园网 2 台设备限制（部署 Gnirehtet USB 反向有线网络共享，免配额直连）；逆向三星 One UI 底层 MARs 数据库注入保活白名单，配置 USB 常亮免休眠解决 8.0.79 锁屏丢发信协程问题 [@hermes]（桌面批处理脚本, android-root）
- 2026-10-31: L1 路由模型升级 flash-lite → **gemini-3.8-flash**（价格低可放心用） [@human+@trae]（config.ts 默认值 + .env）
- 2026-10-31: 新增 **R 额度保护拒单**信号——路由器判定任务规模过大（海量文件/全库重构/批量生成）时不唤醒 Pi，礼貌拒绝并建议拆解分批；E2E 三连测通过（巨量任务 R 拒单 / 普通任务 C 不误杀 / 闲聊 T） [@human+@trae]（protocol.ts RouteSignal + llm.ts ROUTE_SYS/parseDecision + pipeline.ts case R）
- 2026-10-31: 文档勘误——01 拓扑图 wxbridge 命名说明（systemd 单元实为 hermes-wxbridge.service，历史遗留命名非杜撰）；清除正文 AstrBot 残留表述（仅变更日志保留历史记录）；清理 hermes-gateway.service 残尸单元 [@trae]

- 2026-10-29: L1 三处调用（路由/直答/史官）主力切 Gemini flash-lite，DeepSeek 降级兜底；E2E provider=gemini 1.2s 验证通过 [@trae]（src/llm.ts, src/config.ts）
- 2026-10-29: 发现并修复构建假成功陷阱（PATH 污染致 tsc 静默失败），运维手册固化 env 前缀 [@trae]
- 2026-10-28~29: Control Plane v2.0 全量落地并通过 4 项验收——5 表 Schema、两阶段 Y/N 审批（通道A E2E 5s 闭环）、Persona 引擎分流（secretary 零 Pi 进程）、Cron 事件化（晨报+一次性任务）、全量审计 req_id/source/risk_flag + jsonl 10MB 轮转 [@trae]（src/control.ts 新建 ~470行, pipeline.ts, index.ts, mcp/*）
- 2026-10-28: 修复审批拦截层吞 /approve、孤儿租约卡死、SQLite 懒加载崩溃、cron 人设降级（persona_id 任务级优先）等 4 个 bug [@trae]
- 2026-10-27: 视觉链路打通——NEMotron 识图（thinking:false），测试图目录 mkdir -p 修复 [@trae]
- 2026-10-27: NIM 模型大面积死亡排查，锁定 nemotron-3.5-super-vl-120b-a12b 唯一活口；拍板 NEMotron 只当眼睛 [@trae]
- 2026-10-26: 主管线全链路 E2E 打通（入站→路由→Pi→出站）；wxbridge 双向 ID 映射修复；用户 wxid 入白名单 [@trae]
- 2026-10-26: 清空 Mnemosyne 记忆库 2098 条（全量备份至 /opt/backups/mnemosyne-full-backup-20261026/） [@trae]
- 2026-10-25: 删除 AstrBot 及相关容器；确认 mihomo 7890 出海链路 [@trae]
- 2026-10-25: 资产盘点：发现 Mnemosyne(18010)/wxbridge/Antigravity 反代(8045) 等存量资产 [@trae]
- 2026-10-24: 项目启动，Pi-WeChat-Gateway 四层漏斗蓝图确立（内存红线 765MB/零容器） [@human+@trae]

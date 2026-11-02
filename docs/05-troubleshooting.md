# 05 故障排查与 Bug 档案

## 0. 快速分诊

| 症状 | 先查 | 常见根因 |
|---|---|---|
| 微信不回 | `systemctl status` 两个服务 / journalctl | bridge 掉线、平板微信离线 |
| 回复变慢/降级到 deepseek | trace provider 字段 / 8045 models | 反代挂、Gemini 超时 |
| 改代码无效果 | dist mtime / import dist 打印 | **构建假成功（见1）** |
| 新任务永远排队 | sessions.turn_lease | 孤儿租约（重启自愈已修，仍需确认） |
| /approve 没反应 | pending_confirm_id + 审批拦截层 | 被拦截层吞（已修） |
| 图片不识别 | /tmp/wx-gateway-img/ 目录 | 目录不存在（已修 mkdir -p） |

## 1. 🔴 构建假成功（最高频陷阱）

- **现象**：npm run build 显示 exit 0，但服务行为不变，`config.antigravity.model === undefined`
- **根因**：shell PATH 被 trae 环境污染，其 node/tsc 因 GLIBCXX 版本不匹配静默失败，dist 未产出新代码
- **修复**：构建/运行 node 一律加 `env -u LD_LIBRARY_PATH -u LD_PRELOAD PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
- **验证**：`import dist/config.js` 打印新字段非 undefined

## 2. Bug 档案（按修复时间）

| # | 问题 | 根因 | 修复 | 文件 |
|---|---|---|---|---|
| 1 | NIM llama 系全挂 | 停服/挂死107s | 唯一活口 nemotron-3.5-super-vl 当眼睛 | llm.ts |
| 2 | NEMotron 路由全判 W | 判断力差 | 路由主力换 DeepSeek→后换 Gemini | llm.ts |
| 3 | NEMotron 光思考不出结果 | 推理模型 600 token 全花 reasoning | `chat_template_kwargs:{thinking:false}` | llm.ts |
| 4 | 测试图写盘静默失败 | /tmp/wx-gateway-img/ 不存在 | mkdir -p | pipeline.ts |
| 5 | 启动 SQLite logic error 崩溃 | 模块加载时 prepare 含新列 SQL，migrate 在后 | 懒加载 getStmtTrace() | db.ts |
| 6 | cron 晨报被降级 | 会话残留 persona 覆盖任务人设 | WxInboundPkt 加 persona_id，任务级优先 | protocol.ts/pipeline.ts |
| 7 | /approve 被吞 | 审批拦截层只认 Y/N 其余 return | isApproveCmd 放行 | pipeline.ts |
| 8 | 重启后新任务永久 steer_queued | 孤儿 turn_lease=1 | initControlPlane 启动自愈清零 | control.ts |
| 9 | handleApprovalReply 空实现 | 写坏 | 重写 resolveApproval/hasPendingConfirm | control.ts |
| 10 | sqlite '-180' 语义误用 | 是天不是秒 | Date.now()-N*60*1000 相对计算 | 临时查询 |
| 11 | Gemini 切换后 provider 仍 deepseek | 构建1假成功 | 干净 PATH 重建 | 无代码变更 |

## 3. 已知未解决/观察项

- 通道B 金牌重放代码完整但从未真实触发（Gemini 太守规矩拒高危，属好事）
- 群聊 @ 机器人防串台：代码就绪，**用户一直没测**
- Antigravity 两个谷歌账号（kouhaiying77 / w15545178089）来源**待用户确认**
- 明早 9 点晨报 cron 生产首跑待观察

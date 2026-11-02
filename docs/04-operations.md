# 04 运维手册

## 1. 服务管理（systemd）

```bash
systemctl status|restart|stop pi-wx-gateway.service   # 网关
systemctl status|restart hermes-wxbridge.service      # 微信桥
journalctl -u pi-wx-gateway -n 50 --no-pager          # 网关日志
```
启动序列：initControlPlane()（迁移+自愈）→ wireCronToPipeline() → startScheduler()。

## 2. 构建与发布（⚠️ 必读陷阱）

```bash
cd /opt/FEAGLEwxbot/apps/gateway
env -u LD_LIBRARY_PATH -u LD_PRELOAD PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
systemctl restart pi-wx-gateway
```

**陷阱**：shell 默认 PATH 里 trae 的 node/tsc 会因 GLIBCXX 不匹配静默失败，`build exit: 0` 但 dist 没更新，服务跑旧代码且无报错。症状：改了代码行为不变。判定：对比 dist 文件 mtime 或直接 import dist/config.js 打印字段。**永远带 env 前缀构建**。

## 3. 内存监控（红线 765MB）

```bash
free -m                                   # 可用应 >800MB
ps aux | grep -E "dist/index|pi" | grep -v grep   # 网关 RSS 30~80M 正常；Pi 空闲应不存在（3min即焚）
```
Pi 回收：闲置 SIGTERM；`/cd` 切工作区时也会 killIfIdle。

## 4. 日志与审计

```bash
# 裁剪审计（SQLite）
node -e "..."   # 见下，或用 /audit 指令
# 全量审计（10MB 轮转）
tail -50 /opt/FEAGLEwxbot/apps/gateway/data/audit_full.jsonl
```
查 trace（注意 node 需要 env 前缀，同构建陷阱）：

```bash
cat > /tmp/q.js <<'EOF'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/opt/FEAGLEwxbot/apps/gateway/data/gateway.db');
for (const r of db.prepare("SELECT layer,event,detail,latency_ms FROM trace_logs ORDER BY ts DESC LIMIT 10").all())
  console.log(r.layer, '|', r.event, '|', String(r.detail).slice(0,200), '|', r.latency_ms+'ms');
EOF
env -u LD_LIBRARY_PATH -u LD_PRELOAD /usr/bin/node /tmp/q.js
```

## 5. 验证消息链路（无微信也能测）

```bash
curl -s -X POST http://127.0.0.1:6185/inbound -H "Content-Type: application/json" \
  -d '{"id":"test-1","c":"e2e_test_chat","u":"wxid_nt3xb18o5uhl22","n":"Eagle","at":1730000000,"t":"帮我看看磁盘","ts":1793207400}'
# ts 用 Date.now()/1000 级整数；trace 里看 provider 字段确认走了 gemini 还是 deepseek
```

## 6. 模型出口健康

```bash
curl -s http://127.0.0.1:8045/v1/models -H "Authorization: Bearer sk-853a7382bdef4d50acd0a01c62906b87" | head -c 300
# NIM 识图走 mihomo：curl -x http://127.0.0.1:7890 https://integrate.api.nvidia.com/v1/models -H "Authorization: Bearer nvapi-..."
```

## 7. 备份

- 记忆全量备份：`/opt/backups/mnemosyne-full-backup-20261026/mnemosyne.dump`（2098条，清空前留存）
- 网关数据：`data/gateway.db` + `data/audit_full.jsonl`（scp 拉走即可）
- 文档包：docs/ 本身是 git 仓库，push 到任意远端即备份

## 8. 重大运维记录

- 2026-10-26: 清空 Mnemosyne（备份 2098 条至 /opt/backups） [@trae]
- 2026-10-28: Control Plane v2.0 上线（5表+审批+cron） [@trae]
- 2026-10-29: L1 三处调用主力切 Gemini，DeepSeek 降级兜底 [@trae]

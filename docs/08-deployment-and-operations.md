# 08 - 生产部署与运维实战手册

> **版本**：v5.1 (Production Baseline)  
> **模块**：FEAGLE WxBot 运维与生产实战篇  
> **基准代码**：`apps/gateway` · `apps/bridge` · `apps/web` · ECS 生产环境编排  

---

## 1. 生产基础设施与拓扑基线

当前生产系统稳定运行于阿里云 ECS 服务器：
* **公网 IP 地址**：`39.97.255.91`；
* **操作系统版本**：Ubuntu 26.04 LTS (x86_64)；
* **Node.js 运行时**：v20.x / v22.x LTS；
* **生产代码根路径**：`/opt/FEAGLEwxbot/`；
* **系统守护进程**：Linux 原生 `systemd`。

---

## 2. Systemd 生产服务编排规格

系统核心功能由四大相互协同的 systemd 服务单元管理：

```text
/etc/systemd/system/
├── pi-wx-gateway.service       # 四层漏斗主网关 (Node.js, 内存硬限 320M)
├── hermes-wxbridge.service     # 微信协议桥接与控制台 (:6190, :6191, :6192)
├── antigravity-tools.service   # Google Gemini 多模态与生图代理 (:8045)
└── mnemosyne.service           # 语义记忆与人际图谱中枢 (:18010)
```

### 2.1 网关主服务配置 (`pi-wx-gateway.service`)
```ini
[Unit]
Description=FEAGLE Pi WeChat Gateway Service
After=network.target hermes-wxbridge.service antigravity-tools.service
Wants=hermes-wxbridge.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/FEAGLEwxbot/apps/gateway
EnvironmentFile=/opt/FEAGLEwxbot/.env
ExecStart=/usr/bin/node --max-old-space-size=320 dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 2.2 协议桥接服务配置 (`hermes-wxbridge.service`)
```ini
[Unit]
Description=FEAGLE Hermes WeChat Bridge & Web Console
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/FEAGLEwxbot/apps/bridge
EnvironmentFile=/opt/FEAGLEwxbot/.env
ExecStart=/usr/bin/node --max-old-space-size=256 src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

---

## 3. 全量环境变量配置字典 (`.env`)

所有微服务统一从项目根目录的 `/opt/FEAGLEwxbot/.env` 读取配置。各参数的业务定义如下：

| 配置键名 | 生产典型值 | 必填 | 作用与参数说明 |
|---|---|:---:|---|
| `TZ` | `Asia/Shanghai` | 是 | 系统主时区设置。 |
| `BOT_TIMEZONE` | `Asia/Shanghai` | 是 | 定时任务与打卡计算时区。 |
| `BOT_QUIET_HOURS` | `00:00-07:00` | 否 | 免打扰静默时段。在此区间内非紧急指令自动静音。 |
| `DASHBOARD_HOST_PORT` | `6190` | 是 | Web 控制台外部访问端口与反向代理监听端口。 |
| `ANDROID_WS_BIND_HOST` | `0.0.0.0` | 是 | Android 物理平板长连接绑定的监听地址。 |
| `ANDROID_WS_HOST_PORT` | `6191` | 是 | Android 物理平板 WebSocket 连接端口。 |
| `GATEWAY_PORT` | `6185` | 是 | 四层漏斗核心网关内部 REST/Inbound 监听端口。 |
| `GATEWAY_OUTBOUND_PORT` | `6192` | 是 | Bridge 接收网关待发批次的 HTTP 队列监听端口。 |
| `BRIDGE_OUT_URL` | `http://127.0.0.1:6192/gw/outbound` | 是 | 网关抛送出站消息批次的目标 URL。 |
| `ANTIGRAVITY_BASE_URL` | `http://127.0.0.1:8045/v1` | 是 | Gemini 账号池代理服务根地址。 |
| `ANTIGRAVITY_KEY` | `sk-853a7382b...` | 是 | 账号池访问令牌。 |
| `ANTIGRAVITY_MODEL` | `gemini-3.8-flash` | 是 | L1 意图路由与日常直答首选模型。 |
| `ANTIGRAVITY_TIMEOUT_MS` | `15000` | 否 | 上游模型请求超时时间（毫秒）。 |
| `MNEMOSYNE_BASE_URL` | `http://127.0.0.1:18010` | 是 | 记忆中枢 REST 端点。 |
| `BOT_USER_RATE_LIMIT` | `3` | 是 | 防风控：单用户在限流窗口内允许的最大消息数。 |
| `BOT_USER_RATE_WINDOW_MS` | `30000` | 是 | 防风控：单用户限流计算窗口（30秒）。 |
| `BOT_GROUP_REPLY_COOLDOWN_MS` | `5000` | 是 | 群聊回复冷却时间（5秒），杜绝刷屏。 |
| `OUT_CHUNK_SIZE` | `800` | 是 | 出站消息切片最大单条字符数。 |
| `OUT_MIN_DELAY` | `800` | 是 | 出站拟人化随机抖动延迟下限（毫秒）。 |
| `OUT_MAX_DELAY` | `1500` | 是 | 出站拟人化随机抖动延迟上限（毫秒）。 |

---

## 4. 生产常用运维与监控指令

### 4.1 服务生命周期管理
* **查看核心服务运行状态**：
  ```bash
  systemctl status pi-wx-gateway.service hermes-wxbridge.service --no-pager
  ```
* **一键平滑重启网关与桥接**：
  ```bash
  systemctl restart pi-wx-gateway.service hermes-wxbridge.service
  ```
* **单重载 Web 控制台静态资源**：
  ```bash
  systemctl reload hermes-wxbridge.service
  ```

### 4.2 实时日志跟踪与排错
* **实时追踪网关流水（L0/L1/L2 决策）**：
  ```bash
  journalctl -u pi-wx-gateway.service -f -n 50
  ```
* **实时追踪微信通信与发信日志**：
  ```bash
  journalctl -u hermes-wxbridge.service -f -n 50
  ```
* **联合追踪全链路实时日志**：
  ```bash
  journalctl -u pi-wx-gateway.service -u hermes-wxbridge.service -f
  ```

### 4.3 网络与 API 快速验证
* **测试网关内置工具集列表与反向代理**：
  ```bash
  curl -s http://127.0.0.1:6190/api/tools | jq .
  ```
* **测试网关沙箱列表**：
  ```bash
  curl -s http://127.0.0.1:6190/api/channels | jq .
  ```
* **测试网关内部健康状态**：
  ```bash
  curl -s http://127.0.0.1:6185/health | jq .
  ```
* **测试出站端口连通性**：
  ```bash
  curl -s -X POST http://127.0.0.1:6192/gw/outbound \
    -H "Content-Type: application/json" \
    -d '{"c":"test","seq":[]}'
  ```

---

## 5. 前端现代化工程增量构建与发布

当对 `apps/web` 下的 Vue 3 组件或样式完成修改后，按以下标准流程执行编译发布：

```bash
# 1. 切换至前端工程根目录
cd /opt/FEAGLEwxbot/apps/web

# 2. 执行强类型检查并生成编译产物 (输出至 apps/bridge/src/public)
npm run build

# 3. 验证编译产物存在
ls -la ../bridge/src/public/assets

# 4. 平滑重载桥接静态托管
systemctl reload hermes-wxbridge.service
```

---

## 6. 常见故障排查与应急预案 (Runbook)

### 故障 1：平板显示离线，Web 控制台亮起琥珀色呼吸灯
* **排查步骤**：
  1. 检查物理平板是否因电量耗尽关机或处于休眠断网状态；
  2. 检查平板屏幕上 Android Agent 前台通知是否存活；
  3. 执行 `netstat -tlpn | grep 6191`，确认服务器端 6191 端口正常监听；
  4. 若依然无法建连，在 Web 控制台右上角打开“设备连接向导”，重新扫码配对。

### 故障 2：微信能收到提问，但机器人无回复且无错误提示
* **排查步骤**：
  1. 查看日志 `journalctl -u pi-wx-gateway.service -n 50`；
  2. **检查是否命中 L0 模式拦截**：查看该群是否被设置为 `/mode mute`（静默模式）或 `/mode sentry`（哨兵模式）；
  3. **检查提问是否包含 `@机器人`**：群聊非硬指令提问必须提及机器人昵称；
  4. **检查是否触发额度保护 (R)**：若用户提问篇幅过长，网关会在日志中打印 `[L1:QuotaGuard] refused`；
  5. **检查 Antigravity 代理状态**：执行 `curl http://127.0.0.1:8045/health` 检查 Gemini 上游通道是否存活。

### 故障 3：大模型生图成功保存但微信未发出图片
* **排查步骤**：
  1. 查看 `apps/gateway/data/generated-images/` 是否已生成对应 PNG 文件；
  2. 检查 `config.bridgeOutUrl` 是否正确指向 `http://127.0.0.1:6192/gw/outbound`；
  3. 检查 Bridge 服务日志是否出现发图超时或平板 WebSocket 断线重连告警。

# 02 - 全栈系统拓扑与网络协议

> **版本**：v5.1 (Production Baseline)  
> **模块**：FEAGLE WxBot 架构与通信篇  
> **基准代码**：`apps/gateway` · `apps/bridge` · `apps/web` · `apps/android-agent`  

---

## 1. 系统全景网络拓扑图

FEAGLE WxBot 架构由移动物理端、协议中继桥（Bridge）、核心网关（Gateway）、Web 控制台与上游模型代理协同构成：

```text
               ┌────────────────────────────────────────────────────────┐
               │         物理移动端 (Samsung SM-X200 Tablet)            │
               │  WeChat 8.0.78 (Official) + LSPosed / Vector Module    │
               └──────────────────────────┬─────────────────────────────┘
                                          │ WebSocket (:6191/android 加密流)
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ apps/bridge (Hermes 微信协议中继与管理中枢)                                    │
│                                                                                │
│ ├─ DashboardServer (:6190 外部唯一管理后台入口)                                 │
│ │   ├─ 托管 Vue 3 生产构建产物 (index.html, assets, downloads)                │
│ │   ├─ SSE 流: /events (状态快照) 与 /logs (实时终端日志流)                   │
│ │   ├─ 原生流式反向代理:                                                      │
│ │   │   ├─ /api/channels* ──> http://127.0.0.1:6185 (Gateway REST)            │
│ │   │   ├─ /api/tools     ──> http://127.0.0.1:6185 (Gateway Tools)           │
│ │   │   └─ /gw/outbound   ──> http://127.0.0.1:6192 (Bridge GatewayClient)    │
│ │                                                                              │
│ ├─ AndroidWechatClient (:6191 WebSocket 物理终端服务)                           │
│ │   ├─ 扫码免密配对握手 (PairingStore / 动态随机 Ticket / Token 校验)          │
│ │   ├─ 进站解析: 文本、高清图片、HEVC(wxgf)转码为标准 JPEG                     │
│ │   └─ 双向 ID 映射 (SQLite: data/wechat/mapping.sqlite: wxid ⇄ 数字 ID)       │
│ │                                                                              │
│ └─ GatewayClient (:6192 HTTP 出站队列)                                         │
│     ├─ 接收待发批次: POST /gw/outbound (支持文本 item.t 与本地图片 item.img)   │
│     └─ 同会话串行化分片排队，注入拟人化随机等待延迟 (800~1500ms)               │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ HTTP POST /inbound (入站投递)
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ apps/gateway (Pi-Wx-Gateway 四层漏斗调度中枢)                                  │
│                                                                                │
│ ├─ 端口监听: 127.0.0.1:6185 (REST & Inbound Pipeline)                          │
│ ├─ 四层漏斗引擎:                                                               │
│ │   ├─ L0: commands.ts (硬指令集), sanitizer.ts (防提示词投毒/越狱)            │
│ │   ├─ L1: llm.ts (Gemini 3.8 意图分流/直答/额度熔断/15分钟衰减环)            │
│ │   ├─ L2: pi-manager.ts (Pi 子进程工程任务, 3分钟闲置自动回收)                │
│ │   └─ L3: dialog.ts (微信原生引用回复气泡封装), sanitizer.ts (脱敏与分片)    │
│ ├─ 控制面 (control.ts): 沙箱、人设、Cron 调度、高危审批挂起、成员画像          │
│ └─ 工具注册表 (tools.ts): 网页搜索、定时提醒、记忆宫殿、Gemini Imagen 生图直发 │
└───────────────────────┬───────────────────────────────┬────────────────────────┘
                        │                               │
                        ▼                               ▼
┌────────────────────────────────────────┐ ┌────────────────────────────────────┐
│ 上游模型代理 (Antigravity Tools)       │ │ 长期语义记忆 (Mnemosyne 中枢)      │
│ 监听: 127.0.0.1:8045                   │ │ 监听: 127.0.0.1:18010              │
│ ├─ POST /v1/chat/completions           │ │ ├─ 语义向量存储与检索              │
│ │  (Google Gemini 3.8 Flash 对话模型)  │ │ ├─ 自动化社交图谱构建              │
│ └─ POST /v1/images/generations         │ │ └─ Git 工作区环境快照存取          │
│    (Google Gemini 3.1 Flash Image 生图)│ └────────────────────────────────────┘
└────────────────────────────────────────┘
```

---

## 2. 核心端口与协议矩阵

系统严格遵守**“最小公网暴露”**的安全原则。除 Web 管理后台（`:6190`）与 Android 物理接入（`:6191`）外，所有微服务均强制绑定在 `127.0.0.1` 本机回环地址：

| 服务模块 | 监听地址与端口 | 传输层协议 | 网络边界 | 核心功能与报文规范 |
|---|---|---|---|---|
| **Web 管理后台 (Dashboard)** | `0.0.0.0:6190` | HTTP / SSE | 外部授权访问 | 托管 Vue 3 SPA 应用；推送 SSE 实时状态与日志；承接透明反向代理 |
| **Android Hook (Bridge)** | `0.0.0.0:6191` | WebSocket (WSS) | 凭证校验访问 | 物理平板端微信 Hook 报文长连接传输；二进制分片流与心跳保活 |
| **Bridge 出站服务 (GatewayClient)** | `127.0.0.1:6192` | HTTP REST | 本机回环 (内网) | 接收网关待发消息批次，同会话串行拟人化分片推向微信客户端 |
| **网关中枢 (Gateway REST)** | `127.0.0.1:6185` | HTTP REST | 本机回环 (内网) | 接收消息入站请求；提供社群沙箱、工具库、成员画像的管理接口 |
| **大模型账号池反代 (Antigravity)** | `127.0.0.1:8045` | HTTP REST (OpenAI 兼容) | 本机回环 (内网) | 代理 Google Gemini 多模态与 Imagen 生图接口，实现额度管理与鉴权 |
| **记忆中枢 (Mnemosyne)** | `127.0.0.1:18010` | HTTP REST | 本机回环 (内网) | 提供长期记忆语义向量检索、社群人际图谱关系与任务快照存储 |

---

## 3. 单端口 (6190) 原生透明反向代理架构

为了彻底消除跨域（CORS）限制，避免在服务器防火墙上开凿多个公网端口，`apps/bridge/src/dashboard.js` 内部实现了一套零外部依赖的原生流式反向代理。

### 3.1 代理路由分发机制

```text
[浏览器前端请求] ──> http://server-ip:6190/api/channels/19827364501@chatroom
                                │
                                ▼
┌────────────────────────────────────────────────────────┐
│ DashboardServer.handle() 路由裁决器                    │
│                                                        │
│ • 若命中 /api/channels* 或 /api/tools:                │
│   ──> 目标: 127.0.0.1:6185 (Gateway REST)              │
│                                                        │
│ • 若命中 /gw/outbound:                                 │
│   ──> 目标: 127.0.0.1:6192 (Bridge GatewayClient)      │
│                                                        │
│ • 若命中 /events 或 /logs:                             │
│   ──> 本地 SSE 流式管道直出                            │
│                                                        │
│ • 其余静态文件 (HTML/JS/CSS/APK):                      │
│   ──> 直接返回 apps/bridge/src/public/ 磁盘文件        │
└────────────────────────────────────────────────────────┘
```

### 3.2 生产代码实现考量
1. **Host 头重写**：代理客户端自动将请求头中的 `Host` 字段重写为 `127.0.0.1:<targetPort>`，确保后端安全校验通过。
2. **双向流式管道 (Full Streaming)**：采用 `request.pipe(proxyReq)` 与 `proxyRes.pipe(response)`，数据流即时穿透，不消耗额外 Node.js Buffer 内存。
3. **故障优雅降级**：若网关服务或出站队列处于重启或离线状态，代理器自动返回带详细错误原因的 JSON 格式 502 Bad Gateway 响应，控制台据此展示断网提示，杜绝界面出现未捕获异常白屏。

---

## 4. 端到端数据流向与报文契约

### 4.1 消息进站流向 (Inbound Flow)
1. **微信客户端**：群友发送一条文本或图片消息；
2. **Android Hook**：底层 SQLite 写入事件被截获，提取真实群 ID、发件人 wxid、消息内容与时间戳；
3. **Android Agent**：将数据组装为 `feagle.android.v1` 协议包，经由 WebSocket (`:6191`) 投递至 Bridge；
4. **Bridge**：完成数字映射校验与媒体转码，以 HTTP POST 请求发送至 `http://127.0.0.1:6185/inbound`；
5. **Gateway**：经过去重防抖（2.5 秒滑动窗口）后，进入四层漏斗流水线。

### 4.2 消息出站流向 (Outbound Flow)
1. **Gateway**：模型生成回复后，经 L3 出站切片器包装为出站批次对象：
   ```json
   {
     "c": "19827364501@chatroom",
     "seq": [
       { "t": "这是第一段解答...", "d": 300 },
       { "img": "/opt/FEAGLEwxbot/apps/gateway/data/generated-images/gen-12345.png", "d": 500 }
     ]
   }
   ```
2. **Bridge 出站服务 (`:6192`)**：接收批次报文，同群聊排队，并在分片之间注入 800ms~1500ms 随机抖动；
3. **WebSocket 下发**：向平板端推发原生发信指令（`SEND_TEXT` / `SEND_IMAGE`）；
4. **微信发信**：平板调用微信原生接口将消息发送至群聊中。

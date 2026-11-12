# 04 - 工具体系与技能热拔插规范

> **版本**：v5.1 (Production Baseline)  
> **模块**：FEAGLE WxBot 工具与技能插件篇  
> **基准代码**：`apps/gateway/src/tools.ts` · `commands.ts` · `control.ts` · `pipeline.ts`  

---

## 1. 工具 (Tool) 与 技能 (Skill) 的概念辨析

为了建立严密的软件工程规范，FEAGLE WxBot 对“功能/工具”与“技能/插件”进行了严格的层级界定：

```text
┌────────────────────────────────────────────────────────┐
│ 复合技能 / 插件扩展包 (Skill / Plugin)                 │
│                                                        │
│ • 拥有独立元数据清单 (manifest.json)                   │
│ • 注入专属业务 System Prompt (如专属画师/架构师设定)   │
│ • 注册专属 L0 用户确定性硬指令 (如 /draw, /render)      │
│ • 封装若干微观原子工具 (Tools)                         │
└──────────────────────────┬─────────────────────────────┘
                           │ 包含并驱动
                           ▼
┌────────────────────────────────────────────────────────┐
│ 原子工具 (Tool / Function Calling)                     │
│                                                        │
│ • 大模型在思考链中按需调用的执行单元                   │
│ • 强类型 JSON Schema 参数输入                          │
│ • 返回确定性纯文本或副作用（如出站发图、写库）         │
└────────────────────────────────────────────────────────┘
```

* **原子工具 (Tool)**：大模型自主判断并调用的单一能力，如“联网搜索一下当前气温”、“存入一条备忘”。模型根据工具定义生成参数，网关执行后将结果反馈给模型生成最终回答。
* **复合技能 (Skill)**：一个独立打包的业务套件（未来支持从 GitHub 或私有 npm 仓库动态拉取）。一个 Skill 可以挂载特定领域提示词、包含一个或多个原子工具，并且可以向网关注册专属的**L0 确定性硬指令（例如 `/draw`）**，让用户既能通过大模型自然语言驱动，也能通过前缀指令精确触发。

---

## 2. 四大核心内置工具规格与执行链路

网关当前默认内置 4 款全局系统级工具。这些工具受社群沙箱的工具白名单严格治理，全局受保护不可被非法注销。

### 2.1 实时联网搜索 (`web_search`)
* **设计目标**：打破大模型知识库截止时间限制，实时检索最新新闻、股票、技术文档或事实核验。
* **参数 Schema**：
  ```json
  {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "要搜索的关键词或具体问题" }
    },
    "required": ["query"]
  }
  ```
* **实现精粹**：
  - 通过 Bing 实时搜索获取 Top 5 权威网页；
  - 内置 `decodeHtmlEntities` 实体净化算法，自动将 `&amp;`、`&quot;`、`&nbsp;`、`&#039;` 等乱码符号解码为纯净文本；
  - 自动剥离 HTML 冗余标签，将网页标题、正文摘要与原始 URL 拼接后反馈给大模型归纳总结。

### 2.2 社群与个人日程定时提醒 (`group_remind`)
* **设计目标**：支持群友通过自然语言设定倒计时或定时任务，到期自动在群内或私聊中 `@发件人` 提醒。
* **参数 Schema**：
  ```json
  {
    "type": "object",
    "properties": {
      "time": { "type": "string", "description": "提醒时间（支持相对时间如10m/30分钟后，或时间点如15:30）" },
      "content": { "type": "string", "description": "提醒具体内容" },
      "target": { "type": "string", "description": "被提醒人昵称或wxid（可选）" }
    },
    "required": ["time", "content"]
  }
  ```
* **时间解析器 (`parseReminderTime`)**：
  - 相对时间：自动解析 `10m`, `30s`, `2h`, `15分钟后`, `1小时后`；
  - 当日时刻：自动解析 `15:30`, `09:00`（若当前时刻已过，自动顺延推算至次日同一时间）；
  - 绝对时间：自动解析 `2026-11-15 10:00`；
  - 解析完成后向 SQLite 数据库的 `jobs` 表插入任务，由网关后台的毫秒级定时器在到期时唤醒出站流水线。

### 2.3 记忆宫殿备忘录 (`palace_memo`)
* **设计目标**：实现群专属知识、技术方案、群友习惯与踩坑记录的持久化存取。
* **参数 Schema**：
  ```json
  {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["save", "search"], "description": "save(归档) 或 search(检索)" },
      "content": { "type": "string", "description": "备忘内容或搜索关键词" },
      "category": { "type": "string", "enum": ["worklog", "knowledge", "preference", "project", "pitfall"] }
    },
    "required": ["action", "content"]
  }
  ```
* **双轨容灾机制**：
  - 优先调用 `Mnemosyne:18010` 语义向量数据库进行高维检索；
  - 若记忆中枢离线，自动无缝降级到当前群沙箱本地物理文件 `data/channels/<chatId>/memos.json`，保留最近 50 条本地备忘，确保离线高可用。

### 2.4 大模型生图与微信发送闭环 (`generate_image`)
* **设计目标**：将大模型绘图能力彻底接入微信生态，支持群友通过描述生成高清图片并直接发回当前微信群。
* **参数 Schema**：
  ```json
  {
    "type": "object",
    "properties": {
      "prompt": { "type": "string", "description": "画面构图、主体、光影、色彩与质感的详细描述" },
      "aspect_ratio": { "type": "string", "enum": ["1:1", "3:4", "4:3", "9:16", "16:9"], "description": "宽高比" }
    },
    "required": ["prompt"]
  }
  ```
* **全闭环执行链路**：
  ```text
  [用户在微信提问: "画一只赛博朋克猫咪"]
                    │
                    ▼
  [L1 大模型触发 Function Call: generate_image]
                    │
                    ▼
  [请求 Antigravity Imagen API: POST :8045/v1/images/generations]
                    │ (接收 1.3MB base64 图像数据)
                    ▼
  [本地磁盘持久化落盘: data/generated-images/gen-<ts>-<rand>.png]
                    │
                    ▼
  [构建微信出站批次，直推 Bridge :6192 出站队列]
                    │ (batch = { c: chatId, seq: [{ img: filePath, d: 300 }] })
                    ▼
  [Bridge 通过 WebSocket 流式分片推送至 Android 物理平板发信]
                    │
                    ▼
  [网关向大模型返回成功结果，模型补充自然语言说明，图文连贯闭环]
  ```
  - **内存防护设计**：避免在 Node.js 进程间传递巨型 Base64 字符串引爆内存，生成图第一时间落地为物理文件并交由 Bridge 流式推送，兼顾极速与稳定性。

---

## 3. 动态技能热拔插与硬指令零残留注销规范

随着系统未来接入外部 GitHub Skill 或插件包，很多技能会自带特定前缀的硬指令（例如 `/draw`、`/review`）。为确保**“装上即用、关掉即焚、源头零残留”**，必须遵守以下生命周期标准：

### 3.1 带有权属标记的指令定义 (`DynamicCommandDef`)
在注册任何硬指令时，必须显式附加 `skillId` 与 `sourceType` 权属元数据：

```typescript
export interface DynamicCommandDef {
  name: string;           // 指令名，如 "/draw"
  description: string;    // 提示说明
  skillId: string;        // 所属 Skill 唯一标识符，如 "skill-sd-painter"
  sourceType: 'builtin' | 'external_skill';
  handler: (args: string[], ctx: CommandContext) => Promise<string | void>;
}
```

### 3.2 动态热拔插三阶段规范

```text
[外部 GitHub 技能 / 插件包]
            │ 声明: manifest.json
            ▼
┌────────────────────────────────────────────────────────┐
│ 技能生命周期管理器 (Skill Lifecycle Manager)           │
│                                                        │
│ 1. 挂载阶段 (Mount):                                   │
│    • 校验命名空间，严禁覆盖系统保留指令 (/help, /op...)│
│    • 向 HARD_COMMANDS 注册带有 skillId 的动态指令      │
│    • 向 ToolRegistry 注册包含的原子工具                │
│    • 广播给 Web 控制台工具列表刷新                    │
│                                                        │
│ 2. 执行期隔离 (Runtime Sandbox Check):                 │
│    • 用户在群内敲击指令或大模型 Function Call 时:      │
│    • 网关核验当前群 tools.json 是否显式包含该 Skill    │
│    • 未授权群聊即使敲指令也会被 L0 规则优雅拦截        │
│                                                        │
│ 3. 卸载/停用阶段 (Atomic Purge 零残留注销):            │
│    • 遍历 HARD_COMMANDS 字典，原子级删除所有           │
│      cmd.skillId === targetSkillId 的键                │
│    • 遍历 ToolRegistry，注销该 Skill 下的所有 Tools    │
│    • 释放模块 require / import 缓存引用，触发 GC       │
│    • 终态: 再次输入指令立即返回"未知指令"，            │
│      内存无任何遗留事件监听或未释放闭包                │
└────────────────────────────────────────────────────────┘
```

### 3.3 保留字与冲突防御铁律
1. **系统保留字保护**：任何外部技能禁止注册与系统内置指令冲突的名称（包括 `/help`、`/sid`、`/stats`、`/mode`、`/block`、`/op`、`/cron`、`/save`、`/load`、`/cd`、`/approve`、`/deny` 等）；
2. **前缀命名空间防冲突**：外部复合技能推荐采用命名空间前缀（如 `/skill_name:action` 或 `/draw`），在安装时自动执行重名冲突检测；
3. **沙箱白名单双重加锁**：即便 Skill 已在全局挂载，群聊沙箱若未勾选该能力，该群的任何成员输入该指令均不会穿透到底层逻辑。

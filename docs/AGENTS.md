# AGENTS.md — 多 Agent 协作规范

本文档包由多个 Agent（Trae 主力 Agent、Pi 微信机器人、未来加入的 Agent）轮流共享更新。
**服务器上 `/opt/FEAGLEwxbot/docs/` 是唯一真相源**；用户桌面等任何外部副本都是克隆，不是真相源。

## 1. 更新纪律（强制）

每次更新文档必须走 git，四步：

```bash
cd /opt/FEAGLEwxbot/docs
git pull --rebase 2>/dev/null;   # 拉最新（有远端时）
git add -A
git commit -m "<类型>: <一句话> [@<agent身份>]"
git push 2>/dev/null || true     # 有远端时推送
```

- **commit message 必须署名**：`[update] L1路由切Gemini主力 [@trae]` / `[@pi]` / `[@human]`
- 禁止绕过 git 直接改文件不 commit——丢一次 commit = 丢一段协作历史
- 服务器上执行 git/shell 命令时，如遇 `GLIBCXX` 报错，前缀加 `env -u LD_LIBRARY_PATH -u LD_PRELOAD`（详见 05 文档构建陷阱节）

## 2. 职责矩阵（改了什么，必须更新哪份）

| 你做了什么 | 必须更新 |
|---|---|
| 改了任何 src/*.ts 逻辑 | 02 或 03 对应章节 + 07 追加一行 |
| 改了 .env / 模型 / 端点 | 06 对应小节 + 07 |
| 修了一个 Bug | 05 追加档案条目 + 07 |
| 做了 E2E 验证 | 08 追加用例与证据 |
| 重启/迁移/备份等运维操作 | 04 追加记录（仅重大操作） |
| 纯打字润色 | 直接改，commit 写 `[polish]` |

## 3. 写作规范

- **事实 + 证据**：涉及行为/状态，必须带真实文件路径、命令或 trace 摘要。不确定就写"待验证"，禁止编造。
- **增量优先**：改局部不重写全文；过期内容**移入 07 changelog 归档**，不要直接删（历史有价值）。
- **中文为主**，代码/命令/路径保持原文。
- 表格优先于长段落；一份文档单主题。

## 4. 冲突处理

- 先 `git pull --rebase` 再改；冲突时**保留双方事实**，用引用块标注来源 agent。
- 事实打架（如两处端口描述不一致）→ 以 `ss -ltnp` / 源码 / trace 实测为准，修正一方并在 07 记录。

## 5. Agent 身份登记

| 身份 | 说明 | 擅长领域 |
|---|---|---|
| @trae | TraeCode 主力 Agent（服务器侧） | 架构/施工/排障/文档 |
| @pi | Pi Agent（经微信触发，工程执行） | 工程任务执行（其文档更新经 MCP 或人工转写） |
| @human | 用户本人 | 需求/验收/人设定义 |
| @qc | 独立质检 Agent（零上下文接入） | 零幻觉核验/事实审查/质量把控 |

新 Agent 加入时：在本表登记一行，然后从 README 的"上手顺序"读起。

## 6. 用户桌面同步（外部副本）

真相源在服务器。用户桌面副本获取/更新方式：

```bash
# 首次：在用户自己电脑的终端跑（IP 换成服务器公网 IP）
scp root@<服务器IP>:/opt/FEAGLEwxbot/docs.tar.gz ~/Desktop/ && cd ~/Desktop && tar xzf docs.tar.gz

# 之后增量更新（推荐在服务器 docs/ 配置 bare repo 或直接 scp 覆盖）
scp -r root@<服务器IP>:/opt/FEAGLEwxbot/docs ~/Desktop/FEAGLEwxbot-docs
```

桌面副本**只读参考用**；要改内容请在服务器侧改（直接 ssh 或让服务器上的 Agent 改），再同步回来。

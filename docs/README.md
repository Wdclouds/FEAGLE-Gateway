# FEAGLE WxBot 文档中心 (Documentation Hub)

> **版本**：v5.1 (Production Baseline)  
> **基准代码**：`apps/gateway` · `apps/bridge` · `apps/web` · `apps/android-agent`  
> **更新时间**：2026-11-12  
> **维护状态**：生产环境现役基线文档（基于实际代码库严格核对编制）

---

## 欢迎查阅 FEAGLE 微信机器人全栈工程与系统规格文档

FEAGLE WxBot 是一套面向企业社群治理、大模型多模态交互与智能体协同执行的**物理级安全隔离微信机器人中枢系统**。系统通过真实三星物理平板（Android 14 + LSPosed Hook）接管官方微信消息收发，由 Node.js 四层漏斗网关进行意图路由、规则防御与会话沙箱隔离，并依托 Vue 3 + TypeScript 现代化控制台提供实时监控与治理。

为了方便查阅与工程落地，本套文档采用**模块化分层编排**，从宏观系统介绍、全栈物理拓扑，逐步深入至网关算法、工具与技能热拔插、社群物理沙箱、移动端底层拦截、Web控制台以及生产运维指南。

---

## 📚 核心文档目录与导航

| 编号 | 文档名称 | 核心内容摘要 |
|:---:|---|---|
| **01** | [项目定位与系统愿景](01-overview.md) | 传统微信机器人三大死穴与破局点、五大核心设计哲学、系统能力边界与核心特性一览 |
| **02** | [全栈系统拓扑与网络协议](02-architecture-and-topology.md) | 物理硬件与微服务完整网络拓扑图、端口与协议矩阵、单端口 (6190) 原生透明反代架构设计 |
| **03** | [四层漏斗网关与大模型引擎](03-four-layer-funnel-gateway.md) | L0 规则硬指令集、L1 语义路由与额度熔断保护 (R)、L2 单例 Pi 任务调度、L3 拟人防风控出站、15分钟自然衰减环与群聊背景感知 |
| **04** | [工具体系与技能热拔插规范](04-tools-and-skill-ecosystem.md) | 4 大核心内置工具（网页搜索、定时提醒、记忆宫殿、Imagen 生图与微信直发）、Tool vs Skill 辨析、硬指令生命周期与零残留原子级注销 |
| **05** | [社群物理沙箱与成员画像](05-channel-sandbox-and-profiles.md) | `data/channels/<chatId>/` 物理隔离目录设计、微信真实群名实时解析与双层呈现、群成员画像与标签自动化沉淀及 Prompt 动态注入 |
| **06** | [Web 统一管理控制台规格](06-web-management-console.md) | Vue 3.5 + TypeScript 5.6 严格模式工程、OLED 纯黑与高亮双模式、5 大核心业务视图、终端日志流与扫码免密配对向导 |
| **07** | [移动硬件拦截与协议桥接](07-android-hardware-hook.md) | Samsung SM-X200 Android 14 真机环境基线、WeChat 8.0.78 LSPosed Hook 拦截、WebSocket 加密传输、免密扫码配对与大图流式防阻塞 |
| **08** | [生产部署与运维实战手册](08-deployment-and-operations.md) | 阿里云 ECS Ubuntu 26.04 生产基线、systemd 守护进程编排、全量 `.env` 环境变量配置字典、常用运维排障指令与紧急预案 |

---

## 快速入口与完整汇总

* **全量单文件规格书**：若您希望在单一长文档中检索全部内容，请直接查阅 [RPD_FULLSTACK_SPEC.md](RPD_FULLSTACK_SPEC.md)。
* **在线仓库查阅**：GitHub 地址 [https://github.com/Wdclouds/FEAGLE-Gateway/tree/main/docs](https://github.com/Wdclouds/FEAGLE-Gateway/tree/main/docs)。

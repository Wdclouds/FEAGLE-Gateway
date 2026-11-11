import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { addJob, getPersona, getSession } from './control.js';
import { remember, semanticSearch } from './mnemosyne.js';

export interface ToolContext {
  chatId: string;
  senderWxid: string;
  senderName: string;
  isGroup: boolean;
  isAdmin: boolean;
}

export interface GatewayTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}

// ============ HTML 实体解码辅助函数 ============
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&ensp;|&emsp;/g, ' ')
    .replace(/&#0183;|&middot;/g, '·')
    .replace(/&#174;|&reg;/g, '®')
    .replace(/&nbsp;/g, ' ');
}

// ============ 核心工具 1：联网搜索 (web_search) ============
export async function searchBing(
  query: string,
  maxResults = 5
): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
      signal: ctl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = [...html.matchAll(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g)];
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    for (const m of matches.slice(0, maxResults)) {
      const block = m[1];
      const titleM = block.match(/<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
      const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (titleM) {
        const title = decodeHtmlEntities(titleM[2].replace(/<[^>]+>/g, '').trim());
        const snippet = snippetM ? decodeHtmlEntities(snippetM[1].replace(/<[^>]+>/g, '').trim()) : '';
        const url = titleM[1];
        if (title) results.push({ title, snippet, url });
      }
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const webSearchTool: GatewayTool = {
  name: 'web_search',
  description: '联网搜索实时信息、最新资讯、新闻或事实核验。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要搜索的关键词或具体问题' },
    },
    required: ['query'],
  },
  execute: async (args: { query: string }) => {
    const q = (args.query || '').trim();
    if (!q) return '请输入有效的搜索关键词。';
    const results = await searchBing(q, 5);
    if (!results.length) return `未搜索到与“${q}”相关的网页信息。`;
    return [
      `搜索“${q}”的实时结果：`,
      ...results.map((r, i) => `${i + 1}. 【${r.title}】\n   摘要: ${r.snippet}\n   链接: ${r.url}`),
    ].join('\n');
  },
};

// ============ 核心工具 2：群/个人日程与定时提醒 (group_remind) ============
export function parseReminderTime(timeStr: string): { runAt: number; cronExpr: string | null } | null {
  const s = timeStr.trim();
  const now = Date.now();

  // 1. 相对时间：如 10m, 15min, 30s, 2h, 10分钟后, 1小时后
  const relSec = s.match(/^(\d+)\s*(s|sec|second|seconds|秒)(?:钟)?(?:后)?$/i);
  if (relSec) return { runAt: now + Number(relSec[1]) * 1000, cronExpr: null };

  const relMin = s.match(/^(\d+)\s*(m|min|minute|minutes|分|分钟)(?:后)?$/i);
  if (relMin) return { runAt: now + Number(relMin[1]) * 60_000, cronExpr: null };

  const relHour = s.match(/^(\d+)\s*(h|hour|hours|小时)(?:后)?$/i);
  if (relHour) return { runAt: now + Number(relHour[1]) * 3600_000, cronExpr: null };

  // 2. 当日具体时刻：如 15:30 或 09:05
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) {
    const target = new Date();
    target.setHours(Number(timeOnly[1]), Number(timeOnly[2]), 0, 0);
    let targetTs = target.getTime();
    if (targetTs <= now) {
      targetTs += 86400_000; // 如果时间已过，定为明天
    }
    return { runAt: targetTs, cronExpr: null };
  }

  // 3. 完整日期时间：如 2026-11-11 15:30
  const parsedTs = Date.parse(s.replace(/-/g, '/'));
  if (!isNaN(parsedTs) && parsedTs > now) {
    return { runAt: parsedTs, cronExpr: null };
  }

  return null;
}

export const groupRemindTool: GatewayTool = {
  name: 'group_remind',
  description: '在群聊或私聊中设定定时提醒或日程待办。到达指定时间后自动向会话发送提醒。',
  parameters: {
    type: 'object',
    properties: {
      time: {
        type: 'string',
        description: '提醒时间。支持相对时间（如 "10m"、"30s"、"2h"、"10分钟后"）或时间点（如 "15:30"、"2026-11-11 16:00"）',
      },
      content: {
        type: 'string',
        description: '提醒内容详情',
      },
      target: {
        type: 'string',
        description: '被提醒人名称或 @ 对象（可选）',
      },
    },
    required: ['time', 'content'],
  },
  execute: async (args: { time: string; content: string; target?: string }, ctx: ToolContext) => {
    const timeStr = String(args.time || '').trim();
    const content = String(args.content || '').trim();
    const target = args.target ? String(args.target).trim() : '';

    if (!content) return '提醒内容不能为空。';
    const parsed = parseReminderTime(timeStr);
    if (!parsed) {
      return `无法识别提醒时间“${timeStr}”。请提供如“10m”、“30分钟后”、“15:30”或“2026-11-11 16:00”等格式。`;
    }

    const jobId = `remind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const promptPayload = `【定时提醒】${target ? `@${target} ` : ''}${content}`;
    const err = addJob(jobId, ctx.chatId, parsed.cronExpr, parsed.runAt, promptPayload, 'nox');
    if (err) return `设定提醒失败：${err}`;

    const dateStr = new Date(parsed.runAt).toLocaleTimeString('zh-CN', { hour12: false });
    return `已成功设定提醒！将于 ${dateStr} 发送提醒：“${content}”。(任务ID: ${jobId})`;
  },
};

// ============ 核心工具 3：记忆宫殿备忘录 (palace_memo) ============
export interface ChannelMemo {
  content: string;
  category: string;
  sender?: string;
  ts: number;
}

function getChannelMemosPath(chatId: string): string {
  return join(config.channelsDir, chatId, 'memos.json');
}

export function saveChannelMemoFallback(chatId: string, memo: ChannelMemo): void {
  try {
    const chatDir = join(config.channelsDir, chatId);
    if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
    const p = getChannelMemosPath(chatId);
    let list: ChannelMemo[] = [];
    if (existsSync(p)) {
      list = JSON.parse(readFileSync(p, 'utf-8'));
    }
    list.unshift(memo);
    if (list.length > 50) list = list.slice(0, 50);
    writeFileSync(p, JSON.stringify(list, null, 2), 'utf-8');
  } catch { /* 容错 */ }
}

export function searchChannelMemoFallback(chatId: string, keyword: string): ChannelMemo[] {
  try {
    const p = getChannelMemosPath(chatId);
    if (!existsSync(p)) return [];
    const list: ChannelMemo[] = JSON.parse(readFileSync(p, 'utf-8'));
    const kw = keyword.toLowerCase();
    return list.filter((m) => m.content.toLowerCase().includes(kw)).slice(0, 5);
  } catch {
    return [];
  }
}

export const palaceMemoTool: GatewayTool = {
  name: 'palace_memo',
  description: '向记忆宫殿归档重要信息/备忘录，或检索以往归档的记忆知识。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'search'],
        description: '操作类型：save（归档存入）或 search（检索历史记忆）',
      },
      content: {
        type: 'string',
        description: '归档的事实内容，或者检索记忆的关键词',
      },
      category: {
        type: 'string',
        enum: ['worklog', 'knowledge', 'preference', 'project', 'pitfall'],
        description: '记忆分类（默认 knowledge）',
      },
    },
    required: ['action', 'content'],
  },
  execute: async (
    args: { action: 'save' | 'search'; content: string; category?: string },
    ctx: ToolContext
  ) => {
    const action = String(args.action || 'save').toLowerCase();
    const content = String(args.content || '').trim();
    const category = String(args.category || 'knowledge');

    if (!content) return '操作内容不能为空。';

    if (action === 'save') {
      await remember(content, category, {
        chatId: ctx.chatId,
        sender: ctx.senderName,
        ts: Date.now(),
      });
      saveChannelMemoFallback(ctx.chatId, {
        content,
        category,
        sender: ctx.senderName,
        ts: Date.now(),
      });
      return `已成功将备忘存入记忆宫殿（分类: ${category}）：\n“${content}”`;
    }

    if (action === 'search') {
      const hits = await semanticSearch(content, { topK: 3, chatId: ctx.chatId });
      if (!hits.length) {
        const localHits = searchChannelMemoFallback(ctx.chatId, content);
        if (!localHits.length) {
          return `在记忆宫殿中未找到与“${content}”相关的记录。`;
        }
        return [
          `检索到 ${localHits.length} 条本地群备忘：`,
          ...localHits.map(
            (h, i) => `${i + 1}. [${new Date(h.ts).toISOString().slice(0, 10)}] ${h.content}`
          ),
        ].join('\n');
      }
      return [
        `记忆宫殿检索结果：`,
        ...hits.map(
          (h, i) =>
            `${i + 1}. [${h.created_at ? h.created_at.slice(0, 10) : '近期'}] ${h.content}`
        ),
      ].join('\n');
    }

    return `未知操作类型“${action}”，仅支持 save 或 search。`;
  },
};

// ============ 全局工具注册中心与沙箱安全守卫 ============
const toolRegistry = new Map<string, GatewayTool>();

export function registerTool(tool: GatewayTool): void {
  toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): GatewayTool | undefined {
  return toolRegistry.get(name);
}

export function getAllTools(): GatewayTool[] {
  return Array.from(toolRegistry.values());
}

export function getToolsForChat(chatId: string, isOp = false): GatewayTool[] {
  const p = getPersona(getSession(chatId).persona_id, isOp, chatId);
  const allowed = p.allowed_mcp_tools;
  if (allowed.includes('*')) {
    return Array.from(toolRegistry.values());
  }
  return allowed.map((name) => toolRegistry.get(name)).filter(Boolean) as GatewayTool[];
}

export async function executeToolCall(
  name: string,
  rawArgs: string | Record<string, any>,
  ctx: ToolContext,
  allowedToolNames?: string[]
): Promise<string> {
  // 1. 沙箱权限拦截：如果指定了允许工具列表，必须在列表中（或通配 *）
  if (
    allowedToolNames &&
    !allowedToolNames.includes('*') &&
    !allowedToolNames.includes(name)
  ) {
    return `[安全拦截] 当前会话未启用工具 "${name}" 的执行权限。`;
  }

  const tool = toolRegistry.get(name);
  if (!tool) {
    return `[错误] 未找到名称为 "${name}" 的可用工具。`;
  }

  let parsedArgs: any;
  if (typeof rawArgs === 'string') {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      return `[错误] 工具参数格式不正确，解析 JSON 失败。`;
    }
  } else {
    parsedArgs = rawArgs;
  }

  try {
    return await tool.execute(parsedArgs, ctx);
  } catch (err: any) {
    return `[执行异常] 工具 "${name}" 运行出错: ${err?.message || String(err)}`;
  }
}

export function toOpenAiTools(tools: GatewayTool[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// 默认注册三款标准核心工具
registerTool(webSearchTool);
registerTool(groupRemindTool);
registerTool(palaceMemoTool);

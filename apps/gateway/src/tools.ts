import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { addJob, getPersona, getSession } from './control.js';
import { remember, semanticSearch } from './mnemosyne.js';
import { globalSearchOrchestrator, globalFactVerifier } from './search/index.js';

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
  description: '联网搜索实时信息、最新资讯、新闻或事实依据。具备多源智能调度、域名质量清洗与通稿去重能力。',
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
    const res = await globalSearchOrchestrator.search(q, { maxResults: 5 });
    if (!res.items.length) return `未搜索到与“${q}”相关的权威网页信息。`;
    return [
      `搜索“${res.query}”的实时结果（来源: ${res.usedProvider}）：`,
      ...res.items.map((r, i) => `${i + 1}. 【${r.title}】[${r.tier || '其他'}]\n   摘要: ${r.snippet}\n   链接: ${r.url}`),
    ].join('\n');
  },
};

export const factCheckTool: GatewayTool = {
  name: 'fact_check',
  description: '对具体的事件、新闻、时效声明、数字、政策、人事变动、微信文章链接或可疑事实主张进行多源联网检索与事实核验，输出核验状态（已证实/部分证实/与可靠来源冲突/未核实）、权威信源与原文证据。',
  parameters: {
    type: 'object',
    properties: {
      claim: { type: 'string', description: '待核验的具体客观事实主张、新闻事件、数据或微信文章链接（mp.weixin.qq.com/s/...）' },
    },
    required: ['claim'],
  },
  execute: async (args: { claim: string }) => {
    const claim = (args.claim || '').trim();
    if (!claim) return '请提供待核验的事实主张或文章链接。';
    if (claim.includes('mp.weixin.qq.com/s')) {
      const art = await fetchWechatArticle(claim);
      if (art.error) return `读取待核验文章失败: ${art.error}`;
      const report = await globalFactVerifier.verifyArticle(art);
      return report.rawTextReport;
    }
    return await globalFactVerifier.verifyTextQuery(claim);
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

// ============ 核心工具 4：大模型生图与微信发送 (generate_image) ============
export const generateImageTool: GatewayTool = {
  name: 'generate_image',
  description: '使用大模型生图引擎（Gemini Imagen）根据文本描述生成高质量图片，并直接自动发送至当前微信会话中。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '生图提示词。详细描述画面的主体、风格、构图、光影、色彩或质感（例如："一只可爱的赛博朋克风格猫咪，霓虹光影，高清细节"）',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description: '画面宽高比例，默认 1:1',
      },
    },
    required: ['prompt'],
  },
  execute: async (args: { prompt: string; aspect_ratio?: string }, ctx: ToolContext) => {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return '生图提示词不能为空。';

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);

    try {
      const apiUrl = `${config.antigravity.baseUrl}/images/generations`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.antigravity.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gemini-3.1-flash-image',
          prompt,
          n: 1,
          response_format: 'b64_json',
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return `生图服务请求失败 (HTTP ${res.status}): ${errText.slice(0, 300) || '未知上游错误'}`;
      }

      const data = (await res.json()) as any;
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        return '生图服务未返回有效图片数据。';
      }

      // 暂存至本地持久化目录
      const imgDir = join(config.channelsDir, '..', 'generated-images');
      if (!existsSync(imgDir)) {
        mkdirSync(imgDir, { recursive: true });
      }
      const filename = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
      const localFilePath = join(imgDir, filename);
      writeFileSync(localFilePath, Buffer.from(b64, 'base64'));

      // 通过网关出站批次推送到微信
      const batchPayload = {
        c: ctx.chatId,
        seq: [
          {
            img: localFilePath,
            d: 300,
          },
        ],
      };

      const pushRes = await fetch(config.bridgeOutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!pushRes.ok) {
        return `图片已生成并保存本地（${filename}），但推送到微信出口失败 (HTTP ${pushRes.status})。`;
      }

      return `图片生成成功并已发送至微信当前会话中！提示词：“${prompt}”。本地存档路径：${filename}`;
    } catch (err: any) {
      return `生图执行异常: ${err?.message || String(err)}`;
    } finally {
      clearTimeout(timer);
    }
  },
};

// ============ 核心工具 5：微信公众号文章解析阅读 (read_wechat_article) ============
export async function fetchWechatArticle(url: string): Promise<{
  title: string;
  account: string;
  publishTime: string;
  content: string;
  error?: string;
}> {
  try {
    const urlMatch = url.match(/https?:\/\/mp\.weixin\.qq\.com\/s[^\s"'<>]+/);
    let targetUrl = urlMatch ? urlMatch[0] : url.trim();
    // 微信 xml 或引用中常见 &amp; 转义，必须还原为标准 &，避免公众平台参数失效解析报错
    targetUrl = targetUrl.replace(/&amp;/g, '&');

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(targetUrl, {
      signal: ctl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { title: '', account: '', publishTime: '', content: '', error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // 1. 标题
    const titleM =
      html.match(/<h1[^>]*class="[^"]*rich_media_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const title = titleM ? decodeHtmlEntities(titleM[1].replace(/<[^>]+>/g, '').trim()) : '微信文章';

    // 2. 账号名称与作者
    const accountM =
      html.match(/<a[^>]*class="[^"]*rich_media_meta_nickname[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      html.match(/<strong[^>]*class="account_nickname_inner"[^>]*>([\s\S]*?)<\/strong>/i) ||
      html.match(/<meta\s+property="og:article:author"\s+content="([^"]+)"/i);
    const account = accountM ? decodeHtmlEntities(accountM[1].replace(/<[^>]+>/g, '').trim()) : '微信公众号';

    // 3. 发布时间
    const timeM =
      html.match(/var\s+publish_time\s*=\s*"([^"]+)"/) ||
      html.match(/var\s+createTime\s*=\s*"([^"]+)"/);
    const publishTime = timeM ? timeM[1] : '';

    // 4. 正文提取与清洗
    const contentIdx = html.indexOf('id="js_content"');
    let content = '';
    if (contentIdx !== -1) {
      const endIdx = html.indexOf('id="js_sg_bar"', contentIdx);
      const rawSection = endIdx !== -1 ? html.slice(contentIdx, endIdx) : html.slice(contentIdx, contentIdx + 60000);
      content = rawSection
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n\s*\n\s*\n/g, '\n\n');
      content = decodeHtmlEntities(content).trim();
    } else {
      const descM = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      content = descM ? decodeHtmlEntities(descM[1]) : '正文未能解析';
    }

    if (content.length > 12000) {
      content = content.slice(0, 12000) + '\n\n[...因篇幅过长，后序部分已截断...]';
    }

    return { title, account, publishTime, content };
  } catch (err: any) {
    return { title: '', account: '', publishTime: '', content: '', error: err?.message || String(err) };
  }
}

export const readWechatArticleTool: GatewayTool = {
  name: 'read_wechat_article',
  description: '解析并阅读微信公众号文章的完整正文内容。当用户发送微信公众号分享卡片（带有 [链接] 及 mp.weixin.qq.com）、文章链接、或提及要阅读/讲解/总结微信文章时调用。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '微信公众号文章完整 URL 链接（如 https://mp.weixin.qq.com/s/...）',
      },
      verify: {
        type: 'boolean',
        description: '是否需要对文章中的事实主张进行多源联网事实核验。仅在用户明确质疑真实性或求证时开启，默认 false',
      },
    },
    required: ['url'],
  },
  execute: async (args: { url: string; verify?: boolean }) => {
    const rawUrl = String(args.url || '').trim();
    if (!rawUrl) return '请提供有效的微信公众号文章链接。';
    const result = await fetchWechatArticle(rawUrl);
    if (result.error) {
      return `读取微信公众号文章失败: ${result.error}`;
    }

    const lines: string[] = [
      `📰【文章速览】`,
      `• 标题：《${result.title}》`,
      `• 来源公众号: ${result.account || '微信公众号'}${result.publishTime ? ` | 发布时间: ${result.publishTime}` : ''}`,
      `• 链接: ${rawUrl}`,
    ];

    if (args.verify) {
      try {
        const report = await globalFactVerifier.verifyArticle({
          title: result.title,
          account: result.account,
          publishTime: result.publishTime,
          content: result.content,
          url: rawUrl,
        });
        lines.push('', report.rawTextReport);
      } catch {
        lines.push('', '⚠️【事实核验提示】外部搜索检索服务异常，未能完成自动化多源核对。');
      }
    }

    lines.push(
      '',
      `----------------------------------------`,
      `【文章正文内容】`,
      result.content.slice(0, 4500) + (result.content.length > 4500 ? '\n\n[...篇幅较长，已提取前 4500 字核心正文...]' : ''),
      `----------------------------------------`,
      `【处理指南】：请务必紧扣用户的真实诉求（如介绍架构、提炼观点、解析技术细节、总结要点、拆解逻辑等）进行深入浅出、条理清晰的解答。若用户对文章真实性存疑，可按需调用 fact_check 进行多源查证。`
    );

    return lines.join('\n');
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

export function unregisterTool(name: string): boolean {
  if (['web_search', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article', 'fact_check'].includes(name)) {
    return false; // 内置核心工具不可删除
  }
  return toolRegistry.delete(name);
}

export function registerCustomTool(def: {
  name: string;
  description: string;
  parameters?: any;
  endpoint?: string;
}): GatewayTool {
  const customTool: GatewayTool = {
    name: def.name,
    description: def.description,
    parameters: def.parameters || {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数或操作内容' },
      },
    },
    execute: async (args: any, ctx: ToolContext) => {
      if (def.endpoint) {
        try {
          const res = await fetch(def.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ args, ctx }),
          });
          const text = await res.text();
          return `[${def.name} 执行结果] ${text}`;
        } catch (err: any) {
          return `[${def.name} 调用失败] ${err?.message || String(err)}`;
        }
      }
      return `[自定义工具 ${def.name}] 已接收调用：${JSON.stringify(args)}`;
    },
  };
  registerTool(customTool);
  return customTool;
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

// 默认注册六大标准核心工具
registerTool(webSearchTool);
registerTool(factCheckTool);
registerTool(groupRemindTool);
registerTool(palaceMemoTool);
registerTool(generateImageTool);
registerTool(readWechatArticleTool);

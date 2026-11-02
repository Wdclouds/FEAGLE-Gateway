import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import type { CompactRouteDecision, RouteSignal } from './protocol.js';

const proxyAgent = new ProxyAgent(config.proxyUrl);

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  useProxy = false
): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await (useProxy ? undiciFetch : fetch)(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      ...(useProxy ? { dispatcher: proxyAgent } : {}),
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Antigravity 反代单轮调用（Gemini 免费额度）。失败返回 null，由调用方降级。 */
async function antigravityChat(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens: number; temperature: number; timeoutMs?: number }
): Promise<string | null> {
  if (!config.antigravity.apiKey) return null;
  try {
    const res = await postJson(
      `${config.antigravity.baseUrl}/chat/completions`,
      config.antigravity.apiKey,
      {
        model: config.antigravity.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: false,
      },
      opts.timeoutMs ?? config.antigravity.timeoutMs
    );
    const raw = res.choices?.[0]?.message?.content;
    return raw ? String(raw).trim() : null;
  } catch {
    return null; // 反代挂/超时/限流 → 降级
  }
}

/** DeepSeek 单轮调用（付费，兜底）。失败返回 null。 */
async function deepseekChat(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens: number; temperature: number; timeoutMs?: number }
): Promise<string | null> {
  if (!config.deepseek.apiKey) return null;
  try {
    const res = await postJson(
      `${config.deepseek.baseUrl}/chat/completions`,
      config.deepseek.apiKey,
      {
        model: config.deepseek.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: false,
      },
      opts.timeoutMs ?? config.deepseek.timeoutMs
    );
    const raw = res.choices?.[0]?.message?.content;
    return raw ? String(raw).trim() : null;
  } catch {
    return null;
  }
}

const ROUTE_SYS = (isBusy: boolean) =>
  `你是微信Agent网关路由器。当前Pi状态:${isBusy ? 'BUSY' : 'IDLE'}。
只输出纯JSON，严禁Markdown代码块或解释：
{"s":"W|S|X|T|C|R","c":0.9,"g":["翼区名"],"q":"检索词","r":"s为T或R时填中文回复否则null"}
判定标准：W=用户话没说完在等待；S=对运行中任务的追加引导；X=要求打断当前任务；T=闲聊寒暄可直接回复；C=工程/复杂任务需唤醒Coding Agent；R=额度保护拒单。
R的判定（重要）：任务规模过大——例如一次性处理海量文件、全库大规模重构、多阶段超长工程、批量爬取/批量生成等内容，执行将消耗大量模型额度。判定为R时在r中礼貌拒绝，说明预估规模原因，并建议拆解成小步骤分批提交（每批一个明确的小任务）。
注意：普通工程任务（查日志/改单个文件/写小脚本/答问题）绝不能判R，正常判C。
g 可选值（记忆宫殿翼区）：research,engineering。q 为中文检索关键词。`;

function parseDecision(raw: string, isBusy: boolean): CompactRouteDecision {
  const match = raw.match(/\{[\s\S]*\}/); // 正则抠取 JSON，无视模型前后缀废话
  if (match) {
    try {
      const d = JSON.parse(match[0]);
      const s = (['W', 'S', 'X', 'T', 'C', 'R'].includes(d.s) ? d.s : 'C') as RouteSignal;
      return {
        s,
        c: typeof d.c === 'number' ? Math.min(1, Math.max(0, d.c)) : 0.5,
        g: Array.isArray(d.g) ? d.g.slice(0, 3).map(String) : undefined,
        q: typeof d.q === 'string' && d.q ? d.q : undefined,
        r: (s === 'T' || s === 'R') && typeof d.r === 'string' ? d.r : null,
      };
    } catch { /* 落入兜底 */ }
  }
  return fallbackDecision(isBusy);
}

function fallbackDecision(isBusy: boolean): CompactRouteDecision {
  // NIM 限流/超时兜底：直接放行并拉满检索范围防失忆
  return { s: isBusy ? 'S' : 'C', c: 0.5, q: undefined };
}

/**
 * NIM 视觉描述器：nemotron-3.5-super-vl 读微信图片（报错截图等）转成文字。
 * 只当"眼睛"用——路由判断力差（实测全判 W），路由主力固定 DeepSeek。
 * thinking:false 必须传：否则 600+ token 全花在推理上不出结果。
 */
export async function describeImage(imgPath: string): Promise<string | null> {
  if (!config.nim.enabled || !config.nim.apiKey) return null;
  try {
    const buf = await readFile(imgPath);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const res = await postJson(
      `${config.nim.baseUrl}/chat/completions`,
      config.nim.apiKey,
      {
        model: config.nim.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '用中文简述这张图片的内容。如果是报错/日志截图，转述关键错误信息；如果是聊天截图，转述主要对话内容。80字内。' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.1,
        stream: false,
        chat_template_kwargs: { thinking: false },
      },
      config.nim.timeoutMs,
      true // 走 mihomo 出海
    );
    const raw = res.choices?.[0]?.message?.content || '';
    const text = String(raw).trim();
    return text ? text.slice(0, 200) : null;
  } catch {
    return null; // 描述失败按"图片不可读"处理，不阻塞路由
  }
}

/**
 * 第 1 层入口路由。主力 Gemini（Antigravity 反代，免费，实测 1.5~2.2s），
 * 降级 DeepSeek（付费，反代挂掉时兜底），全灭走本地兜底。
 * 图片消息先经 NIM VL 转述成文字再路由（NEMotron 当眼睛不当大脑）。
 */
export async function routeMessage(
  compactHistory: string,
  isBusy: boolean,
  imgUrl?: string
): Promise<{ decision: CompactRouteDecision; provider: 'gemini' | 'deepseek' | 'fallback'; imgDesc?: string | null }> {
  let text = compactHistory;
  let imgDesc: string | null | undefined;
  if (imgUrl) {
    imgDesc = await describeImage(imgUrl);
    text = `${compactHistory}\n[用户发图: ${imgDesc || '图片查看失败，请谨慎判定'}]`;
  }
  const msgs = [
    { role: 'system', content: ROUTE_SYS(isBusy) },
    { role: 'user', content: text },
  ];
  const gem = await antigravityChat(msgs, {
    maxTokens: 250,
    temperature: 0.1,
    timeoutMs: Math.min(10000, config.antigravity.timeoutMs),
  });
  if (gem) return { decision: parseDecision(gem, isBusy), provider: 'gemini', imgDesc };
  const ds = await deepseekChat(msgs, {
    maxTokens: 250,
    temperature: 0.1,
    timeoutMs: Math.min(8000, config.deepseek.timeoutMs),
  });
  if (ds) return { decision: parseDecision(ds, isBusy), provider: 'deepseek', imgDesc };
  return { decision: fallbackDecision(isBusy), provider: 'fallback', imgDesc };
}

/** l1_only 人设直答：跳过路由器与 Pi，主力 Gemini 带人设系统提示直接回复，降级 DeepSeek */
export async function directChat(compactHistory: string, personaSysPrompt: string): Promise<string> {
  const msgs = [
    {
      role: 'system',
      content: `${personaSysPrompt}\n你在微信里回复用户，保持简短（一般不超过 120 字），纯文本不用 Markdown。`,
    },
    { role: 'user', content: compactHistory.slice(-2000) },
  ];
  const gem = await antigravityChat(msgs, { maxTokens: 500, temperature: 0.7 });
  if (gem) return gem;
  const ds = await deepseekChat(msgs, { maxTokens: 500, temperature: 0.7 });
  return ds || '（回复生成失败，请稍后再试）';
}

/** 第 4 层哨兵观测智能分析：对群聊消息进行轻量批审判，识别紧急事件与人际社交图谱 */
export interface SentryAnalysisResult {
  urgent: boolean;
  urgentReason?: string;
  urgentSnippet?: string;
  relations: Array<{ subject: string; relation: string; object: string; context: string }>;
}

export async function analyzeSentryTranscript(transcript: string, chatTitle: string): Promise<SentryAnalysisResult> {
  const sys = `你是群聊安全哨兵与社交图谱分析官。当前正在静默监测微信群【${chatTitle}】。
仔细审视以下近期聊天消息，完成两项核心任务：
1. 紧急度审判 (urgent)：是否有需要管理员/群主立即介入处理的紧急事件？
   - 紧急情况判定：系统宕机/线上故障/误删数据、紧急求助管理员、安全泄露/违法风控风险、严重吵架或突发事件。
   - 一般工作沟通、吹水闲聊、日常讨论绝非紧急 (urgent=false)。
2. 社交图谱与人际关系提炼 (relations)：从对话中提取发言人之间的业务关系、协作分工或角色画像。
   - 提取实体与关系，如: A向B求助某技术、B负责某系统、C是某部门、D在负责某模块。无明确关系时可为空数组。

严格按以下 JSON 格式输出，禁止任何 Markdown 格式或额外文字：
{
  "urgent": true/false,
  "urgentReason": "简要说明紧急原因，非紧急填null",
  "urgentSnippet": "引发警报的关键发言原文，非紧急填null",
  "relations": [
    { "subject": "人物/实体A", "relation": "协作/提问/负责/依赖", "object": "人物/实体B/项目模块", "context": "简述具体事实" }
  ]
}`;

  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: transcript.slice(0, 5000) },
  ];
  const raw =
    (await antigravityChat(msgs, { maxTokens: 800, temperature: 0.1 })) ??
    (await deepseekChat(msgs, { maxTokens: 800, temperature: 0.1 }));

  if (!raw) return { urgent: false, relations: [] };

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { urgent: false, relations: [] };
    const d = JSON.parse(match[0]);
    return {
      urgent: Boolean(d.urgent),
      urgentReason: typeof d.urgentReason === 'string' ? d.urgentReason : undefined,
      urgentSnippet: typeof d.urgentSnippet === 'string' ? d.urgentSnippet : undefined,
      relations: Array.isArray(d.relations) ? d.relations.slice(0, 5) : [],
    };
  } catch {
    return { urgent: false, relations: [] };
  }
}
export async function distillMemories(
  transcript: string
): Promise<Array<{ content: string; category: string; hall: string }>> {
  const sys = `你是记忆史官。从下面微信对话中提炼值得长期记住的事实，过滤水群废话与寒暄。
只输出纯JSON数组，严禁解释：
[{"content":"具体事实（架构决策/踩坑/用户偏好/项目状态）","category":"worklog|knowledge|preference|project|pitfall","hall":"research|engineering"}]
最多 5 条，没有值得记的就输出 []。`;
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user', content: transcript.slice(0, 6000) },
  ];
  const raw =
    (await antigravityChat(msgs, { maxTokens: 600, temperature: 0.2 })) ??
    (await deepseekChat(msgs, { maxTokens: 600, temperature: 0.2 })) ??
    '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    const valid = ['worklog', 'knowledge', 'preference', 'project', 'pitfall'];
    const halls = ['research', 'engineering'];
    return (Array.isArray(arr) ? arr : [])
      .filter((m: any) => m && typeof m.content === 'string' && m.content.length > 4)
      .slice(0, 5)
      .map((m: any) => ({
        content: String(m.content).slice(0, 800),
        category: valid.includes(m.category) ? m.category : 'knowledge',
        hall: halls.includes(m.hall) ? m.hall : 'research',
      }));
  } catch {
    return [];
  }
}

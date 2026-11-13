import type { SearchProvider, SearchResultItem, SourceTier, SearchAuditRecord } from './types.js';
import { BingSearchProvider } from './providers/bing.js';
import { TavilySearchProvider } from './providers/tavily.js';
import { HuggingFaceSearchProvider } from './providers/huggingface.js';

export function isAiModelQuery(query: string): boolean {
  return /(模型|大模型|开源|发布|权重|多模态|参数|架构|vlm|llm|deepseek|qwen|gemini|claude|llama|step|gpt|huggingface|mistral|gemma|minimax|glm|model)/i.test(query);
}

// ============ 来源分级与质量控制 ============
export const T0_DOMAIN_SUFFIXES = [
  // 1. 政府、国际组织、学术权威期刊与预印本
  '.gov',
  '.gov.cn',
  '.edu',
  '.edu.cn',
  '.org.cn',
  'arxiv.org',
  'nature.com',
  'science.org',
  'sec.gov',
  'who.int',
  'un.org',
  'iso.org',
  'ieee.org',
  'acm.org',
  'cell.com',
  'thelancet.com',

  // 2. 顶级 AI 机构官方发布阵地与模型/代码仓库 (一手源头)
  'huggingface.co',
  'github.com',
  'github.io',
  'modelscope.cn',
  'openai.com',
  'anthropic.com',
  'deepseek.com',
  'blog.google',
  'deepmind.google',
  'ai.google.dev',
  'googleblog.com',
  'meta.com',
  'ai.meta.com',
  'microsoft.com',
  'apple.com',
  'qwenlm.github.io',
  'zhipuai.cn',
  'bigmodel.cn',
  'moonshot.cn',
  'minimax.io',
  '01.ai',
  'baichuan-ai.com',
  'mistral.ai',
  'cohere.com',
];

export const T1_DOMAINS = new Set([
  // 1. 综合严肃与财经主流媒体
  'xinhuanet.com',
  'news.cn',
  'people.com.cn',
  'cctv.com',
  'chinanews.com.cn',
  'caixin.com',
  'yicai.com',
  'thepaper.cn',
  'jiemian.com',
  'cls.cn',
  'wallstreetcn.com',
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'apnews.com',
  'bbc.com',
  'nytimes.com',
  'nikkei.com',

  // 2. 权威科技垂直媒体 (一手首发报道与专业评测)
  'jiqizhixin.com',
  'qbitai.com',
  '36kr.com',
  'ithome.com',
  'geekpark.net',
  'huxiu.com',
  'pingwest.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'venturebeat.com',
  'arstechnica.com',
  'engadget.com',
  'zdnet.com',
]);

export const DEFAULT_BLOCKLIST_DOMAINS = new Set([
  '360doc.com',
  'kandian.qq.com',
  'baijiahao.baidu.com',
  'toutiao.com',
  'bilibili.com', // 视频非文本核验源
  'zhihu.com/question', // 问答主观区
  'tieba.baidu.com',
  'weibo.com',
  'douyin.com',
  'xiaohongshu.com',
]);

export function classifySourceTier(url: string, domain?: string): SourceTier {
  const host = (domain || (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })()).toLowerCase();

  if (!host) return '其他';

  for (const s of T0_DOMAIN_SUFFIXES) {
    const raw = s.startsWith('.') ? s.slice(1) : s;
    if (host === raw || host.endsWith('.' + raw)) return 'T0';
  }

  for (const d of T1_DOMAINS) {
    if (host === d || host.endsWith('.' + d)) return 'T1';
  }

  return '其他';
}

export function isBlockedDomain(url: string, customBlocklist?: Set<string>): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const fullPath = (host + u.pathname).toLowerCase();

    const bl = customBlocklist || DEFAULT_BLOCKLIST_DOMAINS;
    for (const b of bl) {
      if (host === b || host.endsWith('.' + b) || fullPath.includes(b)) {
        return true;
      }
    }
  } catch {
    return true; // 无法解析的非法 URL 视为无效
  }
  return false;
}

// ============ 查询脱敏与隐私护栏 ============
export function sanitizeSearchQuery(raw: string): { query: string; isSensitive: boolean } {
  let q = raw.trim();
  let isSensitive = false;

  // 1. 拦截凭证/秘钥泄漏
  if (/(sk-[a-zA-Z0-9]{20,}|api[_-]?key|password|token=|auth=)/i.test(q)) {
    isSensitive = true;
    q = q.replace(/(sk-[a-zA-Z0-9]{20,}|token=[^\s&]+)/gi, '[REDACTED]');
  }

  // 2. 剥除微信号、群 ID、用户特征
  q = q.replace(/wxid_[a-zA-Z0-9_-]+/gi, '');
  q = q.replace(/[a-zA-Z0-9_-]+@chatroom/gi, '');
  q = q.replace(/@[\w一-龥]+/g, ''); // 剥除 @昵称

  // 3. 剥除手机号与身份证特征
  if (/1[3-9]\d{9}/.test(q)) {
    isSensitive = true;
    q = q.replace(/1[3-9]\d{9}/g, '');
  }
  q = q.replace(/\d{17}[\dXx]/g, '');

  // 4. 清洗控制符与指令前缀
  q = q.replace(/[#$`<>{}|\\]/g, ' ');
  q = q.replace(/\s+/g, ' ').trim();

  // 限制最大检索长度，杜绝将整篇上下文作为搜索词
  if (q.length > 80) {
    q = q.slice(0, 80);
  }

  return { query: q, isSensitive };
}

// ============ Prompt Injection 注入防护 ============
export function sanitizeSnippet(snippet: string): string {
  if (!snippet) return '';
  return snippet
    .replace(/(system:|human:|assistant:|user:|prompt:|instruction:)/gi, '[$1]')
    .replace(/(ignore\s+(all\s+)?previous\s+instructions)/gi, '[FILTERED_INJECTION]')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// ============ 通稿转载链去重与折叠 ============
export function deduplicateSources(items: SearchResultItem[]): SearchResultItem[] {
  const seenDomains = new Set<string>();
  const seenTitles: string[] = [];
  const deduped: SearchResultItem[] = [];

  for (const item of items) {
    const domain = item.domain || '';
    const normTitle = item.title.replace(/[^\w一-龥]/g, '').slice(0, 20);

    // 1. 域名完全相同 -> 视为同一发布者，不作为独立信源
    if (domain && seenDomains.has(domain)) {
      continue;
    }

    // 2. 标题高度雷同（超过 80% 相似或完全前缀重合）-> 视为网络通稿转载
    const isReprint = seenTitles.some((t) => {
      if (!t || !normTitle) return false;
      return t === normTitle || t.startsWith(normTitle) || normTitle.startsWith(t);
    });

    if (isReprint) {
      continue;
    }

    if (domain) seenDomains.add(domain);
    if (normTitle) seenTitles.push(normTitle);
    deduped.push(item);
  }

  return deduped;
}

// ============ 多源搜索编排器 (SearchOrchestrator) ============
interface CacheEntry {
  ts: number;
  items: SearchResultItem[];
}

export class SearchOrchestrator {
  private providers: Map<string, SearchProvider> = new Map();
  private priority: string[] = ['tavily', 'bing'];
  private cache: Map<string, CacheEntry> = new Map();
  private auditLog: SearchAuditRecord[] = [];
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时缓存
  private readonly MAX_CACHE_SIZE = 500;
  private readonly MAX_AUDIT_LOG_SIZE = 200;

  constructor(options?: {
    tavilyApiKey?: string;
    tavilyApiKeys?: string | string[];
    priority?: string[];
  }) {
    // 默认内置注册 Bing 免 Key 源
    this.registerProvider(new BingSearchProvider());

    // 若传入 Tavily Key 则注册
    const keys = options?.tavilyApiKeys || options?.tavilyApiKey;
    let tavilyProvider: TavilySearchProvider | undefined;
    if (keys && (Array.isArray(keys) ? keys.length > 0 : Boolean(keys))) {
      tavilyProvider = new TavilySearchProvider(keys);
      this.registerProvider(tavilyProvider);
    }

    // 注册 Hugging Face 开源模型与官方卡片探测器
    this.registerProvider(new HuggingFaceSearchProvider(tavilyProvider));

    if (options?.priority && options.priority.length > 0) {
      this.priority = options.priority;
    }
  }

  registerProvider(provider: SearchProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): SearchProvider | undefined {
    return this.providers.get(name);
  }

  setPriority(order: string[]): void {
    this.priority = order;
  }

  getAudits(): SearchAuditRecord[] {
    return [...this.auditLog];
  }

  clearCache(): void {
    this.cache.clear();
  }

  async search(
    rawQuery: string,
    options?: {
      maxResults?: number;
      timeoutMs?: number;
      requireSecondSource?: boolean;
    }
  ): Promise<{
    query: string;
    items: SearchResultItem[];
    usedProvider: string;
    fallbackOccurred: boolean;
    cached: boolean;
  }> {
    const maxResults = options?.maxResults ?? 5;
    const timeoutMs = options?.timeoutMs ?? 8000;

    // 1. 查询安全脱敏
    const { query, isSensitive } = sanitizeSearchQuery(rawQuery);
    if (!query) {
      return { query: '', items: [], usedProvider: 'none', fallbackOccurred: false, cached: false };
    }

    // 2. 检查 LRU 缓存
    const cacheKey = `${query.toLowerCase()}::${maxResults}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      return {
        query,
        items: cached.items,
        usedProvider: 'cache',
        fallbackOccurred: false,
        cached: true,
      };
    }

    let finalItems: SearchResultItem[] = [];
    let usedProvider = 'none';
    let fallbackOccurred = false;

    // 2.5 若检测为 AI / 模型 / 开源发布类查询，优先并行触发 Hugging Face 专属探测
    let hfItems: SearchResultItem[] = [];
    if (isAiModelQuery(query)) {
      const hfProvider = this.providers.get('huggingface');
      if (hfProvider && hfProvider.isAvailable()) {
        try {
          hfItems = await hfProvider.search(query, 2, Math.min(timeoutMs, 5000));
        } catch { /* 容错 */ }
      }
    }

    // 3. 按优先级编排执行与故障转移
    for (let i = 0; i < this.priority.length; i++) {
      const pName = this.priority[i];
      const provider = this.providers.get(pName);
      if (!provider || !provider.isAvailable()) {
        continue;
      }

      try {
        const rawResults = await provider.search(query, maxResults * 2, timeoutMs);
        if (rawResults && rawResults.length > 0) {
          usedProvider = hfItems.length > 0 ? `${pName}+huggingface` : pName;
          if (i > 0) {
            fallbackOccurred = true;
          }

          // 合并 Hugging Face 官方一手模型与通用检索结果
          const merged = [...hfItems, ...rawResults];

          // 4. 清洗与过滤：注入防护、域名黑名单过滤、信源分级
          const sanitized = merged
            .filter((item) => !isBlockedDomain(item.url))
            .map((item) => ({
              ...item,
              snippet: sanitizeSnippet(item.snippet),
              tier: classifySourceTier(item.url, item.domain),
            }));

          // 5. 通稿去重
          const deduped = deduplicateSources(sanitized);

          // 6. 权威度优先排序（T0 > T1 > 其他）
          deduped.sort((a, b) => {
            const weight = (t?: SourceTier) => (t === 'T0' ? 2 : t === 'T1' ? 1 : 0);
            return weight(b.tier) - weight(a.tier);
          });

          finalItems = deduped.slice(0, maxResults);
          break;
        }
      } catch {
        // 单源异常，继续进入下一优先级备选源
        continue;
      }
    }

    // 7. 写入缓存防抖
    if (finalItems.length > 0) {
      if (this.cache.size >= this.MAX_CACHE_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { ts: Date.now(), items: finalItems });
    }

    // 8. 审计记录（严格脱敏，不存密钥与隐私）
    const audit: SearchAuditRecord = {
      query: isSensitive ? '[SENSITIVE_REDACTED]' : query,
      provider: usedProvider,
      timestamp: Date.now(),
      resultsCount: finalItems.length,
      status: finalItems.length > 0 ? 'ok' : 'quota_exhausted',
      sources: finalItems.map((f) => ({ url: f.url, title: f.title, tier: f.tier || '其他' })),
    };
    this.auditLog.push(audit);
    if (this.auditLog.length > this.MAX_AUDIT_LOG_SIZE) {
      this.auditLog.shift();
    }

    return {
      query,
      items: finalItems,
      usedProvider,
      fallbackOccurred,
      cached: false,
    };
  }
}

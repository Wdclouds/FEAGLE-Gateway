import type { SearchProvider, SearchResultItem } from '../types.js';

export class TavilySearchProvider implements SearchProvider {
  public readonly name = 'tavily';
  private apiKeys: string[] = [];
  private currentKeyIndex = 0;
  private keyCooldowns: Map<string, number> = new Map();

  constructor(apiKeys: string | string[]) {
    this.setApiKeys(apiKeys);
  }

  setApiKeys(keys: string | string[]): void {
    const arr = Array.isArray(keys)
      ? keys
      : String(keys || '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);
    this.apiKeys = arr;
    this.currentKeyIndex = 0;
  }

  isAvailable(): boolean {
    if (!this.apiKeys.length) return false;
    const now = Date.now();
    // 只要池子里还有任意一个 key 没进入冷却期，就判定为可用
    return this.apiKeys.some((k) => (this.keyCooldowns.get(k) || 0) <= now);
  }

  private markKeyExhausted(key: string): void {
    // 标记超额或封禁，冷却 15 分钟
    this.keyCooldowns.set(key, Date.now() + 15 * 60 * 1000);
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
  }

  async search(
    query: string,
    maxResults = 5,
    timeoutMs = 8000,
    options?: {
      topic?: 'general' | 'news';
      includeDomains?: string[];
      days?: number;
    }
  ): Promise<SearchResultItem[]> {
    if (!this.isAvailable()) return [];

    const now = Date.now();
    // 轮询尝试可用的 API Key
    const startIdx = this.currentKeyIndex;
    const totalKeys = this.apiKeys.length;

    for (let step = 0; step < totalKeys; step++) {
      const idx = (startIdx + step) % totalKeys;
      const key = this.apiKeys[idx];
      const cooldown = this.keyCooldowns.get(key) || 0;
      if (now < cooldown) continue; // 处于冷却中，尝试下一个

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);

      try {
        const bodyPayload: Record<string, any> = {
          api_key: key,
          query: query.trim(),
          search_depth: 'basic',
          include_answer: false,
          max_results: maxResults,
        };

        if (options?.topic) {
          bodyPayload.topic = options.topic;
        }
        if (options?.includeDomains && options.includeDomains.length > 0) {
          bodyPayload.include_domains = options.includeDomains;
        }
        if (options?.days && options.days > 0) {
          bodyPayload.days = options.days;
        }

        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          signal: ctl.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        clearTimeout(timer);

        if (res.status === 429 || res.status === 402) {
          // 当前 key 配额耗尽，标记熔断冷却并立即轮转至下一 key
          this.markKeyExhausted(key);
          continue;
        }

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as {
          results?: Array<{
            title: string;
            url: string;
            content: string;
            score?: number;
            published_date?: string;
          }>;
        };

        if (!data.results || !Array.isArray(data.results)) {
          return [];
        }

        const items: SearchResultItem[] = [];
        for (const r of data.results) {
          let domain = '';
          try {
            domain = new URL(r.url).hostname;
          } catch { /* 容错 */ }

          items.push({
            title: r.title || '网页结果',
            snippet: r.content || '',
            url: r.url,
            publishedDate: r.published_date,
            score: r.score,
            domain,
            provider: 'tavily',
          });
        }

        // 成功调用后保存当前有效 key 索引
        this.currentKeyIndex = idx;
        return items;
      } catch {
        clearTimeout(timer);
        continue;
      }
    }

    return [];
  }
}

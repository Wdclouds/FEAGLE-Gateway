import type { SearchProvider, SearchResultItem } from '../types.js';
import type { TavilySearchProvider } from './tavily.js';

/**
 * Hugging Face 开源模型与论文专属探测器
 * 通过 Tavily 国际出口路由，零障碍穿透获取 Hugging Face 官方模型卡片与技术报告
 */
export class HuggingFaceSearchProvider implements SearchProvider {
  public readonly name = 'huggingface';
  private tavilyProvider?: TavilySearchProvider;

  constructor(tavilyProvider?: TavilySearchProvider) {
    this.tavilyProvider = tavilyProvider;
  }

  setTavilyProvider(provider: TavilySearchProvider): void {
    this.tavilyProvider = provider;
  }

  isAvailable(): boolean {
    return Boolean(this.tavilyProvider?.isAvailable());
  }

  /**
   * 提炼模型关键词并定向检索 huggingface.co 官方仓库
   */
  async search(query: string, maxResults = 3, timeoutMs = 8000): Promise<SearchResultItem[]> {
    if (!this.tavilyProvider || !this.tavilyProvider.isAvailable()) {
      return [];
    }

    // 提炼简明模型检索词，例如将 "阶跃星辰今日正式发布Step-3多模态大模型" 提炼为 "Step-3"
    let modelQuery = query.trim();
    // 过滤常见动词与语气词
    modelQuery = modelQuery
      .replace(/(发布了?|上线了?|推出了?|开源了?|最新|正式|今日|今天|模型|多模态|大模型)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!modelQuery || modelQuery.length < 2) {
      modelQuery = query.trim();
    }

    try {
      const results = await this.tavilyProvider.search(modelQuery, maxResults * 2, timeoutMs, {
        includeDomains: ['huggingface.co'],
      });

      // 过滤与提取专属 T0 模型仓库或论文页
      const items: SearchResultItem[] = [];
      for (const r of results) {
        if (!r.url.includes('huggingface.co')) continue;
        // 优先筛选模型卡 (hf.co/<org>/<model>)、论文 (hf.co/papers/<id>)、博客 (hf.co/blog/<slug>)
        const isModelOrPaper =
          r.url.includes('/papers/') ||
          r.url.includes('/blog/') ||
          /huggingface\.co\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(r.url.split('?')[0]);

        items.push({
          ...r,
          tier: 'T0',
          provider: 'huggingface',
          score: isModelOrPaper ? (r.score || 0.8) + 0.2 : r.score,
        });

        if (items.length >= maxResults) break;
      }

      return items;
    } catch {
      return [];
    }
  }
}

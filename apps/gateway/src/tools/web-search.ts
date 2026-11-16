import { globalSearchOrchestrator } from '../search/index.js';
import { decodeHtmlEntities } from './helpers.js';
import type { GatewayTool } from './types.js';

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

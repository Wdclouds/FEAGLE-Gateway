import type { SearchProvider, SearchResultItem } from '../types.js';

function decodeHtml(str: string): string {
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

export class BingSearchProvider implements SearchProvider {
  public readonly name = 'bing';

  isAvailable(): boolean {
    return true; // 免 Key，始终可用
  }

  async search(query: string, maxResults = 5, timeoutMs = 8000): Promise<SearchResultItem[]> {
    const q = query.trim();
    if (!q) return [];

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(q)}`, {
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
      const results: SearchResultItem[] = [];

      for (const m of matches.slice(0, maxResults)) {
        const block = m[1];
        const titleM = block.match(/<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
        const snippetM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        if (titleM) {
          const rawUrl = titleM[1];
          const title = decodeHtml(titleM[2].replace(/<[^>]+>/g, '').trim());
          const snippet = snippetM ? decodeHtml(snippetM[1].replace(/<[^>]+>/g, '').trim()) : '';
          let domain = '';
          try {
            domain = new URL(rawUrl).hostname;
          } catch { /* 容错 */ }

          if (title && rawUrl) {
            results.push({
              title,
              snippet,
              url: rawUrl,
              domain,
              provider: 'bing',
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

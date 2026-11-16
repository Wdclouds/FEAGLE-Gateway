import { globalFactVerifier } from '../search/index.js';
import { decodeHtmlEntities } from './helpers.js';
import type { GatewayTool } from './types.js';

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

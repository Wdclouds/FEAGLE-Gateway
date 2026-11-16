import { globalFactVerifier } from '../search/index.js';
import { fetchWechatArticle } from './wechat-article.js';
import type { GatewayTool } from './types.js';

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

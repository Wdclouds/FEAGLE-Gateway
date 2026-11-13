import type {
  ClaimVerificationResult,
  ArticleVerificationReport,
  VerifiedSource,
  VerificationStatus,
  SourceTier,
} from './types.js';
import { SearchOrchestrator, sanitizeSnippet } from './orchestrator.js';

export type LlmFunction = (
  messages: Array<{ role: string; content: any }>,
  opts: { maxTokens: number; temperature: number; timeoutMs?: number }
) => Promise<string | null>;

export class FactVerifier {
  private orchestrator: SearchOrchestrator;
  private llmCaller?: LlmFunction;

  constructor(orchestrator: SearchOrchestrator, llmCaller?: LlmFunction) {
    this.orchestrator = orchestrator;
    this.llmCaller = llmCaller;
  }

  setLlmCaller(fn: LlmFunction): void {
    this.llmCaller = fn;
  }

  /**
   * 任务 1：从正文中提取 3-4 条可核验的核心事实主张
   * 严格过滤纯主观观点、商业吹嘘和未来展望
   */
  async extractClaims(title: string, content: string, maxClaims = 4): Promise<string[]> {
    const textSnippet = `标题: ${title}\n\n正文选段: ${content.slice(0, 3000)}`;

    const sys = `你是严谨的事实核验分析师。请审阅文章内容，识别出最多 ${maxClaims} 条具有具体时间、机构主体、数据指标、任免、政策发布、论文结果或关键事件的核心事实主张。
【严格准则】：
1. 区分“事实主张”与“观点/预测”：主观评价、未来预测（如“未来将成为龙头”）、营销修辞（如“行业天花板”、“颠覆性创新”）绝不作为事实主张！
2. 提取具体、可独立核验的陈述（例如：“Anthropic 于某日发布了 Claude 3.8 模型并在 GPQA 上取得 92 分”）。
3. 只输出纯 JSON 字符串数组，严禁任何解释或 Markdown：
["主张1", "主张2"]
若全文纯属闲聊、主观杂文或无任何客观事实主张，输出空数组 []。`;

    if (!this.llmCaller) {
      // 降级兜底启发式规则提取（若 LLM 不可用）
      const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 15 && l.length < 80);
      const claims: string[] = [];
      for (const line of lines) {
        if (/(\d{4}年|\d+月\d+日|发布|突破|首次|同比|环比|正式|宣布|官方)/.test(line)) {
          claims.push(line);
          if (claims.length >= maxClaims) break;
        }
      }
      return claims.length > 0 ? claims : [title];
    }

    try {
      const resp = await this.llmCaller(
        [
          { role: 'system', content: sys },
          { role: 'user', content: textSnippet },
        ],
        { maxTokens: 400, temperature: 0.1, timeoutMs: 12000 }
      );

      if (!resp) return [title];
      const match = resp.match(/\[[\s\S]*\]/);
      if (!match) return [title];
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, maxClaims).map(String);
      }
      return [title];
    } catch {
      return [title];
    }
  }

  /**
   * 任务 2：对单条主张执行独立检索与事实核验状态机裁决
   */
  async verifyClaim(claim: string): Promise<ClaimVerificationResult> {
    const trimmed = claim.trim();
    if (!trimmed) {
      return {
        claim,
        status: '未核实',
        sources: [],
        confidence: '低',
        notes: '主张内容为空。',
      };
    }

    // 1. 调用多源编排器执行搜索
    const searchRes = await this.orchestrator.search(trimmed, { maxResults: 3 });
    const items = searchRes.items;

    if (!items || items.length === 0) {
      return {
        claim: trimmed,
        status: '未核实',
        sources: [],
        confidence: '低',
        notes: '外部搜索引擎未检索到可信独立佐证信源，不能擅自判定为真。',
      };
    }

    // 2. 格式化候选证据（带防投毒防护）
    const evidenceBlocks = items.map((it, idx) => {
      return `[信源 ${idx + 1}]
- 标题: ${it.title}
- 域名/来源: ${it.domain || it.provider} (级别: ${it.tier || '其他'})
- 链接: ${it.url}
- 摘录证据: """${sanitizeSnippet(it.snippet)}"""`;
    }).join('\n\n');

    // 3. 模型证据对比与状态机裁决
    if (this.llmCaller) {
      const evalSys = `你是独立事实核验官。请严格比对【待核验主张】与【检索到的外部信源证据】：
【待核验主张】：
${trimmed}

【外部信源证据】：
${evidenceBlocks}

【状态机硬性判定标准】：
- 已证实：有权威官方（T0）或主流严肃媒体（T1）信源明确确认主张的关键事实、时间与口径；
- 部分证实：主张的核心方向属实，但在时间、数字口径或细节范围上存在出入，或证据仅佐证了部分要点；
- 与可靠来源冲突：检索到的权威信源与该主张明确矛盾（如官方辟谣、数字严重夸大、张冠李戴、翻炒过时旧闻）；
- 未核实：检索结果内容无关、属于非一手且无依据的传闻、或信源不足以交叉验证。

严禁把“未检索到反驳”擅自判为已证实！未核实不可当成证实。
请输出纯 JSON，严禁解释或 Markdown：
{
  "status": "已证实|部分证实|与可靠来源冲突|未核实",
  "confidence": "高|中|低",
  "evidence": "支撑判定的一句话简短直接引用依据",
  "notes": "口径差异、时效问题或独立信源局限说明（若无填无）"
}`;

      try {
        const resp = await this.llmCaller(
          [
            { role: 'system', content: evalSys },
            { role: 'user', content: '请判定该主张的事实状态并输出标准 JSON。' },
          ],
          { maxTokens: 300, temperature: 0.1, timeoutMs: 12000 }
        );

        if (resp) {
          const match = resp.match(/\{[\s\S]*\}/);
          if (match) {
            const data = JSON.parse(match[0]);
            const validStatus: VerificationStatus[] = ['已证实', '部分证实', '与可靠来源冲突', '未核实'];
            const status: VerificationStatus = validStatus.includes(data.status) ? data.status : '未核实';

            const sources: VerifiedSource[] = items.map((it, i) => ({
              url: it.url,
              title: it.title,
              provider: it.provider,
              tier: (it.tier || '其他') as SourceTier,
              published_at: it.publishedDate,
              independent: i === 0, // 首个为主信源，其余已在编排层去重
              evidence: data.evidence || it.snippet.slice(0, 80),
            }));

            return {
              claim: trimmed,
              status,
              sources,
              confidence: data.confidence === '高' || data.confidence === '中' || data.confidence === '低' ? data.confidence : '中',
              notes: data.notes || '',
            };
          }
        }
      } catch {
        // 模型异常回退规则判定
      }
    }

    // 4. 离线/模型不可用时的基于权威等级的确定性状态机判定
    const hasT0orT1 = items.some((it) => it.tier === 'T0' || it.tier === 'T1');
    return {
      claim: trimmed,
      status: hasT0orT1 ? '部分证实' : '未核实',
      sources: items.map((it, i) => ({
        url: it.url,
        title: it.title,
        provider: it.provider,
        tier: (it.tier || '其他') as SourceTier,
        published_at: it.publishedDate,
        independent: i === 0,
        evidence: it.snippet.slice(0, 100),
      })),
      confidence: hasT0orT1 ? '中' : '低',
      notes: hasT0orT1 ? '匹配到主流信源，建议结合官方通报进一步比对。' : '仅有普通聚合网页提及，缺乏独立权威佐证。',
    };
  }

  /**
   * 任务 3：公众号全链路核验，输出 300-500 字微信标准三段式
   * 【文章速览】
   * 【关键事实核验】
   * 【综合研判】
   */
  async verifyArticle(article: {
    title: string;
    account: string;
    publishTime: string;
    content: string;
    url?: string;
  }): Promise<ArticleVerificationReport> {
    const claims = await this.extractClaims(article.title, article.content, 3);
    const claimResults: ClaimVerificationResult[] = [];

    for (const c of claims) {
      const res = await this.verifyClaim(c);
      claimResults.push(res);
    }

    // 计算综合研判指标
    let verifiedCount = 0;
    let conflictCount = 0;
    let unverifiedCount = 0;

    for (const cr of claimResults) {
      if (cr.status === '已证实') verifiedCount++;
      else if (cr.status === '与可靠来源冲突') conflictCount++;
      else unverifiedCount++;
    }

    let credibility: '高' | '中' | '低' = '中';
    let recommendation = '核心主张基本属实，可作为参考。';

    if (conflictCount > 0) {
      credibility = '低';
      recommendation = '注意：文章中存在与权威渠道冲突或严重夸大的事实主张，建议谨慎采信。';
    } else if (verifiedCount >= 1 && unverifiedCount === 0) {
      credibility = '高';
      recommendation = '主要事实主张均获权威信源佐证，内容真实度高。';
    } else if (unverifiedCount > verifiedCount) {
      credibility = '低';
      recommendation = '文章充斥未获独立信源佐证的内容，偏向观点输出或自媒体营销，建议核验一手公告。';
    }

    // 生成微信精炼三段式文本
    const retrievedTimeStr = new Date().toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const reportLines = [
      `📰【文章速览】`,
      `• 标题：《${article.title}》`,
      `• 来源: ${article.account || '公众号'}${article.publishTime ? ` | 发布: ${article.publishTime}` : ''}`,
      `• 概述: ${article.content.slice(0, 100).replace(/\s+/g, ' ')}...`,
      ``,
      `🔍【关键事实核验】`,
      ...claimResults.map((cr, idx) => {
        const topSource = cr.sources[0];
        const statusEmoji = cr.status === '已证实' ? '✅' : cr.status === '与可靠来源冲突' ? '❌' : '⚠️';
        const sourceLine = topSource ? `\n   信源: ${topSource.title.slice(0, 25)} (${topSource.tier}) [${topSource.url}]` : '';
        const notesLine = cr.notes && cr.notes !== '无' ? `\n   备注: ${cr.notes}` : '';
        return `${idx + 1}. [${statusEmoji} ${cr.status}] ${cr.claim}${sourceLine}${notesLine}`;
      }),
      ``,
      `⚖️【综合研判】`,
      `• 信息可信度: ${credibility}`,
      `• 研判建议: ${recommendation}`,
      `• 核验时间: ${retrievedTimeStr}`,
    ];

    return {
      overview: {
        title: article.title,
        account: article.account,
        publishTime: article.publishTime,
        oneSentenceSummary: article.content.slice(0, 120),
      },
      claimResults,
      comprehensiveJudgment: {
        credibility,
        nature: conflictCount > 0 ? '夸大/不实' : verifiedCount > 1 ? '严肃资讯' : '自媒体/营销',
        recommendation,
      },
      rawTextReport: reportLines.join('\n'),
      retrievedAt: retrievedTimeStr,
    };
  }

  /**
   * 纯文字问答联网核验（用户询问时效事实、新闻、数据或人物变动）
   */
  async verifyTextQuery(question: string): Promise<string> {
    const claims = await this.extractClaims(question, question, 2);
    if (!claims.length) {
      claims.push(question);
    }

    const results: ClaimVerificationResult[] = [];
    for (const c of claims) {
      results.push(await this.verifyClaim(c));
    }

    const lines: string[] = [
      `🌐 联网事实核验结果：`,
      ...results.map((r, i) => {
        const statusEmoji = r.status === '已证实' ? '✅' : r.status === '与可靠来源冲突' ? '❌' : '⚠️';
        const sourceLinks = r.sources.slice(0, 2).map((s) => `\n   • [${s.tier}] ${s.title}: ${s.url}`).join('');
        return `${i + 1}. [${statusEmoji} ${r.status}] ${r.claim}${sourceLinks}\n   说明: ${r.notes || '暂无更多补充'}`;
      }),
    ];

    return lines.join('\n');
  }
}

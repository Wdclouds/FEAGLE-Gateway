export type VerificationStatus = '已证实' | '部分证实' | '与可靠来源冲突' | '未核实';

export type SourceTier = 'T0' | 'T1' | '其他';

export interface VerifiedSource {
  url: string;
  title: string;
  provider: string;
  tier: SourceTier;
  published_at?: string;
  event_date?: string;
  independent: boolean;
  evidence: string;
}

export interface ClaimVerificationResult {
  claim: string;
  status: VerificationStatus;
  sources: VerifiedSource[];
  confidence: '高' | '中' | '低';
  notes: string;
}

export interface ArticleVerificationReport {
  overview: {
    title: string;
    account: string;
    publishTime: string;
    oneSentenceSummary: string;
  };
  claimResults: ClaimVerificationResult[];
  comprehensiveJudgment: {
    credibility: '高' | '中' | '低';
    nature: string;
    recommendation: string;
  };
  rawTextReport: string;
  retrievedAt: string;
}

export interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
  publishedDate?: string;
  provider: string;
  score?: number;
  domain?: string;
  tier?: SourceTier;
}

export interface SearchProvider {
  name: string;
  isAvailable(): boolean;
  search(
    query: string,
    maxResults?: number,
    timeoutMs?: number,
    options?: {
      topic?: 'general' | 'news';
      includeDomains?: string[];
      days?: number;
    }
  ): Promise<SearchResultItem[]>;
}

export interface SearchAuditRecord {
  query: string;
  provider: string;
  timestamp: number;
  resultsCount: number;
  status: 'ok' | 'timeout' | 'quota_exhausted' | 'error';
  sources: Array<{ url: string; title: string; tier: SourceTier }>;
}

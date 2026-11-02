import { config } from './config.js';
import type { MemoryHit } from './protocol.js';

const MN = config.mnemosyne;

async function mnFetch(path: string, init?: RequestInit): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MN.timeoutMs);
  try {
    const res = await fetch(`${MN.baseUrl}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (!res.ok) throw new Error(`MN ${path} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 时间半衰期衰减与时效性过滤 (四重机制之一)
 * Score = BaseScore * exp(-lambda * delta_days)
 */
function applyAgingFilter(hits: MemoryHit[]): MemoryHit[] {
  const now = Date.now();
  const ONE_DAY_MS = 86400_000;

  return hits.map((hit) => {
    // 1. 无时间戳的默认为有效基础分
    if (!hit.created_at) {
      return { ...hit, effectiveScore: hit.score ?? 1.0, isExpired: false };
    }

    const createdTime = new Date(hit.created_at).getTime();
    const daysOld = Math.max(0, (now - createdTime) / ONE_DAY_MS);
    const baseScore = hit.score ?? 1.0;

    // 2. 静态偏好 / 置顶标记 / 核心知识永不衰减
    const isPreference = hit.category === 'preference' || hit.content.includes('[PIN]');
    if (isPreference) {
      return { ...hit, effectiveScore: baseScore, isExpired: false };
    }

    // 3. 项目配置 / 临时排错记录：半衰期 7 天 (lambda = 0.693 / 7 ≈ 0.099)
    const lambda = 0.099;
    const effectiveScore = baseScore * Math.exp(-lambda * daysOld);

    // 4. 硬截断：超过 30 天且得分极低的临时记录判定为过时 (自动淘汰)
    const isExpired = daysOld > 30 && effectiveScore < 0.2;

    return {
      ...hit,
      effectiveScore: Math.round(effectiveScore * 1000) / 1000,
      isExpired,
    };
  })
  .filter((h) => !h.isExpired) // 过滤掉已被判为失效的记忆
  .sort((a, b) => (b.effectiveScore ?? 0) - (a.effectiveScore ?? 0));
}

function extractHits(data: any, limit: number): MemoryHit[] {
  // 兼容 {results|items|memories|data: [...]} 多种返回包装
  const arr: any[] =
    data?.results || data?.items || data?.memories || data?.data || (Array.isArray(data) ? data : []);
  
  const rawHits: MemoryHit[] = arr.map((m: any) => ({
    id: m.id,
    content: (m.content || m.text || JSON.stringify(m)).slice(0, 800),
    category: m.category ?? undefined,
    hall: m.hall ?? undefined,
    score: m.score ?? m.similarity ?? 1.0,
    created_at: m.created_at ?? undefined,
    metadata: m.metadata ?? undefined,
  }));

  // 经过时效半衰期过滤与重排序，再截取 limit
  return applyAgingFilter(rawHits).slice(0, limit);
}

/** 三通检索：按名字/按引导/按语义共鸣（palace/summon 融合召回） */
export async function summon(query: string, topK = MN.topK): Promise<MemoryHit[]> {
  try {
    const url =
      `/api/v1/palace/summon?q=${encodeURIComponent(query)}` +
      `&user_id=${encodeURIComponent(MN.userId)}&top_k=${topK}&fused=true`;
    return extractHits(await mnFetch(url), topK);
  } catch (e) {
    return [];
  }
}

export interface SearchMemoryOptions {
  topK?: number;
  chatId?: string;
  scope?: string;
  category?: string;
  includeTest?: boolean;
}

/** 语义检索（memories/search，支持会话空间隔离与测试数据过滤） */
export async function semanticSearch(
  query: string,
  options: number | SearchMemoryOptions = 10
): Promise<MemoryHit[]> {
  const opts: SearchMemoryOptions = typeof options === 'number' ? { topK: options } : options;
  const topK = opts.topK ?? 10;
  try {
    const payload: Record<string, unknown> = {
      user_id: MN.userId,
      query,
      top_k: topK,
    };
    if (opts.chatId) payload.chat_id = opts.chatId;
    if (opts.scope) payload.scope = opts.scope;
    if (opts.category) payload.category_filter = opts.category;
    if (opts.includeTest) payload.include_test = true;

    const data = await mnFetch('/api/v1/memories/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return extractHits(data, topK);
  } catch {
    return [];
  }
}

/** 记忆入库（史官异步写入，带前缀防腐） */
export async function remember(
  content: string,
  category: string,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    await mnFetch('/api/v1/memories', {
      method: 'POST',
      body: JSON.stringify({ user_id: MN.userId, content, category, metadata }),
    });
    return true;
  } catch {
    return false;
  }
}

/** [SAVEPOINT] 存档快照（/save 指令：by_name 精准命中） */
export async function saveCheckpoint(tag: string, snapshot: string): Promise<boolean> {
  return remember(
    `[CURRENT][SAVEPOINT] ${tag}\n${snapshot}`,
    'project',
    { kind: 'savepoint', tag, ts: Date.now() }
  );
}

/** [SAVEPOINT] 读取（/load 指令） */
export async function loadCheckpoint(tag: string): Promise<string | null> {
  try {
    const data = await mnFetch('/api/v1/memories/search', {
      method: 'POST',
      body: JSON.stringify({
        user_id: MN.userId,
        query: `[SAVEPOINT] ${tag}`,
      }),
    });
    const hits = extractHits(data, 5);
    const exact = hits.find((h) => h.content.includes(`[SAVEPOINT] ${tag}`));
    return exact ? exact.content : hits[0]?.content ?? null;
  } catch {
    return null;
  }
}

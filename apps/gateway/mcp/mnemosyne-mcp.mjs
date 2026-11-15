#!/usr/bin/env node
/**
 * Mnemosyne 记忆宫殿 MCP 服务器（Pi 专用，无依赖 stdio JSON-RPC 2.0）
 * 让 Pi/Gemini 在任务中主动进宫殿翻房间：检索、写入、提炼、钉住。
 * 用法：pi mcp add mnemosyne -- node /opt/FEAGLEwxbot/apps/gateway/mcp/mnemosyne-mcp.mjs
 */
import { createInterface } from 'node:readline';

const MN_BASE = process.env.MNEMOSYNE_BASE_URL || 'http://127.0.0.1:18010';
const MN_USER = process.env.MN_USER_ID || 'eagle';
const TIMEOUT = 15_000;

async function mnFetch(path, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${MN_BASE}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}`, detail: text.slice(0, 400) };
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  .join('&');

// 14 个工具：与蓝图"记忆宫殿 14 工具"对齐
const TOOLS = [
  {
    name: 'palace_summon',
    description: '记忆宫殿三通融合检索（按名字/按引导/按语义共鸣）。查背景、找历史决策、找踩坑记录的首选工具。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '检索词（自然语言或存档标签）' },
        top_k: { type: 'integer', description: '返回条数，默认 5', default: 5 },
      },
      required: ['q'],
    },
    run: (a) => mnFetch(`/api/v1/palace/summon?${qs({ q: a.q, user_id: MN_USER, top_k: a.top_k ?? 5, fused: 'true' })}`),
  },
  {
    name: 'palace_status',
    description: '查看记忆宫殿当前状态：7 大翼区 × 20 房间的占用、记忆总量、分层水位。',
    inputSchema: { type: 'object', properties: {} },
    run: () => mnFetch(`/api/v1/palace/status?${qs({ user_id: MN_USER })}`),
  },
  {
    name: 'palace_archive',
    description: '触发宫殿归档（把热记忆沉降入宫，通常由后台定时任务执行，手动补跑用）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '处理条数上限，默认 500', default: 500 } },
    },
    run: (a) => mnFetch(`/api/v1/palace/archive?${qs({ user_id: MN_USER, limit: a.limit ?? 500 })}`, { method: 'POST' }),
  },
  {
    name: 'palace_refine',
    description: '触发宫殿提炼（把碎片记忆融合成高阶知识，手动补跑用）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '处理条数上限，默认 20', default: 20 } },
    },
    run: (a) => mnFetch(`/api/v1/palace/refine?${qs({ limit: a.limit ?? 20 })}`, { method: 'POST' }),
  },
  {
    name: 'palace_extract',
    description: '触发实体抽取入宫（从记忆文本提取实体挂图，手动补跑用）。',
    inputSchema: {
      type: 'object',
      properties: { batch: { type: 'integer', description: '批大小，默认 20', default: 20 } },
    },
    run: (a) => mnFetch(`/api/v1/palace/extract?${qs({ batch: a.batch ?? 20 })}`, { method: 'POST' }),
  },
  {
    name: 'palace_pin',
    description: '钉住关键记忆（permanent / long / short 档位），被钉住的记忆检索时权重提升。',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'integer', description: '记忆 ID' },
        retention: { type: 'string', description: '保留档位：permanent/long/short', default: 'permanent' },
      },
      required: ['memory_id'],
    },
    run: (a) => mnFetch(`/api/v1/palace/pin?${qs({ memory_id: a.memory_id, retention: a.retention ?? 'permanent' })}`, { method: 'POST' }),
  },
  {
    name: 'memories_search',
    description: '纯语义向量检索（memories/search）。palace_summon 无命中或需要更大范围时用。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '语义检索词' },
        top_k: { type: 'integer', description: '返回条数，默认 10', default: 10 },
        category_filter: { type: 'string', description: '类别过滤（session/knowledge/worklog/preference/project/pitfall）' },
      },
      required: ['query'],
    },
    run: (a) => mnFetch('/api/v1/memories/search', {
      method: 'POST',
      body: JSON.stringify({
        user_id: MN_USER,
        query: a.query,
        top_k: a.top_k ?? 10,
        ...(a.category_filter ? { category_filter: a.category_filter } : {}),
      }),
    }),
  },
  {
    name: 'memories_create',
    description: '写入一条新记忆入宫。任务完成时沉淀结论/决策/偏好用（史官会自动做，此为手动通道）。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆正文（中文，含足够上下文让未来检索能命中）' },
        category: { type: 'string', description: '类别：knowledge/worklog/preference/project/pitfall', default: 'knowledge' },
        metadata: { type: 'object', description: '附加元数据' },
      },
      required: ['content'],
    },
    run: (a) => mnFetch('/api/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        user_id: MN_USER,
        content: a.content,
        category: a.category ?? 'knowledge',
        ...(a.metadata ? { metadata: a.metadata } : {}),
      }),
    }),
  },
  {
    name: 'memories_list',
    description: '列出记忆宫殿现有记忆（按类别浏览房间）。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '类别过滤' },
        limit: { type: 'integer', description: '返回条数，默认 20', default: 20 },
      },
    },
    run: (a) => mnFetch(`/api/v1/memories?${qs({ user_id: MN_USER, ...(a.category ? { category: a.category } : {}), limit: a.limit ?? 20 })}`),
  },
  {
    name: 'memories_stats',
    description: '记忆库统计（总量/类别分布/分层水位）。',
    inputSchema: { type: 'object', properties: {} },
    run: () => mnFetch(`/api/v1/memories/stats?${qs({ user_id: MN_USER })}`),
  },
  {
    name: 'memory_update',
    description: '更新一条已有记忆的正文。',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'integer', description: '记忆 ID' },
        content: { type: 'string', description: '新正文' },
      },
      required: ['memory_id', 'content'],
    },
    run: (a) => mnFetch(`/api/v1/memories/${a.memory_id}`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: MN_USER, content: a.content }),
    }),
  },
  {
    name: 'memory_delete',
    description: '删除一条记忆（谨慎使用，删前先 palace_summon 确认）。用户明确要求遗忘时才用。',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'integer', description: '记忆 ID' } },
      required: ['memory_id'],
    },
    run: (a) => mnFetch(`/api/v1/memories/${a.memory_id}?${qs({ user_id: MN_USER })}`, { method: 'DELETE' }),
  },
  {
    name: 'wiki_search',
    description: '检索知识 Wiki 页（已结构化的高阶知识，比散记忆更浓缩）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词' },
        top_k: { type: 'integer', description: '返回条数，默认 5', default: 5 },
      },
      required: ['query'],
    },
    run: (a) => mnFetch('/api/v1/wiki/search', {
      method: 'POST',
      body: JSON.stringify({ query: a.query, user_id: MN_USER, top_k: a.top_k ?? 5 }),
    }),
  },
  {
    name: 'tmt_recall',
    description: '固化树回忆（TMT 树分层召回，适合复杂工程问题需要结构性历史上下文时）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词' },
        max_results: { type: 'integer', description: '最大返回数，默认 8', default: 8 },
      },
      required: ['query'],
    },
    run: (a) => mnFetch('/api/v1/tmt/recall', {
      method: 'POST',
      body: JSON.stringify({ user_id: MN_USER, query: a.query, max_results: a.max_results ?? 8 }),
    }),
  },
];

const toolList = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

// ---- 人设写权限过滤（蓝图破局二：MCP 层执行点）----
const WRITE_TOOLS = new Set(['memories_create', 'memory_update', 'memory_delete', 'palace_pin', 'palace_archive', 'palace_refine', 'palace_extract']);
const GW_BASE = process.env.GATEWAY_BASE_URL || 'http://127.0.0.1:6185';

async function personaWriteAllowed(toolName) {
  try {
    const ctxRes = await fetch(`${GW_BASE}/internal/context`, { signal: AbortSignal.timeout(4000) });
    const ctx = await ctxRes.json();
    if (!ctx.active) return { ok: true, note: 'no_active_task' }; // 非网关任务（人工 pi 调试）：放行
    const ptRes = await fetch(`${GW_BASE}/internal/persona-tools?chat=${encodeURIComponent(ctx.chat)}`, { signal: AbortSignal.timeout(4000) });
    const pt = await ptRes.json();
    if (!Array.isArray(pt.allowed_tools)) return { ok: true, note: 'gateway_older' };
    const ok = pt.allowed_tools.includes('*') || pt.allowed_tools.includes(toolName);
    return { ok, persona: pt.persona, mode: pt.engine_mode };
  } catch {
    return { ok: true, note: 'gateway_unreachable_fail_open' }; // 网关不在（独立调试场景）：放行
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const raw = line.trim();
  if (!raw) return;
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { id, method, params } = msg;
  if (method === undefined) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mnemosyne-palace', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: toolList } });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true } });
      return;
    }
    // 写类工具：先查当前任务人设是否授权（蓝图破局二）
    if (WRITE_TOOLS.has(name)) {
      const gate = await personaWriteAllowed(name);
      if (!gate.ok) {
        send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: `当前人设 ${gate.persona}（${gate.mode}）无权调用写类工具 ${name}，操作被拒绝。请改用只读检索工具完成任务。` }], isError: true },
        });
        return;
      }
    }
    Promise.resolve()
      .then(() => tool.run(params?.arguments || {}))
      .then((data) => {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: text.length > 8000 ? `${text.slice(0, 8000)}...(截断)` : text }], isError: false },
        });
      })
      .catch((e) => {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `工具执行失败: ${e.message}` }], isError: true } });
      });
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
});

console.error('[mnemosyne-mcp] ready on stdio -> ' + MN_BASE);

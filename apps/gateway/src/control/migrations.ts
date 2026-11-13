import { config } from '../config.js';
import { db } from '../db.js';
import { nextRun } from './scheduler.js';

export interface Persona {
  id: string;
  name: string;
  sys_prompt: string;
  engine_mode: 'auto' | 'l1_only';
  allowed_mcp_tools: string[];
  allow_shell: boolean;
  op_only?: boolean;
}

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'nox',
    name: 'Nox (通用智能助手)',
    engine_mode: 'auto',
    allow_shell: true,
    allowed_mcp_tools: ['*'],
    op_only: false,
    sys_prompt: '你是用户的专属智能助手 Nox。性格敏锐、聪颖、真诚、温和中带点灵巧。在交流中直击要点，表达自然生动，不做假大空的套话。根据提问者身份与指令提供精准高效的解答与执行协助。若收到微信公众号分享卡片（含有 [链接] 及 mp.weixin.qq.com）或网页链接，主动调用 read_wechat_article 读取全文并进行事实核验，为用户提炼核心干货并深入解答。若用户询问时效性新闻、事实真伪、政策、数据、产品或对可靠性有较高要求的场景，主动调用 fact_check 或 web_search 进行多源查证后再回答，不得伪称已查证或胡编乱造。',
  },
  {
    id: 'daily_assistant',
    name: 'Nox (日常对话模式)',
    engine_mode: 'l1_only',
    allow_shell: false,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'wiki_search', 'web_search', 'fact_check', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article'],
    op_only: false,
    sys_prompt: '你是智能助手 Nox。性格敏锐、温和聪慧。聊天自然亲切，专注于日常解答、总结归纳与群内互动，不执行服务器底层变更。若收到微信公众号分享卡片或文章链接，主动调用 read_wechat_article 阅读并提炼要点与事实核验。若用户询问时效性新闻、数据或事实真伪，主动调用 fact_check 或 web_search 核验后再作答。',
  },
  {
    id: 'readonly_auditor',
    name: '只读审计 (禁止Shell)',
    engine_mode: 'l1_only',
    allow_shell: false,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'wiki_search', 'web_search', 'fact_check', 'read_wechat_article'],
    op_only: false,
    sys_prompt: '你是只读技术审计助手：只做事实核查、检索汇总与分析，严禁修改任何文件或执行系统命令。',
  },
  {
    id: 'secretary',
    name: '精简秘书',
    engine_mode: 'l1_only',
    allow_shell: false,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'wiki_search', 'web_search', 'fact_check', 'read_wechat_article'],
    op_only: false,
    sys_prompt: '你是精简秘书：回答克制精炼（尽量三句话内），协助信息检索、文章快速速览、事实核实与日程对话。',
  },
  {
    id: 'architect',
    name: '架构师 (工程模式)',
    engine_mode: 'auto',
    allow_shell: true,
    allowed_mcp_tools: ['*'],
    op_only: false,
    sys_prompt: '你是一位严谨务实的资深架构师与全栈工程师 Nox。直接输出技术结论、执行代码、排错并给出最小 diff，不需要客套。',
  },
];

function colExists(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

function addColumn(table: string, col: string, def: string): void {
  if (!colExists(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function migrate(): void {
  addColumn('sessions', 'persona_id', `TEXT NOT NULL DEFAULT 'architect'`);
  addColumn('sessions', 'workspace', `TEXT NOT NULL DEFAULT '/opt/FEAGLEwxbot'`);
  addColumn('sessions', 'pending_confirm_id', 'TEXT');
  addColumn('sessions', 'mode', `TEXT NOT NULL DEFAULT 'chat'`);
  addColumn('sessions', 'dsh_session', 'TEXT');
  addColumn('trace_logs', 'req_id', 'TEXT');
  addColumn('trace_logs', 'source', `TEXT DEFAULT 'wx'`);
  addColumn('trace_logs', 'risk_flag', 'INTEGER DEFAULT 0');
  db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sys_prompt TEXT NOT NULL,
    engine_mode TEXT NOT NULL,
    allowed_mcp_tools TEXT NOT NULL,
    allow_shell INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocklist (
    target_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    runner TEXT NOT NULL,
    risk_level INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    cron_expr TEXT,
    run_at INTEGER NOT NULL,
    prompt_payload TEXT NOT NULL,
    persona_id TEXT DEFAULT 'architect',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    last_status TEXT
  );
  `);
  seedPersonas();
  seedSkills();
  seedDemoJob();
}

function seedPersonas(): void {
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT INTO personas(id,name,sys_prompt,engine_mode,allowed_mcp_tools,allow_shell,updated_at) VALUES(?,?,?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET name=excluded.name, sys_prompt=excluded.sys_prompt, engine_mode=excluded.engine_mode, allowed_mcp_tools=excluded.allowed_mcp_tools, allow_shell=excluded.allow_shell, updated_at=excluded.updated_at'
  );
  for (const p of DEFAULT_PERSONAS) {
    stmt.run(p.id, p.name, p.sys_prompt, p.engine_mode, JSON.stringify(p.allowed_mcp_tools), p.allow_shell ? 1 : 0, now);
  }
}

function seedSkills(): void {
  const rows: Array<[string, string, number, string]> = [
    ['/stop', 'l0_builtin', 0, '中断当前任务'],
    ['/new', 'l0_builtin', 0, '开启新会话'],
    ['/save', 'l0_builtin', 0, '存档快照入记忆宫殿'],
    ['/load', 'l0_builtin', 0, '恢复存档'],
    ['/status', 'l0_builtin', 0, '网关状态'],
    ['/persona', 'l0_builtin', 0, '切换人设'],
    ['/cron', 'l0_builtin', 1, '定时任务管理'],
    ['/approve', 'l0_builtin', 2, '放行高危重放'],
    ['palace_summon', 'mcp_mnemosyne', 0, '三通融合检索'],
    ['palace_status', 'mcp_mnemosyne', 0, '宫殿状态'],
    ['palace_archive', 'mcp_mnemosyne', 1, '归档补跑'],
    ['palace_refine', 'mcp_mnemosyne', 1, '提炼补跑'],
    ['palace_extract', 'mcp_mnemosyne', 1, '实体抽取补跑'],
    ['palace_pin', 'mcp_mnemosyne', 1, '钉住记忆'],
    ['memories_search', 'mcp_mnemosyne', 0, '语义检索'],
    ['memories_create', 'mcp_mnemosyne', 0, '写入记忆'],
    ['memories_list', 'mcp_mnemosyne', 0, '列出记忆'],
    ['memories_stats', 'mcp_mnemosyne', 0, '记忆统计'],
    ['memory_update', 'mcp_mnemosyne', 1, '更新记忆'],
    ['memory_delete', 'mcp_mnemosyne', 1, '删除记忆'],
    ['wiki_search', 'mcp_mnemosyne', 0, 'Wiki检索'],
    ['tmt_recall', 'mcp_mnemosyne', 0, '固化树回忆'],
    ['request_high_risk_exec', 'mcp_gateway_ctl', 2, '高危命令Y/N审批'],
    ['get_task_context', 'mcp_gateway_ctl', 0, '读取当前任务上下文'],
    ['bash', 'dsh_native', 2, 'DSH原生Shell'],
  ];
  const stmt = db.prepare('INSERT INTO skills(name,runner,risk_level,enabled,description) VALUES(?,?,?,1,?) ON CONFLICT(name) DO NOTHING');
  for (const r of rows) stmt.run(...r);
}

function seedDemoJob(): void {
  const admin = config.adminWxids[0];
  if (!admin) return;
  const n = (db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
  if (n > 0) return;
  const runAt = nextRun('0 9 * * *', new Date()) ?? Date.now() + 86400_000;
  db.prepare('INSERT INTO jobs(id,chat_id,cron_expr,run_at,prompt_payload,persona_id,enabled) VALUES(?,?,?,?,?,?,1)')
    .run('daily-9am-report', admin, '0 9 * * *', runAt,
      '简要检查服务器内存/磁盘/四个服务(gateway/bridge/mnemosyne/antigravity)运行状态，并检索昨日记忆归档情况，输出一段简短晨报。', 'nox');
}

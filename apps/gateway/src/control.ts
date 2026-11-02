/**
 * Control Plane v2.0 —— 审批双通道 / Persona / Cron / 审计
 * 零新增容器、零新增依赖（node:sqlite + fetch）。
 */
import { appendFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config, isGroup } from './config.js';
import { db, trace } from './db.js';
import { quickBatch } from './sanitizer.js';
import type { WxOutboundBatch } from './protocol.js';

// ============ Schema 平滑迁移 ============
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
  addColumn('sessions', 'mode', `TEXT NOT NULL DEFAULT 'chat'`); // chat | sentry | mute
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
    target_id TEXT PRIMARY KEY,   -- wxid 或 群聊ID
    type TEXT NOT NULL,           -- 'user' | 'group'
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

// ============ 种子数据 ============
export interface Persona {
  id: string;
  name: string;
  sys_prompt: string;
  engine_mode: 'auto' | 'l1_only';
  allowed_mcp_tools: string[]; // ["*"] = 全部
  allow_shell: boolean;
  op_only?: boolean;           // 是否仅 OP (管理员) 可见/可用
}

const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'architect', name: '架构师 (里人设)', engine_mode: 'auto', allow_shell: true, allowed_mcp_tools: ['*'], op_only: true,
    sys_prompt: '你是一位严谨务实的资深架构师与全栈工程师。这是面向管理员的里人设：直接输出技术结论、执行代码、排错并给出最小 diff，不需要客套。',
  },
  {
    id: 'daily_assistant', name: '灵动助手 (表面人设)', engine_mode: 'l1_only', allow_shell: false,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'memories_list', 'memories_stats', 'wiki_search', 'tmt_recall', 'palace_status'],
    sys_prompt: '你是用户的微信智能管家与日常助手（面向正常用户的表人设）。性格温和聪慧、聊天亲切自然，可以回答日常问题与查阅公开记忆，不展示底层系统细节，不执行任何服务器命令。',
  },
  {
    id: 'secretary', name: '精简秘书 (表面人设)', engine_mode: 'l1_only', allow_shell: false,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'memories_list', 'memories_stats', 'wiki_search', 'tmt_recall', 'palace_status'],
    sys_prompt: '你是精简秘书：回答克制精炼（尽量三句话内），只做信息检索与日程对话，严禁任何写操作或 Shell 执行。',
  },
  {
    id: 'readonly_auditor', name: '只读审计员 (里人设)', engine_mode: 'l1_only', allow_shell: false, op_only: true,
    allowed_mcp_tools: ['palace_summon', 'memories_search', 'memories_list', 'memories_stats', 'wiki_search', 'tmt_recall', 'palace_status'],
    sys_prompt: '你是面向管理员的只读安全审计员，仅检索与汇报系统/记忆状态，严禁任何写操作或 Shell 执行。',
  },
];

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
    ['bash', 'pi_native', 2, 'Pi原生Shell'],
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
      '简要检查服务器内存/磁盘/四个服务(gateway/bridge/mnemosyne/antigravity)运行状态，并检索昨日记忆归档情况，输出一段简短晨报。', 'architect');
}

// ============ 人设 ============
let personaCache = new Map<string, Persona>();
export function loadPersonas(): void {
  const rows = db.prepare('SELECT * FROM personas').all() as any[];
  personaCache = new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, sys_prompt: r.sys_prompt,
    engine_mode: r.engine_mode === 'l1_only' ? 'l1_only' : 'auto',
    allowed_mcp_tools: JSON.parse(r.allowed_mcp_tools || '["*"]'),
    allow_shell: r.allow_shell === 1,
    op_only: ['architect', 'readonly_auditor'].includes(r.id),
  }]));
}
export function getPersona(id: string, isOp = true): Persona {
  const p = personaCache.get(id) || personaCache.get('daily_assistant') || DEFAULT_PERSONAS[1];
  // 非 OP 用户强行读取里人设时，硬降级为默认表面人设 (灵动助手)
  if (!isOp && p.op_only) {
    return personaCache.get('daily_assistant') || DEFAULT_PERSONAS[1];
  }
  return p;
}
export function listPersonas(isOp = true): Persona[] {
  const all = Array.from(personaCache.values());
  if (isOp) return all;
  return all.filter((p) => !p.op_only);
}

export type GatewayMode = 'chat' | 'sentry' | 'mute';

interface SessionRow {
  chat_id: string;
  persona_id: string;
  workspace: string;
  pending_confirm_id: string | null;
  mode: GatewayMode;
}
export function getSession(chatId: string): SessionRow {
  touchSessionRow(chatId);
  const row = db.prepare('SELECT chat_id, persona_id, workspace, pending_confirm_id, mode FROM sessions WHERE chat_id = ?').get(chatId) as any;
  return {
    chat_id: row.chat_id,
    persona_id: row.persona_id,
    workspace: row.workspace,
    pending_confirm_id: row.pending_confirm_id,
    mode: (['chat', 'sentry', 'mute'].includes(row.mode) ? row.mode : 'chat') as GatewayMode,
  };
}
function touchSessionRow(chatId: string): void {
  const now = Date.now();
  db.prepare('INSERT INTO sessions(chat_id, updated_at) VALUES(?, ?) ON CONFLICT(chat_id) DO UPDATE SET updated_at = ?')
    .run(chatId, now, now);
}
export function setMode(chatId: string, mode: GatewayMode): void {
  touchSessionRow(chatId);
  db.prepare('UPDATE sessions SET mode = ?, updated_at = ? WHERE chat_id = ?').run(mode, Date.now(), chatId);
}

// ============ 黑名单管理 (Blocklist) ============
let blocklistCache = new Set<string>();
export function loadBlocklist(): void {
  try {
    const rows = db.prepare('SELECT target_id FROM blocklist').all() as any[];
    blocklistCache = new Set(rows.map((r) => r.target_id));
  } catch {
    blocklistCache = new Set();
  }
}
export function isBlocked(targetId: string): boolean {
  return blocklistCache.has(targetId);
}
export function addBlock(targetId: string, type: 'user' | 'group', reason = 'manual'): boolean {
  try {
    db.prepare('INSERT INTO blocklist(target_id, type, reason, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(target_id) DO NOTHING')
      .run(targetId, type, reason, Date.now());
    blocklistCache.add(targetId);
    return true;
  } catch {
    return false;
  }
}
export function removeBlock(targetId: string): boolean {
  try {
    db.prepare('DELETE FROM blocklist WHERE target_id = ?').run(targetId);
    blocklistCache.delete(targetId);
    return true;
  } catch {
    return false;
  }
}
export function listBlocks(): Array<{ target_id: string; type: string; reason: string; created_at: number }> {
  try {
    return db.prepare('SELECT target_id, type, reason, created_at FROM blocklist ORDER BY created_at DESC').all() as any[];
  } catch {
    return [];
  }
}

export function setPersona(chatId: string, personaId: string): void {
  touchSessionRow(chatId);
  db.prepare('UPDATE sessions SET persona_id = ?, updated_at = ? WHERE chat_id = ?').run(personaId, Date.now(), chatId);
}
export function setPendingConfirm(chatId: string, confirmId: string | null): void {
  touchSessionRow(chatId);
  db.prepare('UPDATE sessions SET pending_confirm_id = ?, updated_at = ? WHERE chat_id = ?').run(confirmId, Date.now(), chatId);
}
export function setWorkspace(chatId: string, path: string): void {
  touchSessionRow(chatId);
  db.prepare('UPDATE sessions SET workspace = ?, updated_at = ? WHERE chat_id = ?').run(path, Date.now(), chatId);
}
export function toolAllowedForChat(chatId: string, tool: string): { allowed: boolean; persona: Persona } {
  const p = getPersona(getSession(chatId).persona_id);
  return { allowed: p.allowed_mcp_tools.includes('*') || p.allowed_mcp_tools.includes(tool), persona: p };
}

// ============ 任务上下文（当前正在跑的 Turn；MCP /internal/context 消费） ============
export interface TaskCtx {
  chat: string;
  reqId: string;
  prompt: string;
  persona: Persona;
  startedAt: number;
}
let taskCtx: TaskCtx | null = null;
export function taskStart(ctx: TaskCtx): void { taskCtx = ctx; }
export function taskEnd(): void { taskCtx = null; }
export function getTaskCtx(): TaskCtx | null { return taskCtx; }

// ============ 通道 A：优雅挂起的 Y/N 审批（MCP 长连接） ============
export interface PendingConfirm {
  id: number;
  chat: string;
  cmd: string;
  reason: string;
  resolve: (v: { approved: boolean; reason: string }) => void;
  createdAt: number;
  timer: NodeJS.Timeout;
}
const pendingConfirms = new Map<string, PendingConfirm>(); // chat -> confirm
let confirmSeq = 0;
const CONFIRM_TTL_MS = 120_000;

/** MCP 调用：发起审批，返回 Promise（由微信 Y/N 或超时 resolve） */
export function requestApproval(cmd: string, reason: string): Promise<{ approved: boolean; reason: string }> {
  return new Promise((resolve) => {
    const ctx = getTaskCtx();
    if (!ctx) return resolve({ approved: false, reason: 'no_active_task' });
    // 同 chat 已有挂起审批：先取消旧的（串行审批）
    const old = pendingConfirms.get(ctx.chat);
    if (old) { clearTimeout(old.timer); old.resolve({ approved: false, reason: 'superseded' }); pendingConfirms.delete(ctx.chat); }

    const id = ++confirmSeq;
    const chat = ctx.chat;
    const timer = setTimeout(() => {
      const p = pendingConfirms.get(chat);
      if (p && p.id === id) {
        pendingConfirms.delete(chat);
        setPendingConfirm(chat, null);
        void notify(chat, `⏳ [审批 #${id}] 超时未回复，默认拒绝。任务继续（命令未执行）。`);
        resolve({ approved: false, reason: 'timeout' });
      }
    }, CONFIRM_TTL_MS);
    timer.unref?.();
    pendingConfirms.set(chat, { id, chat, cmd, reason, resolve, createdAt: Date.now(), timer });
    setPendingConfirm(chat, String(id));
    trace(chat, 'L2', 'confirm_requested', { id, cmd: cmd.slice(0, 120), reason: reason.slice(0, 120) }, undefined, { req_id: ctx.reqId, risk_flag: 1 });
    auditFull({ type: 'confirm_requested', id, chat, req_id: ctx.reqId, cmd, reason, ts: Date.now() });
    void notify(chat, `⚠️ [审批 #${id}] 申请执行:\n${cmd}\n原因: ${reason || '(未说明)'}\n请回复 Y 或 N（2分钟内有效）`);
  });
}

/** L0 调用：该会话是否有挂起审批（返回审批号字符串，如 "#3"） */
export function hasPendingConfirm(chatId: string): string | null {
  const p = pendingConfirms.get(chatId);
  return p ? `#${p.id}` : null;
}

/** 实际裁决：用户回复 Y/N 后由 L0 调用。isAdmin=false（群聊非管理员）不允许批准 */
export function resolveApproval(chatId: string, approved: boolean, isAdmin: boolean): boolean {
  const p = pendingConfirms.get(chatId);
  if (!p) return false;
  if (!isAdmin) return false;
  clearTimeout(p.timer);
  pendingConfirms.delete(chatId);
  setPendingConfirm(chatId, null);
  p.resolve({ approved, reason: approved ? 'user_approved' : 'user_denied' });
  trace(chatId, 'L2', approved ? 'confirm_approved' : 'confirm_denied', { id: p.id, cmd: p.cmd.slice(0, 120) }, undefined, { risk_flag: approved ? 2 : 1 });
  auditFull({ type: approved ? 'confirm_approved' : 'confirm_denied', id: p.id, chat: chatId, cmd: p.cmd, ts: Date.now() });
  void notify(chatId, approved ? `✅ [审批 #${p.id}] 已批准，命令将继续执行。` : `❌ [审批 #${p.id}] 已拒绝。`);
  return true;
}

// ============ 通道 B：hazard 熔断 + /approve 一次性金牌重放 ============
export interface HazardArchive {
  id: number;
  chat: string;
  prompt: string;
  cmd: string;
  label: string;
  createdAt: number;
}
let hazardArchive: HazardArchive | null = null; // 同一时间只保留最近一条（单任务模型）
let hazardSeq = 0;

export function recordHazard(label: string, cmd: string): HazardArchive | null {
  const ctx = getTaskCtx();
  if (!ctx) return null;
  hazardArchive = { id: ++hazardSeq, chat: ctx.chat, prompt: ctx.prompt, cmd, label, createdAt: Date.now() };
  trace(ctx.chat, 'L2', 'hazard_archived', { id: hazardArchive.id, label, cmd: cmd.slice(0, 120) }, undefined, { req_id: ctx.reqId, risk_flag: 1 });
  auditFull({ type: 'hazard_archived', id: hazardArchive.id, chat: ctx.chat, req_id: ctx.reqId, label, cmd, ts: Date.now() });
  void notify(ctx.chat,
    `⚠️ 已拦截高危命令（${label}）：\n${cmd}\n任务已强制中断。\n如确认要执行，回复 /approve 放行并自动重跑（命令加入白名单 60 秒）；否则请忽略。`);
  return hazardArchive;
}
/** /approve：取出待放行档案（5 分钟内有效） */
export function consumeHazard(chatId: string): HazardArchive | null {
  if (!hazardArchive) return null;
  if (hazardArchive.chat !== chatId) return null;
  if (Date.now() - hazardArchive.createdAt > 5 * 60_000) { hazardArchive = null; return null; }
  const h = hazardArchive;
  hazardArchive = null;
  return h;
}

// ============ Cron 调度器 ============
type JobRow = {
  id: string; chat_id: string; cron_expr: string | null; run_at: number;
  prompt_payload: string; persona_id: string; enabled: number; last_run_at: number | null; last_status: string | null;
};
let jobHandler: ((job: JobRow) => Promise<void>) | null = null;
export function setJobHandler(fn: (job: JobRow) => Promise<void>): void { jobHandler = fn; }

export function startScheduler(): void {
  const tick = async () => {
    try {
      const due = db.prepare('SELECT * FROM jobs WHERE enabled = 1 AND run_at <= ?').all(Date.now()) as JobRow[];
      for (const job of due) {
        // Turn Lease 排队锁：忙则跳过本轮，顺延
        const busy = db.prepare('SELECT turn_lease FROM sessions WHERE chat_id = ?').get(job.chat_id) as { turn_lease: number } | undefined;
        if (busy?.turn_lease === 1) {
          db.prepare('UPDATE jobs SET last_status = ?, run_at = ? WHERE id = ?').run('busy_skipped', nextSlot(job), job.id);
          trace(job.chat_id, 'SYS', 'cron_busy_skipped', { job: job.id });
          continue;
        }
        db.prepare('UPDATE jobs SET last_run_at = ?, last_status = ? WHERE id = ?').run(Date.now(), 'ok', job.id);
        trace(job.chat_id, 'SYS', 'cron_fired', { job: job.id, persona: job.persona_id }, undefined, { source: 'cron' });
        auditFull({ type: 'cron_fired', job: job.id, chat: job.chat_id, prompt: job.prompt_payload, ts: Date.now() });
        try {
          if (jobHandler) await jobHandler(job);
        } catch (e) {
          db.prepare('UPDATE jobs SET last_status = ? WHERE id = ?').run('error', job.id);
          trace(job.chat_id, 'SYS', 'cron_error', { job: job.id, err: String(e).slice(0, 150) }, undefined, { source: 'cron' });
        }
        // 一次性任务跑完即停；周期任务排下次
        if (job.cron_expr) {
          const nxt = nextRun(job.cron_expr, new Date());
          if (nxt) db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run(nxt, job.id);
          else db.prepare('UPDATE jobs SET enabled = 0 WHERE id = ?').run(job.id);
        } else {
          db.prepare('UPDATE jobs SET enabled = 0 WHERE id = ?').run(job.id);
        }
      }
    } catch { /* 调度失败不影响主流程 */ }
  };
  setInterval(() => void tick(), 15_000);
  void tick(); // 启动即扫一次（补跑停机窗口错过的任务）
  console.log('[control] cron scheduler started (15s tick)');
}

function nextSlot(job: JobRow): number {
  if (job.cron_expr) return nextRun(job.cron_expr, new Date()) ?? Date.now() + 3600_000;
  return Date.now() + 10 * 60_000; // 一次性任务忙时 10 分钟后重试
}

// ---- 极简 5 字段 cron 解析（分 时 日 月 周；支持 * */n a-b a,b）----
function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? parseInt(stepRaw, 10) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let lo = min, hi = max;
    if (range !== '*') {
      const m = range.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      lo = parseInt(m[1], 10);
      hi = m[2] ? parseInt(m[2], 10) : lo;
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}
export function nextRun(expr: string, from: Date): number | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const min = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23),
    dom = parseField(f[2], 1, 31), mon = parseField(f[3], 1, 12), dow = parseField(f[4], 0, 6);
  if (!min || !hour || !dom || !mon || !dow) return null;
  const d = new Date(from.getTime() + 60_000);
  d.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) { // 最多前搜一年
    if (min.has(d.getMinutes()) && hour.has(d.getHours()) && mon.has(d.getMonth() + 1)
      && dom.has(d.getDate()) && dow.has(d.getDay())) {
      return d.getTime();
    }
    d.setTime(d.getTime() + 60_000);
  }
  return null;
}

// ============ jobs 管理（L0 /cron 命令用） ============
export function listJobs(): JobRow[] {
  return db.prepare('SELECT * FROM jobs ORDER BY run_at').all() as JobRow[];
}
export function addJob(id: string, chatId: string, cronExpr: string | null, runAt: number, prompt: string, personaId: string): string {
  try {
    db.prepare('INSERT INTO jobs(id,chat_id,cron_expr,run_at,prompt_payload,persona_id,enabled) VALUES(?,?,?,?,?,?,1)')
      .run(id, chatId, cronExpr, runAt, prompt, personaId);
    return '';
  } catch (e) {
    return String(e).includes('UNIQUE') ? '任务 ID 已存在' : '创建失败';
  }
}
export function deleteJob(id: string): boolean {
  return (db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============ 审计：audit_full.jsonl（全量未裁剪 payload，10MB 轮转） ============
const AUDIT_FILE = join(config.dbPath, '..', 'audit_full.jsonl');
const AUDIT_MAX = 10 * 1024 * 1024;
export function auditFull(entry: Record<string, unknown>): void {
  try {
    if (existsSync(AUDIT_FILE) && statSync(AUDIT_FILE).size > AUDIT_MAX) {
      renameSync(AUDIT_FILE, AUDIT_FILE.replace('.jsonl', `.${Date.now()}.jsonl`));
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch { /* 审计失败不影响主流程 */ }
}

// ============ 通知（control 自持 mini sender，避免与 pipeline 循环依赖） ============
async function notify(chat: string, text: string): Promise<void> {
  const batch: WxOutboundBatch = quickBatch(chat, text);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    await fetch(config.bridgeOutUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch), signal: ctl.signal });
    clearTimeout(timer);
  } catch { /* 通知失败静默 */ }
}

// ============ 启动 ============
export function initControlPlane(): void {
  migrate();
  loadPersonas();
  loadBlocklist();
  // 重启自愈：清孤儿租约（上次进程被杀时 turn_lease 残留 1 会永久卡死新任务）
  const cleared = (db.prepare("UPDATE sessions SET turn_lease = 0 WHERE turn_lease = 1").run().changes ?? 0);
  // 内存审批 Map 已随旧进程消失，DB 残留的 pending_confirm_id 一并清掉
  db.prepare('UPDATE sessions SET pending_confirm_id = NULL WHERE pending_confirm_id IS NOT NULL').run();
  if (cleared) console.log(`[control] 启动自愈：重置 ${cleared} 个孤儿租约`);
  console.log(`[control] personas=${personaCache.size} jobs=${listJobs().length}`);
}

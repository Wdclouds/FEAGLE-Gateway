import { db, trace } from '../db.js';
import { auditFull, notifyChat } from './audit.js';
import type { Persona } from './migrations.js';
import { getPersona } from './sandbox.js';

export type GatewayMode = 'chat' | 'sentry' | 'mute';

export interface SessionRow {
  chat_id: string;
  persona_id: string;
  workspace: string;
  pending_confirm_id: string | null;
  mode: GatewayMode;
}

function touchSessionRow(chatId: string): void {
  const now = Date.now();
  db.prepare('INSERT INTO sessions(chat_id, persona_id, updated_at) VALUES(?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET updated_at = ?')
    .run(chatId, 'nox', now, now);
}

export function getSession(chatId: string): SessionRow {
  touchSessionRow(chatId);
  const row = db.prepare('SELECT chat_id, persona_id, workspace, pending_confirm_id, mode FROM sessions WHERE chat_id = ?').get(chatId) as any;
  return {
    chat_id: row.chat_id,
    persona_id: row.persona_id || 'nox',
    workspace: row.workspace,
    pending_confirm_id: row.pending_confirm_id,
    mode: (['chat', 'sentry', 'mute'].includes(row.mode) ? row.mode : 'chat') as GatewayMode,
  };
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

export function toolAllowedForChat(chatId: string, tool: string, isOp = false): { allowed: boolean; persona: Persona } {
  const p = getPersona(getSession(chatId).persona_id, isOp, chatId);
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
const pendingConfirms = new Map<string, PendingConfirm>();
let confirmSeq = 0;
const CONFIRM_TTL_MS = 120_000;

export function requestApproval(cmd: string, reason: string): Promise<{ approved: boolean; reason: string }> {
  return new Promise((resolve) => {
    const ctx = getTaskCtx();
    if (!ctx) return resolve({ approved: false, reason: 'no_active_task' });
    const old = pendingConfirms.get(ctx.chat);
    if (old) {
      clearTimeout(old.timer);
      old.resolve({ approved: false, reason: 'superseded' });
      pendingConfirms.delete(ctx.chat);
    }

    const id = ++confirmSeq;
    const chat = ctx.chat;
    const timer = setTimeout(() => {
      const p = pendingConfirms.get(chat);
      if (p && p.id === id) {
        pendingConfirms.delete(chat);
        setPendingConfirm(chat, null);
        void notifyChat(chat, `⏳ [审批 #${id}] 超时未回复，默认拒绝。任务继续（命令未执行）。`);
        resolve({ approved: false, reason: 'timeout' });
      }
    }, CONFIRM_TTL_MS);
    timer.unref?.();
    pendingConfirms.set(chat, { id, chat, cmd, reason, resolve, createdAt: Date.now(), timer });
    setPendingConfirm(chat, String(id));
    trace(chat, 'L2', 'confirm_requested', { id, cmd: cmd.slice(0, 120), reason: reason.slice(0, 120) }, undefined, { req_id: ctx.reqId, risk_flag: 1 });
    auditFull({ type: 'confirm_requested', id, chat, req_id: ctx.reqId, cmd, reason, ts: Date.now() });
    void notifyChat(chat, `⚠️ [审批 #${id}] 申请执行:\n${cmd}\n原因: ${reason || '(未说明)'}\n请回复 Y 或 N（2分钟内有效）`);
  });
}

export function hasPendingConfirm(chatId: string): string | null {
  const p = pendingConfirms.get(chatId);
  return p ? `#${p.id}` : null;
}

export function resolveApproval(chatId: string, approved: boolean, isAdmin: boolean): boolean {
  const p = pendingConfirms.get(chatId);
  if (!p || !isAdmin) return false;
  clearTimeout(p.timer);
  pendingConfirms.delete(chatId);
  setPendingConfirm(chatId, null);
  p.resolve({ approved, reason: approved ? 'user_approved' : 'user_denied' });
  trace(chatId, 'L2', approved ? 'confirm_approved' : 'confirm_denied', { id: p.id, cmd: p.cmd.slice(0, 120) }, undefined, { risk_flag: approved ? 2 : 1 });
  auditFull({ type: approved ? 'confirm_approved' : 'confirm_denied', id: p.id, chat: chatId, cmd: p.cmd, ts: Date.now() });
  void notifyChat(chatId, approved ? `✅ [审批 #${p.id}] 已批准，命令将继续执行。` : `❌ [审批 #${p.id}] 已拒绝。`);
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
let hazardArchive: HazardArchive | null = null;
let hazardSeq = 0;

export function recordHazard(label: string, cmd: string): HazardArchive | null {
  const ctx = getTaskCtx();
  if (!ctx) return null;
  hazardArchive = { id: ++hazardSeq, chat: ctx.chat, prompt: ctx.prompt, cmd, label, createdAt: Date.now() };
  trace(ctx.chat, 'L2', 'hazard_archived', { id: hazardArchive.id, label, cmd: cmd.slice(0, 120) }, undefined, { req_id: ctx.reqId, risk_flag: 1 });
  auditFull({ type: 'hazard_archived', id: hazardArchive.id, chat: ctx.chat, req_id: ctx.reqId, label, cmd, ts: Date.now() });
  void notifyChat(ctx.chat,
    `⚠️ 已拦截高危命令（${label}）：\n${cmd}\n任务已强制中断。\n如确认要执行，回复 /approve 放行并自动重跑（命令加入白名单 60 秒）；否则请忽略。`);
  return hazardArchive;
}

export function consumeHazard(chatId: string): HazardArchive | null {
  if (!hazardArchive || hazardArchive.chat !== chatId) return null;
  if (Date.now() - hazardArchive.createdAt > 5 * 60_000) {
    hazardArchive = null;
    return null;
  }
  const h = hazardArchive;
  hazardArchive = null;
  return h;
}

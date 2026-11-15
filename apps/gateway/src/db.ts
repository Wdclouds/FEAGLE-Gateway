import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import type { TraceEntry } from './protocol.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS sessions (
  chat_id     TEXT PRIMARY KEY,
  turn_lease  INTEGER NOT NULL DEFAULT 0,   -- 0=空闲 1=占用（同一 chat 同时只有一个任务）
  pi_session  TEXT,                          -- Pi session id（可选恢复）
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trace_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  chat_id     TEXT NOT NULL,
  layer       TEXT NOT NULL,
  event       TEXT NOT NULL,
  detail      TEXT,
  latency_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trace_chat ON trace_logs(chat_id, ts DESC);
`);

const stmtSession = db.prepare(
  'INSERT INTO sessions(chat_id, updated_at) VALUES(?, ?) ON CONFLICT(chat_id) DO UPDATE SET updated_at = ?'
);
const stmtLease = db.prepare('UPDATE sessions SET turn_lease = ?, updated_at = ? WHERE chat_id = ?');
const stmtGetLease = db.prepare('SELECT turn_lease FROM sessions WHERE chat_id = ?');
// 懒加载：migrate() 补齐 req_id/source/risk_flag 列后再 prepare（避免 import 顺序死锁）
let stmtTrace: ReturnType<typeof db.prepare> | null = null;
function getStmtTrace() {
  if (!stmtTrace) {
    stmtTrace = db.prepare(
      'INSERT INTO trace_logs(ts, chat_id, layer, event, detail, latency_ms, req_id, source, risk_flag) VALUES(?,?,?,?,?,?,?,?,?)'
    );
  }
  return stmtTrace;
}

export interface TraceMeta {
  req_id?: string;
  source?: 'wx' | 'cron' | 'api';
  risk_flag?: 0 | 1 | 2;
}

export function touchSession(chatId: string): void {
  const now = Date.now();
  stmtSession.run(chatId, now, now);
}

export function getLease(chatId: string): boolean {
  const row = stmtGetLease.get(chatId) as { turn_lease: number } | undefined;
  return row ? row.turn_lease === 1 : false;
}

export function setLease(chatId: string, busy: boolean): void {
  touchSession(chatId);
  stmtLease.run(busy ? 1 : 0, Date.now(), chatId);
}

export function trace(chatId: string, layer: TraceEntry['layer'], event: string, detail?: unknown, latencyMs?: number, meta?: TraceMeta): void {
  try {
    getStmtTrace().run(
      Date.now(), chatId, layer, event,
      detail === undefined ? null : JSON.stringify(detail),
      latencyMs ?? null,
      meta?.req_id ?? null,
      meta?.source ?? 'wx',
      meta?.risk_flag ?? 0
    );
  } catch { /* 追踪失败不影响主流程 */ }
}

export function stats(): { sessions: number; traces: number } {
  const s = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  const t = (db.prepare('SELECT COUNT(*) AS n FROM trace_logs').get() as { n: number }).n;
  return { sessions: s, traces: t };
}

import { db, trace } from '../db.js';
import { auditFull } from './audit.js';

export type JobRow = {
  id: string;
  chat_id: string;
  cron_expr: string | null;
  run_at: number;
  prompt_payload: string;
  persona_id: string;
  enabled: number;
  last_run_at: number | null;
  last_status: string | null;
};

let jobHandler: ((job: JobRow) => Promise<void>) | null = null;
export function setJobHandler(fn: (job: JobRow) => Promise<void>): void {
  jobHandler = fn;
}

export function startScheduler(): void {
  const tick = async () => {
    try {
      const due = db.prepare('SELECT * FROM jobs WHERE enabled = 1 AND run_at <= ?').all(Date.now()) as JobRow[];
      for (const job of due) {
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
  void tick();
  console.log('[control] cron scheduler started (15s tick)');
}

function nextSlot(job: JobRow): number {
  if (job.cron_expr) return nextRun(job.cron_expr, new Date()) ?? Date.now() + 3600_000;
  return Date.now() + 10 * 60_000;
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? parseInt(stepRaw, 10) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let lo = min;
    let hi = max;
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
  const min = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const mon = parseField(f[3], 1, 12);
  const dow = parseField(f[4], 0, 6);
  if (!min || !hour || !dom || !mon || !dow) return null;
  const d = new Date(from.getTime() + 60_000);
  d.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (min.has(d.getMinutes()) && hour.has(d.getHours()) && mon.has(d.getMonth() + 1)
      && dom.has(d.getDate()) && dow.has(d.getDay())) {
      return d.getTime();
    }
    d.setTime(d.getTime() + 60_000);
  }
  return null;
}

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

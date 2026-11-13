import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { WxOutboundBatch } from '../protocol.js';
import { quickBatch } from '../sanitizer.js';

const AUDIT_FILE = join(config.dbPath, '..', 'audit_full.jsonl');
const AUDIT_MAX = 10 * 1024 * 1024;

/** 全量未裁剪 payload 审计日志（10MB 轮转） */
export function auditFull(entry: Record<string, unknown>): void {
  try {
    if (existsSync(AUDIT_FILE) && statSync(AUDIT_FILE).size > AUDIT_MAX) {
      renameSync(AUDIT_FILE, AUDIT_FILE.replace('.jsonl', `.${Date.now()}.jsonl`));
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch { /* 审计失败不影响主流程 */ }
}

/** 轻量通知发送器（避免与 pipeline 循环依赖） */
export async function notifyChat(chat: string, text: string): Promise<void> {
  const batch: WxOutboundBatch = quickBatch(chat, text);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    await fetch(config.bridgeOutUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: ctl.signal,
    });
    clearTimeout(timer);
  } catch { /* 通知失败静默 */ }
}

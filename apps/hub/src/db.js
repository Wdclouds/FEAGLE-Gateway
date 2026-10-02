import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.HUB_DB_PATH || path.join(DATA_DIR, 'hub.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// 开启 WAL 模式以支持高吞吐并发读写
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_sender TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS group_policies (
      group_id TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT NOT NULL,
      require_at INTEGER DEFAULT 1,
      response_mode TEXT DEFAULT 'SMART',
      version INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      operator TEXT NOT NULL,
      details TEXT NOT NULL,
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry_hourly (
      hour_key TEXT PRIMARY KEY,
      message_count INTEGER DEFAULT 0,
      active_groups INTEGER DEFAULT 0
    );
  `);

  // 默认管理员账号密码 admin / admin123
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM admins');
  const count = countStmt.get().count;
  if (count === 0) {
    const insertAdmin = db.prepare(`
      INSERT INTO admins (username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?)
    `);
    insertAdmin.run('admin', hashPassword('admin123'), 'admin', new Date().toISOString());
    console.log('[Hub DB] 初始化默认管理员账号：admin / admin123');
  }

  // 默认全局兜底策略 '*'
  const defaultPolicyStmt = db.prepare('SELECT COUNT(*) as count FROM group_policies WHERE group_id = ?');
  if (defaultPolicyStmt.get('*').count === 0) {
    const insertPolicy = db.prepare(`
      INSERT INTO group_policies (group_id, system_prompt, allowed_tools, require_at, response_mode, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertPolicy.run(
      '*',
      '你是由 Hermes 驱动的群聊智能助理，回答简练准确、技术硬核、温暖可靠。',
      JSON.stringify(['web_search']),
      1,
      'SMART',
      1,
      new Date().toISOString(),
    );
  }
}

// ---------------- Admin 模块 ----------------
export function findAdminByUsername(username) {
  const stmt = db.prepare('SELECT * FROM admins WHERE username = ?');
  return stmt.get(username);
}

// ---------------- Groups & Policies 模块 ----------------
export function listGroupsWithPolicies() {
  const stmt = db.prepare(`
    SELECT 
      g.group_id, g.name, g.last_seen_at, g.last_sender, g.message_count, g.status,
      COALESCE(p.system_prompt, dp.system_prompt) as system_prompt,
      COALESCE(p.allowed_tools, dp.allowed_tools) as allowed_tools,
      COALESCE(p.require_at, dp.require_at) as require_at,
      COALESCE(p.response_mode, dp.response_mode) as response_mode,
      COALESCE(p.version, 1) as policy_version,
      p.updated_at as policy_updated_at
    FROM groups g
    LEFT JOIN group_policies p ON g.group_id = p.group_id
    LEFT JOIN group_policies dp ON dp.group_id = '*'
    ORDER BY g.last_seen_at DESC
  `);
  return stmt.all().map((row) => ({
    ...row,
    allowed_tools: JSON.parse(row.allowed_tools || '[]'),
    require_at: Boolean(row.require_at),
  }));
}

export function upsertGroup(groupId, name, lastSender) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO groups (group_id, name, last_seen_at, last_sender, message_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(group_id) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE groups.name END,
      last_seen_at = excluded.last_seen_at,
      last_sender = excluded.last_sender,
      message_count = groups.message_count + 1
  `);
  stmt.run(String(groupId), name || `微信群 ${groupId}`, now, lastSender || '');
}

export function savePolicy(groupId, policy, operator = 'admin') {
  const now = new Date().toISOString();
  const existingStmt = db.prepare('SELECT version FROM group_policies WHERE group_id = ?');
  const existing = existingStmt.get(groupId);
  const nextVersion = existing ? existing.version + 1 : 1;

  const stmt = db.prepare(`
    INSERT INTO group_policies (group_id, system_prompt, allowed_tools, require_at, response_mode, version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      system_prompt = excluded.system_prompt,
      allowed_tools = excluded.allowed_tools,
      require_at = excluded.require_at,
      response_mode = excluded.response_mode,
      version = excluded.version,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    String(groupId),
    policy.systemPrompt || '智能助理',
    JSON.stringify(policy.allowedTools || ['web_search']),
    policy.requireAt ? 1 : 0,
    policy.responseMode || 'SMART',
    nextVersion,
    now,
  );

  addAuditLog(
    'POLICY_UPDATE',
    operator,
    `更新群策略 [${groupId}] 版本 v${nextVersion} (Tools: ${(policy.allowedTools || []).join(',')})`,
  );

  return { groupId, version: nextVersion, updatedAt: now };
}

// ---------------- 遥测与统计 ----------------
export function recordHourlyMetric(groupId) {
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:00`;
  const stmt = db.prepare(`
    INSERT INTO telemetry_hourly (hour_key, message_count, active_groups)
    VALUES (?, 1, 1)
    ON CONFLICT(hour_key) DO UPDATE SET
      message_count = telemetry_hourly.message_count + 1
  `);
  stmt.run(hourKey);
}

export function get24hTelemetry() {
  const stmt = db.prepare(`
    SELECT hour_key, message_count 
    FROM telemetry_hourly 
    ORDER BY hour_key DESC 
    LIMIT 24
  `);
  return stmt.all().reverse();
}

// ---------------- 审计日志 ----------------
export function addAuditLog(action, operator, details, ip = '') {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (action, operator, details, ip, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(action, operator, details, ip, new Date().toISOString());
}

export function listAuditLogs(limit = 50) {
  const stmt = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?');
  return stmt.all(limit);
}

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
    CREATE TABLE IF NOT EXISTS admins (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      username TEXT UNIQUE NOT NULL,\n      password_hash TEXT NOT NULL,\n      role TEXT DEFAULT 'admin',\n      created_at TEXT NOT NULL\n    );

    CREATE TABLE IF NOT EXISTS groups (\n      group_id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      last_seen_at TEXT NOT NULL,\n      last_sender TEXT DEFAULT '',\n      message_count INTEGER DEFAULT 0,\n      status TEXT DEFAULT 'ACTIVE'\n    );

    CREATE TABLE IF NOT EXISTS group_policies (\n      group_id TEXT PRIMARY KEY,\n      system_prompt TEXT NOT NULL,\n      allowed_tools TEXT NOT NULL,\n      require_at INTEGER DEFAULT 1,\n      response_mode TEXT DEFAULT 'SMART',\n      version INTEGER DEFAULT 1,\n      updated_at TEXT NOT NULL\n    );

    CREATE TABLE IF NOT EXISTS audit_logs (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      action TEXT NOT NULL,\n      operator TEXT NOT NULL,\n      details TEXT NOT NULL,\n      ip TEXT DEFAULT '',\n      created_at TEXT NOT NULL\n    );

    CREATE TABLE IF NOT EXISTS telemetry_hourly (\n      hour_key TEXT PRIMARY KEY,\n      message_count INTEGER DEFAULT 0,\n      active_groups INTEGER DEFAULT 0\n    );

    CREATE TABLE IF NOT EXISTS ignored_groups (\n      group_id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      reason TEXT DEFAULT 'USER_REMOVED',\n      ignored_at TEXT NOT NULL\n    );
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

export function isGroupIgnored(groupId) {
  const stmt = db.prepare('SELECT 1 FROM ignored_groups WHERE group_id = ?');
  return Boolean(stmt.get(String(groupId)));
}

export function upsertGroup(groupId, name, lastSender, lastSeenAt = null) {
  const gid = String(groupId);
  if (isGroupIgnored(gid)) {
    // 已被用户标记为移除/忽略的已退群，绝不自动插入复活
    return;
  }
  const now = new Date().toISOString();
  const effectiveLastSeen = lastSeenAt || now;
  const isSync = Boolean(lastSeenAt);

  const stmt = db.prepare(`
    INSERT INTO groups (group_id, name, last_seen_at, last_sender, message_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(group_id) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE groups.name END,
      last_seen_at = CASE 
        WHEN ? THEN COALESCE(groups.last_seen_at, excluded.last_seen_at)
        ELSE excluded.last_seen_at 
      END,
      last_sender = CASE 
        WHEN excluded.last_sender != '' THEN excluded.last_sender 
        ELSE groups.last_sender 
      END,
      message_count = CASE 
        WHEN ? THEN groups.message_count 
        ELSE groups.message_count + 1 
      END
  `);
  stmt.run(gid, name || `微信群 ${gid}`, effectiveLastSeen, lastSender || '', isSync ? 1 : 0, isSync ? 1 : 0);
}

/** 移除已退群聊并移入墓地隔离表，防止网关轮询复活 */
export function deleteGroup(groupId, operator = 'admin') {
  const gid = String(groupId);
  const group = db.prepare('SELECT name FROM groups WHERE group_id = ?').get(gid);
  const groupName = group ? group.name : `群 ${gid}`;
  const now = new Date().toISOString();

  // 1. 记入忽略墓地表
  const ignoreStmt = db.prepare(`
    INSERT INTO ignored_groups (group_id, name, reason, ignored_at)
    VALUES (?, ?, 'USER_REMOVED', ?)
    ON CONFLICT(group_id) DO UPDATE SET ignored_at = excluded.ignored_at
  `);
  ignoreStmt.run(gid, groupName, now);

  // 2. 从活跃群表与策略表中清除
  db.prepare('DELETE FROM groups WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM group_policies WHERE group_id = ?').run(gid);

  // 3. 记录审计日志
  addAuditLog(
    'REMOVE_GROUP',
    operator,
    `移除了已退微信群 [${groupName}] (ID: ${gid})，并封存入防复活隔离表`,
  );

  return { success: true, groupId: gid, name: groupName };
}

/** 一键清理超过指定天数未活跃的僵尸/已退群聊 */
export function cleanStaleGroups(days = 30, operator = 'admin') {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const staleGroups = db.prepare('SELECT group_id, name, last_seen_at FROM groups WHERE last_seen_at < ?').all(cutoff);

  for (const g of staleGroups) {
    deleteGroup(g.group_id, operator);
  }

  addAuditLog(
    'CLEAN_STALE_GROUPS',
    operator,
    `一键清理超过 ${days} 天未活跃的历史群聊，共归档清理 ${staleGroups.length} 个群`,
  );

  return {
    cleanedCount: staleGroups.length,
    groups: staleGroups,
  };
}

export function savePolicy(groupId, policy, operator = 'admin') {
  const now = new Date().toISOString();
  const existingStmt = db.prepare('SELECT version FROM group_policies WHERE group_id = ?');
  const existing = existingStmt.get(groupId);
  const nextVersion = existing ? existing.version + 1 : 1;

  const prompt = policy.systemPrompt ?? policy.system_prompt ?? '智能助理';
  const tools = policy.allowedTools ?? policy.allowed_tools ?? ['web_search'];
  const requireAt = policy.requireAt ?? policy.require_at ?? 1;
  const responseMode = policy.responseMode ?? policy.response_mode ?? 'SMART';

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
    prompt,
    JSON.stringify(tools),
    requireAt ? 1 : 0,
    responseMode,
    nextVersion,
    now,
  );

  addAuditLog(
    'POLICY_UPDATE',
    operator,
    `更新群策略 [${groupId}] 版本 v${nextVersion} (Tools: ${tools.join(',')})`,
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

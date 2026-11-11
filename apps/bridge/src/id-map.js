import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveDataPath } from './paths.js';

const ID_FLOOR = 1_000_000_000;

export function isTestOrSystemTalker(talker) {
  if (!talker) return false;
  const lower = String(talker).trim().toLowerCase();
  return (
    lower.startsWith('test_') ||
    lower.startsWith('e2e_') ||
    lower.startsWith('qc_') ||
    lower.startsWith('notify:') ||
    lower.startsWith('gh_') ||
    lower === 'filehelper' ||
    lower === 'fmessage' ||
    lower === 'newsapp' ||
    lower === 'weixin'
  );
}

export class IdMap {
  constructor(path = resolveDataPath('wechat/mapping.sqlite')) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entities (
        onebot_id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        protocol_id TEXT NOT NULL,
        stable_key TEXT,
        nickname TEXT,
        last_seen_at TEXT NOT NULL,
        UNIQUE(kind, protocol_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_stable
        ON entities(kind, stable_key);
      CREATE TABLE IF NOT EXISTS messages (
        onebot_message_id INTEGER PRIMARY KEY AUTOINCREMENT,
        wechat_message_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_wechat_id
        ON messages(wechat_message_id);
      CREATE TABLE IF NOT EXISTS message_receipts (
        wechat_message_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_receipts_created
        ON message_receipts(created_at);
      CREATE TABLE IF NOT EXISTS contacts (
        talker TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('group','private')),
        name TEXT NOT NULL,
        avatar_base64 TEXT NOT NULL DEFAULT '',
        member_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contact_exclusions (
        talker TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_settings (
        talker TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'ignored', 'exited')),
        pinned INTEGER NOT NULL DEFAULT 0,
        alias TEXT,
        tags TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  entity(kind, protocolId, stableKey = '', nickname = '') {
    const now = new Date().toISOString();

    // 智能昵称反查：如果传入的昵称为空或占位符，自动从 contacts 真实联系人表反查
    if (!nickname || nickname === 'WeChat contact' || nickname === 'Group member' || nickname === 'Android group') {
      try {
        const contactRow = this.db.prepare('SELECT name FROM contacts WHERE talker = ?').get(protocolId);
        if (contactRow && contactRow.name) {
          nickname = contactRow.name;
        }
      } catch {}
    }

    let row = this.db.prepare(
      'SELECT onebot_id, nickname FROM entities WHERE kind = ? AND protocol_id = ?',
    ).get(kind, protocolId);

    if (!row && stableKey) {
      row = this.db.prepare(
        'SELECT onebot_id, nickname FROM entities WHERE kind = ? AND stable_key = ?',
      ).get(kind, stableKey);
    }

    if (row) {
      // 避免用占位符覆盖已经具有的真实昵称
      let finalNickname = nickname;
      if ((!finalNickname || finalNickname === 'WeChat contact' || finalNickname === 'Group member') && row.nickname) {
        finalNickname = row.nickname;
      }

      this.db.prepare(`
        UPDATE entities
        SET protocol_id = ?, stable_key = ?, nickname = ?, last_seen_at = ?
        WHERE onebot_id = ?
      `).run(protocolId, stableKey || null, finalNickname || null, now, row.onebot_id);
      return Number(row.onebot_id);
    }

    const maxRow = this.db.prepare(
      'SELECT COALESCE(MAX(onebot_id), ?) AS max_id FROM entities',
    ).get(ID_FLOOR);
    const onebotId = Number(maxRow.max_id) + 1;
    this.db.prepare(`
      INSERT INTO entities
        (onebot_id, kind, protocol_id, stable_key, nickname, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      onebotId,
      kind,
      protocolId,
      stableKey || null,
      nickname || null,
      now,
    );
    return onebotId;
  }

  /** 根据微信 protocol_id 或 onebot_id 智能解析真实昵称/备注名 */
  resolveNickname(protocolIdOrOnebotId, fallback = '') {
    if (!protocolIdOrOnebotId) return fallback;
    const target = String(protocolIdOrOnebotId).trim();
    try {
      // 1. 优先查 contacts 真实联系人表
      const cRow = this.db.prepare('SELECT name FROM contacts WHERE talker = ?').get(target);
      if (cRow && cRow.name && cRow.name.trim()) return cRow.name.trim();

      // 2. 查 entities 映射表 (按 protocol_id 或 onebot_id)
      let eRow = null;
      if (/^\d+$/.test(target)) {
        eRow = this.db.prepare('SELECT nickname FROM entities WHERE onebot_id = ?').get(Number(target));
      }
      if (!eRow || !eRow.nickname) {
        eRow = this.db.prepare('SELECT nickname FROM entities WHERE protocol_id = ?').get(target);
      }
      if (eRow && eRow.nickname && eRow.nickname !== 'WeChat contact' && eRow.nickname !== 'Group member') {
        return eRow.nickname.trim();
      }
    } catch {}
    return fallback;
  }

  protocolId(onebotId, kind = 'user') {
    const row = this.db.prepare(
      'SELECT protocol_id FROM entities WHERE onebot_id = ? AND kind = ?',
    ).get(Number(onebotId), kind);
    return row?.protocol_id || null;
  }

  contact(onebotId) {
    return this.db.prepare(`
      SELECT onebot_id, protocol_id, nickname
      FROM entities WHERE onebot_id = ?
    `).get(Number(onebotId)) || null;
  }

  /** 列出已知群实体（Dashboard 重启后恢复群列表用，group 实体已持久化）。 */
  listGroups({ includeExited = false } = {}) {
    let hasContactsGroup = false;
    try {
      const cRow = this.db.prepare("SELECT 1 FROM contacts WHERE kind = 'group' LIMIT 1").get();
      if (cRow) hasContactsGroup = true;
    } catch {}

    let rows;
    if (!includeExited && hasContactsGroup) {
      rows = this.db.prepare(`
        SELECT e.onebot_id, e.protocol_id, COALESCE(c.name, e.nickname) AS nickname, e.last_seen_at,
               c.member_count, COALESCE(cs.status, 'active') AS status
        FROM entities e
        INNER JOIN contacts c ON c.talker = e.protocol_id AND c.kind = 'group'
        LEFT JOIN conversation_settings cs ON cs.talker = e.protocol_id
        LEFT JOIN contact_exclusions ce ON ce.talker = e.protocol_id
        WHERE e.kind = 'group'
          AND ce.talker IS NULL
          AND (cs.status IS NULL OR cs.status != 'ignored')
          AND NOT (e.protocol_id LIKE 'test_%' OR e.protocol_id LIKE 'e2e_%')
        ORDER BY e.last_seen_at DESC
      `).all();
    } else {
      rows = this.db.prepare(`
        SELECT e.onebot_id, e.protocol_id, COALESCE(c.name, e.nickname) AS nickname, e.last_seen_at,
               COALESCE(c.member_count, 0) AS member_count,
               CASE
                 WHEN ce.talker IS NOT NULL THEN 'ignored'
                 WHEN cs.status IS NOT NULL THEN cs.status
                 WHEN e.protocol_id LIKE 'test_%' OR e.protocol_id LIKE 'e2e_%' THEN 'test_internal'
                 WHEN ? = 1 AND c.talker IS NULL THEN 'exited'
                 ELSE 'active'
               END AS status
        FROM entities e
        LEFT JOIN contacts c ON c.talker = e.protocol_id
        LEFT JOIN conversation_settings cs ON cs.talker = e.protocol_id
        LEFT JOIN contact_exclusions ce ON ce.talker = e.protocol_id
        WHERE e.kind = 'group'
        ORDER BY e.last_seen_at DESC
      `).all(hasContactsGroup ? 1 : 0);
    }

    return rows.map((row) => ({
      groupId: String(row.onebot_id),
      protocolId: String(row.protocol_id),
      name: String(row.nickname || '微信群').slice(0, 80),
      memberCount: Number(row.member_count || 0),
      lastSeenAt: String(row.last_seen_at || ''),
      status: String(row.status || 'active'),
      isExited: row.status === 'exited',
    }));
  }

  /**
   * 现代化 Web 前端统一会话列表接口。
   * 自动聚合 entities、contacts、conversation_settings、contact_exclusions，
   * 智能识别 active / exited / archived / ignored / test_internal 状态。
   */
  listConversations({
    status = 'active',
    kind = 'all',
    search = '',
    includeExited = false,
    includeTest = false,
    includeIgnored = false,
    includeArchived = false,
    limit = 100,
  } = {}) {
    let hasContactsGroup = false;
    try {
      const cRow = this.db.prepare("SELECT 1 FROM contacts WHERE kind = 'group' LIMIT 1").get();
      if (cRow) hasContactsGroup = true;
    } catch {}

    const query = `
      SELECT e.onebot_id, e.kind, e.protocol_id, e.nickname, e.last_seen_at,
             c.name as contact_name, c.avatar_base64, c.member_count,
             cs.status as custom_status, cs.pinned, cs.alias,
             ce.reason as exclusion_reason
      FROM entities e
      LEFT JOIN contacts c ON c.talker = e.protocol_id
      LEFT JOIN conversation_settings cs ON cs.talker = e.protocol_id
      LEFT JOIN contact_exclusions ce ON ce.talker = e.protocol_id
      WHERE e.kind IN ('group', 'user')
      ORDER BY COALESCE(cs.pinned, 0) DESC, e.last_seen_at DESC
    `;
    const rows = this.db.prepare(query).all();

    const result = [];
    const counts = { total: 0, active: 0, exited: 0, archived: 0, ignored: 0 };

    for (const row of rows) {
      const talker = String(row.protocol_id);
      const isGrp = row.kind === 'group';
      const isTest = isTestOrSystemTalker(talker);

      let convStatus = 'active';
      if (row.exclusion_reason) {
        convStatus = 'ignored';
      } else if (row.custom_status) {
        convStatus = row.custom_status;
      } else if (isTest) {
        convStatus = 'test_internal';
      } else if (isGrp && hasContactsGroup && !row.contact_name) {
        convStatus = 'exited';
      }

      counts.total += 1;
      if (convStatus === 'active') counts.active += 1;
      else if (convStatus === 'exited') counts.exited += 1;
      else if (convStatus === 'archived') counts.archived += 1;
      else if (convStatus === 'ignored') counts.ignored += 1;

      if (!includeTest && convStatus === 'test_internal') continue;
      if (kind !== 'all') {
        const targetKind = kind === 'group' ? 'group' : 'user';
        if (row.kind !== targetKind) continue;
      }
      if (status !== 'all') {
        if (status === 'active') {
          if (convStatus !== 'active') {
            if (convStatus === 'exited' && !includeExited) continue;
            if (convStatus === 'archived' && !includeArchived) continue;
            if (convStatus === 'ignored' && !includeIgnored) continue;
            if (convStatus !== 'exited' && convStatus !== 'archived' && convStatus !== 'ignored') continue;
          }
        } else if (convStatus !== status) {
          continue;
        }
      }

      const name = String(row.alias || row.contact_name || row.nickname || (isGrp ? '微信群' : '联系人')).slice(0, 80);
      if (search) {
        const q = search.trim().toLowerCase();
        if (!name.toLowerCase().includes(q) && !talker.toLowerCase().includes(q)) {
          continue;
        }
      }

      result.push({
        id: String(row.onebot_id),
        talker,
        kind: isGrp ? 'group' : 'private',
        name,
        alias: String(row.alias || ''),
        avatarBase64: String(row.avatar_base64 || ''),
        memberCount: Number(row.member_count || 0),
        status: convStatus,
        isExited: convStatus === 'exited',
        isExcluded: convStatus === 'ignored' || Boolean(row.exclusion_reason),
        pinned: Boolean(row.pinned),
        lastSeenAt: String(row.last_seen_at || ''),
      });

      if (result.length >= limit) break;
    }

    return { conversations: result, counts };
  }

  /** 设置会话状态、备注或置顶 */
  setConversationStatus(talker, status, { reason = '', alias = null, pinned = null } = {}) {
    const validStatuses = new Set(['active', 'archived', 'ignored', 'exited']);
    if (!validStatuses.has(status)) {
      throw new TypeError(`Invalid status: ${status}. Must be one of: active, archived, ignored, exited`);
    }
    const t = String(talker).trim();
    const now = new Date().toISOString();

    const existing = this.db.prepare('SELECT * FROM conversation_settings WHERE talker = ?').get(t);
    const finalPinned = pinned !== null ? (pinned ? 1 : 0) : (existing?.pinned || 0);
    const finalAlias = alias !== null ? String(alias) : (existing?.alias || null);

    this.db.prepare(`
      INSERT INTO conversation_settings (talker, status, pinned, alias, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(talker) DO UPDATE SET
        status = excluded.status,
        pinned = excluded.pinned,
        alias = excluded.alias,
        updated_at = excluded.updated_at
    `).run(t, status, finalPinned, finalAlias, now);

    if (status === 'ignored') {
      this.db.prepare(`
        INSERT OR REPLACE INTO contact_exclusions (talker, reason, created_at)
        VALUES (?, ?, ?)
      `).run(t, reason || 'Dashboard/API 排除', now);
    } else {
      this.db.prepare('DELETE FROM contact_exclusions WHERE talker = ?').run(t);
    }

    return {
      talker: t,
      status,
      pinned: finalPinned === 1,
      alias: finalAlias,
      updatedAt: now,
    };
  }

  /**
   * 自动清理无用会话生命周期：
   * 1. 扫描 groups，将不在 contacts 真实群表中的群自动标注为 exited；
   * 2. 清理无历史消息的 e2e/qc/test 等测试内部 entity 记录；
   * 3. 返回清理指标与当前活跃会话数。
   */
  pruneStaleEntities() {
    let hasContactsGroup = false;
    try {
      const cRow = this.db.prepare("SELECT 1 FROM contacts WHERE kind = 'group' LIMIT 1").get();
      if (cRow) hasContactsGroup = true;
    } catch {}

    let markedExited = 0;
    const now = new Date().toISOString();

    if (hasContactsGroup) {
      const exitedGroups = this.db.prepare(`
        SELECT e.protocol_id
        FROM entities e
        LEFT JOIN contacts c ON c.talker = e.protocol_id
        WHERE e.kind = 'group' AND c.talker IS NULL
          AND NOT (e.protocol_id LIKE 'test_%' OR e.protocol_id LIKE 'e2e_%')
      `).all();

      const markStmt = this.db.prepare(`
        INSERT INTO conversation_settings (talker, status, updated_at)
        VALUES (?, 'exited', ?)
        ON CONFLICT(talker) DO UPDATE SET status = 'exited', updated_at = excluded.updated_at
      `);

      for (const g of exitedGroups) {
        markStmt.run(g.protocol_id, now);
        markedExited += 1;
      }
    }

    const testEntities = this.db.prepare(`
      SELECT onebot_id, protocol_id FROM entities
      WHERE (protocol_id LIKE 'e2e_%' OR protocol_id LIKE 'qc_%' OR protocol_id LIKE 'test_%')
    `).all();

    let cleaned = 0;
    const delEntity = this.db.prepare('DELETE FROM entities WHERE onebot_id = ?');
    for (const te of testEntities) {
      const hasMsg = this.db.prepare(`
        SELECT 1 FROM messages
        WHERE event_json LIKE ? OR event_json LIKE ? OR event_json LIKE ?
        LIMIT 1
      `).get(`%"${te.protocol_id}"%`, `%"group_id":${te.onebot_id}%`, `%"user_id":${te.onebot_id}%`);
      if (!hasMsg) {
        delEntity.run(te.onebot_id);
        cleaned += 1;
      }
    }

    const convInfo = this.listConversations({ status: 'active' });

    return {
      markedExited,
      testCleaned: cleaned,
      activeCount: convInfo.counts.active,
      totalCount: convInfo.counts.total,
    };
  }

  /** 获取单会话历史消息 */
  getConversationMessages(kind, { onebotId = null, talker = null, limit = 50, beforeId = null } = {}) {
    let targetOnebotId = onebotId;
    if (!targetOnebotId && talker) {
      const eRow = this.db.prepare('SELECT onebot_id FROM entities WHERE protocol_id = ?').get(talker);
      if (eRow) targetOnebotId = Number(eRow.onebot_id);
    }

    let sql = 'SELECT onebot_message_id, wechat_message_id, event_json, created_at FROM messages WHERE 1=1';
    const params = [];

    if (beforeId) {
      sql += ' AND onebot_message_id < ?';
      params.push(Number(beforeId));
    }

    if (targetOnebotId) {
      if (kind === 'group') {
        sql += ' AND (event_json LIKE ? OR event_json LIKE ?)';
        params.push(`%"group_id":${targetOnebotId}%`, `%"group_id":"${targetOnebotId}"%`);
      } else {
        sql += ' AND (event_json LIKE ? OR event_json LIKE ?)';
        params.push(`%"user_id":${targetOnebotId}%`, `%"user_id":"${targetOnebotId}"%`);
      }
    } else if (talker) {
      sql += ' AND event_json LIKE ?';
      params.push(`%"${talker}"%`);
    }

    sql += ' ORDER BY onebot_message_id DESC LIMIT ?';
    params.push(Math.min(limit, 200));

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => {
      let event = null;
      try { event = JSON.parse(r.event_json); } catch {}
      return {
        messageId: Number(r.onebot_message_id),
        wechatMessageId: String(r.wechat_message_id),
        createdAt: String(r.created_at),
        event,
      };
    });
  }

  contacts(kind = 'user') {
    return this.db.prepare(`
      SELECT onebot_id, protocol_id, nickname
      FROM entities WHERE kind = ?
      ORDER BY nickname, onebot_id
    `).all(kind);
  }

  /**
   * 静默联系人同步（2026-08-13）：以 Agent 的完整快照为唯一事实源，
   * 一次事务内完成 插入/更新/物理删除，全部成功才 COMMIT，否则 ROLLBACK。
   *
   * 快照必须是完整快照（full === true 才执行删除；否则只做 upsert）。
   * 快照校验失败、解析失败、事务失败时抛错，contacts 表保持原状——
   * 不触碰 entities（OneBot 数字 ID 映射）、messages、message_receipts，
   * 避免旧消息引用失效。
   *
   * @param {object} snapshot { generatedAt, groups, privates, full }
   * @param {{afterStage?: () => void}} [options] afterStage 仅在事务内
   *   staged 完成后、COMMIT 前调用（测试注入事务失败用）。
   * @returns {{inserted: number, updated: number, deleted: number}}
   */
  syncContacts(snapshot, { afterStage } = {}) {
    const { groups, privates, full } = normalizeContactsSnapshot(snapshot);
    const rows = [
      ...groups.map((row) => ({ ...row, kind: 'group' })),
      ...privates.map((row) => ({ ...row, kind: 'private' })),
    ];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let inserted = 0;
      let updated = 0;
      const exists = this.db.prepare(
        'SELECT 1 AS one FROM contacts WHERE talker = ?',
      );
      const upsert = this.db.prepare(`
        INSERT INTO contacts (talker, kind, name, avatar_base64, member_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(talker) DO UPDATE SET
          kind = excluded.kind,
          name = excluded.name,
          avatar_base64 = excluded.avatar_base64,
          member_count = excluded.member_count,
          updated_at = excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const row of rows) {
        const previous = exists.get(row.talker);
        upsert.run(
          row.talker,
          row.kind,
          row.name,
          row.avatarBase64,
          row.memberCount,
          now,
        );
        if (previous) updated += 1;
        else inserted += 1;
      }
      let deleted = 0;
      if (full) {
        const keep = new Set(rows.map((row) => row.talker));
        const existing = this.db.prepare(
          'SELECT talker FROM contacts',
        ).all();
        const remove = this.db.prepare(
          'DELETE FROM contacts WHERE talker = ?',
        );
        for (const row of existing) {
          const talker = String(row.talker);
          if (keep.has(talker)) continue;
          deleted += Number(remove.run(talker).changes);
        }
      }
      if (typeof afterStage === 'function') afterStage();
      this.db.exec('COMMIT');
      return { inserted, updated, deleted };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 事务可能已被 SQLite 自动回滚，忽略
      }
      throw error;
    }
  }

  /** 列出联系人展示表全部行（talker 稳定主键；不用于身份映射）。 */
  listContacts() {
    return this.db.prepare(`
      SELECT talker, kind, name, avatar_base64, member_count, updated_at
      FROM contacts
      ORDER BY kind, name, talker
    `).all().map((row) => ({
      talker: String(row.talker),
      kind: String(row.kind),
      name: String(row.name),
      avatarBase64: String(row.avatar_base64 || ''),
      memberCount: Number(row.member_count || 0),
      updatedAt: String(row.updated_at || ''),
    }));
  }

  storeMessage(wechatMessageId, event) {
    const normalizedMessageId = String(wechatMessageId || '');
    if (normalizedMessageId) {
      const existing = this.db.prepare(
        'SELECT onebot_message_id FROM messages WHERE wechat_message_id = ? ORDER BY onebot_message_id LIMIT 1',
      ).get(normalizedMessageId);
      if (existing) {
        this.updateMessage(existing.onebot_message_id, event);
        return Number(existing.onebot_message_id);
      }
    }
    const result = this.db.prepare(`
      INSERT INTO messages (wechat_message_id, event_json, created_at)
      VALUES (?, ?, ?)
    `).run(
      normalizedMessageId,
      JSON.stringify(event),
      new Date().toISOString(),
    );
    return Number(result.lastInsertRowid);
  }

  updateMessage(onebotMessageId, event) {
    this.db.prepare(
      'UPDATE messages SET event_json = ? WHERE onebot_message_id = ?',
    ).run(JSON.stringify(event), Number(onebotMessageId));
  }

  message(onebotMessageId) {
    const row = this.db.prepare(
      'SELECT event_json FROM messages WHERE onebot_message_id = ?',
    ).get(Number(onebotMessageId));
    return row ? JSON.parse(row.event_json) : null;
  }

  claimMessage(wechatMessageId, kind = 'private') {
    const messageId = String(wechatMessageId || '').trim();
    if (!messageId) return true;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO message_receipts
        (wechat_message_id, kind, status, created_at, updated_at)
      VALUES (?, ?, 'RECEIVED', ?, ?)
    `).run(messageId, kind, now, now);
    return Number(result.changes) === 1;
  }

  updateMessageReceipt(wechatMessageId, status) {
    const messageId = String(wechatMessageId || '').trim();
    if (!messageId) return;
    this.db.prepare(`
      UPDATE message_receipts
      SET status = ?, updated_at = ?
      WHERE wechat_message_id = ?
    `).run(String(status || 'UNKNOWN'), new Date().toISOString(), messageId);
  }

  messageReceipt(wechatMessageId) {
    const messageId = String(wechatMessageId || '').trim();
    if (!messageId) return null;
    return this.db.prepare(`
      SELECT wechat_message_id, kind, status, created_at, updated_at
      FROM message_receipts
      WHERE wechat_message_id = ?
    `).get(messageId) || null;
  }

  releaseMessageReceipt(wechatMessageId) {
    const messageId = String(wechatMessageId || '').trim();
    if (!messageId) return false;
    const result = this.db.prepare(`
      DELETE FROM message_receipts
      WHERE wechat_message_id = ? AND status = 'RECEIVED'
    `).run(messageId);
    return Number(result.changes) === 1;
  }

  pruneMessageReceipts(retentionMs = 7 * 24 * 60 * 60_000) {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    return Number(this.db.prepare(
      'DELETE FROM message_receipts WHERE created_at < ?',
    ).run(cutoff).changes);
  }

  close() {
    this.db.close();
  }
}

const CONTACT_NAME_MAX = 80;
const CONTACT_AVATAR_MAX = 512_000;

function normalizeContactsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('contacts_snapshot 必须是对象');
  }
  const generatedAt = typeof snapshot.generatedAt === 'string'
    ? snapshot.generatedAt.trim()
    : '';
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('contacts_snapshot 缺少有效的 generatedAt');
  }
  if (!Array.isArray(snapshot.groups)) {
    throw new Error('contacts_snapshot 缺少 groups 数组');
  }
  // 通讯录定义：privateContacts（rcontact 个人联系人）；legacy privates 兼容
  const privateEntries = Array.isArray(snapshot.privateContacts)
    ? snapshot.privateContacts
    : (Array.isArray(snapshot.privates) ? snapshot.privates : null);
  if (privateEntries === null) {
    throw new Error('contacts_snapshot 缺少 privateContacts 数组');
  }
  return {
    generatedAt,
    groups: normalizeContactRows(snapshot.groups, 'group'),
    privates: normalizeContactRows(privateEntries, 'private'),
    full: snapshot.full === true,
  };
}

function normalizeContactRows(entries, kind) {
  const seen = new Set();
  const rows = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`contacts_snapshot ${kind} 行必须是对象`);
    }
    const talker = String(entry.talker || '').trim();
    if (!validSnapshotTalker(talker, kind)) {
      throw new Error(`contacts_snapshot ${kind} talker 非法: ${preview(talker)}`);
    }
    if (seen.has(talker)) continue; // 去重，保留首个
    seen.add(talker);
    const name = String(entry.name ?? '').replace(/\s+/g, ' ').trim()
      .slice(0, CONTACT_NAME_MAX) || (kind === 'group' ? '微信群' : '联系人');
    const avatarBase64 = typeof entry.avatarBase64 === 'string'
      ? entry.avatarBase64.slice(0, CONTACT_AVATAR_MAX)
      : '';
    const memberCount = Number(entry.memberCount);
    rows.push({
      talker,
      name,
      avatarBase64,
      memberCount: Number.isInteger(memberCount) && memberCount >= 0
        ? memberCount
        : 0,
    });
  }
  return rows;
}

function validSnapshotTalker(talker, kind) {
  if (typeof talker !== 'string' || talker.length === 0 || talker.length > 256) {
    return false;
  }
  const lower = talker.toLocaleLowerCase();
  if (kind === 'group') {
    return lower.endsWith('@chatroom') && !lower.includes(':');
  }
  return !lower.endsWith('@chatroom')
    && !lower.endsWith('@openim')
    && !lower.startsWith('gh_')
    && !['filehelper', 'newsapp', 'fmessage', 'weixin'].includes(lower)
    && !lower.includes(':');
}

function preview(value) {
  const text = String(value || '');
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

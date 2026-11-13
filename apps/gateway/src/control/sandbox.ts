import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, isGroup } from '../config.js';
import { db } from '../db.js';
import { DEFAULT_PERSONAS, type Persona } from './migrations.js';

export type { Persona };

let personaCache = new Map<string, Persona>();

export function loadPersonas(): void {
  const rows = db.prepare('SELECT * FROM personas').all() as any[];
  personaCache = new Map(rows.map((r) => [r.id, {
    id: r.id,
    name: r.name,
    sys_prompt: r.sys_prompt,
    engine_mode: r.engine_mode === 'l1_only' ? 'l1_only' : 'auto',
    allowed_mcp_tools: JSON.parse(r.allowed_mcp_tools || '["*"]'),
    allow_shell: r.allow_shell === 1,
    op_only: false,
  }]));
}

export function getPersonaCount(): number {
  return personaCache.size;
}

export interface MemberProfile {
  name: string;
  role?: string;
  tags?: string[];
  notes?: string;
  interactions: number;
  lastSeen: number;
}

export interface ChannelSandbox {
  chatId: string;
  name?: string;
  dir: string;
  personaText: string;
  rulesText: string;
  tools: string[];
  members: Record<string, MemberProfile>;
}

export interface ChannelSummary {
  chatId: string;
  name?: string;
  tools: string[];
  memberCount: number;
  hasPersona: boolean;
  hasRules: boolean;
}

export const CORE_TOOLS = ['web_search', 'fact_check', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article'];

interface ChannelDocCache {
  mtime: number;
  content: string;
}
const docCache = new Map<string, ChannelDocCache>();

function readFileCached(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    const cached = docCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.content;
    }
    const content = readFileSync(filePath, 'utf-8');
    docCache.set(filePath, { mtime: stat.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}

function resolveRealGroupName(chatId: string): string {
  try {
    const dbPath = join(process.cwd(), 'data', 'wechat', 'mapping.sqlite');
    if (!existsSync(dbPath)) return '';
    const mappingDb = new DatabaseSync(dbPath);
    const row = mappingDb.prepare('SELECT name FROM contacts WHERE talker = ?').get(chatId) as { name?: string } | undefined;
    if (row?.name) return row.name;
    const entityRow = mappingDb.prepare("SELECT nickname FROM entities WHERE protocol_id = ? AND kind = 'group'").get(chatId) as { nickname?: string } | undefined;
    if (entityRow?.nickname) return entityRow.nickname;
  } catch {}
  return '';
}

export function ensureChannelSandbox(chatId: string): ChannelSandbox {
  const baseDir = config.channelsDir;
  const chatDir = join(baseDir, chatId);
  const defaultDir = join(baseDir, 'default');

  if (!existsSync(chatDir)) {
    mkdirSync(chatDir, { recursive: true });
  }

  const metaPath = join(chatDir, 'meta.json');
  let name = '';
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      name = meta.name || '';
    } catch { /* 容错 */ }
  }
  if (!name) {
    name = resolveRealGroupName(chatId);
  }

  const personaPath = join(chatDir, 'persona.md');
  if (!existsSync(personaPath)) {
    const defaultPersona = readFileCached(join(defaultDir, 'persona.md')) ||
      `# Nox - 群聊智能助手\n你是微信群聊专属 AI 助手 Nox。性格敏锐、聪慧亲切、热情得体。\n在群聊中协助解答问题、技术交流与友好互动。`;
    writeFileSync(personaPath, defaultPersona, 'utf-8');
  }

  const rulesPath = join(chatDir, 'rules.md');
  if (!existsSync(rulesPath)) {
    const defaultRules = readFileCached(join(defaultDir, 'rules.md')) ||
      `# 社群交互与安全铁律\n1. 绝对保密原则：严禁向群内透露任何服务器IP、端口、API密钥。\n2. 权限隔离原则：群聊内严禁执行任何Linux Shell命令或文件改写。\n3. 记忆边界铁律：群聊只讨论公开公共知识，严禁透露他人私聊隐私。`;
    writeFileSync(rulesPath, defaultRules, 'utf-8');
  }

  const toolsPath = join(chatDir, 'tools.json');
  let tools: string[] = [...CORE_TOOLS];
  if (existsSync(toolsPath)) {
    try {
      const raw = readFileSync(toolsPath, 'utf-8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        const set = new Set(saved);
        let changed = false;
        for (const t of CORE_TOOLS) {
          if (!set.has(t)) {
            set.add(t);
            changed = true;
          }
        }
        tools = Array.from(set);
        if (changed) {
          writeFileSync(toolsPath, JSON.stringify(tools, null, 2), 'utf-8');
        }
      }
    } catch { /* 容错 */ }
  } else {
    writeFileSync(toolsPath, JSON.stringify(CORE_TOOLS, null, 2), 'utf-8');
  }

  const membersPath = join(chatDir, 'members.json');
  if (!existsSync(membersPath)) {
    writeFileSync(membersPath, '{}', 'utf-8');
  }

  const personaText = readFileCached(personaPath) || '';
  const rulesText = readFileCached(rulesPath) || '';

  let members: Record<string, MemberProfile> = {};
  try {
    const raw = readFileSync(membersPath, 'utf-8');
    members = JSON.parse(raw);
  } catch { /* 容错 */ }

  return { chatId, name: name || undefined, dir: chatDir, personaText, rulesText, tools, members };
}

export function listChannelSandboxes(): ChannelSummary[] {
  const baseDir = config.channelsDir;
  if (!existsSync(baseDir)) return [];
  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    const list: ChannelSummary[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'default' && !entry.name.startsWith('.')) {
        const sb = ensureChannelSandbox(entry.name);
        list.push({
          chatId: entry.name,
          name: sb.name,
          tools: sb.tools,
          memberCount: Object.keys(sb.members).length,
          hasPersona: Boolean(sb.personaText),
          hasRules: Boolean(sb.rulesText),
        });
      }
    }
    return list;
  } catch {
    return [];
  }
}

export function updateChannelSandbox(
  chatId: string,
  updates: { name?: string; personaText?: string; rulesText?: string; tools?: string[] }
): ChannelSandbox {
  const sb = ensureChannelSandbox(chatId);
  if (typeof updates.name === 'string') {
    const metaPath = join(sb.dir, 'meta.json');
    let meta: Record<string, any> = {};
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch {}
    }
    meta.name = updates.name.trim();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    sb.name = meta.name;
  }
  if (typeof updates.personaText === 'string') {
    writeFileSync(join(sb.dir, 'persona.md'), updates.personaText, 'utf-8');
    sb.personaText = updates.personaText;
  }
  if (typeof updates.rulesText === 'string') {
    writeFileSync(join(sb.dir, 'rules.md'), updates.rulesText, 'utf-8');
    sb.rulesText = updates.rulesText;
  }
  if (Array.isArray(updates.tools)) {
    writeFileSync(join(sb.dir, 'tools.json'), JSON.stringify(updates.tools, null, 2), 'utf-8');
    sb.tools = updates.tools;
  }
  return sb;
}

export function deleteChannelSandbox(chatId: string): boolean {
  const baseDir = config.channelsDir;
  const chatDir = join(baseDir, chatId);
  if (!existsSync(chatDir)) return false;
  try {
    rmSync(chatDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function getMemberProfiles(chatId: string): Record<string, MemberProfile> {
  return ensureChannelSandbox(chatId).members;
}

export function getMemberProfile(chatId: string, wxid: string): MemberProfile | null {
  return ensureChannelSandbox(chatId).members[wxid] || null;
}

export function touchMemberProfile(chatId: string, wxid: string, name?: string): MemberProfile {
  const sb = ensureChannelSandbox(chatId);
  let profile = sb.members[wxid];
  const now = Date.now();
  if (!profile) {
    profile = { name: name || wxid, interactions: 1, lastSeen: now };
    sb.members[wxid] = profile;
  } else {
    if (name && name !== profile.name) profile.name = name;
    profile.interactions = (profile.interactions || 0) + 1;
    profile.lastSeen = now;
  }
  try {
    writeFileSync(join(sb.dir, 'members.json'), JSON.stringify(sb.members, null, 2), 'utf-8');
  } catch { /* 写入异常不阻断 */ }
  return profile;
}

export function updateMemberProfile(chatId: string, wxid: string, updates: Partial<MemberProfile>): MemberProfile {
  const sb = ensureChannelSandbox(chatId);
  const current = sb.members[wxid] || {
    name: updates.name || wxid,
    interactions: 0,
    lastSeen: Date.now(),
  };
  const updated: MemberProfile = { ...current, ...updates, lastSeen: Date.now() };
  sb.members[wxid] = updated;
  try {
    writeFileSync(join(sb.dir, 'members.json'), JSON.stringify(sb.members, null, 2), 'utf-8');
  } catch { /* 写入异常不阻断 */ }
  return updated;
}

export function formatMemberProfileContext(chatId: string, wxid: string, name?: string): string {
  const profile = touchMemberProfile(chatId, wxid, name);
  const details: string[] = [];
  if (profile.role) details.push(`身份: ${profile.role}`);
  if (profile.tags && profile.tags.length > 0) details.push(`标签: ${profile.tags.join('/')}`);
  if (profile.notes) details.push(`关注点: ${profile.notes}`);
  const extra = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `[当前提问成员: ${profile.name || name || '群友'}${extra}]`;
}

export function loadChannelPersona(chatId: string): Persona | null {
  const sb = ensureChannelSandbox(chatId);
  const combinedPrompt = [
    sb.personaText || '你是微信群聊专属 AI 助手 Nox。性格敏锐、聪慧亲切、热情得体。',
    sb.rulesText ? `\n\n【群聊最高安全与行为铁律】：\n${sb.rulesText}` : '',
  ].join('');

  return {
    id: `channel_${chatId}`,
    name: `群沙箱人设 (${chatId.endsWith('@chatroom') ? chatId.replace('@chatroom', '').slice(-6) : chatId})`,
    sys_prompt: combinedPrompt,
    engine_mode: 'l1_only',
    allowed_mcp_tools: sb.tools,
    allow_shell: false,
    op_only: false,
  };
}

export function getPersona(id: string, isOp = true, chatId?: string): Persona {
  if (chatId && isGroup(chatId)) {
    const channelPersona = loadChannelPersona(chatId);
    if (channelPersona) return channelPersona;
  }

  const p = personaCache.get(id) || personaCache.get('nox') || personaCache.get('daily_assistant') || DEFAULT_PERSONAS[0];

  if (chatId && isGroup(chatId)) {
    return { ...p, engine_mode: 'l1_only', allow_shell: false, op_only: false };
  }
  if (!isOp) {
    return { ...p, allow_shell: false, op_only: false };
  }
  return p;
}

export function listPersonas(_isOp = true): Persona[] {
  if (personaCache.size === 0) {
    try {
      loadPersonas();
    } catch { /* ignore */ }
    if (personaCache.size === 0) return [...DEFAULT_PERSONAS];
  }
  return Array.from(personaCache.values());
}

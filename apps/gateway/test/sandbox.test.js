import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureChannelSandbox,
  getMemberProfiles,
  touchMemberProfile,
  updateMemberProfile,
  formatMemberProfileContext,
  getPersona,
  listPersonas,
  initControlPlane,
} from '../dist/control.js';
import { config } from '../dist/config.js';

initControlPlane();

test('ensureChannelSandbox scaffolds persona.md, rules.md, tools.json, and members.json', () => {
  const testChatId = 'test_sandbox_12345@chatroom';
  const chatDir = join(config.channelsDir, testChatId);
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });

  const sb = ensureChannelSandbox(testChatId);
  assert.equal(sb.chatId, testChatId);
  assert.ok(existsSync(join(chatDir, 'persona.md')));
  assert.ok(existsSync(join(chatDir, 'rules.md')));
  assert.ok(existsSync(join(chatDir, 'tools.json')));
  assert.ok(existsSync(join(chatDir, 'members.json')));

  assert.deepEqual(sb.tools, [
    'web_search',
    'group_remind',
    'palace_memo',
    'generate_image',
    'read_wechat_article',
  ]);
  assert.deepEqual(sb.members, {});

  // 清理测试目录
  rmSync(chatDir, { recursive: true, force: true });
});

test('member profile lifecycle: touch, update, and format context', () => {
  const testChatId = 'test_member_profile@chatroom';
  const chatDir = join(config.channelsDir, testChatId);
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });

  const wxid = 'wxid_alice_test';
  // 1. 初次发言 touch
  const p1 = touchMemberProfile(testChatId, wxid, '爱丽丝');
  assert.equal(p1.name, '爱丽丝');
  assert.equal(p1.interactions, 1);

  // 2. 再次发言 touch 递增互动数
  const p2 = touchMemberProfile(testChatId, wxid, '爱丽丝');
  assert.equal(p2.interactions, 2);

  // 3. 更新管理员角色与标签
  const updated = updateMemberProfile(testChatId, wxid, {
    role: '管理员',
    tags: ['架构师', '前端负责人'],
    notes: '关注新版UI重构与发布计划',
  });
  assert.equal(updated.role, '管理员');
  assert.deepEqual(updated.tags, ['架构师', '前端负责人']);

  // 4. 生成注入大模型的发言者上下文
  const ctx = formatMemberProfileContext(testChatId, wxid, '爱丽丝');
  assert.match(ctx, /爱丽丝/);
  assert.match(ctx, /身份: 管理员/);
  assert.match(ctx, /标签: 架构师\/前端负责人/);
  assert.match(ctx, /关注点: 关注新版UI重构与发布计划/);

  // 5. 验证 members.json 持久化
  const membersFile = JSON.parse(readFileSync(join(chatDir, 'members.json'), 'utf-8'));
  assert.ok(membersFile[wxid]);
  assert.equal(membersFile[wxid].role, '管理员');

  rmSync(chatDir, { recursive: true, force: true });
});

test('Unified Nox persona with dynamic privilege guards', () => {
  const testChatId = 'test_sample@chatroom';
  const chatDir = join(config.channelsDir, testChatId);
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });

  // 1. 列表返回统一 Nox 人设，不再向非 OP 隐藏
  const allPersonas = listPersonas(false);
  assert.ok(allPersonas.some((p) => p.id === 'nox'));

  // 2. 群聊环境：无论调用方是谁，强制降级为 l1_only 且 allow_shell = false
  const groupPersona = getPersona('nox', true, testChatId);
  assert.equal(groupPersona.engine_mode, 'l1_only');
  assert.equal(groupPersona.allow_shell, false);

  // 3. 私聊环境：OP 管理员拥有 allow_shell = true
  const opPrivatePersona = getPersona('nox', true, 'wxid_admin');
  assert.equal(opPrivatePersona.allow_shell, true);

  // 4. 私聊环境：普通用户强制 allow_shell = false
  const userPrivatePersona = getPersona('nox', false, 'wxid_regular_user');
  assert.equal(userPrivatePersona.allow_shell, false);

  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });
});

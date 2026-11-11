import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureChannelSandbox,
  touchMemberProfile,
} from '../dist/control.js';
import { config } from '../dist/config.js';

test('Web Admin Ops channel sandbox management APIs', async () => {
  const testChatId = 'test_api_channel@chatroom';
  const chatDir = join(config.channelsDir, testChatId);
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true, force: true });

  // 1. 初始化沙箱
  const sb = ensureChannelSandbox(testChatId);
  touchMemberProfile(testChatId, 'wxid_tester', '测试小助手');

  // 动态导入模块或直接测试接口逻辑函数
  const { listChannelSandboxes, updateChannelSandbox, getMemberProfiles, updateMemberProfile } = await import('../dist/control.js');
  const { getAllTools } = await import('../dist/tools.js');

  // 2. 验证工具列表
  const allTools = getAllTools();
  assert.ok(allTools.length >= 3);
  assert.ok(allTools.some((t) => t.name === 'web_search'));

  // 3. 验证频道沙箱清单列出
  const list = listChannelSandboxes();
  assert.ok(list.some((c) => c.chatId === testChatId));
  const item = list.find((c) => c.chatId === testChatId);
  assert.equal(item.memberCount, 1);

  // 4. 更新频道沙箱配置 (人设、群规、工具)
  const updated = updateChannelSandbox(testChatId, {
    personaText: '# Nox 专属技术群模式\n你专注于技术探讨。',
    rulesText: '# 核心安全原则\n严禁向外泄密。',
    tools: ['web_search', 'group_remind'],
  });
  assert.equal(updated.personaText, '# Nox 专属技术群模式\n你专注于技术探讨。');
  assert.deepEqual(updated.tools, ['web_search', 'group_remind']);

  // 验证磁盘写入
  const savedPersona = readFileSync(join(chatDir, 'persona.md'), 'utf-8');
  assert.equal(savedPersona, '# Nox 专属技术群模式\n你专注于技术探讨。');
  const savedTools = JSON.parse(readFileSync(join(chatDir, 'tools.json'), 'utf-8'));
  assert.deepEqual(savedTools, ['web_search', 'group_remind']);

  // 5. 更新群成员画像
  const updatedProfile = updateMemberProfile(testChatId, 'wxid_tester', {
    role: '安全顾问',
    tags: ['安全审计', '网关守护'],
    notes: '定期抽查群内提醒与知识',
  });
  assert.equal(updatedProfile.role, '安全顾问');
  assert.deepEqual(updatedProfile.tags, ['安全审计', '网关守护']);

  // 验证成员列表查询
  const members = getMemberProfiles(testChatId);
  assert.ok(members['wxid_tester']);
  assert.equal(members['wxid_tester'].role, '安全顾问');

  // 清理测试目录
  rmSync(chatDir, { recursive: true, force: true });
});

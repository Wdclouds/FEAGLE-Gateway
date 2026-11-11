import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdMap } from '../src/id-map.js';

test('message receipts survive in SQLite and reject replayed WeChat IDs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feagle-id-map-'));
  const path = join(directory, 'mapping.sqlite');
  const first = new IdMap(path);

  assert.equal(first.claimMessage('wechat-1', 'private'), true);
  assert.equal(first.claimMessage('wechat-1', 'private'), false);

  first.close();
  const reopened = new IdMap(path);
  t.after(() => reopened.close());
  assert.equal(reopened.claimMessage('wechat-1', 'private'), false);
});

test('message receipts can be retried before forwarding but not after forwarding', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feagle-id-map-retry-'));
  const map = new IdMap(join(directory, 'mapping.sqlite'));
  t.after(() => map.close());

  assert.equal(map.claimMessage('android:event-1', 'android-private'), true);
  assert.equal(map.messageReceipt('android:event-1').status, 'RECEIVED');
  assert.equal(map.releaseMessageReceipt('android:event-1'), true);
  assert.equal(map.messageReceipt('android:event-1'), null);

  assert.equal(map.claimMessage('android:event-1', 'android-private'), true);
  map.updateMessageReceipt('android:event-1', 'FORWARDED');
  assert.equal(map.releaseMessageReceipt('android:event-1'), false);
  assert.equal(map.messageReceipt('android:event-1').status, 'FORWARDED');
});

test('OneBot message IDs remain stable when the same transport event is replayed', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feagle-id-map-message-'));
  const map = new IdMap(join(directory, 'mapping.sqlite'));
  t.after(() => map.close());

  const first = map.storeMessage('android:event-2', { raw_message: 'first' });
  const second = map.storeMessage('android:event-2', { raw_message: 'replayed' });

  assert.equal(second, first);
  assert.equal(map.message(first).raw_message, 'replayed');
});

test('idMap manages conversation lifecycles, detects exited groups, and prunes stale test entities', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'feagle-id-map-conv-'));
  const map = new IdMap(join(directory, 'mapping.sqlite'));
  t.after(() => map.close());

  // 模拟建立实体
  const activeGroupId = map.entity('group', '11111@chatroom', '11111@chatroom', '活跃微信群');
  const exitedGroupId = map.entity('group', '22222@chatroom', '22222@chatroom', '已退出的群');
  const user1Id = map.entity('user', 'wxid_user1', 'wxid_user1', '真实联系人');
  const testEntId = map.entity('group', 'test_group_temp', 'test_group_temp', '临时测试群');
  const e2eEntId = map.entity('user', 'e2e_mock_runner', 'e2e_mock_runner', 'E2E测试Runner');

  // 同步 contacts 权威快照（只有 11111@chatroom 和 wxid_user1 存在，22222@chatroom 已退群不在 contacts 中）
  map.syncContacts({
    full: true,
    generatedAt: new Date().toISOString(),
    groups: [{ talker: '11111@chatroom', name: '活跃微信群', memberCount: 15, avatarBase64: '' }],
    privateContacts: [{ talker: 'wxid_user1', name: '真实联系人', avatarBase64: '' }],
  });

  // 1. 验证 listGroups 默认自动过滤已退出的群与内部测试群
  const defaultGroups = map.listGroups();
  assert.equal(defaultGroups.length, 1);
  assert.equal(defaultGroups[0].protocolId, '11111@chatroom');
  assert.equal(defaultGroups[0].status, 'active');
  assert.equal(defaultGroups[0].isExited, false);

  const allGroups = map.listGroups({ includeExited: true });
  assert.equal(allGroups.length, 3);
  const exitedGroupItem = allGroups.find((g) => g.protocolId === '22222@chatroom');
  assert.ok(exitedGroupItem);
  assert.equal(exitedGroupItem.status, 'exited');
  assert.equal(exitedGroupItem.isExited, true);

  // 2. 验证 listConversations 聚合与分类
  const activeConvList = map.listConversations({ status: 'active' });
  assert.equal(activeConvList.conversations.length, 2);
  assert.equal(activeConvList.counts.total, 5);
  assert.equal(activeConvList.counts.active, 2);
  assert.equal(activeConvList.counts.exited, 1);

  // 3. 验证 setConversationStatus 自定义状态、置顶与别名
  const updatedStatus = map.setConversationStatus('11111@chatroom', 'active', {
    alias: '核心业务群',
    pinned: true,
  });
  assert.equal(updatedStatus.alias, '核心业务群');
  assert.equal(updatedStatus.pinned, true);

  const pinnedList = map.listConversations({ status: 'active' });
  assert.equal(pinnedList.conversations[0].talker, '11111@chatroom');
  assert.equal(pinnedList.conversations[0].name, '核心业务群');
  assert.equal(pinnedList.conversations[0].pinned, true);

  // 4. 验证排除/静音（ignored）状态
  map.setConversationStatus('wxid_user1', 'ignored', { reason: '垃圾营销号' });
  const excludedConv = map.listConversations({ status: 'active' });
  assert.equal(excludedConv.conversations.length, 1); // wxid_user1 不再出现在活跃列表中
  const ignoredConv = map.listConversations({ status: 'ignored' });
  assert.equal(ignoredConv.conversations.length, 1);
  assert.equal(ignoredConv.conversations[0].isExcluded, true);

  // 5. 验证 pruneStaleEntities 自动收敛已退群并清理无消息引用的测试实体
  // 给 testEntId 存入一条消息，使其受保护不被清理
  map.storeMessage('test-msg-1', {
    group_id: Number(testEntId),
    raw_message: '保留测试消息',
  });

  const pruneResult = map.pruneStaleEntities();
  assert.equal(pruneResult.markedExited, 1); // 22222@chatroom 被自动标注为 exited
  assert.equal(pruneResult.testCleaned, 1);  // e2e_mock_runner 无消息，被物理清理

  // 验证 e2e_mock_runner 已清理，而 test_group_temp 因有消息得以保留
  const remainingEntities = map.db.prepare('SELECT protocol_id FROM entities').all().map((r) => r.protocol_id);
  assert.equal(remainingEntities.includes('e2e_mock_runner'), false);
  assert.equal(remainingEntities.includes('test_group_temp'), true);
});


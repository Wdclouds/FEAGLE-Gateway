import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeState } from '../src/state.js';
import { DashboardServer } from '../src/dashboard.js';

const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-FEAGLE-Dashboard': '1',
};

test('dashboard refreshes contacts only through an authorized manual POST', async (t) => {
  const state = new RuntimeState();
  let calls = 0;
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    async refreshContacts(options) {
      calls += 1;
      assert.deepEqual(options, { includeAvatars: true });
      state.setContacts({
        status: 'READY',
        groups: [{ talker: 'group@chatroom', name: '测试群', avatarBase64: '', memberCount: 2 }],
        privates: [{ talker: 'wxid_friend', name: '好友', avatarBase64: '' }],
        counts: { groups: 1, privates: 1, inserted: 2, updated: 0, deleted: 0 },
        error: '',
      });
      return { groups: 1, privates: 1, inserted: 2, updated: 0, deleted: 0 };
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());
  const { port } = dashboard.server.address();
  const url = `http://127.0.0.1:${port}/api/contacts/refresh`;

  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-FEAGLE-Dashboard': '1' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(calls, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.groups, 1);
  assert.equal(payload.state.contacts.privates.length, 1);
});

test('dashboard test-mode endpoint toggles the schedule override', async (t) => {
  const state = new RuntimeState();
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    setTestMode(enabled) {
      state.setSchedule({ mode: enabled ? 'TEST' : 'SLEEPING', testMode: enabled });
      return state.snapshot();
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());

  const { port } = dashboard.server.address();
  const enableResponse = await fetch(`http://127.0.0.1:${port}/api/test-mode`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enableResponse.status, 200);
  const enabled = await enableResponse.json();
  assert.equal(enabled.schedule.mode, 'TEST');
  assert.equal(enabled.schedule.testMode, true);

  const disableResponse = await fetch(`http://127.0.0.1:${port}/api/test-mode`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disableResponse.status, 200);
  const disabled = await disableResponse.json();
  assert.equal(disabled.schedule.mode, 'SLEEPING');
  assert.equal(disabled.schedule.testMode, false);
});

test('dashboard exposes separate liveness and readiness endpoints', async (t) => {
  const state = new RuntimeState();
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
  });
  await dashboard.start();
  t.after(() => dashboard.stop());

  const { port } = dashboard.server.address();
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<!doctype html>/i);

  const live = await fetch(`http://127.0.0.1:${port}/api/health/live`);
  assert.equal(live.status, 200);

  const notReady = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
  assert.equal(notReady.status, 503);

  state.patch('wechat', { status: 'ONLINE', protocolHealth: 'HEALTHY' });
  state.patch('hermes', { status: 'READY' });
  state.patch('onebot', { status: 'CONNECTED' });
  const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).hermes, 'READY');
});

test('dashboard sends a Feishu notification test through a POST-only endpoint', async (t) => {
  const state = new RuntimeState();
  let calls = 0;
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    async sendNotificationTest() {
      calls += 1;
      state.patch('notifications', {
        status: 'READY',
        lastType: 'TEST',
      });
      return state.snapshot();
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());

  const { port } = dashboard.server.address();
  const getResponse = await fetch(`http://127.0.0.1:${port}/api/notifications/test`);
  assert.equal(getResponse.status, 405);

  const response = await fetch(`http://127.0.0.1:${port}/api/notifications/test`, {
    method: 'POST',
    headers: { 'X-FEAGLE-Dashboard': '1' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(calls, 1);
  assert.equal(payload.notifications.lastType, 'TEST');
});

test('dashboard persists an explicitly confirmed manual-offline mode', async (t) => {
  const state = new RuntimeState();
  const modes = [];
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    async setWechatAdminMode(mode) {
      modes.push(mode);
      state.patch('wechat', {
        adminMode: mode,
        status: mode,
        protocolHealth: 'OFFLINE',
      });
      return state.snapshot();
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());

  const { port } = dashboard.server.address();
  const rejected = await fetch(`http://127.0.0.1:${port}/api/wechat/admin-mode`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ mode: 'MANUAL_OFFLINE' }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(modes.length, 0);

  const accepted = await fetch(`http://127.0.0.1:${port}/api/wechat/admin-mode`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      mode: 'MANUAL_OFFLINE',
      confirm: 'MANUAL_OFFLINE',
    }),
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(modes, ['MANUAL_OFFLINE']);
  const payload = await accepted.json();
  assert.equal(payload.wechat.adminMode, 'MANUAL_OFFLINE');
});

test('dashboard group reply mode is fail-closed and requires confirmation', async (t) => {
  const state = new RuntimeState();
  const calls = [];
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    async setGroupChatConfig(mode, allowlist, blockedTerms) {
      calls.push({ mode, allowlist, blockedTerms });
      state.patch('groupChat', { mode, allowlist, blockedTerms });
      return state.snapshot();
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());
  const { port } = dashboard.server.address();
  const url = `http://127.0.0.1:${port}/api/group-chat/config`;

  const rejected = await fetch(url, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ mode: 'MENTION_ONLY', allowlist: ['1001'] }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 0);

  const accepted = await fetch(url, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      mode: 'MENTION_ONLY',
      allowlist: ['1001', 'bad', 1002],
      blockedTerms: [' Risk ', 'risk'],
      confirm: 'ENABLE_GROUP_REPLY',
    }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls, [{
    mode: 'MENTION_ONLY',
    allowlist: ['1001', '1002'],
    blockedTerms: ['risk'],
  }]);
});

test('dashboard settings API hides secrets and protects mutations', async (t) => {
  const state = new RuntimeState();
  let settings = { transport: 'android', quietHours: '00:00-07:00' };
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    getBridgeSettings: () => settings,
    saveBridgeSettings(changes) {
      settings = { ...settings, ...changes };
      return { settings };
    },
  });
  await dashboard.start();
  t.after(() => dashboard.stop());
  const { port } = dashboard.server.address();
  const url = `http://127.0.0.1:${port}/api/settings`;

  const readable = await fetch(url);
  assert.equal(readable.status, 200);
  const readPayload = await readable.json();
  assert.deepEqual(readPayload.settings, settings);
  assert.equal(JSON.stringify(readPayload).includes('API_KEY'), false);

  const forbidden = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quietHours: '01:00-06:00' }),
  });
  assert.equal(forbidden.status, 403);

  const accepted = await fetch(url, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify({ quietHours: '01:00-06:00' }),
  });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).settings.quietHours, '01:00-06:00');
});

test('dashboard exposes conversations REST API with filtering, status mutation, batch, and prune', async (t) => {
  const state = new RuntimeState();
  const convDb = [
    { id: '10001', talker: 'group_active@chatroom', kind: 'group', name: '活跃群', status: 'active', pinned: true },
    { id: '10002', talker: 'group_exited@chatroom', kind: 'group', name: '退出群', status: 'exited', pinned: false },
    { id: '10003', talker: 'wxid_test_contact', kind: 'private', name: '测试号', status: 'test_internal', pinned: false },
  ];
  let prunedCount = 0;
  const statusUpdates = [];

  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
    listConversations({ status = 'active', includeExited = false, includeTest = false }) {
      const filtered = convDb.filter((c) => {
        if (!includeTest && c.status === 'test_internal') return false;
        if (!includeExited && c.status === 'exited' && status === 'active') return false;
        if (status !== 'all' && c.status !== status) return false;
        return true;
      });
      return {
        conversations: filtered,
        counts: { total: convDb.length, active: 1, exited: 1, archived: 0, ignored: 0 },
      };
    },
    setConversationStatus(talker, status, opts) {
      statusUpdates.push({ talker, status, ...opts });
      return { talker, status, ...opts };
    },
    pruneConversations() {
      prunedCount += 1;
      return { markedExited: 1, testCleaned: 1, activeCount: 1, totalCount: 2 };
    },
  });

  await dashboard.start();
  t.after(() => dashboard.stop());
  const { port } = dashboard.server.address();
  const base = `http://127.0.0.1:${port}`;

  // 1. GET /api/conversations (默认 active)
  const listRes = await fetch(`${base}/api/conversations`);
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.ok, true);
  assert.equal(listJson.conversations.length, 1);
  assert.equal(listJson.conversations[0].talker, 'group_active@chatroom');
  assert.equal(listJson.counts.active, 1);

  // 2. PUT /api/conversations/status (鉴权与状态修改)
  const unauthRes = await fetch(`${base}/api/conversations/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ talker: 'group_active@chatroom', status: 'ignored' }),
  });
  assert.equal(unauthRes.status, 403);

  const authRes = await fetch(`${base}/api/conversations/status`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify({
      talker: 'group_active@chatroom',
      status: 'ignored',
      reason: '已屏蔽测试群',
      pinned: false,
    }),
  });
  assert.equal(authRes.status, 200);
  const authJson = await authRes.json();
  assert.equal(authJson.ok, true);
  assert.equal(authJson.conversation.status, 'ignored');
  assert.equal(authJson.conversation.reason, '已屏蔽测试群');

  // 3. POST /api/conversations/prune
  const pruneRes = await fetch(`${base}/api/conversations/prune`, {
    method: 'POST',
    headers: mutationHeaders,
  });
  assert.equal(pruneRes.status, 200);
  const pruneJson = await pruneRes.json();
  assert.equal(pruneJson.ok, true);
  assert.equal(pruneJson.result.markedExited, 1);
  assert.equal(prunedCount, 1);

  // 4. POST /api/conversations/batch
  const batchRes = await fetch(`${base}/api/conversations/batch`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      talkers: ['wxid_1', 'wxid_2'],
      action: 'ignore',
      reason: '批量静音',
    }),
  });
  assert.equal(batchRes.status, 200);
  const batchJson = await batchRes.json();
  assert.equal(batchJson.ok, true);
  assert.equal(batchJson.updatedCount, 2);
  assert.equal(statusUpdates.length, 3);
});


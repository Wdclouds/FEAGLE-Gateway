import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import {
  initGateway,
  gatewayState,
  sendActionToBridge,
  stopGateway,
} from '../src/gateway-client.js';

test('Dual-Mode Gateway: Server Mode (Local Listener)', async (t) => {
  const TEST_PORT = 17199;
  
  // 1. 初始化为 Server 模式
  initGateway({ gatewayMode: 'server', gatewayServerPort: TEST_PORT });
  assert.equal(gatewayState.mode, 'server');
  assert.equal(gatewayState.listenPort, TEST_PORT);
  assert.equal(gatewayState.status, 'listening');

  // 2. 模拟外部 Bridge 客户端连入
  const client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`, {
    headers: { 'X-Self-ID': '1000000001' },
  });

  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
  });

  assert.equal(gatewayState.connected, true);
  assert.equal(gatewayState.clientCount, 1);
  assert.equal(gatewayState.selfId, '1000000001');

  // 3. 模拟 Bridge 发送群聊消息
  const fakeMsg = {
    post_type: 'message',
    message_type: 'group',
    message_id: 12345,
    group_id: 998877,
    group_name: '测试群',
    raw_message: 'Hello Server Mode',
    sender: { nickname: 'Tester' },
  };
  client.send(JSON.stringify(fakeMsg));

  await new Promise((r) => setTimeout(r, 300));
  const latest = gatewayState.recentMessages[gatewayState.recentMessages.length - 1];
  assert.ok(latest);
  assert.equal(latest.text, 'Hello Server Mode');

  // 4. 断开客户端
  client.terminate();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(gatewayState.connected, false);
  assert.equal(gatewayState.status, 'listening');
});

test('Dual-Mode Gateway: Client Mode (Remote Direct Connection)', async (t) => {
  const REMOTE_PORT = 17198;

  // 1. 启动一个 Mock Remote Bridge Server
  const remoteServer = new WebSocketServer({ port: REMOTE_PORT });
  let serverSideSocket = null;
  const serverConnected = new Promise((resolve) => {
    remoteServer.on('connection', (ws, req) => {
      serverSideSocket = ws;
      assert.equal(req.headers['x-self-id'], '1000000001');
      resolve(ws);
    });
  });

  // 2. 将 Gateway 切换为 Client 模式，主动连接 Remote Server
  initGateway({
    gatewayMode: 'client',
    gatewayRemoteUrl: `ws://127.0.0.1:${REMOTE_PORT}/ws`,
  });

  assert.equal(gatewayState.mode, 'client');
  await serverConnected;

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(gatewayState.connected, true);
  assert.equal(gatewayState.status, 'connected');

  // 3. 从 Remote Server 发送消息给 Hub Client
  const remoteMsg = {
    post_type: 'message',
    message_type: 'group',
    message_id: 54321,
    group_id: 998877,
    group_name: '测试群',
    raw_message: 'Hello Client Mode',
    sender: { nickname: 'RemoteTester' },
  };
  serverSideSocket.send(JSON.stringify(remoteMsg));

  await new Promise((r) => setTimeout(r, 300));
  const latest = gatewayState.recentMessages[gatewayState.recentMessages.length - 1];
  assert.ok(latest);
  assert.equal(latest.text, 'Hello Client Mode');

  // 4. 清理
  stopGateway();
  if (serverSideSocket) serverSideSocket.terminate();
  await new Promise((r) => remoteServer.close(r));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';

test('Hub connects to OneBot WebSocket, captures group events and updates telemetry', async (t) => {
  // 1. 启动 Mock OneBot WebSocket Server
  const server = new WebSocketServer({ port: 6199 });
  
  let connectedSocket = null;
  const connectionPromise = new Promise((resolve) => {
    server.on('connection', (ws) => {
      connectedSocket = ws;
      resolve(ws);
    });
  });

  // 等待 Hub 的重连客户端握手进来
  const socket = await Promise.race([
    connectionPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for Hub to connect to port 6199')), 12000)),
  ]);

  assert.ok(socket, 'Hub successfully connected to Mock OneBot Gateway');

  // 2. 发送一条 OneBot v11 模拟群聊消息
  const fakeGroupMessage = {
    time: Math.floor(Date.now() / 1000),
    self_id: 1000000001,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 998877,
    group_id: 55667788,
    group_name: 'FEAGLE 架构验收群',
    user_id: 10001,
    message: [{ type: 'text', data: { text: '测试 Hub 消息流接入' } }],
    raw_message: '测试 Hub 消息流接入',
    font: 0,
    sender: {
      user_id: 10001,
      nickname: '测试架构师',
      card: '测试架构师',
    },
  };

  socket.send(JSON.stringify(fakeGroupMessage));

  // 等待 Hub 写入 SQLite 并流转
  await new Promise((r) => setTimeout(r, 600));

  // 3. 校验 Hub API 是否正确捕获并入库
  const res = await fetch('http://127.0.0.1:6200/api/telemetry');
  const telemetry = await res.json();

  assert.equal(telemetry.gateway.connected, true, 'Gateway should be marked as connected');
  assert.ok(telemetry.recentMessages.length > 0, 'Recent messages should contain captured message');
  assert.equal(telemetry.recentMessages[telemetry.recentMessages.length - 1].sender, '测试架构师');
  assert.equal(telemetry.recentMessages[telemetry.recentMessages.length - 1].groupName, 'FEAGLE 架构验收群');

  console.log('✔ Hub ↔ Gateway 端到端集成验证完全通过！');

  if (connectedSocket) {
    try { connectedSocket.terminate(); } catch {}
  }
  await new Promise((r) => server.close(r));
});

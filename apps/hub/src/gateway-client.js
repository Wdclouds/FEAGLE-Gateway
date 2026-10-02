import { WebSocket, WebSocketServer } from 'ws';
import { upsertGroup, recordHourlyMetric } from './db.js';

export const gatewayState = {
  connected: false,
  role: 'server',
  port: Number(process.env.ONEBOT_PORT || 6199),
  endpoint: 'ws://127.0.0.1:6199/ws',
  clientCount: 0,
  selfId: null,
  lastPingMs: null,
  recentMessages: [],
};

const sseClients = new Set();
const activeSockets = new Set();
let wss = null;
const actionWaiters = new Map();
let nextEchoId = 1;

export function subscribeSse(res) {
  sseClients.add(res);
  return () => sseClients.delete(res);
}

export function broadcastSse(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function extractText(message) {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message
      .filter((s) => s?.type === 'text')
      .map((s) => s?.data?.text || '')
      .join('');
  }
  return '';
}

export function initGatewayServer(port = gatewayState.port) {
  if (wss) {
    try {
      wss.close();
    } catch {
      // ignore
    }
    wss = null;
  }

  gatewayState.port = Number(port);
  console.log(`[GatewayServer] 正在启动 OneBot v11 反向 WebSocket 服务端，监听端口 :${gatewayState.port}`);

  wss = new WebSocketServer({ port: gatewayState.port });

  wss.on('connection', (socket, req) => {
    activeSockets.add(socket);
    gatewayState.connected = true;
    gatewayState.clientCount = activeSockets.size;

    const selfIdHeader = req.headers['x-self-id'];
    if (selfIdHeader) gatewayState.selfId = String(selfIdHeader);

    console.log(`[GatewayServer] Bridge 客户端已连入！(URL: ${req.url}, Self-ID: ${gatewayState.selfId || 'unknown'})`);
    broadcastSse('gateway_status', {
      connected: true,
      clientCount: activeSockets.size,
      selfId: gatewayState.selfId,
    });

    socket.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // 1. 如果是对 Hub 发送的 Action 响应 (带 echo)
        if (data.echo && actionWaiters.has(data.echo)) {
          const waiter = actionWaiters.get(data.echo);
          actionWaiters.delete(data.echo);
          waiter.resolve(data);
          return;
        }

        // 2. 上报事件处理
        if (data.post_type === 'message') {
          const text = data.raw_message || extractText(data.message) || '[多媒体消息]';
          const sender = data.sender?.nickname || String(data.user_id || 'unknown');
          const groupName = data.group_name || (data.group_id ? `群 ${data.group_id}` : '');

          const messageEntry = {
            id: data.message_id || Date.now(),
            type: data.message_type || 'unknown',
            groupId: data.group_id ? String(data.group_id) : null,
            groupName,
            sender,
            text: text.slice(0, 160),
            time: new Date().toISOString(),
          };

          // 环形缓冲保留最近 100 条
          gatewayState.recentMessages.push(messageEntry);
          if (gatewayState.recentMessages.length > 100) gatewayState.recentMessages.shift();

          // 入库 SQLite
          if (data.message_type === 'group' && data.group_id) {
            const gid = String(data.group_id);
            upsertGroup(gid, groupName, sender);
            recordHourlyMetric(gid);
          }

          // SSE 推流到 Web 前端
          broadcastSse('message', messageEntry);
        } else if (data.post_type === 'meta_event') {
          gatewayState.connected = true;
          if (data.meta_event_type === 'heartbeat') {
            gatewayState.lastPingMs = Date.now();
            broadcastSse('heartbeat', { time: Date.now() });
          }
        }
      } catch {
        // ignore malformed frame
      }
    });

    socket.on('close', () => {
      activeSockets.delete(socket);
      gatewayState.clientCount = activeSockets.size;
      gatewayState.connected = activeSockets.size > 0;
      console.log(`[GatewayServer] Bridge 客户端断开连接 (剩余连接数: ${activeSockets.size})`);
      broadcastSse('gateway_status', {
        connected: gatewayState.connected,
        clientCount: activeSockets.size,
      });
    });

    socket.on('error', (err) => {
      console.log(`[GatewayServer] Socket 异常: ${err.message}`);
    });
  });

  wss.on('error', (err) => {
    console.error(`[GatewayServer] 监听端口 ${gatewayState.port} 失败: ${err.message}`);
  });
}

/** 向已连接的 Bridge 发送 OneBot Action（如 send_msg, get_status 等） */
export function sendActionToBridge(action, params = {}, timeoutMs = 5000) {
  const socket = activeSockets.values().next().value;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Bridge WebSocket 尚未连接，无法执行动作'));
  }

  const echo = `echo_${nextEchoId++}_${Date.now()}`;
  const payload = { action, params, echo };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      actionWaiters.delete(echo);
      reject(new Error(`Action [${action}] 执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    actionWaiters.set(echo, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    socket.send(JSON.stringify(payload));
  });
}

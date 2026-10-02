import { WebSocket } from 'ws';
import { upsertGroup, recordHourlyMetric } from './db.js';

export const gatewayState = {
  connected: false,
  endpoint: 'ws://127.0.0.1:6199',
  lastPingMs: null,
  reconnectAttempts: 0,
  recentMessages: [],
};

const sseClients = new Set();
let wsClient = null;
let reconnectTimer = null;
let pingTimer = null;
let isAlive = false;

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

export function initGatewayClient(endpoint) {
  if (endpoint) gatewayState.endpoint = endpoint;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (wsClient) {
    try {
      wsClient.removeAllListeners();
      wsClient.close();
    } catch {
      // ignore
    }
    wsClient = null;
  }

  console.log(`[GatewayClient] Connecting to ${gatewayState.endpoint}`);

  try {
    wsClient = new WebSocket(gatewayState.endpoint, {
      headers: {
        'X-Client-Role': 'Universal',
      },
    });

    wsClient.on('open', () => {
      gatewayState.connected = true;
      gatewayState.reconnectAttempts = 0;
      isAlive = true;
      console.log('[GatewayClient] Connected to Bridge WebSocket');
      broadcastSse('gateway_status', { connected: true, endpoint: gatewayState.endpoint });

      // Protocol-level ping
      pingTimer = setInterval(() => {
        if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
        if (!isAlive) {
          console.log('[GatewayClient] Half-open socket detected, terminating');
          wsClient.terminate();
          return;
        }
        isAlive = false;
        try {
          wsClient.ping();
        } catch {
          // ignore
        }
      }, 15_000);
      pingTimer.unref();
    });

    wsClient.on('pong', () => {
      isAlive = true;
    });

    wsClient.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
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

          // 落库 SQLite
          if (data.message_type === 'group' && data.group_id) {
            const gid = String(data.group_id);
            upsertGroup(gid, groupName, sender);
            recordHourlyMetric(gid);
          }

          // SSE 推流到前端
          broadcastSse('message', messageEntry);
        } else if (data.post_type === 'meta_event') {
          gatewayState.connected = true;
        }
      } catch {
        // ignore malformed frame
      }
    });

    wsClient.on('error', (err) => {
      gatewayState.connected = false;
      console.log(`[GatewayClient] Error: ${err.message}`);
    });

    wsClient.on('close', () => {
      gatewayState.connected = false;
      if (pingTimer) clearInterval(pingTimer);
      broadcastSse('gateway_status', { connected: false, endpoint: gatewayState.endpoint });

      // 指数退避 + Jitter
      const delay = Math.min(
        30_000,
        1_000 * (2 ** Math.min(gatewayState.reconnectAttempts, 5)),
      ) + Math.floor(Math.random() * 1000);
      gatewayState.reconnectAttempts++;
      console.log(`[GatewayClient] Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);
      reconnectTimer = setTimeout(() => initGatewayClient(), delay);
      reconnectTimer.unref();
    });
  } catch (err) {
    gatewayState.connected = false;
    reconnectTimer = setTimeout(() => initGatewayClient(), 5000);
    reconnectTimer.unref();
  }
}

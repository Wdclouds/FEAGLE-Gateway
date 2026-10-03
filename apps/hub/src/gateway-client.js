import { WebSocket, WebSocketServer } from 'ws';
import { upsertGroup, recordHourlyMetric } from './db.js';

export const gatewayState = {
  connected: false,
  mode: 'bridge_sync', // 'bridge_sync' | 'server' | 'client'
  status: 'idle', // 'connected' | 'listening' | 'connecting' | 'reconnecting' | 'error'
  statusText: '未初始化',
  bridgeUrl: process.env.WECHAT_BRIDGE_URL || 'http://127.0.0.1:6190',
  listenPort: Number(process.env.ONEBOT_PORT || 6199),
  remoteUrl: process.env.WECHAT_BRIDGE_WS || 'ws://127.0.0.1:6199/ws',
  token: '',
  endpoint: 'http://127.0.0.1:6190',
  clientCount: 0,
  selfId: null,
  accountName: null,
  avatarBase64: null,
  lastPingMs: null,
  reconnectAttempts: 0,
  recentMessages: [],
};

const sseClients = new Set();
const activeSockets = new Set();
let wss = null;
let clientWs = null;
let reconnectTimer = null;
let syncPollTimer = null;
let sseAbortController = null;
const actionWaiters = new Map();
let nextEchoId = 1;
const seenMessageKeys = new Set();

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

function handleSocketMessage(raw) {
  try {
    const data = JSON.parse(raw.toString());

    if (data.echo && actionWaiters.has(data.echo)) {
      const waiter = actionWaiters.get(data.echo);
      actionWaiters.delete(data.echo);
      waiter.resolve(data);
      return;
    }

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

      gatewayState.recentMessages.push(messageEntry);
      if (gatewayState.recentMessages.length > 100) gatewayState.recentMessages.shift();

      if (data.message_type === 'group' && data.group_id) {
        const gid = String(data.group_id);
        upsertGroup(gid, groupName, sender);
        recordHourlyMetric(gid);
      }

      broadcastSse('message', messageEntry);
    } else if (data.post_type === 'meta_event') {
      gatewayState.connected = true;
      if (data.meta_event_type === 'heartbeat') {
        gatewayState.lastPingMs = Date.now();
        broadcastSse('heartbeat', { time: Date.now() });
      }
    }
  } catch {}
}

function cleanupExisting() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
  if (sseAbortController) {
    try { sseAbortController.abort(); } catch {}
    sseAbortController = null;
  }
  if (clientWs) {
    try {
      clientWs.removeAllListeners();
      clientWs.terminate();
    } catch {}
    clientWs = null;
  }
  if (wss) {
    try {
      wss.removeAllListeners();
      wss.close();
    } catch {}
    wss = null;
  }
  for (const s of activeSockets) {
    try {
      s.removeAllListeners();
      s.terminate();
    } catch {}
  }
  activeSockets.clear();
  gatewayState.connected = false;
  gatewayState.clientCount = 0;
  gatewayState.selfId = null;
}

function normalizeHttpUrl(url) {
  if (!url) return 'http://127.0.0.1:6190';
  let clean = url.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'http://' + clean;
  }
  try {
    const parsed = new URL(clean);
    if (!parsed.port) {
      parsed.port = '6190';
    }
    return parsed.origin;
  } catch {
    return clean;
  }
}

export function initGateway(cfg = {}) {
  cleanupExisting();

  const mode = cfg.gatewayMode || cfg.mode || gatewayState.mode || 'bridge_sync';
  gatewayState.mode = mode;

  if (mode === 'bridge_sync') {
    // === 模式 1：Bridge HTTP / SSE 免隧道直连模式 (推荐) ===
    const targetUrl = normalizeHttpUrl(cfg.bridgeUrl || cfg.endpoint || gatewayState.bridgeUrl);
    gatewayState.bridgeUrl = targetUrl;
    gatewayState.endpoint = targetUrl;
    gatewayState.status = 'connecting';
    gatewayState.statusText = `正在连接云端 Bridge (${targetUrl})...`;
    console.log(`[BridgeSync] 正在直连 Bridge 端点: ${targetUrl}`);
    broadcastState();

    startBridgeSyncLoop(targetUrl);
  } else if (mode === 'server') {
    // === 模式 2：本地监听模式 (Server) ===
    const port = Number(cfg.gatewayServerPort || cfg.port || gatewayState.listenPort || 6199);
    gatewayState.listenPort = port;
    gatewayState.endpoint = `ws://0.0.0.0:${port}/ws`;
    gatewayState.status = 'listening';
    gatewayState.statusText = `本地监听中 (0.0.0.0:${port}，等待 Bridge 接入)`;
    console.log(`[GatewayServer] 正在启动 OneBot v11 反向 WebSocket 服务端，监听端口 :${port}`);

    try {
      wss = new WebSocketServer({ port });
    } catch (err) {
      gatewayState.status = 'error';
      gatewayState.statusText = `监听端口 ${port} 失败: ${err.message}`;
      console.error(`[GatewayServer] 监听端口 ${port} 失败: ${err.message}`);
      broadcastState();
      return;
    }

    wss.on('connection', (socket, req) => {
      activeSockets.add(socket);
      gatewayState.connected = true;
      gatewayState.clientCount = activeSockets.size;
      gatewayState.status = 'connected';

      const selfIdHeader = req.headers['x-self-id'];
      if (selfIdHeader) gatewayState.selfId = String(selfIdHeader);

      gatewayState.statusText = `已连接 Bridge 网关 (客户端数: ${activeSockets.size}, Self-ID: ${gatewayState.selfId || 'unknown'})`;
      console.log(`[GatewayServer] Bridge 客户端已连入！(URL: ${req.url}, Self-ID: ${gatewayState.selfId || 'unknown'})`);
      broadcastState();

      socket.on('message', handleSocketMessage);

      socket.on('close', () => {
        activeSockets.delete(socket);
        gatewayState.clientCount = activeSockets.size;
        gatewayState.connected = activeSockets.size > 0;
        if (!gatewayState.connected) {
          gatewayState.status = 'listening';
          gatewayState.statusText = `本地监听中 (0.0.0.0:${port}，等待 Bridge 接入)`;
        } else {
          gatewayState.statusText = `已连接 Bridge 网关 (客户端数: ${activeSockets.size})`;
        }
        console.log(`[GatewayServer] Bridge 客户端断开连接 (剩余连接数: ${activeSockets.size})`);
        broadcastState();
      });

      socket.on('error', (err) => {
        console.log(`[GatewayServer] Socket 异常: ${err.message}`);
      });
    });

    wss.on('error', (err) => {
      gatewayState.status = 'error';
      gatewayState.statusText = `监听端口 ${port} 出错: ${err.message}`;
      console.error(`[GatewayServer] 监听端口 ${port} 失败: ${err.message}`);
      broadcastState();
    });

    broadcastState();
  } else {
    // === 模式 3：远程 WebSocket 客户端模式 (Client) ===
    const remoteUrl = cfg.gatewayRemoteUrl || cfg.remoteUrl || gatewayState.remoteUrl || 'ws://127.0.0.1:6199/ws';
    const token = cfg.gatewayToken ?? cfg.token ?? gatewayState.token ?? '';
    gatewayState.remoteUrl = remoteUrl;
    gatewayState.token = token;
    gatewayState.endpoint = remoteUrl;
    gatewayState.reconnectAttempts = 0;

    connectRemoteClient();
  }
}

async function pollBridgeStatus(targetUrl) {
  try {
    const res = await fetch(`${targetUrl}/api/status`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const isOnline = data.wechat?.status === 'ONLINE';
    gatewayState.connected = isOnline;
    gatewayState.selfId = data.selfAvatar?.wxid || 'WeChat Bot';
    gatewayState.accountName = data.selfAvatar?.nickname || 'FaSt_eAgle';
    gatewayState.avatarBase64 = data.selfAvatar?.avatarBase64 || null;
    gatewayState.status = isOnline ? 'connected' : 'offline';
    gatewayState.statusText = isOnline
      ? `已直连云端 Bridge (${data.selfAvatar?.nickname || '微信'} · ${data.wechat?.detail || '在线'})`
      : `已连接 Bridge，但微信未就绪: ${data.wechat?.detail || data.wechat?.status || 'OFFLINE'}`;

    // 同步最近消息
    if (Array.isArray(data.messages)) {
      for (const m of data.messages) {
        const key = `${m.time}_${m.text}`;
        if (!seenMessageKeys.has(key)) {
          seenMessageKeys.add(key);
          if (seenMessageKeys.size > 500) {
            const first = seenMessageKeys.values().next().value;
            seenMessageKeys.delete(first);
          }

          const entry = {
            id: Date.now() + Math.random(),
            type: m.peer?.includes('群') ? 'group' : 'private',
            groupName: m.peer || '微信会话',
            sender: m.direction === 'OUT' ? (data.selfAvatar?.nickname || 'FaSt_eAgle') : m.peer,
            text: m.text,
            time: m.time || new Date().toISOString(),
          };
          gatewayState.recentMessages.push(entry);
          if (gatewayState.recentMessages.length > 100) gatewayState.recentMessages.shift();
          broadcastSse('message', entry);
        }
      }
    }

    // 同步云端已发现的微信群组到本地多群策略表
    if (data.groupChat && Array.isArray(data.groupChat.discovered)) {
      for (const g of data.groupChat.discovered) {
        if (g.groupId && g.name) {
          upsertGroup(String(g.groupId), g.name, '', g.lastSeenAt || null);
        }
      }
    }

    broadcastState();
  } catch (err) {
    gatewayState.connected = false;
    gatewayState.status = 'error';
    gatewayState.statusText = `无法连接 Bridge (${targetUrl}): ${err.message}`;
    broadcastState();
  }
}

function startBridgeSyncLoop(targetUrl) {
  // 首次立即探测
  pollBridgeStatus(targetUrl);

  // 定时轮询保持心跳与数据同步
  if (syncPollTimer) clearInterval(syncPollTimer);
  syncPollTimer = setInterval(() => {
    if (gatewayState.mode === 'bridge_sync') {
      pollBridgeStatus(targetUrl);
    }
  }, 4000);
}

function connectRemoteClient() {
  if (gatewayState.mode !== 'client') return;
  if (clientWs) {
    try { clientWs.terminate(); } catch {}
    clientWs = null;
  }

  gatewayState.status = gatewayState.reconnectAttempts === 0 ? 'connecting' : 'reconnecting';
  gatewayState.statusText = `正在连接远程网关 ${gatewayState.remoteUrl} (第 ${gatewayState.reconnectAttempts + 1} 次)...`;
  console.log(`[GatewayClient] ${gatewayState.statusText}`);
  broadcastState();

  const headers = {
    'X-Self-ID': '1000000001',
    'User-Agent': 'FEAGLE-Hub/2.0',
  };
  if (gatewayState.token) {
    headers['Authorization'] = `Bearer ${gatewayState.token}`;
  }

  try {
    clientWs = new WebSocket(gatewayState.remoteUrl, { headers });
  } catch (err) {
    scheduleReconnect(err.message);
    return;
  }

  clientWs.on('open', () => {
    gatewayState.connected = true;
    gatewayState.clientCount = 1;
    gatewayState.reconnectAttempts = 0;
    gatewayState.status = 'connected';
    gatewayState.statusText = `已成功连接远程网关 (${gatewayState.remoteUrl})`;
    console.log(`[GatewayClient] ✔ 成功连接到远程网关：${gatewayState.remoteUrl}`);
    broadcastState();
  });

  clientWs.on('message', handleSocketMessage);

  clientWs.on('close', (code, reason) => {
    gatewayState.connected = false;
    gatewayState.clientCount = 0;
    console.log(`[GatewayClient] 远程连接关闭 (code: ${code}, reason: ${reason || 'none'})`);
    scheduleReconnect(`连接断开 (code: ${code})`);
  });

  clientWs.on('error', (err) => {
    console.log(`[GatewayClient] 远程连接异常: ${err.message}`);
  });
}

function scheduleReconnect(reason) {
  if (gatewayState.mode !== 'client') return;
  gatewayState.connected = false;
  gatewayState.clientCount = 0;
  gatewayState.reconnectAttempts++;
  gatewayState.status = 'reconnecting';
  const delayMs = Math.min(3000 * Math.pow(1.5, Math.min(gatewayState.reconnectAttempts - 1, 4)), 15000);
  gatewayState.statusText = `远程连接异常 [${reason}]，将在 ${Math.round(delayMs / 1000)} 秒后自动重试 (第 ${gatewayState.reconnectAttempts} 次)...`;
  broadcastState();

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectRemoteClient();
  }, delayMs);
}

function broadcastState() {
  broadcastSse('gateway_status', {
    connected: gatewayState.connected,
    mode: gatewayState.mode,
    status: gatewayState.status,
    statusText: gatewayState.statusText,
    bridgeUrl: gatewayState.bridgeUrl,
    listenPort: gatewayState.listenPort,
    remoteUrl: gatewayState.remoteUrl,
    endpoint: gatewayState.endpoint,
    clientCount: gatewayState.clientCount,
    selfId: gatewayState.selfId,
    accountName: gatewayState.accountName,
  });
}

export function stopGateway() {
  cleanupExisting();
  gatewayState.mode = 'idle';
  gatewayState.status = 'idle';
  gatewayState.statusText = '已停止';
}

// 兼容旧名字
export const initGatewayServer = (port) => initGateway({ mode: 'server', port });

/** 向 Bridge 发送 OneBot Action（如 send_msg, get_status 等） */
export function sendActionToBridge(action, params = {}, timeoutMs = 5000) {
  let socket = null;
  if (gatewayState.mode === 'client') {
    socket = clientWs;
  } else if (gatewayState.mode === 'server') {
    socket = activeSockets.values().next().value;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`当前网关模式 (${gatewayState.mode}) 未建立双向控制长连接`));
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

/** 主动向网关拉取最新群聊列表并同步入库 */
export async function syncGroupsFromGatewayNow() {
  if (gatewayState.mode === 'bridge_sync') {
    const targetUrl = gatewayState.bridgeUrl;
    try {
      const res = await fetch(`${targetUrl}/api/status`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let syncCount = 0;
      if (data.groupChat && Array.isArray(data.groupChat.discovered)) {
        for (const g of data.groupChat.discovered) {
          if (g.groupId && g.name) {
            upsertGroup(String(g.groupId), g.name, '', g.lastSeenAt || null);
            syncCount++;
          }
        }
      }
      return { success: true, count: syncCount, mode: 'bridge_sync' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else if (gatewayState.mode === 'server' || gatewayState.mode === 'client') {
    try {
      const result = await sendActionToBridge('get_group_list', {}, 3000);
      if (result && Array.isArray(result.data)) {
        let syncCount = 0;
        for (const g of result.data) {
          if (g.group_id) {
            upsertGroup(String(g.group_id), g.group_name || `群 ${g.group_id}`, '');
            syncCount++;
          }
        }
        return { success: true, count: syncCount, mode: 'onebot' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: '网关未连接' };
}

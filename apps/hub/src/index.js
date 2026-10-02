import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initDb,
  findAdminByUsername,
  hashPassword,
  listGroupsWithPolicies,
  savePolicy,
  get24hTelemetry,
  listAuditLogs,
} from './db.js';

import { signJwt, requireAuth } from './auth.js';
import {
  initGateway,
  sendActionToBridge,
  syncGroupsFromGatewayNow,
  gatewayState,
  subscribeSse,
  broadcastSse,
} from './gateway-client.js';
import {
  initHermesProbe,
  hermesState,
} from './hermes-probe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'hub-config.json');

// 1. 初始化数据库与配置
initDb();

let config = {
  gatewayMode: process.env.GATEWAY_MODE || 'bridge_sync',
  bridgeUrl: process.env.WECHAT_BRIDGE_URL || 'http://127.0.0.1:6190',
  gatewayServerPort: Number(process.env.ONEBOT_PORT || 6199),
  gatewayRemoteUrl: process.env.WECHAT_BRIDGE_WS || 'ws://127.0.0.1:6199/ws',
  gatewayToken: process.env.GATEWAY_TOKEN || '',
  hermesEndpoint: process.env.HERMES_ENDPOINT || 'http://127.0.0.1:18010',
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (err) {
    console.error('[Hub] Failed to parse config file:', err.message);
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// 2. 启动网关双模管理器与 Hermes 探活
initGateway(config);
initHermesProbe(config.hermesEndpoint);

// 3. 辅助函数：读取 JSON Body
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// 4. HTTP 服务器
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS 跨域支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API 路由 ---

  // 1. 登录与鉴权
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await readJsonBody(req);
      const admin = findAdminByUsername(username);
      if (!admin || admin.password_hash !== hashPassword(password)) {
        sendJson(res, 401, { error: '用户名或密码错误' });
        return;
      }
      const token = signJwt({ id: admin.id, username: admin.username, role: admin.role });
      sendJson(res, 200, {
        token,
        user: { id: admin.id, username: admin.username, role: admin.role },
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { user });
    return;
  }

  // 2. 遥测大盘
  if (pathname === '/api/telemetry' && req.method === 'GET') {
    const groups = listGroupsWithPolicies();
    sendJson(res, 200, {
      gateway: {
        connected: gatewayState.connected,
        mode: gatewayState.mode,
        status: gatewayState.status,
        statusText: gatewayState.statusText,
        endpoint: gatewayState.endpoint,
        bridgeUrl: gatewayState.bridgeUrl,
        listenPort: gatewayState.listenPort,
        remoteUrl: gatewayState.remoteUrl,
        clientCount: gatewayState.clientCount,
        selfId: gatewayState.selfId,
        accountName: gatewayState.accountName,
        avatarBase64: gatewayState.avatarBase64,
        reconnectAttempts: gatewayState.reconnectAttempts,
      },
      hermes: {
        connected: hermesState.connected,
        mode: hermesState.mode,
        endpoint: hermesState.endpoint,
        statusText: hermesState.statusText,
        lastPingMs: hermesState.lastPingMs,
      },
      recentMessages: gatewayState.recentMessages.slice(-20),
      hourly24h: get24hTelemetry(),
      groupsCount: groups.length,
      activeCount: groups.filter((g) => g.status === 'ACTIVE').length,
    });
    return;
  }

  // 3. 多群列表与策略
  if (pathname === '/api/groups' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { groups: listGroupsWithPolicies() });
    return;
  }

  // 3.1 主动向网关同步最新群列表
  if (pathname === '/api/groups/refresh' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const syncRes = await syncGroupsFromGatewayNow();
      const groups = listGroupsWithPolicies();
      sendJson(res, 200, {
        success: syncRes.success,
        message: syncRes.success
          ? `群列表已与网关同步完成，当前共纳管 ${groups.length} 个微信群`
          : `同步完成 (当前纳管 ${groups.length} 个微信群，网关提示: ${syncRes.error || '暂无新增'})`,
        count: groups.length,
        groups,
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  const groupPolicyMatch = /^\/api\/groups\/([^/]+)\/policy$/.exec(pathname);
  if (groupPolicyMatch && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const groupId = decodeURIComponent(groupPolicyMatch[1]);
    try {
      const body = await readJsonBody(req);
      const result = savePolicy(groupId, body, user.username);
      broadcastSse('policy_update', { groupId, ...body });
      sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // 4. 网关配置与切换 (Bridge直连 vs 本地监听 vs 远程WS)
  if (pathname === '/api/gateway/config' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, {
      config: {
        gatewayMode: config.gatewayMode || 'bridge_sync',
        bridgeUrl: config.bridgeUrl || 'http://127.0.0.1:6190',
        gatewayServerPort: config.gatewayServerPort || 6199,
        gatewayRemoteUrl: config.gatewayRemoteUrl || 'ws://127.0.0.1:6199/ws',
        gatewayToken: config.gatewayToken || '',
        hermesEndpoint: config.hermesEndpoint || 'http://127.0.0.1:18010',
        savedNodes: config.savedNodes || [
          { id: 'cloud_node', name: '阿里云生产节点', url: 'http://39.97.255.91:6190', mode: 'bridge_sync' },
          { id: 'local_node', name: '本地开发节点', url: 'http://127.0.0.1:6190', mode: 'bridge_sync' },
        ],
      },
      state: {
        connected: gatewayState.connected,
        mode: gatewayState.mode,
        status: gatewayState.status,
        statusText: gatewayState.statusText,
        endpoint: gatewayState.endpoint,
        bridgeUrl: gatewayState.bridgeUrl,
        listenPort: gatewayState.listenPort,
        remoteUrl: gatewayState.remoteUrl,
        clientCount: gatewayState.clientCount,
        selfId: gatewayState.selfId,
        accountName: gatewayState.accountName,
        reconnectAttempts: gatewayState.reconnectAttempts,
      },
    });
    return;
  }

  // 4.1 连通性实时测试探测器 (不用保存先测通)
  if (pathname === '/api/gateway/probe' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const mode = body.gatewayMode || 'bridge_sync';
      const start = Date.now();

      if (mode === 'bridge_sync') {
        let rawUrl = (body.bridgeUrl || 'http://127.0.0.1:6190').trim();
        if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
          rawUrl = 'http://' + rawUrl;
        }
        let parsed;
        try {
          parsed = new URL(rawUrl);
          if (!parsed.port) parsed.port = '6190';
        } catch {
          sendJson(res, 200, { ok: false, error: '目标 URL 格式不合法' });
          return;
        }
        const target = parsed.origin;
        const probeRes = await fetch(`${target}/api/status`, {
          signal: AbortSignal.timeout(4000),
        });
        const pingMs = Date.now() - start;
        if (!probeRes.ok) throw new Error(`HTTP ${probeRes.status}`);
        const data = await probeRes.json();
        sendJson(res, 200, {
          ok: true,
          pingMs,
          endpoint: target,
          wechatStatus: data.wechat?.status || 'OFFLINE',
          accountName: data.selfAvatar?.nickname || 'FaSt_eAgle',
          detail: data.wechat?.detail || '状态就绪',
          discoveredGroupsCount: data.groupChat?.discovered?.length || 0,
        });
        return;
      } else if (mode === 'client') {
        const rawUrl = (body.gatewayRemoteUrl || 'ws://127.0.0.1:6199/ws').trim();
        const headers = { 'X-Self-ID': '1000000001' };
        if (body.gatewayToken) headers['Authorization'] = `Bearer ${body.gatewayToken}`;
        const ws = new WebSocket(rawUrl, { headers });
        const wsResult = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            try { ws.terminate(); } catch {}
            reject(new Error('WebSocket 握手超时 (3500ms)'));
          }, 3500);
          ws.on('open', () => {
            clearTimeout(timer);
            try { ws.terminate(); } catch {}
            resolve({ ok: true, pingMs: Date.now() - start });
          });
          ws.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
        sendJson(res, 200, wsResult);
        return;
      } else {
        sendJson(res, 200, { ok: true, message: '本地监听模式无需外部探测' });
        return;
      }
    } catch (err) {
      sendJson(res, 200, { ok: false, error: err.message });
    }
    return;
  }

  if (pathname === '/api/gateway/config' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      config = { ...config, ...body };
      saveConfig();
      initGateway(config);
      if (body.hermesEndpoint !== undefined) {
        initHermesProbe(config.hermesEndpoint);
      }
      sendJson(res, 200, {
        success: true,
        message: '网关与智能体端点配置已更新并热重载生效',
        config: {
          gatewayMode: config.gatewayMode,
          bridgeUrl: config.bridgeUrl,
          gatewayServerPort: config.gatewayServerPort,
          gatewayRemoteUrl: config.gatewayRemoteUrl,
          hermesEndpoint: config.hermesEndpoint,
        },
        state: {
          connected: gatewayState.connected,
          mode: gatewayState.mode,
          status: gatewayState.status,
          statusText: gatewayState.statusText,
          endpoint: gatewayState.endpoint,
        },
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // 5. 实时日志与遥测推流 (SSE)
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 初始快照
    res.write(`event: init\ndata: ${JSON.stringify({
      gateway: {
        connected: gatewayState.connected,
        mode: gatewayState.mode,
        status: gatewayState.status,
        statusText: gatewayState.statusText,
        endpoint: gatewayState.endpoint,
        listenPort: gatewayState.listenPort,
        remoteUrl: gatewayState.remoteUrl,
      },
      hermes: { connected: hermesState.connected, endpoint: hermesState.endpoint },
      recentMessages: gatewayState.recentMessages.slice(-20),
    })}\n\n`);

    const unsubscribe = subscribeSse(res);
    req.on('close', () => {
      unsubscribe();
    });
    return;
  }

  // 6. 审计日志
  if (pathname === '/api/audit' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { logs: listAuditLogs(50) });
    return;
  }

  // 7. 配置管理
  if (pathname === '/api/config' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      config = { ...config, ...body };
      saveConfig();
      sendJson(res, 200, { success: true, config });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // 8. 向 Bridge 发送测试 Action (如 get_status, get_version_info)
  if (pathname === '/api/gateway/action' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const { action, params } = await readJsonBody(req);
      const result = await sendActionToBridge(action || 'get_status', params || {});
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // --- 静态文件分发 (SPA 客户端支持) ---
  const serveDir = fs.existsSync(DIST_DIR) ? DIST_DIR : PUBLIC_DIR;
  let filePath = path.join(serveDir, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(serveDir, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = Number(process.env.HUB_PORT) || 6200;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FEAGLE Hub] Control Plane v2 running at http://127.0.0.1:${PORT}`);
});

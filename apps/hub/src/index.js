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
  initGatewayClient,
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
  bridgeWs: process.env.WECHAT_BRIDGE_WS || 'ws://127.0.0.1:6199',
  hermesEndpoint: process.env.HERMES_ENDPOINT || 'http://127.0.0.1:18080',
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

// 2. 启动长连接与探活服务
initGatewayClient(config.bridgeWs);
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
        endpoint: gatewayState.endpoint,
        reconnectAttempts: gatewayState.reconnectAttempts,
      },
      hermes: {
        connected: hermesState.connected,
        endpoint: hermesState.endpoint,
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

  // 4. 实时日志与遥测推流 (SSE)
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 初始快照
    res.write(`event: init\ndata: ${JSON.stringify({
      gateway: { connected: gatewayState.connected, endpoint: gatewayState.endpoint },
      hermes: { connected: hermesState.connected, endpoint: hermesState.endpoint },
      recentMessages: gatewayState.recentMessages.slice(-20),
    })}\n\n`);

    const unsubscribe = subscribeSse(res);
    req.on('close', () => {
      unsubscribe();
    });
    return;
  }

  // 5. 审计日志
  if (pathname === '/api/audit' && req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { logs: listAuditLogs(50) });
    return;
  }

  // 6. 配置管理
  if (pathname === '/api/config' && req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const body = await readJsonBody(req);
      const oldBridge = config.bridgeWs;
      config = { ...config, ...body };
      saveConfig();
      if (body.bridgeWs && body.bridgeWs !== oldBridge) {
        initGatewayClient(config.bridgeWs);
      }
      sendJson(res, 200, { success: true, config });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // --- 静态文件分发 (SPA 客户端支持) ---
  const serveDir = fs.existsSync(DIST_DIR) ? DIST_DIR : PUBLIC_DIR;
  let filePath = path.join(serveDir, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: 非静态资源回退到 index.html
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

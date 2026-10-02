import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, '..', 'data', 'hub-config.json');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

// Load or initialize config
let config = {
  bridgeWs: process.env.WECHAT_BRIDGE_WS || 'ws://127.0.0.1:6199',
  hermesEndpoint: process.env.HERMES_ENDPOINT || 'http://127.0.0.1:18080',
  adminWxid: '',
  groupPolicies: {
    '*': {
      prompt: '你是由 Hermes 驱动的群聊智能助理，回答简练准确。',
      allowedTools: ['web_search'],
      requireAt: true,
    },
  },
};

if (fs.existsSync(DATA_FILE)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    console.error('[Hub] Failed to parse config file:', e.message);
  }
}

function saveConfig() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// Runtime Telemetry & Connections
const state = {
  bridgeConnected: false,
  hermesConnected: false,
  lastPingMs: null,
  activeGroups: new Map(),
  recentMessages: [],
};

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

// --- Resilient Bridge WebSocket Client ---
let bridgeWsClient = null;
let bridgeReconnectTimer = null;
let bridgeReconnectAttempts = 0;

function connectBridge() {
  if (bridgeReconnectTimer) {
    clearTimeout(bridgeReconnectTimer);
    bridgeReconnectTimer = null;
  }
  if (bridgeWsClient) {
    try {
      bridgeWsClient.removeAllListeners();
      bridgeWsClient.close();
    } catch {
      // ignore
    }
    bridgeWsClient = null;
  }

  const endpoint = config.bridgeWs;
  console.log(`[Hub] Connecting to FEAGLE Bridge: ${endpoint}`);

  try {
    bridgeWsClient = new WebSocket(endpoint, {
      headers: {
        'X-Client-Role': 'Universal',
      },
    });

    bridgeWsClient.on('open', () => {
      state.bridgeConnected = true;
      bridgeReconnectAttempts = 0;
      console.log('[Hub] Successfully connected to FEAGLE Bridge WebSocket');
    });

    bridgeWsClient.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.post_type === 'message') {
          const text = data.raw_message || extractText(data.message);
          const entry = {
            id: data.message_id || Date.now(),
            type: data.message_type || 'unknown',
            sender: data.sender?.nickname || data.user_id || 'unknown',
            text: text.slice(0, 120),
            time: new Date().toISOString(),
          };
          state.recentMessages.push(entry);
          if (state.recentMessages.length > 50) state.recentMessages.shift();

          if (data.message_type === 'group' && data.group_id) {
            const gid = String(data.group_id);
            const current = state.activeGroups.get(gid) || {
              groupId: gid,
              name: data.group_name || `群 ${gid}`,
              messageCount: 0,
            };
            current.lastSeenAt = new Date().toISOString();
            current.lastSender = data.sender?.nickname || String(data.user_id);
            current.messageCount = (current.messageCount || 0) + 1;
            state.activeGroups.set(gid, current);
          }
        } else if (data.post_type === 'meta_event') {
          state.bridgeConnected = true;
        }
      } catch {
        // ignore malformed frame
      }
    });

    bridgeWsClient.on('error', (err) => {
      state.bridgeConnected = false;
      console.log(`[Hub] Bridge WebSocket error: ${err.message}`);
    });

    bridgeWsClient.on('close', () => {
      state.bridgeConnected = false;
      const delay = Math.min(
        30_000,
        1_000 * (2 ** Math.min(bridgeReconnectAttempts, 5)),
      ) + Math.floor(Math.random() * 1000);
      bridgeReconnectAttempts++;
      console.log(`[Hub] Bridge WebSocket closed. Reconnecting in ${Math.round(delay / 1000)}s...`);
      bridgeReconnectTimer = setTimeout(connectBridge, delay);
      bridgeReconnectTimer.unref();
    });
  } catch (err) {
    state.bridgeConnected = false;
    bridgeReconnectTimer = setTimeout(connectBridge, 5000);
    bridgeReconnectTimer.unref();
  }
}

// --- Hermes Agent Health Probe ---
async function probeHermes() {
  const start = Date.now();
  try {
    const target = config.hermesEndpoint.replace(/\/+$/, '');
    const res = await fetch(`${target}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    state.hermesConnected = res.status < 500;
    state.lastPingMs = Date.now() - start;
  } catch {
    state.hermesConnected = false;
    state.lastPingMs = null;
  }
}

connectBridge();
void probeHermes();
const hermesProbeInterval = setInterval(probeHermes, 15_000);
hermesProbeInterval.unref();

// --- Static HTTP Server & API ---
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoints
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      bridgeConnected: state.bridgeConnected,
      hermesConnected: state.hermesConnected,
      lastPingMs: state.lastPingMs,
      bridgeWs: config.bridgeWs,
      hermesEndpoint: config.hermesEndpoint,
      activeGroupsCount: state.activeGroups.size,
      groups: Array.from(state.activeGroups.values()),
      recentMessages: state.recentMessages.slice(-20),
    }));
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(config));
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const changes = JSON.parse(body);
        const oldBridgeWs = config.bridgeWs;
        const oldHermes = config.hermesEndpoint;
        config = { ...config, ...changes };
        saveConfig();
        if (changes.bridgeWs && changes.bridgeWs !== oldBridgeWs) {
          connectBridge();
        }
        if (changes.hermesEndpoint && changes.hermesEndpoint !== oldHermes) {
          void probeHermes();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, config }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
  const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = Number(process.env.HUB_PORT) || 6200;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FEAGLE Hub] Control Plane running at http://127.0.0.1:${PORT}`);
});

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
    // default template
    '*': {
      prompt: '你是由 Hermes 驱动的群聊智能助理，回答简练准确。',
      allowedTools: ['web_search'],
      requireAt: true
    }
  }
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
  recentMessages: []
};

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      bridgeConnected: state.bridgeConnected,
      hermesConnected: state.hermesConnected,
      bridgeWs: config.bridgeWs,
      hermesEndpoint: config.hermesEndpoint,
      activeGroupsCount: state.activeGroups.size,
      groups: Array.from(state.activeGroups.values()),
      recentMessages: state.recentMessages.slice(-20)
    }));
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const changes = JSON.parse(body);
        config = { ...config, ...changes };
        saveConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
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

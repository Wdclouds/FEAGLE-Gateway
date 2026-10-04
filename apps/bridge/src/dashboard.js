
const convSkills = {
  listGlobalSkills: () => [],
  listChannelSkills: () => [],
  deleteSkill: () => false,
  writeSkill: () => false,
  readSkill: () => ''
};
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { subscribeLogs, tailLogs } from './terminal-log.js';
// mnemosyne decoupled
// convSkills decoupled
import QRCode from 'qrcode';
import { runSystemDiagnosis } from './doctor.js';

function getAvailableLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('./public/', import.meta.url));

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};
const WECHAT_ADMIN_MODES = new Set(['RUNNING', 'PAUSED', 'MANUAL_OFFLINE']);
const GROUP_CHAT_MODES = new Set(['OFF', 'OBSERVE', 'MENTION_ONLY']);

export class DashboardServer {
  constructor({
    state,
    host = '0.0.0.0',
    port = 6190,
    setTestMode = () => state.snapshot(),
    sendNotificationTest = async () => state.snapshot(),
    forceWechatRelogin = async () => state.snapshot(),
    setWechatAdminMode = async () => state.snapshot(),
    setSleepOverride = async () => state.snapshot(),
    setGroupChatConfig = async () => state.snapshot(),
    setGroupChatMode = async () => state.snapshot(),
    refreshContacts = async () => ({}),
    getConversationMessages = async () => ({ messages: [] }),
    mnemosyne = null,
    resolveChannelFolder = null,
    getConversationLogs = async () => [],
    getConversationMembers = async () => [],
    getConversationTools = async () => null,
    setConversationTools = async () => null,
    getToolCatalog = async () => [],
    listDocVault = () => [],
    readDocDir = () => null,
    getBridgeSettings = () => ({}),
    saveBridgeSettings = async () => ({}),
    switchTransport = async () => ({}),
    getProbeRouter = () => null,
    createPairingCode = null,
    publicRoot = DEFAULT_PUBLIC_ROOT,
  }) {
    this.state = state;
    this.host = host;
    this.port = port;
    this.createPairingCode = createPairingCode;
    this.setTestMode = setTestMode;
    this.sendNotificationTest = sendNotificationTest;
    this.forceWechatRelogin = forceWechatRelogin;
    this.setWechatAdminMode = setWechatAdminMode;
    this.setSleepOverride = setSleepOverride;
    this.setGroupChatConfig = setGroupChatConfig;
    this.setGroupChatMode = setGroupChatMode;
    this.refreshContacts = refreshContacts;
    this.getConversationMessages = getConversationMessages;
    this.mnemosyne = mnemosyne;
    this.resolveChannelFolder = resolveChannelFolder;
    this.getProbeRouter = getProbeRouter;
    this.getConversationLogs = getConversationLogs;
    this.getConversationMembers = getConversationMembers;
    this.getConversationTools = getConversationTools;
    this.setConversationTools = setConversationTools;
    this.getToolCatalog = getToolCatalog;
    this.listDocVault = listDocVault;
    this.readDocDir = readDocDir;
    this.getBridgeSettings = getBridgeSettings;
    this.saveBridgeSettings = saveBridgeSettings;
    this.switchTransport = switchTransport;
    this.clients = new Set();
    this.publicRoot = publicRoot;
    this.server = createServer((request, response) => {
      this.handle(request, response);
    });
    this.onSnapshotListener = (snapshot) => this.push(snapshot);
    this.state.on('snapshot', this.onSnapshotListener);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        console.log(`[Dashboard] listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    // 支持 WebView2 / 本地跨源请求
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-FEAGLE-Dashboard, Origin, Accept');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === '/api/contacts/refresh') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      Promise.resolve(this.refreshContacts({ includeAvatars: true }))
        .then((result) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            ok: true,
            result,
            state: this.state.snapshot(),
          }));
        })
        .catch((error) => {
          response.writeHead(503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            error: String(error?.message || error).slice(0, 200),
          }));
        });
      return;
    }

    if (url.pathname === '/api/probe/route') {
      const probeRouter = this.getProbeRouter();
      if (request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(probeRouter?.getStatus() || { enabled: false }));
        return;
      }
      if (request.method === 'POST') {
        if (!this.authorizeMutation(request, response)) return;
        const body = await this.readBody(request, 1_024);
        const res = probeRouter?.setRoute(body || {});
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ ok: true, status: res }));
        return;
      }
    }

    if (url.pathname === '/api/probe/pull') {
      const probeRouter = this.getProbeRouter();
      const since = Number(url.searchParams.get('since') || 0);
      const limit = Number(url.searchParams.get('limit') || 10);
      const waitMs = Number(url.searchParams.get('wait') || 0);
      const events = waitMs > 0 && probeRouter
        ? await probeRouter.waitForEvents(since, Math.min(waitMs, 30_000))
        : (probeRouter?.pullEvents(since, limit) || []);
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ ok: true, events }));
      return;
    }

    if (url.pathname === '/api/probe/reply') {
      const probeRouter = this.getProbeRouter();
      if (request.method === 'POST') {
        if (!this.authorizeMutation(request, response)) return;
        const body = await this.readBody(request, 4_096);
        const convKey = body?.convKey;
        const text = body?.text;
        try {
          const res = await probeRouter?.sendReply(convKey, text);
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, result: res }));
        } catch (err) {
          response.writeHead(500, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
        return;
      }
    }

    if (url.pathname === '/api/settings') {
      if (request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({
          settings: this.getBridgeSettings(),
          secretsManagedExternally: true,
          restartOnSave: true,
        }));
        return;
      }
      if (request.method !== 'PUT') {
        response.writeHead(405, {
          Allow: 'GET, PUT',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      this.readJson(request, response, 32_768, (payload) => {
        Promise.resolve(this.saveBridgeSettings(payload))
          .then((result) => {
            response.writeHead(202, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify(result));
          })
          .catch((error) => {
            response.writeHead(400, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
          });
      });
      return;
    }

    if (url.pathname === '/api/health/live') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        status: 'ok',
        startedAt: this.state.startedAt,
        now: new Date().toISOString(),
      }));
      return;
    }

    if (url.pathname === '/api/health/ready') {
      const snapshot = this.state.snapshot();
      const ready = snapshot.wechat?.status === 'ONLINE'
        && snapshot.wechat?.protocolHealth === 'HEALTHY'
        && snapshot.hermes?.status === 'READY'
        && snapshot.onebot?.status === 'CONNECTED';
      response.writeHead(ready ? 200 : 503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        status: ready ? 'ready' : 'not_ready',
        wechat: {
          status: snapshot.wechat?.status || 'UNKNOWN',
          protocolHealth: snapshot.wechat?.protocolHealth || 'UNKNOWN',
          lastSyncAt: snapshot.wechat?.lastSyncAt || '',
        },
        hermes: snapshot.hermes?.status || 'UNKNOWN',
        onebot: snapshot.onebot?.status || 'UNKNOWN',
      }));
      return;
    }

    if (url.pathname === '/api/test-mode') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }

      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024) request.destroy();
      });
      request.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (typeof payload.enabled !== 'boolean') {
            throw new TypeError('enabled must be a boolean');
          }
          const snapshot = this.setTestMode(payload.enabled);
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify(snapshot));
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/notifications/test') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      Promise.resolve(this.sendNotificationTest())
        .then((snapshot) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify(snapshot));
        })
        .catch((error) => {
          response.writeHead(502, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            error: String(error?.message || error).slice(0, 200),
          }));
        });
      return;
    }

    if (url.pathname === '/api/wechat/admin-mode') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }

      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024) request.destroy();
      });
      request.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }
        if (!WECHAT_ADMIN_MODES.has(payload.mode)) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Unsupported WeChat admin mode' }));
          return;
        }
        if (
          payload.mode === 'MANUAL_OFFLINE'
          && payload.confirm !== 'MANUAL_OFFLINE'
        ) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Explicit confirmation is required' }));
          return;
        }
        Promise.resolve(this.setWechatAdminMode(payload.mode))
          .then((snapshot) => {
            response.writeHead(202, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify(snapshot));
          })
          .catch((error) => {
            response.writeHead(409, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({
              error: String(error?.message || error).slice(0, 200),
            }));
          });
      });
      return;
    }

    // ---- POST /api/schedule/override（解除时限 = 休眠豁免，休眠时段内也正常回复）----
    if (url.pathname === '/api/schedule/override') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }
      this.readJson(request, response, 1_024, (payload) => {
        if (typeof payload.enabled !== 'boolean') {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'enabled must be a boolean' }));
          return;
        }
        Promise.resolve(this.setSleepOverride(payload.enabled))
          .then((snapshot) => {
            response.writeHead(202, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify(snapshot));
          })
          .catch((error) => {
            response.writeHead(409, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({
              error: String(error?.message || error).slice(0, 200),
            }));
          });
      });
      return;
    }


    if (url.pathname === '/api/group-chat/config') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 8_192) request.destroy();
      });
      request.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }
        if (!GROUP_CHAT_MODES.has(payload.mode)) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Unsupported group chat mode' }));
          return;
        }
        if (!Array.isArray(payload.allowlist)) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'allowlist must be an array' }));
          return;
        }
        const allowlist = Array.from(new Set(payload.allowlist
          .map((item) => String(item || '').trim())
          .filter((item) => /^\d+$/.test(item))));
        if (payload.blockedTerms !== undefined && !Array.isArray(payload.blockedTerms)) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'blockedTerms must be an array' }));
          return;
        }
        const blockedTerms = Array.from(new Set((payload.blockedTerms || [])
          .map((item) => String(item || '').trim().toLocaleLowerCase())
          .filter(Boolean)
          .map((item) => item.slice(0, 64))))
          .slice(0, 100);
        if (
          payload.mode === 'MENTION_ONLY'
          && payload.confirm !== 'ENABLE_GROUP_REPLY'
        ) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Explicit confirmation is required' }));
          return;
        }
        Promise.resolve(this.setGroupChatConfig(payload.mode, allowlist, blockedTerms))
          .then((snapshot) => {
            response.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify(snapshot));
          })
          .catch((error) => {
            response.writeHead(409, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({
              error: String(error?.message || error).slice(0, 200),
            }));
          });
      });
      return;
    }

    // ---- POST /api/group-chat/status（切换单个群的接收模式）----
    if (url.pathname === '/api/group-chat/status') {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          Allow: 'POST',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 8_192) request.destroy();
      });
      request.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }
        const groupId = String(payload.groupId || '').trim();
        if (!GROUP_CHAT_MODES.has(payload.mode)) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Unsupported group chat mode' }));
          return;
        }
        if (!groupId) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'groupId is required' }));
          return;
        }
        Promise.resolve(this.setGroupChatMode(groupId, payload.mode))
          .then((snapshot) => {
            response.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify(snapshot));
          })
          .catch((error) => {
            response.writeHead(409, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({
              error: String(error?.message || error).slice(0, 200),
            }));
          });
      });
      return;
    }

    // ---- GET /api/device/pair-code (扫码免密配对二维码生成) ----
    if (url.pathname === '/api/device/pair-code') {
      const host = request.headers['x-forwarded-host'] || request.headers.host || `${this.host}:${this.port}`;
      let hostname = String(host).split(':')[0];
      const lanIps = getAvailableLanIps();
      const requestedIp = url.searchParams.get('ip');

      if (requestedIp && lanIps.includes(requestedIp)) {
        hostname = requestedIp;
      } else if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname.toLowerCase())) {
        hostname = lanIps[0] || '127.0.0.1';
      }

      const wsPort = process.env.ANDROID_WS_HOST_PORT || process.env.ANDROID_WS_PORT || '6191';
      const wsPath = process.env.ANDROID_WS_PATH || '/android';
      const proto = request.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';

      let token = process.env.ANDROID_BRIDGE_TOKEN || '';
      let pairingCode = null;
      let expiresAt = null;

      if (token.length < 24 && typeof this.createPairingCode === 'function') {
        try {
          const pair = this.createPairingCode();
          if (pair?.code) {
            pairingCode = pair.code;
            expiresAt = pair.expiresAt;
          }
        } catch (err) {
          console.warn('[Dashboard] createPairingCode notice:', err.message);
        }
      }

      const endpoint = pairingCode
        ? `${proto}://${hostname}:${wsPort}${wsPath}?mode=pair`
        : `${proto}://${hostname}:${wsPort}${wsPath}`;

      const httpProto = request.headers['x-forwarded-proto'] || 'http';
      const hostHeader = request.headers.host || `${hostname}:${this.port}`;
      const downloadUrl = `${httpProto}://${hostHeader}/download`;

      const payload = {
        endpoint,
        ...(token ? { token } : {}),
        ...(pairingCode ? { pairingCode, expiresAt } : {}),
        timestamp: Math.floor(Date.now() / 1000),
      };

      const rawPayload = JSON.stringify(payload);
      QRCode.toDataURL(rawPayload, { errorCorrectionLevel: 'M', margin: 2, width: 280 }, (err, qrDataUrl) => {
        QRCode.toDataURL(downloadUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 }, (dlErr, downloadQrDataUrl) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            endpoint,
            downloadUrl,
            downloadQrDataUrl: dlErr ? '' : downloadQrDataUrl,
            selectedIp: hostname,
            lanIps,
            pairingCode,
            expiresAt,
            timestamp: payload.timestamp,
            qrDataUrl: err ? '' : qrDataUrl,
            deviceStatus: this.state.snapshot().android?.deviceStatus || 'DISCONNECTED',
          }));
        });
      });
      return;
    }

    // ---- GET /api/device/check-update (OTA 版本检查) ----
    if (url.pathname === '/api/device/check-update') {
      const clientVer = String(url.searchParams.get('version') || '0.0.0').trim();
      const latestVer = '0.8.0';
      const hasUpdate = clientVer !== latestVer;
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({
        hasUpdate,
        currentVersion: clientVer,
        latestVersion: latestVer,
        downloadUrl: '/api/device/download-agent',
        releaseNotes: 'FEAGLE Gateway Driver 0.8.0: 支持扫码直接下载、免密配对与微信 8.0.78 深度适配',
      }));
      return;
    }

    // ---- GET /download (移动端优雅下载引导落地页) ----
    if (url.pathname === '/download' || url.pathname === '/downloads') {
      const httpProto = request.headers['x-forwarded-proto'] || 'http';
      const hostHeader = request.headers.host || `${this.host}:${this.port}`;
      const cdnUrl = 'https://ghfast.top/https://github.com/Wdclouds/FEAGLE-Gateway/releases/download/v0.8.0/feagle-driver-v0.8.0.apk';
      const localUrl = '/api/device/download-agent';

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>FEAGLE Driver 下载</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; text-align: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 32px 24px; max-width: 380px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 54px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #38bdf8; }
    p.sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .btn { display: block; width: 100%; padding: 14px 20px; background: #0284c7; color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4); transition: all 0.2s; }
    .btn:active { transform: scale(0.98); background: #0369a1; }
    .btn-sub { display: block; width: 100%; margin-top: 10px; padding: 10px 16px; background: rgba(51, 65, 85, 0.6); color: #cbd5e1; text-decoration: none; border-radius: 10px; font-size: 13px; }
    .tips { margin-top: 24px; padding: 14px; background: rgba(51, 65, 85, 0.5); border-radius: 10px; font-size: 12px; color: #cbd5e1; text-align: left; line-height: 1.6; }
    #wx-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.85); z-index: 999; padding: 20px; text-align: right; }
    .wx-arrow { font-size: 32px; color: #38bdf8; margin-right: 12px; font-weight: bold; }
    .wx-text { font-size: 16px; color: #fff; margin-top: 10px; line-height: 1.6; text-align: right; }
  </style>
</head>
<body>
  <div id="wx-overlay">
    <div class="wx-arrow">↗</div>
    <div class="wx-text">微信内无法直接下载 APK<br>请点击右上角 <b>【···】</b><br>选择 <b>【在浏览器中打开】</b> 即可下载</div>
  </div>
  <div class="card">
    <div class="icon">📱</div>
    <h1>FEAGLE Driver v0.8.0</h1>
    <p class="sub">Android 微信 8.0.78 物理 Hook 驱动 (450 KB)</p>
    <a id="dl-link" href="${localUrl}" class="btn">⚡ 立即下载 APK 安装包</a>
    <a href="${cdnUrl}" class="btn-sub">🌐 境外备用 CDN 下载</a>
    <div style="margin-top: 16px; padding: 10px; background: rgba(15, 23, 42, 0.6); border-radius: 8px; font-size: 11px; color: #94a3b8; word-break: break-all; text-align: left;">
      <div style="margin-bottom: 4px; color: #cbd5e1; font-weight: 600;">备用手动直链 (可复制到地址栏回车):</div>
      <span id="raw-url">${httpProto}://${hostHeader}${localUrl}</span>
    </div>
    <div class="tips">
      <b>📌 安装后续步骤：</b><br>
      1. 下载完成后在平板上点击安装；<br>
      2. 打开 <b>LSPosed</b> 模块管理器并勾选 <b>微信</b>；<br>
      3. 强制停止微信并重新打开微信生效；<br>
      4. 回到电脑屏幕切换至第二步扫码配对。
    </div>
  </div>
  <script>
    const isWechat = /MicroMessenger/i.test(navigator.userAgent);
    if (isWechat) {
      document.getElementById('wx-overlay').style.display = 'block';
    }
  </script>
</body>
</html>`;

      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(html);
      return;
    }

    // ---- GET /api/device/download-agent (APK 原生分发下载，国内 ECS 直连极速吐包) ----
    if (url.pathname === '/api/device/download-agent') {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const candidatePaths = [
        path.resolve(this.publicRoot, 'downloads', 'feaglewxbot-agent.apk'),
        path.resolve(this.publicRoot, '..', '..', 'android-agent', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
        path.resolve('/opt/FEAGLEwxbot/dist/feaglewxbot-agent.apk'),
      ];
      let apkBuffer = null;
      for (const p of candidatePaths) {
        try {
          apkBuffer = await fs.readFile(p);
          break;
        } catch {
          // try next
        }
      }
      if (apkBuffer) {
        response.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': 'attachment; filename="feagle-driver-v0.8.0.apk"',
          'Content-Length': apkBuffer.length,
          'Cache-Control': 'no-store',
        });
        response.end(apkBuffer);
      } else {
        response.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'APK package not found on server' }));
      }
      return;
    }

    if (url.pathname === '/api/status') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(this.state.snapshot()));
      return;
    }

    // ---- GET /api/doctor (全系统与双大脑主动健康诊断) ----
    if (url.pathname === '/api/doctor') {
      try {
        const report = await runSystemDiagnosis({ state: this.state });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(report));
      } catch (err) {
        response.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // ---- GET /api/messages（对话流：按会话查询 messages 表）----
    if (url.pathname === '/api/messages') {
      if (request.method !== 'GET') {
        response.writeHead(405, {
          Allow: 'GET',
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      const kind = url.searchParams.get('kind') === 'group' ? 'group' : 'private';
      const rawId = String(url.searchParams.get('id') || '').trim();
      const talker = String(url.searchParams.get('talker') || '').trim();
      if (!/^\d+$/.test(rawId) && !talker) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'id (OneBot id) or talker (微信 id) is required' }));
        return;
      }
      const limit = Math.min(Number(url.searchParams.get('limit') || 50) || 50, 200);
      const beforeRaw = String(url.searchParams.get('beforeId') || '').trim();
      const beforeId = /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
      Promise.resolve(this.getConversationMessages(kind, {
        onebotId: /^\d+$/.test(rawId) ? Number(rawId) : null,
        talker,
        limit,
        beforeId,
      }))
        .then((messages) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            ok: true,
            kind,
            messages,
          }));
        })
        .catch((error) => {
          response.writeHead(503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({
            error: String(error?.message || error).slice(0, 200),
          }));
        });
      return;
    }

    // ---- GET /api/memory/*（记忆代理 → Mnemosyne）----
    if (url.pathname.startsWith('/api/memory/')) {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.mnemosyne) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Memory service not configured' }));
        return;
      }
      const route = url.pathname.slice('/api/memory/'.length);
      const userId = url.searchParams.get('user_id') || this.mnemosyne.userId;
      const limit = Math.min(Number(url.searchParams.get('limit') || 20) || 20, 100);
      // 按聊天过滤：key → source（g:xxx / u:xxx）
      let source = null;
      const keyParam = String(url.searchParams.get('key') || '').trim();
      if (keyParam && this.resolveChannelFolder) {
        const folder = this.resolveChannelFolder(keyParam);
        if (folder) source = folder.replace(/^([gu])-/, '$1:');
      }
      const ownerParam = String(url.searchParams.get('owner') || '').trim() || null;
      try {
        let data;
        if (route === 'summary') {
          const [stats, tree] = await Promise.all([
            this.mnemosyne.stats(userId),
            this.mnemosyne.tree(userId),
          ]);
          data = { stats, tree };
        } else if (route === 'search') {
          const q = String(url.searchParams.get('q') || '').trim();
          if (!q) throw new TypeError('q (query) is required');
          data = await this.mnemosyne.search(q, { userId, limit, source, owner: ownerParam });
        } else if (route === 'recent') {
          data = await this.mnemosyne.recent({ userId, limit, source, owner: ownerParam });
        } else if (route === 'sessions') {
          data = await this.mnemosyne.sessions(limit);
        } else {
          response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Unknown memory route: ' + route }));
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ ok: true, data }));
      } catch (error) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 300) }));
      }
      return;
    }

    // ---- GET /api/persona（画像：围绕某人的信念 + 记忆检索）----
    if (url.pathname === '/api/persona') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.mnemosyne) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Memory service not configured' }));
        return;
      }
      const q = String(url.searchParams.get('q') || '').trim();
      const limit = Math.min(Number(url.searchParams.get('limit') || 10) || 10, 30);
      try {
        const data = await this.mnemosyne.persona(q, { limit });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ ok: true, data }));
      } catch (error) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 300) }));
      }
      return;
    }

    // ---- GET/PUT /api/tools/config（per-chat 工具栏配置）----
    if (url.pathname === '/api/tools/config') {
      if (request.method === 'GET') {
        const key = String(url.searchParams.get('key') || '').trim();
        Promise.resolve(this.getConversationTools(key))
          .then((config) => {
            response.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({ ok: true, config }));
          })
          .catch((error) => {
            response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
          });
        return;
      }
      if (request.method !== 'PUT') {
        response.writeHead(405, { Allow: 'GET, PUT', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      this.readJson(request, response, 16_384, (payload) => {
        const key = String(payload.key || '').trim();
        if (!key) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'key is required (e.g. group:1000000003)' }));
          return;
        }
        Promise.resolve(this.setConversationTools(key, {
          tools: payload.tools,
          workflow: payload.workflow,
        }))
          .then((config) => {
            response.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            response.end(JSON.stringify({ ok: true, config }));
          })
          .catch((error) => {
            response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
          });
      });
      return;
    }

    // ---- GET /api/tools/catalog（可选工具目录）----
    if (url.pathname === '/api/tools/catalog') {
      Promise.resolve(this.getToolCatalog())
        .then((catalog) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, catalog }));
        })
        .catch((error) => {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        });
      return;
    }

    // ---- GET /api/conversation/members（会话成员列表，记忆按成员筛选）----
    if (url.pathname === '/api/conversation/members') {
      const kind = url.searchParams.get('kind') === 'group' ? 'group' : 'private';
      const rawId = String(url.searchParams.get('id') || '').trim();
      const talker = String(url.searchParams.get('talker') || '').trim();
      Promise.resolve(this.getConversationMembers(kind, {
        onebotId: /^\d+$/.test(rawId) ? Number(rawId) : null,
        talker,
      }))
        .then((members) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, members }));
        })
        .catch((error) => {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        });
      return;
    }

    // ---- GET /api/logs（per-conversation 输入/输出日志）----
    if (url.pathname === '/api/logs') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      const key = String(url.searchParams.get('key') || '').trim();
      const limit = Math.min(Number(url.searchParams.get('limit') || 100) || 100, 300);
      const beforeRaw = String(url.searchParams.get('beforeId') || '').trim();
      const beforeId = /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
      Promise.resolve(this.getConversationLogs(key, { limit, beforeId }))
        .then((logs) => {
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, logs }));
        })
        .catch((error) => {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        });
      return;
    }

    // ---- GET /api/docs (conversation doc vault overview + read) ----
    if (url.pathname === '/api/docs') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      const key = String(url.searchParams.get('key') || '').trim();
      const type = String(url.searchParams.get('type') || 'memory').trim();
      try {
        if (key) {
          // key 归一化：group:微信talker -> g-<oid>（doc-vault 目录名）
          const dirName = this.resolveChannelFolder ? this.resolveChannelFolder(key) : null;
          if (!dirName) {
            response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: 'no docs for this conversation yet' }));
            return;
          }
          const docs = this.readDocDir ? this.readDocDir(dirName, type) : null;
          if (!docs) {
            response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: 'no docs for this conversation yet' }));
            return;
          }
          // 统一结构 { memory, personas }，前端只管 docs.memory / docs.personas
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ ok: true, key, type, docs }));
          return;
        }
        const vault = this.listDocVault();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true, vault }));
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 300) }));
      }
      return;
    }

    // ---- GET /api/skills/catalog（hermes 全局技能目录，只读参考）----
    if (url.pathname === '/api/skills/catalog') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ ok: true, catalog: convSkills.listGlobalSkills() }));
      return;
    }

    // ---- /api/skills（per-channel 技能文件夹管理）----
    if (url.pathname === '/api/skills') {
      if (request.method === 'GET') {
        const key = String(url.searchParams.get('key') || '').trim();
        const folder = this.resolveSkillsChannel(key, response);
        if (!folder) return;
        try {
          const skills = convSkills.listChannelSkills(folder);
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, skills }));
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        }
        return;
      }
      if (request.method === 'DELETE') {
        if (!this.authorizeMutation(request, response)) return;
        const key = String(url.searchParams.get('key') || '').trim();
        const name = String(url.searchParams.get('name') || '').trim();
        const folder = this.resolveSkillsChannel(key, response);
        if (!folder) return;
        try {
          const removed = convSkills.deleteSkill(folder, name);
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, removed }));
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        }
        return;
      }
      if (request.method !== 'PUT') {
        response.writeHead(405, { Allow: 'GET, PUT, DELETE', 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      if (!this.authorizeMutation(request, response)) return;
      this.readJson(request, response, 512_000, (payload) => {
        const key = String(payload.key || '').trim();
        const name = String(payload.name || '').trim();
        const content = String(payload.content ?? '');
        const folder = this.resolveSkillsChannel(key, response);
        if (!folder) return;
        try {
          const saved = convSkills.writeSkill(folder, name, content);
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify({ ok: true, saved }));
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
        }
      });
      return;
    }

    // ---- GET /api/skills/content（读取单个 SKILL.md）----
    if (url.pathname === '/api/skills/content') {
      const key = String(url.searchParams.get('key') || '').trim();
      const name = String(url.searchParams.get('name') || '').trim();
      const folder = this.resolveSkillsChannel(key, response);
      if (!folder) return;
      try {
        const content = convSkills.readSkill(folder, name);
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ ok: true, content }));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
      }
      return;
    }

    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write(`data: ${JSON.stringify(this.state.snapshot())}\n\n`);
      this.clients.add(response);
      request.on('close', () => this.clients.delete(response));
      return;
    }

    // ---- GET /logs（终端日志 SSE：先发环形缓冲尾部，再推增量）----
    if (url.pathname === '/logs') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      for (const line of tailLogs(200)) {
        response.write(`data: ${line}\n\n`);
      }
      const unsubscribe = subscribeLogs((line) => {
        response.write(`data: ${line}\n\n`);
      });
      request.on('close', () => {
        unsubscribe();
      });
      return;
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const relative = normalize(requested).replace(/^([/\\])+/, '');
    const path = join(this.publicRoot, relative);
    if (!path.startsWith(this.publicRoot) || !existsSync(path)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const headers = {
      'Content-Type': CONTENT_TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };
    if (extname(path) === '.apk') {
      headers['Content-Disposition'] = 'attachment; filename="feaglewxbot-agent.apk"';
      headers['Content-Type'] = 'application/vnd.android.package-archive';
    }
    response.writeHead(200, headers);
    createReadStream(path).pipe(response);
  }

  push(snapshot) {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  resolveSkillsChannel(key, response) {
    let folder = null;
    if (this.resolveChannelFolder) {
      try { folder = this.resolveChannelFolder(key); } catch { folder = null; }
    }
    if (!folder) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '无效的频道 id（需 g:xxx / u:xxx / g-xxx / u-xxx，或 group:/private: + 微信 id）' }));
      return null;
    }
    return folder;
  }

  authorizeMutation(request, response) {
    if (request.headers['x-feagle-dashboard'] !== '1') {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Dashboard mutation header required' }));
      return false;
    }
    const origin = String(request.headers.origin || '');
    const host = String(request.headers.host || '');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Invalid Origin' }));
        return false;
      }
      if (originHost !== host) {
        response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Cross-origin mutation denied' }));
        return false;
      }
    }
    return true;
  }

  readBody(request, maxBytes = 16_384) {
    return new Promise((resolve, reject) => {
      let body = '';
      let aborted = false;
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        if (aborted) return;
        body += chunk;
        if (body.length > maxBytes) {
          aborted = true;
          reject(new Error('Request body too large'));
          request.destroy();
        }
      });
      request.on('end', () => {
        if (aborted) return;
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
      request.on('error', reject);
    });
  }

  readJson(request, response, maxBytes, callback) {
    if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
      response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
      return;
    }
    let body = '';
    let tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > maxBytes) tooLarge = true;
    });
    request.on('end', () => {
      if (tooLarge) {
        response.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      try {
        callback(JSON.parse(body || '{}'));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: String(error?.message || 'Invalid JSON body') }));
      }
    });
  }

  stop() {
    if (this.onSnapshotListener) {
      this.state.off('snapshot', this.onSnapshotListener);
      this.onSnapshotListener = null;
    }
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server.close();
  }
}

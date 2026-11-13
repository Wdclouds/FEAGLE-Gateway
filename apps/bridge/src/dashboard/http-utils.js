import os from 'node:os';

export function getAvailableLanIps() {
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

export function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

export function sendMethodNotAllowed(response, allow) {
  sendJson(response, 405, { error: 'Method not allowed' }, { Allow: allow });
}

export function authorizeMutation(request, response) {
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

export function readBody(request, maxBytes = 16_384) {
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

export function readJson(request, response, maxBytes, callback) {
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

export function resolveSkillsChannel(server, key, response) {
  let folder = null;
  if (server.resolveChannelFolder) {
    try { folder = server.resolveChannelFolder(key); } catch { folder = null; }
  }
  if (!folder) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: '无效的频道 id（需 g:xxx / u:xxx / g-xxx / u-xxx，或 group:/private: + 微信 id）' }));
    return null;
  }
  return folder;
}

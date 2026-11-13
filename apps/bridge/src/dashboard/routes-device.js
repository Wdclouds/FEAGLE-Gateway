import QRCode from 'qrcode';
import { getAvailableLanIps, sendJson } from './http-utils.js';

export async function handleDeviceRoutes(server, request, response, url) {
  if (url.pathname === '/api/device/pair-code') {
    const host = request.headers['x-forwarded-host'] || request.headers.host || `${server.host}:${server.port}`;
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

    const token = process.env.ANDROID_BRIDGE_TOKEN || '';
    let pairingCode = null;
    let expiresAt = null;

    if (token.length < 24 && typeof server.createPairingCode === 'function') {
      try {
        const pair = server.createPairingCode();
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
    const hostHeader = request.headers.host || `${hostname}:${server.port}`;
    const downloadUrl = `${httpProto}://${hostHeader}/download`;
    const lanzouUrl = 'https://wwbpz.lanzout.com/ij5Aw4avhhni';
    const lanzouPass = '9qt0';

    const payload = {
      endpoint,
      ...(token ? { token } : {}),
      ...(pairingCode ? { pairingCode, expiresAt } : {}),
      timestamp: Math.floor(Date.now() / 1000),
    };

    const rawPayload = JSON.stringify(payload);
    QRCode.toDataURL(rawPayload, { errorCorrectionLevel: 'M', margin: 2, width: 280 }, (err, qrDataUrl) => {
      QRCode.toDataURL(lanzouUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 }, (dlErr, downloadQrDataUrl) => {
        sendJson(response, 200, {
          endpoint,
          downloadUrl,
          downloadQrDataUrl: dlErr ? '' : downloadQrDataUrl,
          lanzouUrl,
          lanzouPass,
          selectedIp: hostname,
          lanIps,
          pairingCode,
          expiresAt,
          timestamp: payload.timestamp,
          qrDataUrl: err ? '' : qrDataUrl,
          deviceStatus: server.state.snapshot().android?.deviceStatus || 'DISCONNECTED',
        });
      });
    });
    return true;
  }

  if (url.pathname.startsWith('/api/device/outbound-image/')) {
    const ticket = url.pathname.slice('/api/device/outbound-image/'.length);
    const item = server.imageStore?.get(ticket);
    if (!item) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end('Image expired or not found');
      return true;
    }
    response.writeHead(200, {
      'Content-Type': item.contentType || 'image/jpeg',
      'Content-Length': item.buffer.length,
      'Cache-Control': 'no-store',
    });
    response.end(item.buffer);
    return true;
  }

  if (url.pathname === '/api/device/check-update') {
    const clientVer = String(url.searchParams.get('version') || '0.0.0').trim();
    const latestVer = '0.8.4';
    const hasUpdate = clientVer !== latestVer;
    sendJson(response, 200, {
      hasUpdate,
      currentVersion: clientVer,
      latestVersion: latestVer,
      downloadUrl: '/api/device/download-agent',
      releaseNotes: 'FEAGLE Gateway Driver 0.8.4: 采用 Linux 原生 ParcelFileDescriptor 零内存零分片直传，彻底消除 Binder 队头阻塞',
    });
    return true;
  }

  if (url.pathname === '/download' || url.pathname === '/downloads') {
    const lanzouUrl = 'https://wwbpz.lanzout.com/ij5Aw4avhhni';
    const lanzouPass = '9qt0';
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
    .pass-tag { display: inline-block; background: #0369a1; color: #fff; padding: 2px 8px; border-radius: 6px; font-weight: bold; font-family: monospace; letter-spacing: 1px; }
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
    <h1>FEAGLE Driver v0.8.4</h1>
    <p class="sub">Android 微信 8.0.79 / 8.0.78 物理 Hook 驱动 (469 KB)</p>
    <a id="dl-link" href="${lanzouUrl}" target="_blank" class="btn">⚡ 蓝奏云极速下载 (密码: <span class="pass-tag">${lanzouPass}</span>)</a>
    <a href="${localUrl}" class="btn-sub">💾 服务器直接下载 (备用)</a>
    <a href="${cdnUrl}" class="btn-sub">🌐 GitHub Releases 下载 (备用)</a>
    <div class="tips">
      <b>📌 安装后续步骤：</b><br>
      1. 蓝奏云打开后输入提取码 <b>${lanzouPass}</b> 下载 APK 并安装；<br>
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
    return true;
  }

  if (url.pathname === '/api/device/download-agent') {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const candidatePaths = [
      path.resolve(server.publicRoot, 'downloads', 'feaglewxbot-agent.apk'),
      path.resolve(server.publicRoot, '..', '..', 'android-agent', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
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
        'Content-Disposition': 'attachment; filename="feagle-driver-v0.8.4.apk"',
        'Content-Length': apkBuffer.length,
        'Cache-Control': 'no-store',
      });
      response.end(apkBuffer);
    } else {
      sendJson(response, 404, { error: 'APK package not found on server' });
    }
    return true;
  }

  return false;
}

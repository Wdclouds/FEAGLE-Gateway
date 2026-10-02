export const hermesState = {
  connected: false,
  mode: 'memory', // 'memory' | 'http' | 'cli'
  endpoint: 'http://127.0.0.1:18010',
  statusText: '正在检测...',
  lastPingMs: null,
};

let probeTimer = null;

export async function probeHermesNow(endpoint) {
  if (endpoint) hermesState.endpoint = endpoint;
  const rawTarget = (hermesState.endpoint || '').trim();

  if (!rawTarget || rawTarget.toLowerCase() === 'cli') {
    hermesState.connected = true;
    hermesState.mode = 'cli';
    hermesState.statusText = 'Hermes 本地 CLI 交互中枢 (在线)';
    hermesState.lastPingMs = 0;
    return hermesState;
  }

  const start = Date.now();
  try {
    const target = rawTarget.replace(/\/+$/, '');
    const res = await fetch(`${target}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    // 任何 HTTP 返回（包括 200, 404, 405）都证明服务端口在线
    hermesState.connected = true;
    hermesState.lastPingMs = Date.now() - start;
    if (target.includes('18010')) {
      hermesState.mode = 'memory';
      hermesState.statusText = `Mnemosyne 记忆中枢已连接 (${hermesState.lastPingMs}ms)`;
    } else {
      hermesState.mode = 'http';
      hermesState.statusText = `Hermes 网关在线 (${hermesState.lastPingMs}ms)`;
    }
  } catch (err) {
    hermesState.connected = false;
    hermesState.lastPingMs = null;
    hermesState.statusText = `无法连接端点 (${rawTarget}): ${err.message}`;
  }
  return hermesState;
}

export function initHermesProbe(endpoint, intervalMs = 10_000) {
  if (endpoint) hermesState.endpoint = endpoint;
  if (probeTimer) clearInterval(probeTimer);
  void probeHermesNow();
  probeTimer = setInterval(() => {
    void probeHermesNow();
  }, intervalMs);
  probeTimer.unref();
}

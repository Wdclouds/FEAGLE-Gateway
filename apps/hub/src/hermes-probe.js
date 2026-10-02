export const hermesState = {
  connected: false,
  endpoint: 'http://127.0.0.1:18080',
  lastPingMs: null,
};

let probeTimer = null;

export async function probeHermesNow(endpoint) {
  if (endpoint) hermesState.endpoint = endpoint;
  const start = Date.now();
  try {
    const target = hermesState.endpoint.replace(/\/+$/, '');
    const res = await fetch(`${target}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    hermesState.connected = res.status < 500;
    hermesState.lastPingMs = Date.now() - start;
  } catch {
    hermesState.connected = false;
    hermesState.lastPingMs = null;
  }
  return hermesState;
}

export function initHermesProbe(endpoint, intervalMs = 15_000) {
  if (endpoint) hermesState.endpoint = endpoint;
  if (probeTimer) clearInterval(probeTimer);
  void probeHermesNow();
  probeTimer = setInterval(() => {
    void probeHermesNow();
  }, intervalMs);
  probeTimer.unref();
}

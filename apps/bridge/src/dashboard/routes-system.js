import { runSystemDiagnosis } from '../doctor.js';
import { authorizeMutation, readBody, readJson, sendJson, sendMethodNotAllowed } from './http-utils.js';

const WECHAT_ADMIN_MODES = new Set(['RUNNING', 'PAUSED', 'MANUAL_OFFLINE']);
const GROUP_CHAT_MODES = new Set(['OFF', 'OBSERVE', 'MENTION_ONLY']);

export async function handleSystemRoutes(server, request, response, url) {
  if (url.pathname === '/api/contacts/refresh') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    Promise.resolve(server.refreshContacts({ includeAvatars: true }))
      .then((result) => sendJson(response, 200, { ok: true, result, state: server.state.snapshot() }))
      .catch((error) => sendJson(response, 503, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname === '/api/probe/route') {
    const probeRouter = server.getProbeRouter();
    if (request.method === 'GET') {
      sendJson(response, 200, probeRouter?.getStatus() || { enabled: false });
      return true;
    }
    if (request.method === 'POST') {
      if (!authorizeMutation(request, response)) return true;
      const body = await readBody(request, 1_024);
      const res = probeRouter?.setRoute(body || {});
      sendJson(response, 200, { ok: true, status: res });
      return true;
    }
  }

  if (url.pathname === '/api/probe/pull') {
    const probeRouter = server.getProbeRouter();
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Number(url.searchParams.get('limit') || 10);
    const waitMs = Number(url.searchParams.get('wait') || 0);
    const events = waitMs > 0 && probeRouter
      ? await probeRouter.waitForEvents(since, Math.min(waitMs, 30_000))
      : (probeRouter?.pullEvents(since, limit) || []);
    sendJson(response, 200, { ok: true, events });
    return true;
  }

  if (url.pathname === '/api/probe/reply') {
    const probeRouter = server.getProbeRouter();
    if (request.method === 'POST') {
      if (!authorizeMutation(request, response)) return true;
      const body = await readBody(request, 4_096);
      try {
        const res = await probeRouter?.sendReply(body?.convKey, body?.text);
        sendJson(response, 200, { ok: true, result: res });
      } catch (err) {
        sendJson(response, 500, { ok: false, error: err?.message || String(err) });
      }
      return true;
    }
  }

  if (url.pathname === '/api/settings') {
    if (request.method === 'GET') {
      sendJson(response, 200, {
        settings: server.getBridgeSettings(),
        secretsManagedExternally: true,
        restartOnSave: true,
      });
      return true;
    }
    if (request.method !== 'PUT') {
      sendMethodNotAllowed(response, 'GET, PUT');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 32_768, (payload) => {
      Promise.resolve(server.saveBridgeSettings(payload))
        .then((result) => sendJson(response, 202, result))
        .catch((error) => sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/health/live') {
    sendJson(response, 200, {
      status: 'ok',
      startedAt: server.state.startedAt,
      now: new Date().toISOString(),
    });
    return true;
  }

  if (url.pathname === '/api/health/ready') {
    const snapshot = server.state.snapshot();
    const ready = snapshot.wechat?.status === 'ONLINE'
      && snapshot.wechat?.protocolHealth === 'HEALTHY'
      && snapshot.hermes?.status === 'READY'
      && snapshot.onebot?.status === 'CONNECTED';
    sendJson(response, ready ? 200 : 503, {
      status: ready ? 'ready' : 'not_ready',
      wechat: {
        status: snapshot.wechat?.status || 'UNKNOWN',
        protocolHealth: snapshot.wechat?.protocolHealth || 'UNKNOWN',
        lastSyncAt: snapshot.wechat?.lastSyncAt || '',
      },
      hermes: snapshot.hermes?.status || 'UNKNOWN',
      onebot: snapshot.onebot?.status || 'UNKNOWN',
    });
    return true;
  }

  if (url.pathname === '/api/test-mode') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 1024, (payload) => {
      if (typeof payload.enabled !== 'boolean') {
        sendJson(response, 400, { error: 'enabled must be a boolean' });
        return;
      }
      sendJson(response, 200, server.setTestMode(payload.enabled));
    });
    return true;
  }

  if (url.pathname === '/api/notifications/test') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    Promise.resolve(server.sendNotificationTest())
      .then((snapshot) => sendJson(response, 200, snapshot))
      .catch((error) => sendJson(response, 502, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname === '/api/wechat/admin-mode') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 1024, (payload) => {
      if (!WECHAT_ADMIN_MODES.has(payload.mode)) {
        sendJson(response, 400, { error: 'Unsupported WeChat admin mode' });
        return;
      }
      if (payload.mode === 'MANUAL_OFFLINE' && payload.confirm !== 'MANUAL_OFFLINE') {
        sendJson(response, 400, { error: 'Explicit confirmation is required' });
        return;
      }
      Promise.resolve(server.setWechatAdminMode(payload.mode))
        .then((snapshot) => sendJson(response, 202, snapshot))
        .catch((error) => sendJson(response, 409, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/schedule/override') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 1_024, (payload) => {
      if (typeof payload.enabled !== 'boolean') {
        sendJson(response, 400, { error: 'enabled must be a boolean' });
        return;
      }
      Promise.resolve(server.setSleepOverride(payload.enabled))
        .then((snapshot) => sendJson(response, 202, snapshot))
        .catch((error) => sendJson(response, 409, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/group-chat/config') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 8_192, (payload) => {
      if (!GROUP_CHAT_MODES.has(payload.mode)) {
        sendJson(response, 400, { error: 'Unsupported group chat mode' });
        return;
      }
      if (!Array.isArray(payload.allowlist)) {
        sendJson(response, 400, { error: 'allowlist must be an array' });
        return;
      }
      const allowlist = Array.from(new Set(payload.allowlist
        .map((item) => String(item || '').trim())
        .filter((item) => /^\d+$/.test(item))));
      if (payload.blockedTerms !== undefined && !Array.isArray(payload.blockedTerms)) {
        sendJson(response, 400, { error: 'blockedTerms must be an array' });
        return;
      }
      const blockedTerms = Array.from(new Set((payload.blockedTerms || [])
        .map((item) => String(item || '').trim().toLocaleLowerCase())
        .filter(Boolean)
        .map((item) => item.slice(0, 64))))
        .slice(0, 100);
      if (payload.mode === 'MENTION_ONLY' && payload.confirm !== 'ENABLE_GROUP_REPLY') {
        sendJson(response, 400, { error: 'Explicit confirmation is required' });
        return;
      }
      Promise.resolve(server.setGroupChatConfig(payload.mode, allowlist, blockedTerms))
        .then((snapshot) => sendJson(response, 200, snapshot))
        .catch((error) => sendJson(response, 409, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/group-chat/status') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 8_192, (payload) => {
      const groupId = String(payload.groupId || '').trim();
      if (!GROUP_CHAT_MODES.has(payload.mode)) {
        sendJson(response, 400, { error: 'Unsupported group chat mode' });
        return;
      }
      if (!groupId) {
        sendJson(response, 400, { error: 'groupId is required' });
        return;
      }
      Promise.resolve(server.setGroupChatMode(groupId, payload.mode))
        .then((snapshot) => sendJson(response, 200, snapshot))
        .catch((error) => sendJson(response, 409, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/status') {
    sendJson(response, 200, server.state.snapshot());
    return true;
  }

  if (url.pathname === '/api/doctor') {
    try {
      const report = await runSystemDiagnosis({ state: server.state });
      sendJson(response, 200, report);
    } catch (err) {
      sendJson(response, 500, { error: err?.message || String(err) });
    }
    return true;
  }

  return false;
}

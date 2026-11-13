import { authorizeMutation, readJson, resolveSkillsChannel, sendJson, sendMethodNotAllowed } from './http-utils.js';

const convSkills = {
  listGlobalSkills: () => [],
  listChannelSkills: () => [],
  deleteSkill: () => false,
  writeSkill: () => false,
  readSkill: () => '',
};

export async function handleConversationRoutes(server, request, response, url) {
  if (url.pathname === '/api/conversations') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    const status = url.searchParams.get('status') || 'active';
    const kind = url.searchParams.get('kind') || 'all';
    const search = url.searchParams.get('search') || '';
    const includeExited = url.searchParams.get('includeExited') === 'true' || url.searchParams.get('includeExited') === '1';
    const includeTest = url.searchParams.get('includeTest') === 'true' || url.searchParams.get('includeTest') === '1';
    const includeIgnored = url.searchParams.get('includeIgnored') === 'true' || url.searchParams.get('includeIgnored') === '1';
    const includeArchived = url.searchParams.get('includeArchived') === 'true' || url.searchParams.get('includeArchived') === '1';
    const limit = Math.min(Number(url.searchParams.get('limit') || 100) || 100, 500);

    try {
      const data = server.listConversations({
        status,
        kind,
        search,
        includeExited,
        includeTest,
        includeIgnored,
        includeArchived,
        limit,
      });
      sendJson(response, 200, { ok: true, ...data });
    } catch (error) {
      sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) });
    }
    return true;
  }

  if (url.pathname === '/api/conversations/status') {
    if (request.method !== 'PUT' && request.method !== 'POST') {
      sendMethodNotAllowed(response, 'PUT, POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 16_384, (payload) => {
      const talker = String(payload.talker || '').trim();
      const status = String(payload.status || 'active').trim();
      if (!talker) {
        sendJson(response, 400, { error: 'talker is required' });
        return;
      }
      try {
        const res = server.setConversationStatus(talker, status, {
          reason: payload.reason,
          alias: payload.alias,
          pinned: payload.pinned,
        });
        sendJson(response, 200, { ok: true, conversation: res });
      } catch (error) {
        sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) });
      }
    });
    return true;
  }

  if (url.pathname === '/api/conversations/prune') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    try {
      const result = server.pruneConversations();
      if (server.idMap && typeof server.state?.restoreGroups === 'function') {
        try { server.state.restoreGroups(server.idMap.listGroups()); } catch {}
      }
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) });
    }
    return true;
  }

  if (url.pathname === '/api/conversations/batch') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, 'POST');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 65_536, (payload) => {
      const talkers = Array.isArray(payload.talkers) ? payload.talkers : [];
      const action = String(payload.action || 'ignore').trim();
      const reason = String(payload.reason || '').trim();
      const statusMap = { ignore: 'ignored', archive: 'archived', activate: 'active', exit: 'exited' };
      const targetStatus = statusMap[action] || action;

      let updated = 0;
      for (const t of talkers) {
        const talkerStr = String(t || '').trim();
        if (!talkerStr) continue;
        try {
          server.setConversationStatus(talkerStr, targetStatus, { reason });
          updated += 1;
        } catch {}
      }
      sendJson(response, 200, { ok: true, updatedCount: updated });
    });
    return true;
  }

  if (url.pathname === '/api/messages') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    const kind = url.searchParams.get('kind') === 'group' ? 'group' : 'private';
    const rawId = String(url.searchParams.get('id') || '').trim();
    const talker = String(url.searchParams.get('talker') || '').trim();
    if (!/^\d+$/.test(rawId) && !talker) {
      sendJson(response, 400, { error: 'id (OneBot id) or talker (微信 id) is required' });
      return true;
    }
    const limit = Math.min(Number(url.searchParams.get('limit') || 50) || 50, 200);
    const beforeRaw = String(url.searchParams.get('beforeId') || '').trim();
    const beforeId = /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
    Promise.resolve(server.getConversationMessages(kind, {
      onebotId: /^\d+$/.test(rawId) ? Number(rawId) : null,
      talker,
      limit,
      beforeId,
    }))
      .then((messages) => sendJson(response, 200, { ok: true, kind, messages }))
      .catch((error) => sendJson(response, 503, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname.startsWith('/api/memory/')) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    if (!server.mnemosyne) {
      sendJson(response, 503, { error: 'Memory service not configured' });
      return true;
    }
    const route = url.pathname.slice('/api/memory/'.length);
    const userId = url.searchParams.get('user_id') || server.mnemosyne.userId;
    const limit = Math.min(Number(url.searchParams.get('limit') || 20) || 20, 100);
    let source = null;
    const keyParam = String(url.searchParams.get('key') || '').trim();
    if (keyParam && server.resolveChannelFolder) {
      const folder = server.resolveChannelFolder(keyParam);
      if (folder) source = folder.replace(/^([gu])-/, '$1:');
    }
    const ownerParam = String(url.searchParams.get('owner') || '').trim() || null;
    try {
      let data;
      if (route === 'summary') {
        const [stats, tree] = await Promise.all([
          server.mnemosyne.stats(userId),
          server.mnemosyne.tree(userId),
        ]);
        data = { stats, tree };
      } else if (route === 'search') {
        const q = String(url.searchParams.get('q') || '').trim();
        if (!q) throw new TypeError('q (query) is required');
        data = await server.mnemosyne.search(q, { userId, limit, source, owner: ownerParam });
      } else if (route === 'recent') {
        data = await server.mnemosyne.recent({ userId, limit, source, owner: ownerParam });
      } else if (route === 'sessions') {
        data = await server.mnemosyne.sessions(limit);
      } else {
        sendJson(response, 404, { error: 'Unknown memory route: ' + route });
        return true;
      }
      sendJson(response, 200, { ok: true, data });
    } catch (error) {
      sendJson(response, 502, { error: String(error?.message || error).slice(0, 300) });
    }
    return true;
  }

  if (url.pathname === '/api/persona') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    if (!server.mnemosyne) {
      sendJson(response, 503, { error: 'Memory service not configured' });
      return true;
    }
    const q = String(url.searchParams.get('q') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit') || 10) || 10, 30);
    try {
      const data = await server.mnemosyne.persona(q, { limit });
      sendJson(response, 200, { ok: true, data });
    } catch (error) {
      sendJson(response, 502, { error: String(error?.message || error).slice(0, 300) });
    }
    return true;
  }

  if (url.pathname === '/api/tools/config') {
    if (request.method === 'GET') {
      const key = String(url.searchParams.get('key') || '').trim();
      Promise.resolve(server.getConversationTools(key))
        .then((config) => sendJson(response, 200, { ok: true, config }))
        .catch((error) => sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) }));
      return true;
    }
    if (request.method !== 'PUT') {
      sendMethodNotAllowed(response, 'GET, PUT');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 16_384, (payload) => {
      const key = String(payload.key || '').trim();
      if (!key) {
        sendJson(response, 400, { error: 'key is required (e.g. group:1000000003)' });
        return;
      }
      Promise.resolve(server.setConversationTools(key, {
        tools: payload.tools,
        workflow: payload.workflow,
      }))
        .then((config) => sendJson(response, 200, { ok: true, config }))
        .catch((error) => sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) }));
    });
    return true;
  }

  if (url.pathname === '/api/tools/catalog') {
    Promise.resolve(server.getToolCatalog())
      .then((catalog) => sendJson(response, 200, { ok: true, catalog }))
      .catch((error) => sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname === '/api/conversation/members') {
    const kind = url.searchParams.get('kind') === 'group' ? 'group' : 'private';
    const rawId = String(url.searchParams.get('id') || '').trim();
    const talker = String(url.searchParams.get('talker') || '').trim();
    Promise.resolve(server.getConversationMembers(kind, {
      onebotId: /^\d+$/.test(rawId) ? Number(rawId) : null,
      talker,
    }))
      .then((members) => sendJson(response, 200, { ok: true, members }))
      .catch((error) => sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname === '/api/logs') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    const key = String(url.searchParams.get('key') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit') || 100) || 100, 300);
    const beforeRaw = String(url.searchParams.get('beforeId') || '').trim();
    const beforeId = /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
    Promise.resolve(server.getConversationLogs(key, { limit, beforeId }))
      .then((logs) => sendJson(response, 200, { ok: true, logs }))
      .catch((error) => sendJson(response, 500, { error: String(error?.message || error).slice(0, 200) }));
    return true;
  }

  if (url.pathname === '/api/docs') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    const key = String(url.searchParams.get('key') || '').trim();
    const type = String(url.searchParams.get('type') || 'memory').trim();
    try {
      if (key) {
        const dirName = server.resolveChannelFolder ? server.resolveChannelFolder(key) : null;
        if (!dirName) {
          sendJson(response, 404, { error: 'no docs for this conversation yet' });
          return true;
        }
        const docs = server.readDocDir ? server.readDocDir(dirName, type) : null;
        if (!docs) {
          sendJson(response, 404, { error: 'no docs for this conversation yet' });
          return true;
        }
        sendJson(response, 200, { ok: true, key, type, docs });
        return true;
      }
      sendJson(response, 200, { ok: true, vault: server.listDocVault() });
    } catch (error) {
      sendJson(response, 500, { error: String(error?.message || error).slice(0, 300) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/catalog') {
    sendJson(response, 200, { ok: true, catalog: convSkills.listGlobalSkills() });
    return true;
  }

  if (url.pathname === '/api/skills') {
    if (request.method === 'GET') {
      const key = String(url.searchParams.get('key') || '').trim();
      const folder = resolveSkillsChannel(server, key, response);
      if (!folder) return true;
      try {
        sendJson(response, 200, { ok: true, skills: convSkills.listChannelSkills(folder) });
      } catch (error) {
        sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) });
      }
      return true;
    }
    if (request.method === 'DELETE') {
      if (!authorizeMutation(request, response)) return true;
      const key = String(url.searchParams.get('key') || '').trim();
      const name = String(url.searchParams.get('name') || '').trim();
      const folder = resolveSkillsChannel(server, key, response);
      if (!folder) return true;
      try {
        sendJson(response, 200, { ok: true, removed: convSkills.deleteSkill(folder, name) });
      } catch (error) {
        sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) });
      }
      return true;
    }
    if (request.method !== 'PUT') {
      sendMethodNotAllowed(response, 'GET, PUT, DELETE');
      return true;
    }
    if (!authorizeMutation(request, response)) return true;
    readJson(request, response, 512_000, (payload) => {
      const key = String(payload.key || '').trim();
      const name = String(payload.name || '').trim();
      const content = String(payload.content ?? '');
      const folder = resolveSkillsChannel(server, key, response);
      if (!folder) return;
      try {
        sendJson(response, 200, { ok: true, saved: convSkills.writeSkill(folder, name, content) });
      } catch (error) {
        sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) });
      }
    });
    return true;
  }

  if (url.pathname === '/api/skills/content') {
    const key = String(url.searchParams.get('key') || '').trim();
    const name = String(url.searchParams.get('name') || '').trim();
    const folder = resolveSkillsChannel(server, key, response);
    if (!folder) return true;
    try {
      sendJson(response, 200, { ok: true, content: convSkills.readSkill(folder, name) });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error).slice(0, 200) });
    }
    return true;
  }

  return false;
}

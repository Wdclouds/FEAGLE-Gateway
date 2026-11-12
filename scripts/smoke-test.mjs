import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { DashboardServer } from '../apps/bridge/src/dashboard.js';
import { RuntimeState } from '../apps/bridge/src/state.js';
import {
  ensureChannelSandbox,
  listChannelSandboxes,
  updateChannelSandbox,
  getMemberProfiles,
  updateMemberProfile,
  initControlPlane,
} from '../apps/gateway/dist/control.js';
import { getAllTools } from '../apps/gateway/dist/tools.js';

async function main() {
  console.log('🚀 [Smoke Test] Initializing Gateway Control Plane & In-Memory Database...');
  initControlPlane();

  // Create lightweight Gateway server matching apps/gateway/src/index.ts
  const gwServer = createServer((req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
      return json(200, {
        ok: true,
        service: 'pi-wx-gateway',
        uptime_s: 10,
        db: { sessions: 1, traces: 5 },
      });
    }

    if (req.method === 'GET' && req.url === '/api/tools') {
      const tools = getAllTools();
      return json(200, {
        ok: true,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      });
    }

    if (req.method === 'GET' && req.url === '/api/channels') {
      return json(200, { ok: true, channels: listChannelSandboxes() });
    }

    const membersMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/members$/);
    if (req.method === 'GET' && membersMatch) {
      const chatId = decodeURIComponent(membersMatch[1]);
      return json(200, { ok: true, chatId, members: getMemberProfiles(chatId) });
    }

    const memberUpdateMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/members\/([^/?]+)$/);
    if (req.method === 'POST' && memberUpdateMatch) {
      const chatId = decodeURIComponent(memberUpdateMatch[1]);
      const wxid = decodeURIComponent(memberUpdateMatch[2]);
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        const profile = updateMemberProfile(chatId, wxid, body);
        return json(200, { ok: true, chatId, wxid, profile });
      });
      return;
    }

    const channelUpdateMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)$/);
    if (req.method === 'POST' && channelUpdateMatch) {
      const chatId = decodeURIComponent(channelUpdateMatch[1]);
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        const updated = updateChannelSandbox(chatId, body);
        return json(200, { ok: true, chatId, sandbox: updated });
      });
      return;
    }

    json(404, { error: 'not_found' });
  });

  await new Promise((resolve) => gwServer.listen(0, '127.0.0.1', resolve));
  const gwPort = gwServer.address().port;
  process.env.GATEWAY_PORT = String(gwPort);
  console.log(`📡 [Smoke Test] Gateway mock listening on 127.0.0.1:${gwPort}`);

  // Start Bridge Dashboard Server
  const state = new RuntimeState();
  const dashboard = new DashboardServer({
    state,
    host: '127.0.0.1',
    port: 0,
  });
  await dashboard.start();
  const bridgePort = dashboard.server.address().port;
  const base = `http://127.0.0.1:${bridgePort}`;
  console.log(`🌐 [Smoke Test] Bridge Dashboard listening on 127.0.0.1:${bridgePort}`);

  try {
    // 1. Single Page Application (Vue 3 index.html)
    console.log('\n--- 1. Testing Vue 3 SPA Delivery ---');
    const rootRes = await fetch(`${base}/`);
    assert.equal(rootRes.status, 200);
    const html = await rootRes.text();
    assert.match(html, /<div id="app"><\/div>/);
    assert.match(html, /assets\/index\.[a-zA-Z0-9_-]+\.js/);
    console.log('✔ GET / -> 200 OK (Served Vue 3 SPA index.html)');

    // 2. APK Binary Preservation
    console.log('\n--- 2. Testing Binary Asset Preservation ---');
    const apkRes = await fetch(`${base}/downloads/feaglewxbot-agent.apk`);
    assert.equal(apkRes.status, 200);
    const apkBuffer = await apkRes.arrayBuffer();
    assert.equal(apkBuffer.byteLength, 499758);
    console.log(`✔ GET /downloads/feaglewxbot-agent.apk -> 200 OK (${apkBuffer.byteLength} bytes binary intact)`);

    // 3. Bridge State Snapshot API
    console.log('\n--- 3. Testing Bridge Native APIs ---');
    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.wechat.adminMode, 'RUNNING');
    console.log('✔ GET /api/status -> 200 OK (Bridge state snapshot returned)');

    // 4. Reverse Proxy: Gateway Health
    console.log('\n--- 4. Testing Gateway Reverse Proxy (Zero-CORS) ---');
    const healthRes = await fetch(`${base}/api/gateway/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.service, 'pi-wx-gateway');
    console.log('✔ GET /api/gateway/health -> 200 OK (Proxied to Gateway 127.0.0.1:' + gwPort + '/health)');

    // 5. Reverse Proxy: Tools Catalog
    const toolsRes = await fetch(`${base}/api/tools`);
    assert.equal(toolsRes.status, 200);
    const toolsJson = await toolsRes.json();
    assert.ok(toolsJson.tools.length >= 3);
    console.log(`✔ GET /api/tools -> 200 OK (Proxied: ${toolsJson.tools.length} function tools found)`);

    // 6. Reverse Proxy: Channel Sandboxes & Member Ops
    console.log('\n--- 5. Testing Channel Sandbox & Member APIs via Proxy ---');
    const testChat = 'smoke_test_group@chatroom';
    ensureChannelSandbox(testChat);

    const chRes = await fetch(`${base}/api/channels`);
    assert.equal(chRes.status, 200);
    const chJson = await chRes.json();
    assert.ok(chJson.channels.some((c) => c.chatId === testChat));
    console.log(`✔ GET /api/channels -> 200 OK (Proxied: ${chJson.channels.length} channels listed)`);

    const updateChRes = await fetch(`${base}/api/channels/${encodeURIComponent(testChat)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personaText: '# Smoke Test Persona',
        tools: ['web_search'],
      }),
    });
    assert.equal(updateChRes.status, 200);
    const updateChJson = await updateChRes.json();
    assert.equal(updateChJson.sandbox.personaText, '# Smoke Test Persona');
    console.log('✔ POST /api/channels/:chatId -> 200 OK (Sandbox updated via proxy)');

    const updateMemRes = await fetch(`${base}/api/channels/${encodeURIComponent(testChat)}/members/wxid_smoke_user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'VIP',
        tags: ['Tester', 'Core'],
        notes: 'Integration test user',
      }),
    });
    assert.equal(updateMemRes.status, 200);
    const updateMemJson = await updateMemRes.json();
    assert.equal(updateMemJson.profile.role, 'VIP');
    assert.deepEqual(updateMemJson.profile.tags, ['Tester', 'Core']);
    console.log('✔ POST /api/channels/:chatId/members/:wxid -> 200 OK (Member profile updated via proxy)');

    console.log('\n🎉 ====================================================');
    console.log('   ALL E2E INTEGRATION & PROXY SMOKE TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    await dashboard.stop();
    gwServer.close();
    delete process.env.GATEWAY_PORT;
  }
}

main().catch((err) => {
  console.error('\n❌ [Smoke Test] Failed with error:', err);
  process.exit(1);
});

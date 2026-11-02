import { createServer } from 'node:http';
import { config } from './config.js';
import { trace, stats } from './db.js';
import { piManager } from './pi-manager.js';
import { receiveInbound, sendToBridge, gatewayStatus, wireCronToPipeline } from './pipeline.js';
import { quickBatch } from './sanitizer.js';
import {
  initControlPlane, startScheduler, requestApproval, getTaskCtx,
  listPersonas, hasPendingConfirm, listJobs, toolAllowedForChat,
} from './control.js';
import type { WxInboundPkt } from './protocol.js';

const seen = new Map<string, number>(); // 消息 ID 去重（防 bridge 重发）
const SEEN_MAX = 2000;

function dedup(id: string): boolean {
  if (seen.has(id)) return false;
  seen.set(id, Date.now());
  if (seen.size > SEEN_MAX) {
    // 简单淘汰：删最老一半
    const entries = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]);
    for (const [k] of entries.slice(0, Math.floor(SEEN_MAX / 2))) seen.delete(k);
  }
  return true;
}

const server = createServer((req, res) => {
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // 健康检查
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
    return json(200, {
      ok: true,
      service: 'pi-wx-gateway',
      ...gatewayStatus(),
      db: stats(),
      uptime_s: Math.round(process.uptime()),
      rss_mb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    });
  }

  // 入站：wxbridge → 网关
  if (req.method === 'POST' && req.url === '/inbound') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 262144) req.destroy(); });
    req.on('end', async () => {
      try {
        const pkt = JSON.parse(raw) as WxInboundPkt;
        if (!pkt.id || !pkt.c || !pkt.u || (pkt.t === undefined && !pkt.img)) {
          return json(400, { error: 'bad_pkt' });
        }
        if (!dedup(pkt.id)) return json(200, { ok: true, dedup: true });
        await receiveInbound(pkt);
        json(200, { ok: true });
      } catch (e) {
        trace('-', 'SYS', 'inbound_parse_error', { err: String(e).slice(0, 200) });
        json(400, { error: 'parse_error' });
      }
    });
    return;
  }

  // 出站测试端点：模拟给某 chat 发消息（联调用）
  if (req.method === 'POST' && req.url === '/test/outbound') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      try {
        const { c: chat, t: text } = JSON.parse(raw);
        const ok = await sendToBridge(quickBatch(chat, text || 'gateway test'));
        json(ok ? 200 : 502, { sent: ok });
      } catch { json(400, { error: 'bad_body' }); }
    });
    return;
  }

  // ===== Control Plane 内部端点（仅本机 127.0.0.1，MCP 与运维用）=====

  // 通道 A：MCP 高危审批长连接（挂起等微信 Y/N，最长 120s）
  if (req.method === 'POST' && req.url === '/internal/confirm') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', async () => {
      try {
        const { cmd, reason } = JSON.parse(raw);
        if (!cmd) return json(400, { error: 'cmd_required' });
        const verdict = await requestApproval(String(cmd).slice(0, 500), String(reason || '').slice(0, 500));
        json(200, verdict);
      } catch { json(400, { error: 'bad_body' }); }
    });
    return;
  }

  // 当前任务上下文（gateway-ctl MCP 读取）
  if (req.method === 'GET' && req.url === '/internal/context') {
    const ctx = getTaskCtx();
    if (!ctx) return json(200, { active: false });
    return json(200, {
      active: true,
      chat: ctx.chat,
      req_id: ctx.reqId,
      persona: ctx.persona.id,
      engine_mode: ctx.persona.engine_mode,
      allow_shell: ctx.persona.allow_shell,
      started_at: ctx.startedAt,
      prompt_head: ctx.prompt.slice(0, 400),
    });
  }

  // 人设与工具权限查询（gateway-ctl MCP 过滤 tools/list 用）
  if (req.method === 'GET' && (req.url || '').startsWith('/internal/persona-tools')) {
    const chat = new URL(req.url || '/', 'http://x').searchParams.get('chat') || '';
    if (!chat) return json(400, { error: 'chat_required' });
    const { allowed, persona } = toolAllowedForChat(chat, '__probe__');
    return json(200, { persona: persona.id, engine_mode: persona.engine_mode, allow_shell: persona.allow_shell, allowed_tools: persona.allowed_mcp_tools });
  }

  // 挂起审批一览
  if (req.method === 'GET' && req.url === '/internal/approvals') {
    return json(200, { pending: true, note: 'approvals held in-memory per chat', chats_hint: 'see sessions.pending_confirm_id' });
  }

  json(404, { error: 'not_found' });
});

// ---------- Control Plane 启动 ----------
initControlPlane();
wireCronToPipeline();
startScheduler();

server.listen(config.gatewayPort, '127.0.0.1', () => {
  console.log(`[pi-wx-gateway] listening on 127.0.0.1:${config.gatewayPort}`);
  console.log(`[pi-wx-gateway] bridge -> ${config.bridgeOutUrl}`);
  console.log(`[pi-wx-gateway] personas: ${listPersonas().map((p) => p.id).join(',')} | jobs: ${listJobs().length}`);
  if (!config.adminWxids.length) {
    console.warn('[pi-wx-gateway] ⚠️ ADMIN_WXIDS 未配置：私聊鉴权关闭（所有人可用）');
  }
});

piManager.on('recycled', () => console.log('[pi] 闲置回收完成'));
piManager.on('log', (s: string) => console.log(`[pi:stderr] ${s}`));

const shutdown = () => {
  console.log('[gateway] shutting down...');
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

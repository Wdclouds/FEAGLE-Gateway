import { createServer } from 'node:http';
import { config } from './config.js';
import { trace, stats } from './db.js';
import { dshManager } from './dsh-manager.js';
import { receiveInbound, sendToBridge, gatewayStatus, wireCronToPipeline } from './pipeline.js';
import { quickBatch } from './sanitizer.js';
import {
  initControlPlane, startScheduler, requestApproval, getTaskCtx,
  listPersonas, hasPendingConfirm, listJobs, toolAllowedForChat,
  listChannelSandboxes, ensureChannelSandbox, updateChannelSandbox,
  deleteChannelSandbox, getMemberProfiles, updateMemberProfile,
} from './control.js';
import { dialogManager } from './dialog.js';
import { getAllTools, registerCustomTool, unregisterTool } from './tools.js';
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
      service: 'feagle-wx-gateway',
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

  // ===== Web Admin Ops & Channel Sandbox 管理 REST API =====

  // 1. 获取全局工具清单
  if (req.method === 'GET' && req.url === '/api/tools') {
    const tools = getAllTools();
    return json(200, {
      ok: true,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        builtin: ['web_search', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article'].includes(t.name),
      })),
    });
  }

  // 1.1 动态注册自定义工具
  if (req.method === 'POST' && req.url === '/api/tools') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        if (!body.name || !body.description) {
          return json(400, { error: 'name_and_description_required' });
        }
        const created = registerCustomTool(body);
        return json(201, {
          ok: true,
          tool: {
            name: created.name,
            description: created.description,
            parameters: created.parameters,
            builtin: false,
          },
        });
      } catch {
        return json(400, { error: 'bad_body' });
      }
    });
    return;
  }

  // 1.2 动态删除自定义工具
  const toolDeleteMatch = (req.url || '').match(/^\/api\/tools\/([^/?]+)$/);
  if (req.method === 'DELETE' && toolDeleteMatch) {
    const toolName = decodeURIComponent(toolDeleteMatch[1]);
    const ok = unregisterTool(toolName);
    return json(ok ? 200 : 400, {
      ok,
      name: toolName,
      message: ok ? '工具已移除' : '内置核心工具不可删除',
    });
  }

  // 2. 列出所有社群沙箱摘要
  if (req.method === 'GET' && req.url === '/api/channels') {
    return json(200, { ok: true, channels: listChannelSandboxes() });
  }

  // 2.1 新建社群沙箱
  if (req.method === 'POST' && req.url === '/api/channels') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 262144) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        const chatId = String(body.chatId || '').trim();
        if (!chatId) return json(400, { error: 'chatId_required' });
        const sb = ensureChannelSandbox(chatId);
        if (body.name || body.personaText || body.rulesText || body.tools) {
          updateChannelSandbox(chatId, body);
        }
        return json(201, { ok: true, chatId, sandbox: sb });
      } catch {
        return json(400, { error: 'bad_body' });
      }
    });
    return;
  }

  // 3. 群聊沙箱成员列表
  const membersMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/members$/);
  if (req.method === 'GET' && membersMatch) {
    const chatId = decodeURIComponent(membersMatch[1]);
    const members = getMemberProfiles(chatId);
    return json(200, { ok: true, chatId, members });
  }

  // 3.1 创新点呈现：15分钟自然衰减会话环状态与手动重置
  const sessionMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/session$/);
  if (sessionMatch) {
    const chatId = decodeURIComponent(sessionMatch[1]);
    if (req.method === 'GET') {
      return json(200, {
        ok: true,
        chatId,
        remainingTtlSec: dialogManager.getRemainingTtlSec(chatId),
        turns: dialogManager.getTurns(chatId),
      });
    }
    if (req.method === 'POST') {
      dialogManager.resetSession(chatId);
      return json(200, { ok: true, chatId, reset: true });
    }
  }

  // 3.2 创新点呈现：群聊背景感知环（最近 20 条无需 @Nox 的普通流水）
  const bgMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/background$/);
  if (bgMatch && req.method === 'GET') {
    const chatId = decodeURIComponent(bgMatch[1]);
    return json(200, {
      ok: true,
      chatId,
      backgroundText: dialogManager.getGroupBackground(chatId, 20),
    });
  }

  // 4. 更新特定群成员画像/角色标签
  const memberUpdateMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/members\/([^/?]+)$/);
  if (req.method === 'POST' && memberUpdateMatch) {
    const chatId = decodeURIComponent(memberUpdateMatch[1]);
    const wxid = decodeURIComponent(memberUpdateMatch[2]);
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        const profile = updateMemberProfile(chatId, wxid, body);
        return json(200, { ok: true, chatId, wxid, profile });
      } catch {
        return json(400, { error: 'bad_body' });
      }
    });
    return;
  }

  // 5. 单个社群沙箱详情与配置更新 / 删除
  const channelMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)$/);
  if (channelMatch) {
    const chatId = decodeURIComponent(channelMatch[1]);
    if (req.method === 'GET') {
      const sb = ensureChannelSandbox(chatId);
      return json(200, {
        ok: true,
        sandbox: {
          chatId: sb.chatId,
          name: sb.name,
          dir: sb.dir,
          personaText: sb.personaText,
          rulesText: sb.rulesText,
          tools: sb.tools,
          memberCount: Object.keys(sb.members).length,
        },
      });
    }

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 262144) req.destroy(); });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw);
          const updated = updateChannelSandbox(chatId, body);
          return json(200, {
            ok: true,
            sandbox: {
              chatId: updated.chatId,
              name: updated.name,
              personaText: updated.personaText,
              rulesText: updated.rulesText,
              tools: updated.tools,
            },
          });
        } catch {
          return json(400, { error: 'bad_body' });
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const ok = deleteChannelSandbox(chatId);
      return json(ok ? 200 : 404, { ok, chatId });
    }
  }

  json(404, { error: 'not_found' });
});

// ---------- Control Plane 启动 ----------
initControlPlane();
wireCronToPipeline();
startScheduler();

server.listen(config.gatewayPort, '127.0.0.1', () => {
  console.log(`[feagle-wx-gateway] listening on 127.0.0.1:${config.gatewayPort}`);
  console.log(`[feagle-wx-gateway] bridge -> ${config.bridgeOutUrl}`);
  console.log(`[feagle-wx-gateway] engine -> dsh (${config.dsh.provider}/${config.dsh.model}, fallback=${config.dsh.fallbackProvider}/${config.dsh.fallbackModel})`);
  console.log(`[feagle-wx-gateway] personas: ${listPersonas().map((p) => p.id).join(',')} | jobs: ${listJobs().length}`);
  if (!config.adminWxids.length) {
    console.warn('[feagle-wx-gateway] ⚠️ ADMIN_WXIDS 未配置：私聊鉴权关闭（所有人可用）');
  }
});

dshManager.on('recycled', () => console.log('[dsh] 闲置回收完成'));
dshManager.on('log', (s: string) => console.log(`[dsh:stderr] ${s}`));

const shutdown = async () => {
  console.log('[gateway] shutting down...');
  await dshManager.shutdown();
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

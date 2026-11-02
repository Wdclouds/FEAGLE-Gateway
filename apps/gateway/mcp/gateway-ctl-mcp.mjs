#!/usr/bin/env node
/**
 * Gateway Control MCP —— Pi 的第二工具箱（高危审批 + 任务上下文）
 * 通道 A：request_high_risk_exec 通过 /internal/confirm 长连接挂起，
 * 等微信 Y/N 裁决后返回，Pi 全程不中断（绕过 abort() 死局）。
 * 注册：pi mcp add gateway-ctl -- node /opt/FEAGLEwxbot/apps/gateway/mcp/gateway-ctl-mcp.mjs
 */
import { createInterface } from 'node:readline';

const GW = process.env.GATEWAY_BASE_URL || 'http://127.0.0.1:6185';

async function gwFetch(path, init = {}, timeoutMs = 130_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GW}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { raw: text.slice(0, 1000) } }; }
  } catch (e) {
    return { status: 0, body: { error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) } };
  } finally {
    clearTimeout(timer);
  }
}

const TOOLS = [
  {
    name: 'request_high_risk_exec',
    description: '高危命令审批（必须先于执行调用）：删除数据/修改系统配置/重启服务/大范围文件变动等操作，调用本工具挂起等待用户微信 Y/N 裁决（2分钟）。approved=true 才能继续执行。',
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: '即将执行的确切命令' },
        reason: { type: 'string', description: '为什么需要执行（给用户看）' },
      },
      required: ['cmd'],
    },
    run: async (a) => {
      const r = await gwFetch('/internal/confirm', {
        method: 'POST',
        body: JSON.stringify({ cmd: a.cmd, reason: a.reason || '' }),
      });
      if (r.status !== 200) return { approved: false, error: r.body };
      return r.body;
    },
  },
  {
    name: 'get_task_context',
    description: '读取当前任务上下文（会话/人设/权限/任务开头），判断自己当前能做什么。',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await gwFetch('/internal/context', {}, 8000)).body,
  },
];

const toolList = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { id, method, params } = msg;
  if (method === undefined) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gateway-ctl', version: '2.0.0' },
      },
    });
    return;
  }
  if (method.startsWith('notifications/')) return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: toolList } });
    return;
  }

  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `未知工具: ${params?.name}` }], isError: true } });
      return;
    }
    Promise.resolve()
      .then(() => tool.run(params?.arguments || {}))
      .then((data) => {
        send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
        });
      })
      .catch((e) => {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `执行失败: ${e.message}` }], isError: true } });
      });
    return;
  }

  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
});

console.error('[gateway-ctl-mcp] ready -> ' + GW);

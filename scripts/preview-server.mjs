import { createServer } from 'node:http';
import { DashboardServer } from '../apps/bridge/src/dashboard.js';
import { RuntimeState } from '../apps/bridge/src/state.js';
import {
  ensureChannelSandbox,
  listChannelSandboxes,
  updateChannelSandbox,
  deleteChannelSandbox,
  getMemberProfiles,
  updateMemberProfile,
  initControlPlane,
} from '../apps/gateway/dist/control.js';
import { getAllTools, registerCustomTool, unregisterTool } from '../apps/gateway/dist/tools.js';
import { dialogManager } from '../apps/gateway/dist/dialog.js';

// 1. 初始化 Gateway 数据平面
initControlPlane();

// 预置两个样例社群沙箱供界面直观展示
ensureChannelSandbox('24892019283@chatroom');
updateChannelSandbox('24892019283@chatroom', {
  personaText: '# Nox 极客技术研讨群\n你是一个专业、犀利且风趣的高级架构师助手。',
  rulesText: '# 社群管理规则\n1. 严禁散播未经核实的指令\n2. 优先解答技术架构与全栈开发问题',
  tools: ['web_search', 'group_remind'],
});
updateMemberProfile('24892019283@chatroom', 'wxid_geek_alex', {
  name: 'Alex (全栈老手)',
  role: 'Core Admin',
  tags: ['架构师', 'Vue3活跃者'],
  notes: '经常讨论分布式系统与微前端',
});
updateMemberProfile('24892019283@chatroom', 'wxid_bot_fan', {
  name: '小明同学',
  role: 'VIP',
  tags: ['提问常客', 'Python'],
  notes: '关注大模型落地与智能体交互',
});

// 预置创新点：群背景感知流水与多轮问答衰减环数据
dialogManager.recordGroupBackground('24892019283@chatroom', '群友张三', '大家测过最新的 Vue 3.5 响应式性能提升了吗？');
dialogManager.recordGroupBackground('24892019283@chatroom', '李四', '据说内存占用降低了 56%，而且 SSR 渲染快了很多');
dialogManager.recordGroupBackground('24892019283@chatroom', '王五', '群主刚才发的架构图设计很棒');
dialogManager.appendTurn('24892019283@chatroom', {
  role: 'user',
  sender: 'Alex (全栈老手)',
  content: 'Nox，帮我看看当前集群的内存占用是否处于安全阈值内？',
  timestamp: Date.now() - 120_000,
});
dialogManager.appendTurn('24892019283@chatroom', {
  role: 'assistant',
  content: '收到 Alex。当前集群宿主机空闲物理内存约 2.3 GB，各项服务均在限额范围内平稳运行。',
  timestamp: Date.now() - 110_000,
});

ensureChannelSandbox('19827364501@chatroom');
updateChannelSandbox('19827364501@chatroom', {
  personaText: '# FEAGLE 官方运维监控群\n实时通报系统异常与安全巡检警报。',
  rulesText: '# 巡检守则\n保持高敏感度，拦截异常行为。',
  tools: ['web_search', 'palace_memo'],
});

// 2. 启动 Gateway 本地轻量控制服务 (6185 端口)
const gwServer = createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
    return json(200, {
      ok: true,
      service: 'feagle-wx-gateway',
      engine: 'DSH-ACP + Antigravity Dual Core',
      uptime_s: Math.round(process.uptime()),
      db: { sessions: 12, traces: 148 },
    });
  }

  // 工具列表
  if (req.method === 'GET' && req.url === '/api/tools') {
    const tools = getAllTools();
    return json(200, {
      ok: true,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        builtin: ['web_search', 'group_remind', 'palace_memo'].includes(t.name),
      })),
    });
  }

  // 动态注册自定义工具
  if (req.method === 'POST' && req.url === '/api/tools') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
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
        return json(400, { error: 'invalid_json' });
      }
    });
    return;
  }

  // 删除自定义工具
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

  // 社群沙箱列表
  if (req.method === 'GET' && req.url === '/api/channels') {
    return json(200, { ok: true, channels: listChannelSandboxes() });
  }

  // 新建社群沙箱
  if (req.method === 'POST' && req.url === '/api/channels') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        const chatId = String(body.chatId || '').trim();
        if (!chatId) return json(400, { error: 'chatId_required' });
        const sb = ensureChannelSandbox(chatId);
        if (body.personaText || body.rulesText || body.tools) {
          updateChannelSandbox(chatId, body);
        }
        return json(201, { ok: true, chatId, sandbox: sb });
      } catch {
        return json(400, { error: 'invalid_json' });
      }
    });
    return;
  }

  // 15分钟自然衰减会话状态与重置
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

  // 群聊背景感知环
  const bgMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)\/background$/);
  if (bgMatch && req.method === 'GET') {
    const chatId = decodeURIComponent(bgMatch[1]);
    return json(200, {
      ok: true,
      chatId,
      backgroundText: dialogManager.getGroupBackground(chatId, 20),
    });
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
      try {
        const body = JSON.parse(raw);
        const profile = updateMemberProfile(chatId, wxid, body);
        return json(200, { ok: true, chatId, wxid, profile });
      } catch {
        return json(400, { error: 'invalid_json' });
      }
    });
    return;
  }

  const channelMatch = (req.url || '').match(/^\/api\/channels\/([^/?]+)$/);
  if (channelMatch) {
    const chatId = decodeURIComponent(channelMatch[1]);
    if (req.method === 'GET') {
      const sb = ensureChannelSandbox(chatId);
      return json(200, {
        ok: true,
        sandbox: {
          chatId: sb.chatId,
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
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw);
          const updated = updateChannelSandbox(chatId, body);
          return json(200, { ok: true, chatId, sandbox: updated });
        } catch {
          return json(400, { error: 'invalid_json' });
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

await new Promise((resolve) => gwServer.listen(6185, '127.0.0.1', resolve));
process.env.GATEWAY_PORT = '6185';
console.log('📡 [Gateway Engine] 监听在 127.0.0.1:6185');

// 3. 初始化 Bridge RuntimeState
const state = new RuntimeState();
state.patch('wechat', {
  status: 'ONLINE',
  adminMode: 'RUNNING',
  botName: 'FEAGLE-Bot (Preview)',
  roundTripLatencyMs: 42,
  reconnectCount: 0,
});
state.patch('android', {
  deviceStatus: 'CONNECTED',
  deviceName: 'Samsung Galaxy Tab A8 (SM-X200)',
});
state.patch('pipeline', {
  observed: 1240,
  forwarded: 356,
  replied: 298,
  blocked: 42,
  policyViolated: 8,
  rateLimited: 5,
  circuitBroken: 0,
});

// 4. 启动 DashboardServer 在 6190 端口
const dashboard = new DashboardServer({
  state,
  host: '0.0.0.0',
  port: 6190,
  setWechatAdminMode: async (mode) => {
    state.patch('wechat', { adminMode: mode });
    return state.snapshot();
  },
  setSleepOverride: async (enabled) => {
    state.patch('schedule', { overrideActive: enabled });
    return state.snapshot();
  },
});

await dashboard.start();
console.log('🎉 ========================================================');
console.log('   FEAGLE 控制台已成功启动！请在浏览器打开以下地址访问：');
console.log('');
console.log('   👉 本地访问地址: http://localhost:6190/');
console.log('   👉 局域网地址:   http://127.0.0.1:6190/');
console.log('========================================================');

// 模拟实时日志推送
const sampleLogs = [
  '[Gateway] Pi-Hermes 思考引擎已就绪，沙箱环境加载完成',
  '[AndroidHook] SM-X200 硬件驱动通过零拷贝管道连接就绪 (ParcelFileDescriptor mode)',
  '[Sandbox] 社群 24892019283@chatroom 载入人设: # Nox 极客技术研讨群',
  '[Router] 收到来自微信社群的消息，漏斗拦截评估耗时 12ms',
  '[Tools] 预编译 Function Calling 模式: web_search, group_remind, palace_memo',
];
let logIndex = 0;
setInterval(() => {
  const line = `${new Date().toLocaleTimeString()} ${sampleLogs[logIndex % sampleLogs.length]}`;
  dashboard.broadcastLog?.(line);
  logIndex++;
}, 3000);

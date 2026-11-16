import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 轻量 .env 解析（避免 dotenv 依赖）
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const paths = [
    join(ROOT, '.env'),
    join(ROOT, '..', '..', '.env'),
  ];
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !line.trim().startsWith('#') && !out[m[1]]) out[m[1]] = m[2];
      }
    } catch { /* 容错 */ }
  }
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) } as Record<string, string>;
}

const env = loadEnv();
const get = (k: string, d = ''): string => env[k] || d;
const getNum = (k: string, d: number): number => Number(env[k]) || d;

// 兼容旧名：LLM_* 是当前配置名（与 .env.example 一致），ANTIGRAVITY_* 是当年指向本地反代时留下的旧名
const getFirst = (...keys: string[]): string => {
  for (const k of keys) if (env[k]) return env[k];
  return '';
};
const getFirstNum = (d: number, ...keys: string[]): number => {
  for (const k of keys) {
    const v = Number(env[k]);
    if (v) return v;
  }
  return d;
};

export const config = {
  // 网关本体
  gatewayPort: getNum('GATEWAY_PORT', 6185),
  bridgeOutUrl: get('BRIDGE_OUT_URL', 'http://127.0.0.1:6192/gw/outbound'),

  // 鉴权
  adminWxids: get('ADMIN_WXIDS', '').split(',').map((s) => s.trim()).filter(Boolean),
  groupChatEnabled: get('GROUP_CHAT_ENABLED', '1') === '1',

  // 出海代理（Pi 进程可选代理）
  proxyUrl: get('PROXY_URL', 'http://127.0.0.1:7890'),

  // L1 直答与路由用的 OpenAI 兼容端点（Mr. Day One API）。密钥只从环境变量读，不设任何内置默认值。
  llm: {
    baseUrl: getFirst('LLM_API_BASE', 'LLM_BASE_URL', 'ANTIGRAVITY_BASE_URL') || 'https://code.mrday.one/v1',
    apiKey: getFirst('LLM_API_KEY', 'LLM_KEY', 'ANTIGRAVITY_KEY'),
    // 日常问答的模型
    model: getFirst('LLM_MODEL', 'ANTIGRAVITY_MODEL') || 'deepseek-v4.1-flash',
    // 路由器跑在每条消息的关键路径上、有硬超时（见 routeTimeoutMs），慢模型会让每条消息都白等到超时
    routeModel: getFirst('LLM_ROUTE_MODEL', 'ANTIGRAVITY_ROUTE_MODEL', 'LLM_MODEL', 'ANTIGRAVITY_MODEL') || 'deepseek-v4.1-flash',
    // 出图单独一个模型：聊天模型不能出图
    imageModel: getFirst('LLM_IMAGE_MODEL') || 'gpt-image-2.6-sunburst',
    // 日常问答的温度：太高容易跑腿、太低像模板；0.6 兼顾自然与稳定
    temperature: getFirstNum(0.6, 'LLM_TEMPERATURE', 'ANTIGRAVITY_TEMPERATURE'),
    // 路由器超时：deepseek-flash 一般 4–5s，但偶有 10s+；给到 12s 避免误降级
    routeTimeoutMs: getFirstNum(12000, 'LLM_ROUTE_TIMEOUT_MS', 'ANTIGRAVITY_ROUTE_TIMEOUT_MS'),
    timeoutMs: getFirstNum(90000, 'LLM_TIMEOUT_MS', 'ANTIGRAVITY_TIMEOUT_MS'),
  },

  // Mnemosyne 记忆宫殿
  mnemosyne: {
    baseUrl: get('MNEMOSYNE_BASE_URL', 'http://127.0.0.1:18010'),
    userId: get('MN_USER_ID', 'eagle'),
    timeoutMs: getNum('MNEMOSYNE_TIMEOUT_MS', 5000),
    topK: getNum('MNEMOSYNE_TOP_K', 5),
  },

  // Pi RPC 子进程（全局单例 + 闲置即焚）
  pi: {
    bin: get('PI_BIN', 'pi'),
    idleTimeoutMs: getNum('PI_IDLE_TIMEOUT_MS', 3 * 60 * 1000), // 3 分钟
    defaultCwd: get('PI_CWD', '/opt/FEAGLEwxbot'),
    maxOldSpace: getNum('PI_MAX_OLD_SPACE', 256),               // V8 硬限 256MB
    promptTimeoutMs: getNum('PI_PROMPT_TIMEOUT_MS', 10 * 60 * 1000),
  },

  // 滑动窗口防抖（同 chat_id 连发消息合并）
  debounceMs: getNum('DEBOUNCE_MS', 2500),

  // 数据库与日志
  dbPath: get('DB_PATH', join(ROOT, 'data', 'gateway.db')),
  channelsDir: get('CHANNELS_DIR', join(ROOT, 'data', 'channels')),

  // 联网检索与事实核验 (多源编排)
  search: {
    tavilyApiKeys: get('TAVILY_API_KEYS', get('TAVILY_API_KEY', ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    priority: get('SEARCH_PROVIDER_PRIORITY', 'tavily,bing').split(',').map((s) => s.trim()).filter(Boolean),
    timeoutMs: getNum('SEARCH_TIMEOUT_MS', 8000),
    maxClaims: getNum('SEARCH_MAX_CLAIMS', 4),
  },

  // 微信出口批次默认参数
  out: {
    chunkSize: getNum('OUT_CHUNK_SIZE', 800),       // 单条消息最大字符
    minDelay: getNum('OUT_MIN_DELAY', 800),          // 批次最小间隔
    maxDelay: getNum('OUT_MAX_DELAY', 1500),
  },
};

export const isGroup = (chatId: string): boolean => chatId.endsWith('@chatroom');

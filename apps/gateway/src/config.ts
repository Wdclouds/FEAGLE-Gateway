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

export const config = {
  // 网关本体
  gatewayPort: getNum('GATEWAY_PORT', 6185),
  bridgeOutUrl: get('BRIDGE_OUT_URL', 'http://127.0.0.1:6192/gw/outbound'),

  // 鉴权
  adminWxids: get('ADMIN_WXIDS', '').split(',').map((s) => s.trim()).filter(Boolean),
  groupChatEnabled: get('GROUP_CHAT_ENABLED', '1') === '1',

  // 出海代理（Pi 进程可选代理）
  proxyUrl: get('PROXY_URL', 'http://127.0.0.1:7890'),

  // 统一大模型后端：Antigravity 反代（Gemini 3.8 Flash，支持原生视觉、单轮与多轮智能）
  antigravity: {
    baseUrl: get('ANTIGRAVITY_BASE_URL', 'http://127.0.0.1:8045/v1'),
    apiKey: get('ANTIGRAVITY_KEY', 'sk-853a7382bdef4d50acd0a01c62906b87'),
    model: get('ANTIGRAVITY_MODEL', 'gemini-3.8-flash'),
    timeoutMs: getNum('ANTIGRAVITY_TIMEOUT_MS', 15000),
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 轻量 .env 解析（避免 dotenv 依赖）
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
  } catch { /* .env 缺失时全靠进程环境变量 */ }
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) } as Record<string, string>;
}

const env = loadEnv();
const get = (k: string, d = ''): string => env[k] || d;
const getNum = (k: string, d: number): number => Number(env[k]) || d;

export const config = {
  // 网关本体
  gatewayPort: getNum('GATEWAY_PORT', 6185),
  bridgeOutUrl: get('BRIDGE_OUT_URL', 'http://127.0.0.1:6190/gw/outbound'),

  // 鉴权
  adminWxids: get('ADMIN_WXIDS', '').split(',').map((s) => s.trim()).filter(Boolean),
  groupChatEnabled: get('GROUP_CHAT_ENABLED', '1') === '1',

  // 出海代理（NIM 专用；DeepSeek/Antigravity/Mnemosyne 直连）
  proxyUrl: get('PROXY_URL', 'http://127.0.0.1:7890'),

  // 第 1 层：NIM 路由（当前 NIM 推理不稳定，自动降级 DeepSeek）
  nim: {
    apiKey: get('NVIDIA_NIM_KEY'),
    baseUrl: get('NIM_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    // 视觉描述专用：llama-3.2-90b-vision 已停服挂死，nemotron-3.5-super-vl 活跃且支持 vision
    model: get('NIM_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
    timeoutMs: getNum('NIM_TIMEOUT_MS', 30000),
    enabled: get('NIM_ENABLED', '1') === '1',
  },

  // DeepSeek：路由降级 + 异步史官
  deepseek: {
    apiKey: get('DEEPSEEK_KEY'),
    baseUrl: get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
    model: get('DEEPSEEK_MODEL', 'deepseek-chat'),
    timeoutMs: getNum('DEEPSEEK_TIMEOUT_MS', 30000),
  },

  // Antigravity（Pi 主力大脑 + L1 路由/直答/史官的免费主力，Gemini 经反代）
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

  // 微信出口批次默认参数
  out: {
    chunkSize: getNum('OUT_CHUNK_SIZE', 800),       // 单条消息最大字符
    minDelay: getNum('OUT_MIN_DELAY', 800),          // 批次最小间隔
    maxDelay: getNum('OUT_MAX_DELAY', 1500),
  },
};

export const isGroup = (chatId: string): boolean => chatId.endsWith('@chatroom');

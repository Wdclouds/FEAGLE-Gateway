/**
 * FEAGLE Hub · 原生终端系统日志引擎 (Terminal Log Engine)
 * 实时捕获并流式推送系统状态、网关拓扑变动、微信收发报文与安全审计事件。
 */

const MAX_LOGS = 500;
const logBuffer = [];
let nextLogId = 1;
let broadcaster = null;

export function setLogBroadcaster(fn) {
  broadcaster = fn;
}

function formatTimestamp(d = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}.${ms}`;
}

/**
 * 记录一条原生终端系统日志
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level 日志等级
 * @param {string} tag 业务模块标识 (e.g. SYSTEM, GATEWAY, RECV:GROUP, SEND:GROUP, POLICY, HERMES)
 * @param {string} message 日志主内容
 * @param {Record<string, any>} [meta] 附加元数据
 */
export function addSystemLog(level = 'INFO', tag = 'SYSTEM', message = '', meta = {}) {
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const id = nextLogId++;

  const entry = {
    id,
    timestamp,
    isoTime: now.toISOString(),
    level: level.toUpperCase(),
    tag: tag.toUpperCase(),
    message: String(message),
    meta,
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  // 终端控制台同时输出
  const colorMap = {
    INFO: '\x1b[32m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    DEBUG: '\x1b[36m',
  };
  const color = colorMap[entry.level] || '\x1b[37m';
  const reset = '\x1b[0m';
  console.log(`[${entry.timestamp}] ${color}[${entry.level.padEnd(5)}]${reset} [${entry.tag.padEnd(10)}] ${entry.message}`);

  if (typeof broadcaster === 'function') {
    try {
      broadcaster(entry);
    } catch {}
  }

  return entry;
}

export function getRecentSystemLogs(limit = 150) {
  const count = Math.min(limit, logBuffer.length);
  return logBuffer.slice(-count);
}

export function clearSystemLogs() {
  logBuffer.length = 0;
  return { success: true };
}

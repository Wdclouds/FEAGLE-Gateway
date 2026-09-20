import { RuntimeState } from './state.js';
import { DashboardServer } from './dashboard.js';
import { IdMap } from './id-map.js';
import { AndroidWechatClient } from './android-client.js';
import { OneBotClient } from './onebot-client.js';
import {
  PersistentControlState,
  WECHAT_ADMIN_MODES,
} from './control-state.js';
import { GROUP_CHAT_MODES } from './group-chat.js';
import { BridgeSettingsStore } from './bridge-settings.js';
import { resolveDataPath } from './paths.js';
import os from 'node:os';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function userIdSet(value) {
  const ids = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

const state = new RuntimeState();
const settingsStore = new BridgeSettingsStore({
  path: process.env.BRIDGE_SETTINGS_PATH || resolveDataPath('bridge-settings.json'),
});
let settings;
try {
  settings = settingsStore.load();
} catch (error) {
  state.addError('bridge-settings-load', error);
  settings = settingsStore.snapshot();
}
const controlStore = new PersistentControlState({
  path: process.env.BOT_CONTROL_STATE_PATH || resolveDataPath('control-state.json'),
});
let savedControl = {
  wechatAdminMode: WECHAT_ADMIN_MODES.RUNNING,
  groupChatMode: GROUP_CHAT_MODES.OFF,
  groupAllowlist: [],
  groupBlockedTerms: [],
  groupModes: {},
  selfAvatar: null,
  sleepOverride: false,
  changedAt: '',
};
try {
  savedControl = controlStore.load();
} catch (error) {
  state.addError('control-state-load', error);
}
state.patch('wechat', {
  adminMode: savedControl.wechatAdminMode,
  adminModeChangedAt: savedControl.changedAt,
});
state.patch('groupChat', {
  mode: savedControl.groupChatMode,
  allowlist: savedControl.groupAllowlist,
});
const messageGuard = null;

let onebot;
const transport = settings.transport;
state.patch('transport', {
  active: transport,
  requested: transport,
  switching: false,
  restartRequired: false,
  detail: transport === 'android'
    ? 'Android Hook transport'
    : 'Wechat4u Web transport',
});
if (transport !== 'android') {
  state.patch('android', { serverStatus: 'DISABLED' });
}

const idMap = new IdMap();
idMap.pruneMessageReceipts();
try {
  state.restoreGroups(idMap.listGroups());
} catch (error) {
  state.addError('idmap-list-groups', error);
}

const commonWechatOptions = {
  state,
  idMap,
  isSleeping: () => false,
  messageGuard: null,
  initialAdminMode: savedControl.wechatAdminMode,
  onPrivateText: async (message) => onebot.sendPrivateText(message),
  onGroupText: async (message) => onebot.sendGroupText(message),
  onPrivateImage: async (message) => onebot.sendPrivateImage(message),
  onGroupImage: async (message) => onebot.sendGroupImage(message),
  onNotice: async (event) => onebot.sendNotice(event),
  onSelfAvatar: async (message) => {
    try {
      controlStore.saveSelfAvatar(message);
    } catch (error) {
      state.addError('control-state-self-avatar', error);
    }
  },
  initialGroupChatMode: savedControl.groupChatMode,
  initialGroupAllowlist: savedControl.groupAllowlist,
  initialGroupBlockedTerms: savedControl.groupBlockedTerms,
  initialGroupModes: savedControl.groupModes,
  groupReplyCooldownMs: settings.groupReplyCooldownMs,
  groupReplyMaxChars: settings.groupReplyMaxChars,
  groupJitterMinMs: settings.groupJitterMinMs,
  groupJitterMaxMs: settings.groupJitterMaxMs,
  contactsSyncIntervalMs: positiveInteger(
    process.env.ANDROID_CONTACTS_SYNC_INTERVAL_MS,
    30 * 60_000,
  ),
  contactsSyncTimeoutMs: positiveInteger(
    process.env.ANDROID_CONTACTS_SYNC_TIMEOUT_MS,
    25_000,
  ),
};

const wechat = new AndroidWechatClient(commonWechatOptions);
const dashboard = new DashboardServer({
  state,
  host: '0.0.0.0',
  port: Number(process.env.BOT_DASHBOARD_PORT || 6190),
  createPairingCode: (ttlMs) => wechat?.pairingStore?.createCode(ttlMs) || null,
  setTestMode: (enabled) => state.patch('testMode', { enabled: Boolean(enabled) }),
  getBridgeSettings: () => settingsStore.snapshot(),
  saveBridgeSettings: (changes) => settingsStore.save(changes),
});



const bridgeSelfId = idMap.entity(
  'self',
  'feagle:bridge',
  'feagle:bridge',
  'FEAGLE WxBot',
);
onebot = new OneBotClient({
  state,
  idMap,
  wechat,
  selfId: bridgeSelfId,
  isSleeping: () => false,
  maxInFlight: settings.maxInFlight,
  maxInFlightPerUser: settings.maxInFlightPerUser,
});

// quiet-hours schedule decoupled

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

async function main() {
  await dashboard.start();
  // host mode：AstrBot 由外部管理（hermes-wxbridge.service 不监督 AstrBot），
  // 仅保留 supervisor 实例用于 /api/status 状态展示，不 bootstrap/spawn。
  await wechat.start();
  onebot.start();

  const lanIps = getLanIps();
  const dashPort = process.env.BOT_DASHBOARD_PORT || 6190;
  console.log(`[Dashboard] Web控制台已启动: http://127.0.0.1:${dashPort}`);
  if (lanIps.length) {
    console.log(`[Dashboard] 局域网访问地址: http://${lanIps[0]}:${dashPort}`);
    console.log(`[Android] 平板配对接入地址: ws://${lanIps[0]}:6191/android`);
  }
}

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  console.log(`[Runtime] received ${signal}, shutting down`);
  
  onebot.stop();
  wechat.shutdown();
  dashboard.stop();
  idMap.close();
  const exitTimer = setTimeout(() => process.exit(exitCode), 1_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  state.addError('uncaughtException', error);
  console.error(error);
});
process.on('unhandledRejection', (error) => {
  state.addError('unhandledRejection', error);
  console.error(error);
});

main().catch((error) => {
  state.addError('startup', error);
  console.error(error);
  setTimeout(() => process.exit(1), 1_000).unref();
});

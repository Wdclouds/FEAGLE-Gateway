import { RuntimeState } from './state.js';
import { DashboardServer } from './dashboard.js';
import { IdMap } from './id-map.js';
import { AndroidWechatClient } from './android-client.js';
import { OneBotClient } from './onebot-client.js';
import { GatewayClient } from './gateway-client.js';
import {
  PersistentControlState,
  WECHAT_ADMIN_MODES,
} from './control-state.js';
import { GROUP_CHAT_MODES } from './group-chat.js';
import { BridgeSettingsStore } from './bridge-settings.js';
import { OutboundImageStore } from './image-store.js';
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
let gateway;
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
  onPrivateText: async (message) => gateway.sendPrivateText(message),
  onGroupText: async (message) => gateway.sendGroupText(message),
  onPrivateImage: async (message) => gateway.sendPrivateImage(message),
  onGroupImage: async (message) => gateway.sendGroupImage(message),
  onNotice: async (event) => gateway.sendNotice(event),
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

const outboundImageStore = new OutboundImageStore();
const wechat = new AndroidWechatClient({
  ...commonWechatOptions,
  imageStore: outboundImageStore,
});
const dashboard = new DashboardServer({
  state,
  host: '0.0.0.0',
  port: Number(process.env.BOT_DASHBOARD_PORT || 6190),
  imageStore: outboundImageStore,
  createPairingCode: (ttlMs) => wechat?.pairingStore?.createCode(ttlMs) || null,
  setTestMode: (enabled) => state.patch('testMode', { enabled: Boolean(enabled) }),
  getBridgeSettings: () => settingsStore.snapshot(),
  saveBridgeSettings: (changes) => settingsStore.save(changes),
  setGroupChatMode: async (gid, mode) => {
    controlStore.saveGroupMode(gid, mode);
    state.setGroupMode(gid, mode);
    if (wechat?.groupModes) wechat.groupModes[gid] = mode;
    return state.snapshot();
  },
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

// pi-wx-gateway：极简扁平协议客户端（入站 POST 6185，出站监听 6192）
gateway = new GatewayClient({ state, idMap, wechat });

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
  gateway.start();
  // onebot 保持不启动（AstrBot 已退役；WebSocket 服务端不再监听）

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
  
  onebot?.stop();
  gateway?.stop();
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

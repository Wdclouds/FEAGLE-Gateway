import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { authorizeMutation, readBody, readJson, resolveSkillsChannel } from './dashboard/http-utils.js';
import { handleGatewayProxy } from './dashboard/gateway-proxy.js';
import { handleSystemRoutes } from './dashboard/routes-system.js';
import { handleDeviceRoutes } from './dashboard/routes-device.js';
import { handleConversationRoutes } from './dashboard/routes-conversations.js';
import { handleSseAndStatic } from './dashboard/static-and-sse.js';

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('./public/', import.meta.url));

export class DashboardServer {
  constructor({
    state,
    host = '0.0.0.0',
    port = 6190,
    setTestMode = () => state.snapshot(),
    sendNotificationTest = async () => state.snapshot(),
    forceWechatRelogin = async () => state.snapshot(),
    setWechatAdminMode = async () => state.snapshot(),
    setSleepOverride = async () => state.snapshot(),
    setGroupChatConfig = async () => state.snapshot(),
    setGroupChatMode = async () => state.snapshot(),
    refreshContacts = async () => ({}),
    idMap = null,
    listConversations = null,
    setConversationStatus = null,
    pruneConversations = null,
    getConversationMessages = null,
    mnemosyne = null,
    resolveChannelFolder = null,
    getConversationLogs = async () => [],
    getConversationMembers = async () => [],
    getConversationTools = async () => null,
    setConversationTools = async () => null,
    getToolCatalog = async () => [],
    listDocVault = () => [],
    readDocDir = () => null,
    getBridgeSettings = () => ({}),
    saveBridgeSettings = async () => ({}),
    switchTransport = async () => ({}),
    getProbeRouter = () => null,
    createPairingCode = null,
    imageStore = null,
    publicRoot = DEFAULT_PUBLIC_ROOT,
  }) {
    this.state = state;
    this.host = host;
    this.port = port;
    this.createPairingCode = createPairingCode;
    this.imageStore = imageStore;
    this.setTestMode = setTestMode;
    this.sendNotificationTest = sendNotificationTest;
    this.forceWechatRelogin = forceWechatRelogin;
    this.setWechatAdminMode = setWechatAdminMode;
    this.setSleepOverride = setSleepOverride;
    this.setGroupChatConfig = setGroupChatConfig;
    this.setGroupChatMode = setGroupChatMode;
    this.refreshContacts = refreshContacts;
    this.idMap = idMap;
    this.listConversations = listConversations || ((opts) => idMap?.listConversations(opts) || { conversations: [], counts: {} });
    this.setConversationStatus = setConversationStatus || ((talker, status, opts) => idMap?.setConversationStatus(talker, status, opts));
    this.pruneConversations = pruneConversations || (() => idMap?.pruneStaleEntities() || {});
    this.getConversationMessages = getConversationMessages || ((kind, opts) => idMap?.getConversationMessages(kind, opts) || []);
    this.mnemosyne = mnemosyne;
    this.resolveChannelFolder = resolveChannelFolder;
    this.getProbeRouter = getProbeRouter;
    this.getConversationLogs = getConversationLogs;
    this.getConversationMembers = getConversationMembers;
    this.getConversationTools = getConversationTools;
    this.setConversationTools = setConversationTools;
    this.getToolCatalog = getToolCatalog;
    this.listDocVault = listDocVault;
    this.readDocDir = readDocDir;
    this.getBridgeSettings = getBridgeSettings;
    this.saveBridgeSettings = saveBridgeSettings;
    this.switchTransport = switchTransport;
    this.clients = new Set();
    this.publicRoot = publicRoot;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.onSnapshotListener = (snapshot) => this.push(snapshot);
    this.state.on('snapshot', this.onSnapshotListener);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        console.log(`[Dashboard] listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-FEAGLE-Dashboard, Origin, Accept');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (handleGatewayProxy(request, response, url)) return;
    if (await handleSystemRoutes(this, request, response, url)) return;
    if (await handleDeviceRoutes(this, request, response, url)) return;
    if (await handleConversationRoutes(this, request, response, url)) return;
    handleSseAndStatic(this, request, response, url);
  }

  push(snapshot) {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  resolveSkillsChannel(key, response) {
    return resolveSkillsChannel(this, key, response);
  }

  authorizeMutation(request, response) {
    return authorizeMutation(request, response);
  }

  readBody(request, maxBytes = 16_384) {
    return readBody(request, maxBytes);
  }

  readJson(request, response, maxBytes, callback) {
    return readJson(request, response, maxBytes, callback);
  }

  stop() {
    if (this.onSnapshotListener) {
      this.state.off('snapshot', this.onSnapshotListener);
      this.onSnapshotListener = null;
    }
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server.close();
  }
}

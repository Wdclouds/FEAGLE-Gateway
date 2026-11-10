import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const GATEWAY_INBOUND_URL = process.env.GATEWAY_INBOUND_URL || 'http://127.0.0.1:6185/inbound';
const OUTBOUND_PORT = Number(process.env.GATEWAY_OUTBOUND_PORT || 6192);
const OUTBOUND_PATH = '/gw/outbound';
const IMG_DIR = process.env.WX_IMG_DIR || '/tmp/wx-gateway-img';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function saveImageBase64(imageBase64, id) {
  try {
    if (!existsSync(IMG_DIR)) await mkdir(IMG_DIR, { recursive: true });
    const file = path.join(IMG_DIR, `img-${id}.jpg`);
    await writeFile(file, Buffer.from(imageBase64, 'base64'));
    return file;
  } catch (error) {
    console.error(`[Gateway] 图片暂存失败: ${error.message}`);
    return undefined;
  }
}

/**
 * 极简网关客户端：入站把微信消息 POST 成 WxInboundPkt；出站在 6192 监听
 * WxOutboundBatch 并按 seq[].d 延迟依次发送（拟人防风控）。
 * 接口与 OneBotClient 对齐（sendPrivateText 等），index.js 可无缝替换。
 */
export class GatewayClient {
  constructor({ state, idMap, wechat }) {
    this.state = state;
    this.idMap = idMap;
    this.wechat = wechat;
    this.outboundServer = null;
    this.sending = new Map(); // chat_id -> Promise（串行化发送，防批次乱序）
  }

  start() {
    this.outboundServer = http.createServer((req, res) => this.handleOutbound(req, res));
    this.outboundServer.listen(OUTBOUND_PORT, '127.0.0.1', () => {
      console.log(`[Gateway] 出站监听: http://127.0.0.1:${OUTBOUND_PORT}${OUTBOUND_PATH}`);
    });
  }

  stop() {
    this.outboundServer?.close();
  }

  async handleOutbound(req, res) {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true });

    if (req.method !== 'POST' || req.url !== OUTBOUND_PATH) return json(404, { error: 'not_found' });

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let batch;
      try { batch = JSON.parse(raw); } catch { return json(400, { error: 'parse_error' }); }
      if (!batch?.c || !Array.isArray(batch.seq) || batch.seq.length === 0) {
        return json(400, { error: 'bad_batch' });
      }
      // 同 chat 串行发送（后到的批次排在队尾，保证顺序）
      const prev = this.sending.get(batch.c) || Promise.resolve();
      const task = prev.then(() => this.executeBatch(batch)).catch((e) => {
        console.error(`[Gateway] 批次发送失败: ${e.message}`);
      });
      this.sending.set(batch.c, task);
      json(202, { ok: true, queued: batch.seq.length });
    });
  }

  async executeBatch(batch) {
    for (const item of batch.seq) {
      if (item.d > 0) await sleep(item.d);
      try {
        if (item.t) {
          if (String(batch.c).endsWith('@chatroom')) {
            const groupId = this.forwardEntity(batch.c, 'group');
            await this.wechat.sendGroupText(groupId, item.t);
          } else {
            const userId = this.forwardEntity(batch.c, 'user');
            await this.wechat.sendText(userId, item.t);
          }
          this.state.increment('replied');
        } else if (item.img) {
          // 每个条目可单独指定 isRaw；缺省按原图发送
          const isRaw = item.isRaw !== false;
          if (String(batch.c).endsWith('@chatroom')) {
            const groupId = this.forwardEntity(batch.c, 'group');
            await this.wechat.sendGroupImage(groupId, item.img, isRaw);
          } else {
            const userId = this.forwardEntity(batch.c, 'user');
            await this.wechat.sendImage(userId, item.img, isRaw);
          }
          this.state.increment('replied');
        }
      } catch (error) {
        console.error(`[Gateway] 单条发送失败(${batch.c}): ${error.message}`);
      }
    }
  }

  async postInbound(pkt) {
    const body = JSON.stringify(pkt);
    const res = await fetch(GATEWAY_INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`网关入站 HTTP ${res.status}`);
    this.state.increment('forwarded');
  }

  /** 实体数字 ID → 原始 wxid/chatroom（网关协议要求原始 ID：@chatroom 结尾判群聊、wxid 判鉴权） */
  reverseEntity(entityId) {
    const target = String(entityId ?? '').trim();
    if (!/^\d+$/.test(target)) return { id: target, nickname: undefined }; // 已是原始 ID 直接透传
    try {
      const row = this.idMap.db
        .prepare('SELECT protocol_id, nickname FROM entities WHERE onebot_id = ?')
        .get(Number(target));
      if (row?.protocol_id) return { id: String(row.protocol_id), nickname: row.nickname || undefined };
    } catch (error) {
      console.error(`[Gateway] 反查实体失败: ${error.message}`);
    }
    return { id: target, nickname: undefined };
  }

  /** 原始 wxid/chatroom → 实体数字 ID（wechat.sendText 按 kind='user' 反查协议 ID） */
  forwardEntity(rawId, kindHint) {
    const target = String(rawId ?? '').trim();
    if (/^\d+$/.test(target) && !target.endsWith('@chatroom')) {
      // 兼容旧批次：纯数字视为实体 ID 透传
      return Number(target);
    }
    const kind = kindHint || (target.endsWith('@chatroom') ? 'group' : 'user');
    return this.idMap.entity(kind, target, target, '');
  }

  // ---- 与 OneBotClient 对齐的入站接口 ----

  async sendPrivateText({ userId, nickname, text, wechatMessageId }) {
    const user = this.reverseEntity(userId);
    await this.postInbound({
      id: String(wechatMessageId),
      c: user.id,
      u: user.id,
      n: nickname || user.nickname || user.id,
      at: 0,
      t: text || '',
      ts: Date.now(),
    });
    return String(wechatMessageId);
  }

  async sendGroupText({
    groupId, userId, nickname, text, wechatMessageId, imageBase64, quoteText,
  }) {
    // 走到这里的群消息必然 @ 过机器人（android-client 已过滤），at=1
    const group = this.reverseEntity(groupId);
    const user = this.reverseEntity(userId);
    let img;
    if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
      img = await saveImageBase64(imageBase64, wechatMessageId);
    }
    await this.postInbound({
      id: String(wechatMessageId),
      c: group.id,
      u: user.id,
      n: nickname || user.nickname || user.id,
      at: 1,
      t: text || '',
      img,
      q: quoteText || undefined,
      ts: Date.now(),
    });
    return String(wechatMessageId);
  }

  async sendPrivateImage({ userId, nickname, imageBase64, wechatMessageId }) {
    const user = this.reverseEntity(userId);
    const img = await saveImageBase64(imageBase64, wechatMessageId);
    await this.postInbound({
      id: String(wechatMessageId),
      c: user.id,
      u: user.id,
      n: nickname || user.nickname || user.id,
      at: 0,
      t: '',
      img,
      ts: Date.now(),
    });
    return String(wechatMessageId);
  }

  async sendGroupImage({ groupId, userId, nickname, imageBase64, wechatMessageId }) {
    const group = this.reverseEntity(groupId);
    const user = this.reverseEntity(userId);
    const img = await saveImageBase64(imageBase64, wechatMessageId);
    await this.postInbound({
      id: String(wechatMessageId),
      c: group.id,
      u: user.id,
      n: nickname || user.nickname || user.id,
      at: 1,
      t: '',
      img,
      ts: Date.now(),
    });
    return String(wechatMessageId);
  }

  async sendNotice(event) {
    // 通知类事件当前无需进网关（登录/掉线等由 dashboard 自行展示）
    console.log(`[Gateway] notice 忽略: ${JSON.stringify(event).slice(0, 120)}`);
  }
}

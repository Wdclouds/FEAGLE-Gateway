import { config } from '../config.js';
import { getSessionKey, type WxInboundPkt } from '../protocol.js';

interface WindowBuf {
  pkts: WxInboundPkt[];
  timer: NodeJS.Timeout;
  firstAt: number;
}

const buffers = new Map<string, WindowBuf>();
const MAX_WINDOW_MS = 30_000;

export function pushToWindow(pkt: WxInboundPkt, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const sk = getSessionKey(pkt);
  let buf = buffers.get(sk);
  if (!buf) {
    buf = { pkts: [], timer: null as unknown as NodeJS.Timeout, firstAt: Date.now() };
    buffers.set(sk, buf);
  }
  buf.pkts.push(pkt);
  if (buf.pkts.length >= 10) {
    flushWindow(sk, onFlush);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushWindow(sk, onFlush), config.debounceMs);
  buf.timer.unref?.();
}

export function extendWindow(sessionKey: string, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const buf = buffers.get(sessionKey);
  if (!buf) return;
  if (Date.now() - buf.firstAt >= MAX_WINDOW_MS) {
    flushWindow(sessionKey, onFlush);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushWindow(sessionKey, onFlush), config.debounceMs);
  buf.timer.unref?.();
}

export function flushWindow(sessionKey: string, onFlush: (pkts: WxInboundPkt[]) => void): void {
  const buf = buffers.get(sessionKey);
  if (!buf || buf.pkts.length === 0) {
    buffers.delete(sessionKey);
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buffers.delete(sessionKey);
  onFlush(buf.pkts);
}

export function getWindowPackets(sessionKey: string): WxInboundPkt[] {
  return buffers.get(sessionKey)?.pkts || [];
}

export function listBufferKeys(): string[] {
  return Array.from(buffers.keys());
}

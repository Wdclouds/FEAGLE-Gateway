import { config } from '../config.js';
import type { WxOutboundBatch } from '../protocol.js';
import { quickBatch } from '../sanitizer.js';

export async function sendToBridge(batch: WxOutboundBatch): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(config.bridgeOutUrl, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyOp(text: string): Promise<void> {
  for (const adminWxid of config.adminWxids) {
    await sendToBridge(quickBatch(adminWxid, text));
  }
}

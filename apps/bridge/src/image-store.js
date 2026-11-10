import { randomUUID } from 'node:crypto';

export class OutboundImageStore {
  constructor({ ttlMs = 5 * 60_000, pruneIntervalMs = 60_000 } = {}) {
    this.ttlMs = ttlMs;
    this.tickets = new Map();
    this.timer = setInterval(() => this.prune(), pruneIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  set(buffer, contentType = 'image/jpeg') {
    const ticketId = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;
    this.tickets.set(ticketId, { buffer, contentType, expiresAt });
    return ticketId;
  }

  get(ticketId) {
    const item = this.tickets.get(ticketId);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.tickets.delete(ticketId);
      return null;
    }
    return item;
  }

  delete(ticketId) {
    this.tickets.delete(ticketId);
  }

  prune() {
    const now = Date.now();
    for (const [id, item] of this.tickets.entries()) {
      if (now > item.expiresAt) {
        this.tickets.delete(id);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    this.tickets.clear();
  }
}

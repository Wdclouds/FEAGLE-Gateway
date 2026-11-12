export type SseCallback<T> = (data: T) => void;

export class SseStream<T = any> {
  private url: string;
  private es: EventSource | null = null;
  private listeners: Set<SseCallback<T>> = new Set();
  private reconnectTimer: any = null;
  private isDestroyed = false;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    if (this.isDestroyed) return;
    try {
      this.es = new EventSource(this.url);
      this.es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          for (const cb of this.listeners) cb(parsed);
        } catch {
          // If not JSON, pass as string
          for (const cb of this.listeners) cb(event.data as any);
        }
      };
      this.es.onerror = () => {
        if (this.es) {
          this.es.close();
          this.es = null;
        }
        if (!this.isDestroyed && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 3000);
        }
      };
    } catch {
      // Reconnect after delay
      if (!this.isDestroyed && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 5000);
      }
    }
  }

  subscribe(callback: SseCallback<T>): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.listeners.clear();
  }
}

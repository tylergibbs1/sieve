/**
 * CDP WebSocket session.
 *
 * Manages a single WebSocket connection to a Chrome DevTools Protocol endpoint.
 * Provides typed send/receive with auto-incrementing IDs and event subscription.
 */

import type { CdpRequest, CdpResponse, CdpEvent, CdpMessage } from "./protocol.ts";
import { isEvent } from "./protocol.ts";

type EventListener = (params: Record<string, unknown>) => void;

export class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  private listeners = new Map<string, Set<EventListener>>();
  private _closed = false;
  private readyPromise: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`CDP WebSocket error: ${e}`));
    });

    this.ws.onmessage = (event) => {
      const msg: CdpMessage = JSON.parse(String(event.data));
      if (isEvent(msg)) {
        this.dispatchEvent(msg);
      } else {
        this.handleResponse(msg);
      }
    };

    this.ws.onclose = () => {
      this._closed = true;
      // Reject all pending requests
      for (const [id, { reject }] of this.pending) {
        reject(new Error("CDP connection closed"));
        this.pending.delete(id);
      }
    };
  }

  /** Wait for the WebSocket connection to be established. */
  async ready(): Promise<void> {
    await this.readyPromise;
  }

  /** Send a CDP command and wait for its response. */
  async send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this._closed) throw new Error("CDP session is closed");

    const id = this.nextId++;
    const request: CdpRequest = { id, method };
    if (params) request.params = params;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));
    });
  }

  /** Subscribe to a CDP event. Returns an unsubscribe function. */
  on(method: string, listener: EventListener): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** Wait for a specific event to fire, with optional timeout. */
  waitForEvent(method: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for CDP event: ${method}`));
      }, timeoutMs);

      const unsub = this.on(method, (params) => {
        clearTimeout(timer);
        unsub();
        resolve(params);
      });
    });
  }

  /** Close the WebSocket connection. */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      this.ws.close();
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  private handleResponse(msg: CdpResponse): void {
    const handler = this.pending.get(msg.id);
    if (!handler) return;
    this.pending.delete(msg.id);

    if (msg.error) {
      handler.reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
    } else {
      handler.resolve(msg.result ?? {});
    }
  }

  private dispatchEvent(msg: CdpEvent): void {
    const set = this.listeners.get(msg.method);
    if (!set) return;
    for (const listener of set) {
      listener(msg.params);
    }
  }
}

/**
 * Connect to a CDP endpoint and return a ready session.
 */
export async function connect(wsUrl: string): Promise<CdpSession> {
  const session = new CdpSession(wsUrl);
  await session.ready();
  return session;
}

/**
 * Resource limits and event hooks.
 *
 * Prevents runaway memory/time usage in production deployments.
 * Provides hooks for observability and telemetry.
 */

export interface ResourceLimits {
  /** Maximum number of DOM nodes per page. Default: 100,000. */
  maxNodes?: number;
  /** Maximum HTML size to parse in bytes. Default: 10MB. */
  maxHTMLSize?: number;
  /** Maximum number of concurrent pages per browser. Default: 10,000. */
  maxPages?: number;
  /** Maximum navigation depth (goto calls) per page. Default: 100. */
  maxNavigations?: number;
  /** Maximum number of cookies per domain. Default: 50. */
  maxCookiesPerDomain?: number;
}

export const DEFAULT_LIMITS: Required<ResourceLimits> = {
  maxNodes: 100_000,
  maxHTMLSize: 10 * 1024 * 1024, // 10MB
  maxPages: 10_000,
  maxNavigations: 100,
  maxCookiesPerDomain: 50,
};

export function resolveLimits(limits?: ResourceLimits): Required<ResourceLimits> {
  return { ...DEFAULT_LIMITS, ...limits };
}

// --- Event hooks ---

export type EventType =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "snapshot"
  | "challenge_solved"
  | "page_created"
  | "page_closed"
  | "error";

export interface SieveEvent {
  type: EventType;
  timestamp: number;
  url?: string;
  detail?: string;
  durationMs?: number;
}

export type EventHandler = (event: SieveEvent) => void;

export class EventEmitter {
  private handlers = new Map<EventType | "*", EventHandler[]>();

  on(type: EventType | "*", handler: EventHandler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);

    // Return unsubscribe function
    return () => {
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  emit(event: SieveEvent): void {
    const specific = this.handlers.get(event.type) ?? [];
    const wildcard = this.handlers.get("*") ?? [];
    for (const handler of [...specific, ...wildcard]) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break the engine
      }
    }
  }
}

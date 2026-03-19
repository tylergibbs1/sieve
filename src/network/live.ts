/**
 * Live HTTP fetcher using Bun's native fetch.
 */

import type { Fetcher, FetchResponse, FetchOptions } from "./fetcher.ts";

export interface LiveFetcherOptions {
  /** Allowed domains (supports wildcards like "*.example.com"). */
  allowedDomains?: string[];
  /** Default headers to include with every request. */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in ms. */
  timeout?: number;
}

export class LiveFetcher implements Fetcher {
  private allowedDomains: string[];
  private defaultHeaders: Record<string, string>;
  private timeout: number;

  constructor(options: LiveFetcherOptions = {}) {
    this.allowedDomains = options.allowedDomains ?? [];
    this.defaultHeaders = options.defaultHeaders ?? {
      "User-Agent": "sieve/0.1.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    this.timeout = options.timeout ?? 30_000;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
    this.checkDomain(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await globalThis.fetch(url, {
        method: options.method ?? "GET",
        headers: { ...this.defaultHeaders, ...options.headers },
        body: options.body,
        redirect: options.redirect ?? "follow",
        signal: controller.signal,
      });

      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headers[k] = v;
      });

      return {
        url: resp.url,
        status: resp.status,
        headers,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private checkDomain(url: string): void {
    if (this.allowedDomains.length === 0) return;

    const hostname = new URL(url).hostname;
    const allowed = this.allowedDomains.some((pattern) => {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
      }
      return hostname === pattern;
    });

    if (!allowed) {
      throw new Error(`Domain not allowed: ${hostname}`);
    }
  }
}

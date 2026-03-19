/**
 * Live HTTP fetcher using Bun's native fetch.
 */

import type { Fetcher, FetchResponse, FetchOptions } from "./fetcher.ts";
import {
  CHROME_MAC,
  buildNavigationHeaders,
  PROFILES,
  type BrowserProfile,
  type ProfileName,
} from "./profiles.ts";

export interface LiveFetcherOptions {
  /** Allowed domains (supports wildcards like "*.example.com"). */
  allowedDomains?: string[];
  /** Default headers to include with every request. Overridden by profile if set. */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in ms. */
  timeout?: number;
  /**
   * Browser profile to emulate. Sets realistic headers for the chosen browser.
   * Pass a profile name ("chrome-mac", "chrome-windows", "firefox-mac", "safari-mac")
   * or a custom BrowserProfile object. Default: none (uses defaultHeaders).
   */
  profile?: ProfileName | BrowserProfile;
}

export class LiveFetcher implements Fetcher {
  private allowedDomains: string[];
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private profile: BrowserProfile | null;

  constructor(options: LiveFetcherOptions = {}) {
    this.allowedDomains = options.allowedDomains ?? [];
    this.timeout = options.timeout ?? 30_000;

    // Resolve profile
    if (options.profile) {
      this.profile = typeof options.profile === "string"
        ? PROFILES[options.profile]
        : options.profile;
      // Profile provides its own headers
      this.defaultHeaders = options.defaultHeaders ?? {};
    } else {
      this.profile = null;
      this.defaultHeaders = options.defaultHeaders ?? {
        "User-Agent": "sieve/0.1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };
    }
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
    this.checkDomain(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    // Build headers: profile navigation headers > caller headers > default headers
    let headers: Record<string, string>;
    if (this.profile) {
      const referer = options.headers?.["Referer"] ?? null;
      headers = {
        ...buildNavigationHeaders(this.profile, referer, url),
        ...this.defaultHeaders,
        ...options.headers,
      };
    } else {
      headers = { ...this.defaultHeaders, ...options.headers };
    }

    try {
      const resp = await globalThis.fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        redirect: options.redirect ?? "follow",
        signal: controller.signal,
      });

      const body = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });

      return {
        url: resp.url,
        status: resp.status,
        headers: respHeaders,
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

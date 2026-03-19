/**
 * Mock and replay network fetchers.
 */

import type { Fetcher, FetchResponse, FetchOptions } from "./fetcher.ts";

export type MockResponse = string | { json: unknown } | FetchResponse;

export interface MockFetcherOptions {
  routes: Record<string, MockResponse>;
  /** Status code for unmatched routes. */
  fallbackStatus?: number;
}

export class MockFetcher implements Fetcher {
  private routes: Map<string, MockResponse>;
  private fallbackStatus: number;

  constructor(options: MockFetcherOptions) {
    this.routes = new Map(Object.entries(options.routes));
    this.fallbackStatus = options.fallbackStatus ?? 404;
  }

  async fetch(url: string, _options?: FetchOptions): Promise<FetchResponse> {
    const mock = this.routes.get(url);
    if (!mock) {
      return {
        url,
        status: this.fallbackStatus,
        headers: {},
        body: "Not Found",
      };
    }

    if (typeof mock === "string") {
      return {
        url,
        status: 200,
        headers: { "content-type": "text/html" },
        body: mock,
      };
    }

    if ("json" in mock) {
      return {
        url,
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mock.json),
      };
    }

    return mock;
  }

  /** Add or replace a mock route. */
  addRoute(url: string, response: MockResponse): void {
    this.routes.set(url, response);
  }
}

/** Replay fetcher: records responses then replays them deterministically. */
export class ReplayFetcher implements Fetcher {
  private recordings: Map<string, FetchResponse>;

  constructor(recordings: Record<string, FetchResponse> = {}) {
    this.recordings = new Map(Object.entries(recordings));
  }

  async fetch(url: string, _options?: FetchOptions): Promise<FetchResponse> {
    const recorded = this.recordings.get(url);
    if (!recorded) {
      throw new Error(`No recording found for URL: ${url}`);
    }
    return { ...recorded };
  }

  /** Record a response for replay. */
  record(url: string, response: FetchResponse): void {
    this.recordings.set(url, response);
  }

  /** Export all recordings for persistence. */
  toJSON(): Record<string, FetchResponse> {
    return Object.fromEntries(this.recordings);
  }

  /** Load from persisted recordings. */
  static fromJSON(data: Record<string, FetchResponse>): ReplayFetcher {
    return new ReplayFetcher(data);
  }
}

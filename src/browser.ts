/**
 * SieveBrowser: manages multiple pages and shared configuration.
 */

import { SievePage } from "./page.ts";
import { LiveFetcher, type LiveFetcherOptions } from "./network/live.ts";
import { MockFetcher, type MockResponse } from "./network/mock.ts";
import { ReplayFetcher } from "./network/mock.ts";
import { DiskReplayFetcher, RecordingFetcher } from "./network/replay.ts";
import type { Fetcher, FetchResponse } from "./network/fetcher.ts";
import { SievePersistence, type PersistenceOptions } from "./persistence/sqlite.ts";

export type NetworkConfig =
  | "live"
  | { live: LiveFetcherOptions }
  | { mock: Record<string, MockResponse> }
  | { replay: Record<string, FetchResponse> }
  | { replayDir: string }
  | { record: { fetcher?: Fetcher; directory: string } }
  | { custom: Fetcher };

export interface BrowserOptions {
  network?: NetworkConfig;
  allowedDomains?: string[];
  /** SQLite persistence for cookies, storage, and snapshots. */
  persistence?: PersistenceOptions | true;
}

export class SieveBrowser {
  private fetcher: Fetcher | null;
  private pages: SievePage[] = [];
  private _persistence: SievePersistence | null = null;

  constructor(options: BrowserOptions = {}) {
    this.fetcher = this.buildFetcher(options);

    if (options.persistence) {
      const persistOpts = options.persistence === true ? {} : options.persistence;
      this._persistence = new SievePersistence(persistOpts);
    }
  }

  private buildFetcher(options: BrowserOptions): Fetcher | null {
    const network = options.network;
    if (!network) return null;

    if (network === "live") {
      return new LiveFetcher({
        allowedDomains: options.allowedDomains,
      });
    }

    if ("live" in network) {
      return new LiveFetcher({
        ...network.live,
        allowedDomains: options.allowedDomains ?? network.live.allowedDomains,
      });
    }

    if ("mock" in network) {
      return new MockFetcher({ routes: network.mock });
    }

    if ("replay" in network) {
      return ReplayFetcher.fromJSON(network.replay);
    }

    if ("replayDir" in network) {
      return new DiskReplayFetcher(network.replayDir);
    }

    if ("record" in network) {
      const liveFetcher = network.record.fetcher ?? new LiveFetcher({
        allowedDomains: options.allowedDomains,
      });
      return new RecordingFetcher(liveFetcher, network.record.directory);
    }

    if ("custom" in network) {
      return network.custom;
    }

    return null;
  }

  /** Create a new page. */
  async newPage(): Promise<SievePage> {
    const page = new SievePage(this.fetcher);
    this.pages.push(page);
    return page;
  }

  /** Get all open pages. */
  get openPages(): readonly SievePage[] {
    return this.pages.filter((p) => !p.isClosed);
  }

  /** SQLite persistence layer (null if not configured). */
  get persistence(): SievePersistence | null {
    return this._persistence;
  }

  /** Close all pages and the browser. */
  close(): void {
    for (const page of this.pages) {
      if (!page.isClosed) page.close();
    }
    this._persistence?.close();
  }
}

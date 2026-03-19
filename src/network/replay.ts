/**
 * Disk-backed replay fetcher using Bun.file / Bun.write.
 * Records live HTTP responses to disk, replays them deterministically.
 * Each URL maps to a pair of files: response body + metadata JSON.
 */

import type { Fetcher, FetchResponse, FetchOptions } from "./fetcher.ts";

interface RecordingMeta {
  url: string;
  status: number;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Sanitize a URL into a safe filename.
 * Uses CRC32 hash to avoid filesystem path issues.
 */
function urlToFilename(url: string): string {
  const hash = Bun.hash.crc32(url).toString(16).padStart(8, "0");
  // Keep a readable prefix from the hostname + path
  try {
    const parsed = new URL(url);
    const readable = `${parsed.hostname}${parsed.pathname}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 60);
    return `${readable}_${hash}`;
  } catch {
    return hash;
  }
}

export class DiskReplayFetcher implements Fetcher {
  private dir: string;

  constructor(directory: string) {
    this.dir = directory;
  }

  async fetch(url: string, _options?: FetchOptions): Promise<FetchResponse> {
    const base = urlToFilename(url);
    const metaFile = Bun.file(`${this.dir}/${base}.meta.json`);
    const bodyFile = Bun.file(`${this.dir}/${base}.body`);

    if (!(await metaFile.exists())) {
      throw new Error(`No recording found for URL: ${url}\n  Expected: ${this.dir}/${base}.meta.json`);
    }

    const meta = await metaFile.json() as RecordingMeta;
    const body = await bodyFile.text();

    return {
      url: meta.url,
      status: meta.status,
      headers: meta.headers,
      body,
    };
  }

  /** Record a response to disk. */
  async record(url: string, response: FetchResponse): Promise<void> {
    const base = urlToFilename(url);

    const meta: RecordingMeta = {
      url: response.url,
      status: response.status,
      headers: response.headers,
      timestamp: Date.now(),
    };

    await Promise.all([
      Bun.write(`${this.dir}/${base}.meta.json`, JSON.stringify(meta, null, 2)),
      Bun.write(`${this.dir}/${base}.body`, response.body),
    ]);
  }

  /** List all recorded URLs in this directory. */
  async listRecordings(): Promise<string[]> {
    const glob = new Bun.Glob("*.meta.json");
    const urls: string[] = [];

    for await (const path of glob.scan({ cwd: this.dir })) {
      const file = Bun.file(`${this.dir}/${path}`);
      const meta = await file.json() as RecordingMeta;
      urls.push(meta.url);
    }

    return urls;
  }
}

/**
 * A recording fetcher that wraps a live fetcher.
 * Passes requests through to the live fetcher, records responses to disk,
 * and can switch to replay mode.
 */
export class RecordingFetcher implements Fetcher {
  private replay: DiskReplayFetcher;

  constructor(
    private liveFetcher: Fetcher,
    private directory: string,
  ) {
    this.replay = new DiskReplayFetcher(directory);
  }

  async fetch(url: string, options?: FetchOptions): Promise<FetchResponse> {
    const response = await this.liveFetcher.fetch(url, options);
    await this.replay.record(url, response);
    return response;
  }

  /** Get a replay-only fetcher for the recorded responses. */
  toReplay(): DiskReplayFetcher {
    return this.replay;
  }
}

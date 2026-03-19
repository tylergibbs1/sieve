/**
 * Network layer: pluggable HTTP fetching.
 */

export interface FetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: "follow" | "manual";
}

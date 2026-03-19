/**
 * URL resolution and navigation history.
 */

export interface HistoryEntry {
  url: string;
  title: string;
  timestamp: number;
}

export class NavigationHistory {
  private entries: HistoryEntry[] = [];
  private currentIndex = -1;

  get current(): HistoryEntry | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.entries.length) return null;
    return this.entries[this.currentIndex] ?? null;
  }

  get url(): string {
    return this.current?.url ?? "about:blank";
  }

  get length(): number {
    return this.entries.length;
  }

  push(url: string, title: string = ""): void {
    // Discard forward history
    this.entries = this.entries.slice(0, this.currentIndex + 1);
    this.entries.push({ url, title, timestamp: Date.now() });
    this.currentIndex = this.entries.length - 1;
  }

  replace(url: string, title: string = ""): void {
    if (this.currentIndex >= 0) {
      this.entries[this.currentIndex] = { url, title, timestamp: Date.now() };
    } else {
      this.push(url, title);
    }
  }

  back(): HistoryEntry | null {
    if (this.currentIndex <= 0) return null;
    this.currentIndex--;
    return this.current;
  }

  forward(): HistoryEntry | null {
    if (this.currentIndex >= this.entries.length - 1) return null;
    this.currentIndex++;
    return this.current;
  }

  canGoBack(): boolean {
    return this.currentIndex > 0;
  }

  canGoForward(): boolean {
    return this.currentIndex < this.entries.length - 1;
  }

  /** All entries for inspection. */
  all(): readonly HistoryEntry[] {
    return this.entries;
  }
}

/** Resolve a URL relative to a base URL. */
export function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith("http://") || relative.startsWith("https://")) {
    return relative;
  }
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

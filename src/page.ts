/**
 * SievePage: the core page abstraction.
 * A page is a DOM + form state + navigation history + cookies.
 */

import { SieveDocument } from "./dom/document.ts";
import { SieveElement } from "./dom/element.ts";
import { parseHTML } from "./dom/parser.ts";
import { serialize } from "./dom/serializer.ts";
import { querySelector, querySelectorAll, matchesSelector } from "./css/selector.ts";
import { isVisible } from "./css/computed.ts";
import { buildAccessibilityTree, type A11yNode } from "./a11y/tree.ts";
import { serializeAccessibilityTree } from "./a11y/serialize.ts";
import {
  captureSnapshot,
  restoreSnapshot,
  diffSnapshots,
  type SnapshotChange,
} from "./snapshot/capture.ts";
import type { DocumentSnapshot } from "./snapshot/capture.ts";
import { hashSnapshot, snapshotsEqual, snapshotId } from "./snapshot/hash.ts";
import {
  getInputValue,
  setInputValue,
  serializeForm,
  serializeFormURLEncoded,
  validateForm,
  type ValidationResult,
} from "./forms/state.ts";
import { simulateClick, type ClickResult } from "./actions/click.ts";
import { simulateType, simulateClear, type TypeResult } from "./actions/type.ts";
import { simulateSelect, simulateSelectByText, type SelectResult } from "./actions/select.ts";
import { NavigationHistory, resolveUrl } from "./navigation/router.ts";
import { CookieJar } from "./navigation/cookies.ts";
import { SieveStorage } from "./navigation/session.ts";
import type { Fetcher, FetchResponse } from "./network/fetcher.ts";
import {
  solveChallenge,
  DEFAULT_SOLVERS,
  type ChallengeSolver,
} from "./network/challenges.ts";

export interface PageOptions {
  /** The URL this page was loaded from. */
  url?: string;
  /** Automatically solve WAF challenges (Sucuri, Cloudflare simple, meta-refresh). */
  solveWafChallenges?: boolean;
  /** Custom challenge solvers (appended to built-in solvers). */
  challengeSolvers?: ChallengeSolver[];
  /** Maximum number of challenge retries before giving up. */
  maxChallengeRetries?: number;
}

export class SievePage {
  private _document: SieveDocument;
  private _history: NavigationHistory;
  private _cookies: CookieJar;
  private _localStorage: SieveStorage;
  private _sessionStorage: SieveStorage;
  private _fetcher: Fetcher | null;
  private _closed = false;
  private _solveWafChallenges: boolean;
  private _challengeSolvers: readonly ChallengeSolver[];
  private _maxChallengeRetries: number;

  constructor(fetcher: Fetcher | null = null, options: PageOptions = {}) {
    this._document = parseHTML("");
    this._history = new NavigationHistory();
    this._cookies = new CookieJar();
    this._localStorage = new SieveStorage();
    this._sessionStorage = new SieveStorage();
    this._fetcher = fetcher;
    this._solveWafChallenges = options.solveWafChallenges ?? false;
    this._challengeSolvers = [
      ...DEFAULT_SOLVERS,
      ...(options.challengeSolvers ?? []),
    ];
    this._maxChallengeRetries = options.maxChallengeRetries ?? 3;
  }

  // --- Navigation ---

  /** Navigate to a URL. Requires a network fetcher. */
  async goto(url: string): Promise<FetchResponse> {
    this.assertOpen();
    if (!this._fetcher) {
      throw new Error("No network fetcher configured. Use setContent() for offline mode.");
    }

    const resolvedUrl = this._history.url !== "about:blank"
      ? resolveUrl(this._history.url, url)
      : url;

    let response = await this.fetchWithCookies(resolvedUrl);

    // Solve WAF challenges if enabled
    if (this._solveWafChallenges) {
      let retries = 0;
      while (retries < this._maxChallengeRetries) {
        const result = solveChallenge(response, resolvedUrl, this._challengeSolvers);
        if (!result || !result.solution.shouldRetry) break;

        for (const cookie of result.solution.cookies) {
          this._cookies.setCookie(cookie, resolvedUrl);
        }

        response = await this.fetchWithCookies(resolvedUrl);
        retries++;
      }
    }

    this._document = parseHTML(response.body);
    this._history.push(response.url, this._document.title);

    return response;
  }

  /** Fetch a URL with current cookies and process Set-Cookie headers. */
  private async fetchWithCookies(url: string): Promise<FetchResponse> {
    const cookieHeader = this._cookies.getCookieHeader(url);
    const headers: Record<string, string> = {};
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const response = await this._fetcher!.fetch(url, { headers });
    this.processSetCookieHeaders(response.headers, response.url);

    return response;
  }

  /** Set page content directly from an HTML string. */
  setContent(html: string, url: string = "about:blank"): void {
    this.assertOpen();
    this._document = parseHTML(html);
    this._history.push(url, this._document.title);
  }

  /** Navigate back in history. */
  async goBack(): Promise<boolean> {
    const entry = this._history.back();
    if (!entry) return false;
    if (this._fetcher) {
      await this.reloadFromUrl(entry.url);
    }
    return true;
  }

  /** Navigate forward in history. */
  async goForward(): Promise<boolean> {
    const entry = this._history.forward();
    if (!entry) return false;
    if (this._fetcher) {
      await this.reloadFromUrl(entry.url);
    }
    return true;
  }

  /** Fetch and load a URL without modifying navigation history. */
  private async reloadFromUrl(url: string): Promise<void> {
    if (!this._fetcher) return;
    const cookieHeader = this._cookies.getCookieHeader(url);
    const headers: Record<string, string> = {};
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const response = await this._fetcher.fetch(url, { headers });
    this.processSetCookieHeaders(response.headers, response.url);
    this._document = parseHTML(response.body);
  }

  get url(): string {
    return this._history.url;
  }

  // --- DOM queries ---

  get document(): SieveDocument {
    return this._document;
  }

  get title(): string {
    return this._document.title;
  }

  querySelector(selector: string): SieveElement | null {
    return querySelector(this._document, selector);
  }

  querySelectorAll(selector: string): SieveElement[] {
    return querySelectorAll(this._document, selector);
  }

  /** Get the inner HTML of the document body. */
  get content(): string {
    const body = this._document.body;
    if (!body) return serialize(this._document);
    return body.childNodes.map(serialize).join("");
  }

  /** Get the full HTML of the document. */
  get html(): string {
    return serialize(this._document);
  }

  // --- Interactions ---

  /** Click an element by selector or element reference. */
  async click(target: string | SieveElement): Promise<ClickResult> {
    this.assertOpen();
    const el = typeof target === "string" ? this.querySelector(target) : target;
    if (!el) {
      return {
        target: new SieveElement("unknown"),
        success: false,
        effect: `Element not found: ${target}`,
      };
    }

    const result = simulateClick(el);

    // Handle navigation
    if (result.navigateTo && this._fetcher) {
      const url = resolveUrl(this._history.url, result.navigateTo);
      await this.goto(url);
    }

    // Handle form submission
    if (result.submitsForm && this._fetcher) {
      await this.submitForm(result.submitsForm);
    }

    return result;
  }

  /** Type text into an input or textarea. Replaces the current value. */
  async type(target: string | SieveElement, text: string): Promise<TypeResult> {
    this.assertOpen();
    const el = typeof target === "string" ? this.querySelector(target) : target;
    if (!el) {
      return { success: false, value: "", effect: `Element not found: ${target}` };
    }
    return simulateType(el, text);
  }

  /** Clear an input's value. */
  clear(target: string | SieveElement): TypeResult {
    const el = typeof target === "string" ? this.querySelector(target) : target;
    if (!el) {
      return { success: false, value: "", effect: `Element not found: ${target}` };
    }
    return simulateClear(el);
  }

  /** Select options in a <select> element. */
  select(target: string | SieveElement, ...values: string[]): SelectResult {
    const el = typeof target === "string" ? this.querySelector(target) : target;
    if (!el) {
      return { success: false, selectedValues: [], effect: `Element not found: ${target}` };
    }
    return simulateSelect(el, ...values);
  }

  /** Select options by their visible text label. */
  selectByText(target: string | SieveElement, ...labels: string[]): SelectResult {
    const el = typeof target === "string" ? this.querySelector(target) : target;
    if (!el) {
      return { success: false, selectedValues: [], effect: `Element not found: ${target}` };
    }
    return simulateSelectByText(el, ...labels);
  }

  // --- Forms ---

  /** Get all forms on the page. */
  get forms(): FormHandle[] {
    return this.querySelectorAll("form").map((el) => new FormHandle(el, this));
  }

  /** Submit a form element. */
  private async submitForm(formEl: SieveElement): Promise<void> {
    const action = formEl.getAttribute("action") ?? this._history.url;
    const method = formEl.getAttribute("method")?.toUpperCase() ?? "GET";
    const url = resolveUrl(this._history.url, action);

    if (method === "GET") {
      const params = serializeFormURLEncoded(formEl);
      const fullUrl = `${url}${url.includes("?") ? "&" : "?"}${params}`;
      await this.goto(fullUrl);
    } else {
      const body = serializeFormURLEncoded(formEl);
      if (this._fetcher) {
        const cookieHeader = this._cookies.getCookieHeader(url);
        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
        };
        if (cookieHeader) headers["Cookie"] = cookieHeader;

        const response = await this._fetcher.fetch(url, {
          method,
          headers,
          body,
        });

        // Process Set-Cookie headers from POST response
        this.processSetCookieHeaders(response.headers, response.url);

        this._document = parseHTML(response.body);
        this._history.push(response.url, this._document.title);
      }
    }
  }

  // --- Accessibility tree ---

  /** Build the accessibility tree for the current page. */
  accessibilityTree(): AccessibilityTreeHandle {
    return new AccessibilityTreeHandle(buildAccessibilityTree(this._document));
  }

  // --- Snapshots ---

  /** Capture the current page state as a snapshot. */
  snapshot(): DocumentSnapshot {
    return captureSnapshot(this._document);
  }

  /** Restore the page to a previous snapshot. */
  restore(snapshot: DocumentSnapshot): void {
    this._document = restoreSnapshot(snapshot);
  }

  /** Diff two snapshots. */
  static diff(before: DocumentSnapshot, after: DocumentSnapshot): SnapshotChange[] {
    return diffSnapshots(before, after);
  }

  /** Fast hash-based check: did anything change since this snapshot? */
  hasChanged(snapshot: DocumentSnapshot): boolean {
    return !snapshotsEqual(snapshot, captureSnapshot(this._document));
  }

  /** Content-addressable snapshot ID (CRC32 hex). */
  snapshotId(): string {
    return snapshotId(captureSnapshot(this._document));
  }

  /** Fast snapshot hash (Bun.hash / Wyhash). */
  snapshotHash(): number | bigint {
    return hashSnapshot(captureSnapshot(this._document));
  }

  // --- State ---

  get cookies(): CookieJar {
    return this._cookies;
  }

  get localStorage(): SieveStorage {
    return this._localStorage;
  }

  get sessionStorage(): SieveStorage {
    return this._sessionStorage;
  }

  get history(): NavigationHistory {
    return this._history;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  close(): void {
    this._closed = true;
  }

  /** Process Set-Cookie headers from a response, case-insensitively. */
  private processSetCookieHeaders(headers: Record<string, string>, responseUrl: string): void {
    // Look for set-cookie header case-insensitively
    const headerKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === "set-cookie"
    );
    const setCookie = headerKey ? headers[headerKey] : undefined;
    if (setCookie) {
      for (const cookie of setCookie.split(/,(?=\s*\w+=)/)) {
        this._cookies.setCookie(cookie.trim(), responseUrl);
      }
    }
  }

  private assertOpen(): void {
    if (this._closed) throw new Error("Page is closed");
  }
}

/** Handle for interacting with a form. */
export class FormHandle {
  constructor(
    readonly element: SieveElement,
    private page: SievePage,
  ) {}

  /** Get form data as key-value pairs. */
  get data(): Record<string, string | string[]> {
    return serializeForm(this.element);
  }

  /** Get URL-encoded form data. */
  get encoded(): string {
    return serializeFormURLEncoded(this.element);
  }

  /** Validate the form. */
  validate(): ValidationResult {
    return validateForm(this.element);
  }

  /** Submit the form. */
  async submit(): Promise<void> {
    // Search within this form, not the whole page
    const submitBtn = querySelector(this.element, "button[type='submit'], input[type='submit']");
    if (submitBtn) {
      await this.page.click(submitBtn);
    }
  }
}

/** Handle for the accessibility tree. */
export class AccessibilityTreeHandle {
  constructor(readonly root: A11yNode) {}

  /** Serialize to compact text for LLM consumption. */
  serialize(): string {
    return serializeAccessibilityTree(this.root);
  }

  /** Find nodes by role. */
  findByRole(role: string): A11yNode[] {
    const results: A11yNode[] = [];
    const walk = (node: A11yNode) => {
      if (node.role === role) results.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return results;
  }

  /** Find nodes by name (accessible name). */
  findByName(name: string): A11yNode[] {
    const results: A11yNode[] = [];
    const walk = (node: A11yNode) => {
      if (node.name === name) results.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return results;
  }
}

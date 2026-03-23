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
import { serializeAccessibilityTree, type SerializeOptions } from "./a11y/serialize.ts";
import { assignRefs, resolveRef, type RefMap } from "./a11y/refs.ts";
import { diffAccessibilityTrees } from "./a11y/diff.ts";
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
import {
  checkPolicy,
  PolicyDeniedError,
  DEFAULT_POLICY,
  type ActionPolicy,
  type ActionType,
} from "./actions/policy.ts";
import { NavigationHistory, resolveUrl } from "./navigation/router.ts";
import { CookieJar, type Cookie } from "./navigation/cookies.ts";
import { SieveStorage } from "./navigation/session.ts";
import type { Fetcher, FetchResponse } from "./network/fetcher.ts";
import {
  solveChallenge,
  DEFAULT_SOLVERS,
  type ChallengeSolver,
} from "./network/challenges.ts";
import {
  executeSandboxed,
  executeDocumentScripts,
  type SandboxResult,
  type SandboxExecOptions,
} from "./js/sandbox.ts";

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

/** Semantic locator: find elements by role and/or name in the a11y tree. */
export interface SemanticLocator {
  role: string;
  name?: string;
}

/** A single action in a batch. */
export type BatchAction =
  | { action: "click"; target: string | SieveElement | SemanticLocator }
  | { action: "type"; target: string | SieveElement | SemanticLocator; text: string }
  | { action: "clear"; target: string | SieveElement | SemanticLocator }
  | { action: "select"; target: string | SieveElement | SemanticLocator; values: string[] };

export type BatchResult = {
  results: (ClickResult | TypeResult | SelectResult)[];
  /** If the batch was stopped early due to navigation, this is the index that triggered it. */
  stoppedAtNavigation?: number;
};

/** Portable session state for export/import. */
export interface SessionState {
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  url: string;
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
  private _policy: ActionPolicy = DEFAULT_POLICY;

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

  // --- Policy ---

  /** Set the action policy for this page. */
  setPolicy(policy: ActionPolicy): void {
    this._policy = policy;
  }

  /** Get the current action policy. */
  get policy(): ActionPolicy {
    return this._policy;
  }

  /** Check policy and throw if denied. */
  private enforcePolicy(action: ActionType): void {
    const result = checkPolicy(this._policy, action);
    if (result.decision === "deny") {
      throw new PolicyDeniedError(action);
    }
  }

  // --- Navigation ---

  /** Navigate to a URL. Requires a network fetcher. */
  async goto(url: string): Promise<FetchResponse> {
    this.assertOpen();
    this.enforcePolicy("navigation");
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

  /** Fetch a URL with current cookies, referer, and process Set-Cookie headers. */
  private async fetchWithCookies(url: string): Promise<FetchResponse> {
    const cookieHeader = this._cookies.getCookieHeader(url);
    const headers: Record<string, string> = {};
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    // Pass current URL as Referer so the fetcher can compute Sec-Fetch-Site
    const currentUrl = this._history.url;
    if (currentUrl && currentUrl !== "about:blank") {
      headers["Referer"] = currentUrl;
    }

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

  /** Click an element by CSS selector, @ref, semantic locator, or element reference. */
  async click(target: string | SieveElement | SemanticLocator): Promise<ClickResult> {
    this.assertOpen();
    this.enforcePolicy("click");
    const el = this.resolveAnyTarget(target);
    if (!el) {
      return {
        target: new SieveElement("unknown"),
        success: false,
        effect: `Element not found: ${formatTarget(target)}`,
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

  /** Type text into an input or textarea. Accepts CSS selector, @ref, semantic locator, or element. */
  async type(target: string | SieveElement | SemanticLocator, text: string): Promise<TypeResult> {
    this.assertOpen();
    this.enforcePolicy("type");
    const el = this.resolveAnyTarget(target);
    if (!el) {
      return { success: false, value: "", effect: `Element not found: ${formatTarget(target)}` };
    }
    return simulateType(el, text);
  }

  /** Clear an input's value. Accepts CSS selector, @ref, semantic locator, or element. */
  clear(target: string | SieveElement | SemanticLocator): TypeResult {
    this.enforcePolicy("clear");
    const el = this.resolveAnyTarget(target);
    if (!el) {
      return { success: false, value: "", effect: `Element not found: ${formatTarget(target)}` };
    }
    return simulateClear(el);
  }

  /** Select options in a <select> element. Accepts CSS selector, @ref, semantic locator, or element. */
  select(target: string | SieveElement | SemanticLocator, ...values: string[]): SelectResult {
    this.enforcePolicy("select");
    const el = this.resolveAnyTarget(target);
    if (!el) {
      return { success: false, selectedValues: [], effect: `Element not found: ${formatTarget(target)}` };
    }
    return simulateSelect(el, ...values);
  }

  /** Select options by their visible text label. Accepts CSS selector, @ref, semantic locator, or element. */
  selectByText(target: string | SieveElement | SemanticLocator, ...labels: string[]): SelectResult {
    const el = this.resolveAnyTarget(target);
    if (!el) {
      return { success: false, selectedValues: [], effect: `Element not found: ${formatTarget(target)}` };
    }
    return simulateSelectByText(el, ...labels);
  }

  // --- Batch actions ---

  /**
   * Execute multiple actions in sequence. Returns results for each action.
   * Stops early if an action triggers navigation (the page changes).
   */
  async batch(actions: BatchAction[]): Promise<BatchResult> {
    this.assertOpen();
    this.enforcePolicy("batch");
    const results: (ClickResult | TypeResult | SelectResult)[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      switch (action.action) {
        case "click": {
          const result = await this.click(action.target);
          results.push(result);
          if (result.navigateTo || result.submitsForm) {
            return { results, stoppedAtNavigation: i };
          }
          break;
        }
        case "type": {
          const result = await this.type(action.target, action.text);
          results.push(result);
          break;
        }
        case "clear": {
          const result = this.clear(action.target);
          results.push(result);
          break;
        }
        case "select": {
          const result = this.select(action.target, ...action.values);
          results.push(result);
          break;
        }
      }
    }

    return { results };
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

  // --- JavaScript execution (Layer 2) ---

  /**
   * Execute JavaScript code in a sandboxed QuickJS WASM environment.
   * The code has access to DOM APIs (document.querySelector, etc.)
   * but no network, no eval, no module imports.
   */
  async executeJS(code: string): Promise<SandboxResult> {
    this.assertOpen();
    return executeSandboxed(code, this._document, { url: this._history.url });
  }

  /**
   * Execute all inline <script> tags in the current document.
   * External scripts (src=) are skipped.
   */
  async executeScripts(): Promise<SandboxResult[]> {
    this.assertOpen();
    return executeDocumentScripts(this._document, { url: this._history.url });
  }

  // --- Accessibility tree ---

  /** The current ref map (populated after accessibilityTree() is called). */
  private _refMap: RefMap | null = null;

  /**
   * Build the accessibility tree with @ref addressing.
   * Interactive elements get stable refs (@e1, @e2, ...) that can be
   * used with click(), type(), select() instead of CSS selectors.
   */
  accessibilityTree(): AccessibilityTreeHandle {
    const tree = buildAccessibilityTree(this._document);
    this._refMap = assignRefs(tree);
    return new AccessibilityTreeHandle(tree, this._refMap);
  }

  /**
   * Resolve a @ref to the DOM element it points to.
   * Returns null if the ref doesn't exist or the tree hasn't been built.
   */
  resolveRef(ref: string): SieveElement | null {
    if (!this._refMap) return null;
    return resolveRef(ref, this._refMap);
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

  // --- State export/import ---

  /** Export page state as a portable JSON-serializable object. */
  exportState(): SessionState {
    return {
      cookies: this._cookies.all(),
      localStorage: this._localStorage.toJSON(),
      sessionStorage: this._sessionStorage.toJSON(),
      url: this._history.url,
    };
  }

  /** Import page state from a previously exported session. */
  importState(state: SessionState): void {
    for (const cookie of state.cookies) {
      this._cookies.setCookieObject(cookie);
    }
    this._localStorage.fromJSON(state.localStorage);
    this._sessionStorage.fromJSON(state.sessionStorage);
    if (state.url && state.url !== "about:blank") {
      this._history.push(state.url, this._document.title);
    }
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

  /**
   * Resolve any target type to a DOM element.
   * Supports @refs, CSS selectors, semantic locators, and direct elements.
   */
  private resolveAnyTarget(target: string | SieveElement | SemanticLocator): SieveElement | null {
    if (target instanceof SieveElement) return target;
    if (typeof target === "string") return this.resolveTarget(target);
    return this.resolveSemanticLocator(target);
  }

  /**
   * Resolve a target string to a DOM element.
   * Supports @refs (@e1, @e2, ...) and CSS selectors.
   */
  private resolveTarget(target: string): SieveElement | null {
    if (target.startsWith("@e")) {
      return this.resolveRef(target);
    }
    return this.querySelector(target);
  }

  /**
   * Resolve a semantic locator to a DOM element via the a11y tree.
   * Builds the tree if needed. Returns null if no match or ambiguous.
   */
  private resolveSemanticLocator(locator: SemanticLocator): SieveElement | null {
    // Ensure a11y tree is built
    if (!this._refMap) {
      this.accessibilityTree();
    }
    const tree = buildAccessibilityTree(this._document);
    const matches: A11yNode[] = [];
    const walk = (node: A11yNode) => {
      if (node.role === locator.role) {
        if (!locator.name || node.name === locator.name) {
          matches.push(node);
        }
      }
      for (const child of node.children) walk(child);
    };
    walk(tree);

    if (matches.length === 1 && matches[0]!.element) {
      return matches[0]!.element;
    }
    return null;
  }

  private assertOpen(): void {
    if (this._closed) throw new Error("Page is closed");
  }
}

function formatTarget(target: string | SieveElement | SemanticLocator): string {
  if (typeof target === "string") return target;
  if (target instanceof SieveElement) return `<${target.tagName}>`;
  return `{role: "${target.role}"${target.name ? `, name: "${target.name}"` : ""}}`;
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

/** Handle for the accessibility tree with ref-based addressing. */
export class AccessibilityTreeHandle {
  constructor(
    readonly root: A11yNode,
    readonly refs: RefMap,
  ) {}

  /**
   * Serialize to compact text for LLM consumption.
   * Options:
   *   interactive: true — only show interactive elements + landmarks
   *   compact: true — strip structural-only wrapper nodes
   *   maxLength: 4000 — truncate output
   *   maxDepth: 5 — limit tree depth
   *   contentBoundary: { origin: "https://..." } — wrap in nonce-protected boundary
   */
  serialize(options?: SerializeOptions): string {
    return serializeAccessibilityTree(this.root, options);
  }

  /** Number of interactive elements with refs. */
  get refCount(): number {
    return this.refs.count;
  }

  /** Resolve a @ref to its a11y node. */
  getByRef(ref: string): A11yNode | null {
    return this.refs.byRef.get(ref) ?? null;
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

  /**
   * Diff this tree against another, producing a unified text diff.
   * Useful for multi-step agent loops: "what changed on the page?"
   */
  diff(other: AccessibilityTreeHandle, options?: SerializeOptions): string {
    return diffAccessibilityTrees(this.root, other.root, options);
  }
}

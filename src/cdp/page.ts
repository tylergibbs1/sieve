/**
 * CdpPage: a real browser page controlled via Chrome DevTools Protocol.
 *
 * Same agent-facing API as SievePage (accessibilityTree, click, type, select,
 * @refs) but backed by a real Chrome tab with full JS execution, rendering,
 * and network support.
 */

import type { CdpSession } from "./session.ts";
import type {
  NavigateResult,
  CaptureScreenshotResult,
  GetDocumentResult,
  QuerySelectorResult,
  QuerySelectorAllResult,
  ResolveNodeResult,
  GetBoxModelResult,
  GetOuterHTMLResult,
  DescribeNodeResult,
  EvaluateResult,
  CallFunctionOnResult,
  GetFullAXTreeResult,
  GetNavigationHistoryResult,
  GetCookiesResult,
  SetCookieParams,
  CdpCookie,
  RemoteObject,
  ConsoleAPICalledEvent,
  ExceptionThrownEvent,
  JavaScriptDialogOpeningEvent,
} from "./protocol.ts";
import { buildA11yTreeFromCdp, type CdpRefMap, type CdpA11yResult } from "./tree.ts";
import type { A11yNode } from "../a11y/tree.ts";
import { serializeAccessibilityTree, type SerializeOptions } from "../a11y/serialize.ts";
import { diffAccessibilityTrees } from "../a11y/diff.ts";

/** Semantic locator: find elements by role and/or name. */
export interface SemanticLocator {
  role: string;
  name?: string;
}

/** Handle for a DOM element in the real browser. */
export interface CdpElementHandle {
  /** CDP nodeId (session-scoped, may become stale). */
  nodeId: number;
  /** CDP backendNodeId (stable across navigations within same document). */
  backendNodeId: number;
  /** Get the outer HTML of this element. */
  outerHTML(): Promise<string>;
  /** Get a property value via JS evaluation. */
  getProperty(name: string): Promise<unknown>;
  /** Click this element. */
  click(): Promise<void>;
  /** Type into this element. */
  type(text: string): Promise<void>;
}

/** A captured console message from the page. */
export interface ConsoleMessage {
  level: "log" | "debug" | "info" | "error" | "warning";
  text: string;
  timestamp: number;
}

/** A captured JavaScript exception from the page. */
export interface PageException {
  text: string;
  timestamp: number;
}

/** Dialog auto-handling policy. */
export type DialogPolicy = "accept" | "dismiss" | "ignore";

/**
 * Key definitions for press/keyDown/keyUp.
 * Maps friendly names to CDP key event params.
 */
const KEY_DEFINITIONS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter:     { key: "Enter",     code: "Enter",      keyCode: 13, text: "\r" },
  Tab:       { key: "Tab",       code: "Tab",        keyCode: 9 },
  Escape:    { key: "Escape",    code: "Escape",     keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace",  keyCode: 8 },
  Delete:    { key: "Delete",    code: "Delete",     keyCode: 46 },
  ArrowUp:   { key: "ArrowUp",   code: "ArrowUp",    keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown",  keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft",  keyCode: 37 },
  ArrowRight:{ key: "ArrowRight",code: "ArrowRight", keyCode: 39 },
  Home:      { key: "Home",      code: "Home",       keyCode: 36 },
  End:       { key: "End",       code: "End",        keyCode: 35 },
  PageUp:    { key: "PageUp",    code: "PageUp",     keyCode: 33 },
  PageDown:  { key: "PageDown",  code: "PageDown",   keyCode: 34 },
  Space:     { key: " ",         code: "Space",      keyCode: 32, text: " " },
  " ":       { key: " ",         code: "Space",      keyCode: 32, text: " " },
};

/** Accessibility tree handle — same interface as SievePage's. */
export class CdpAccessibilityTreeHandle {
  constructor(
    readonly root: A11yNode,
    readonly refMap: CdpRefMap,
  ) {}

  serialize(options?: SerializeOptions): string {
    return serializeAccessibilityTree(this.root, options);
  }

  get refCount(): number {
    return this.refMap.count;
  }

  getByRef(ref: string): A11yNode | null {
    return this.refMap.byRef.get(ref) ?? null;
  }

  findByRole(role: string): A11yNode[] {
    const results: A11yNode[] = [];
    const walk = (node: A11yNode) => {
      if (node.role === role) results.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return results;
  }

  findByName(name: string): A11yNode[] {
    const results: A11yNode[] = [];
    const walk = (node: A11yNode) => {
      if (node.name === name) results.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    return results;
  }

  diff(other: CdpAccessibilityTreeHandle, options?: SerializeOptions): string {
    return diffAccessibilityTrees(this.root, other.root, options);
  }
}

export class CdpPage {
  private _session: CdpSession;
  private _targetId: string;
  private _url = "about:blank";
  private _closed = false;
  private _refMap: CdpRefMap | null = null;
  /** Root document nodeId for DOM queries. */
  private _rootNodeId: number | null = null;

  // --- Console capture ---
  private _consoleLogs: ConsoleMessage[] = [];
  private _exceptions: PageException[] = [];

  // --- Dialog handling ---
  private _dialogPolicy: DialogPolicy = "dismiss";
  private _lastDialog: JavaScriptDialogOpeningEvent | null = null;
  private _unsubDialog: (() => void) | null = null;

  // --- Network idle tracking ---
  private _inflightRequests = 0;
  private _unsubNetworkReq: (() => void) | null = null;
  private _unsubNetworkDone: (() => void) | null = null;
  private _unsubNetworkFail: (() => void) | null = null;

  constructor(session: CdpSession, targetId: string) {
    this._session = session;
    this._targetId = targetId;
  }

  /** Enable required CDP domains. Called once after creation. */
  async _init(): Promise<void> {
    await Promise.all([
      this._session.send("Page.enable"),
      this._session.send("DOM.enable"),
      this._session.send("Accessibility.enable"),
      this._session.send("Network.enable"),
      this._session.send("Runtime.enable"),
    ]);

    // Console capture
    this._session.on("Runtime.consoleAPICalled", (params) => {
      const event = params as unknown as ConsoleAPICalledEvent;
      const text = event.args
        .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ""))
        .join(" ");
      this._consoleLogs.push({
        level: event.type === "warning" ? "warning" : event.type as ConsoleMessage["level"],
        text,
        timestamp: event.timestamp,
      });
    });

    this._session.on("Runtime.exceptionThrown", (params) => {
      const event = params as unknown as ExceptionThrownEvent;
      this._exceptions.push({
        text: event.exceptionDetails.exception?.description ?? event.exceptionDetails.text,
        timestamp: event.timestamp,
      });
    });

    // Dialog auto-handling
    this._unsubDialog = this._session.on("Page.javascriptDialogOpening", (params) => {
      const event = params as unknown as JavaScriptDialogOpeningEvent;
      this._lastDialog = event;
      if (this._dialogPolicy !== "ignore") {
        this._session.send("Page.handleJavaScriptDialog", {
          accept: this._dialogPolicy === "accept",
        }).catch(() => {});
      }
    });

    // Network inflight tracking
    this._unsubNetworkReq = this._session.on("Network.requestWillBeSent", () => {
      this._inflightRequests++;
    });
    this._unsubNetworkDone = this._session.on("Network.loadingFinished", () => {
      this._inflightRequests = Math.max(0, this._inflightRequests - 1);
    });
    this._unsubNetworkFail = this._session.on("Network.loadingFailed", () => {
      this._inflightRequests = Math.max(0, this._inflightRequests - 1);
    });
  }

  // --- Navigation ---

  async goto(url: string): Promise<void> {
    this.assertOpen();

    // Start listening for load event before navigating
    const loadPromise = this._session.waitForEvent("Page.loadEventFired", 30_000);

    const result = (await this._session.send("Page.navigate", { url })) as unknown as NavigateResult;
    if (result.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    await loadPromise;
    this._url = url;
    this._rootNodeId = null;
    this._refMap = null;
    this.recordAction("goto", { target: url });
  }

  async goBack(): Promise<boolean> {
    return this.navigateHistory(-1);
  }

  async goForward(): Promise<boolean> {
    return this.navigateHistory(1);
  }

  private async navigateHistory(delta: number): Promise<boolean> {
    const history = (await this._session.send(
      "Page.getNavigationHistory"
    )) as unknown as GetNavigationHistoryResult;

    const targetIndex = history.currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= history.entries.length) return false;

    const entry = history.entries[targetIndex]!;
    await this._session.send("Page.navigateToHistoryEntry", { entryId: entry.id });
    this._url = entry.url;
    this._rootNodeId = null;
    this._refMap = null;
    return true;
  }

  /** Cached URL. For the live URL after pushState, use getUrl(). */
  get url(): string {
    return this._url;
  }

  /** Get the current URL from the browser (handles pushState changes). */
  async getUrl(): Promise<string> {
    try {
      this._url = await this.evaluate<string>("location.href");
    } catch {
      // Page may be navigating
    }
    return this._url;
  }

  async getTitle(): Promise<string> {
    const result = await this.evaluate("document.title");
    return String(result);
  }

  // --- DOM ---

  private async ensureDocumentRoot(): Promise<number> {
    if (this._rootNodeId !== null) return this._rootNodeId;
    const result = (await this._session.send("DOM.getDocument", {
      depth: 0,
    })) as unknown as GetDocumentResult;
    this._rootNodeId = result.root.nodeId;
    return this._rootNodeId;
  }

  async querySelector(selector: string): Promise<CdpElementHandle | null> {
    const rootId = await this.ensureDocumentRoot();
    try {
      const result = (await this._session.send("DOM.querySelector", {
        nodeId: rootId,
        selector,
      })) as unknown as QuerySelectorResult;

      if (!result.nodeId || result.nodeId === 0) return null;
      return this.makeElementHandle(result.nodeId);
    } catch {
      return null;
    }
  }

  async querySelectorAll(selector: string): Promise<CdpElementHandle[]> {
    const rootId = await this.ensureDocumentRoot();
    try {
      const result = (await this._session.send("DOM.querySelectorAll", {
        nodeId: rootId,
        selector,
      })) as unknown as QuerySelectorAllResult;

      const handles: CdpElementHandle[] = [];
      for (const nodeId of result.nodeIds) {
        if (nodeId === 0) continue;
        handles.push(await this.makeElementHandle(nodeId));
      }
      return handles;
    } catch {
      return [];
    }
  }

  async content(): Promise<string> {
    const result = await this.evaluate("document.body?.innerHTML ?? ''");
    return String(result);
  }

  async html(): Promise<string> {
    const result = await this.evaluate("document.documentElement?.outerHTML ?? ''");
    return String(result);
  }

  // --- Accessibility Tree ---

  async accessibilityTree(): Promise<CdpAccessibilityTreeHandle> {
    this.assertOpen();
    const result = (await this._session.send(
      "Accessibility.getFullAXTree"
    )) as unknown as GetFullAXTreeResult;

    const { root, refMap } = buildA11yTreeFromCdp(result.nodes);
    this._refMap = refMap;
    return new CdpAccessibilityTreeHandle(root, refMap);
  }

  /** Resolve a @ref to its backendDOMNodeId. */
  resolveRef(ref: string): number | null {
    if (!this._refMap) return null;
    return this._refMap.byRefNodeId.get(ref) ?? null;
  }

  // --- Actions ---

  async click(target: string | SemanticLocator): Promise<void> {
    this.assertOpen();
    const nodeId = await this.resolveTarget(target);
    if (nodeId === null) {
      throw new Error(`Element not found: ${formatTarget(target)}`);
    }

    // Resolve to a JS object and call click()
    const objectId = await this.resolveNodeToObject(nodeId);
    try {
      await this._session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          this.scrollIntoViewIfNeeded?.();
          this.click();
        }`,
        awaitPromise: false,
      });
    } finally {
      await this.releaseObject(objectId);
    }

    await this.settle();
    this.recordAction("click", { target: typeof target === "string" ? target : formatTarget(target) });
  }

  async type(target: string | SemanticLocator, text: string): Promise<void> {
    this.assertOpen();
    const nodeId = await this.resolveTarget(target);
    if (nodeId === null) {
      throw new Error(`Element not found: ${formatTarget(target)}`);
    }

    // Focus the element
    await this._session.send("DOM.focus", { backendNodeId: nodeId });

    // Clear existing value
    const objectId = await this.resolveNodeToObject(nodeId);
    try {
      await this._session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          this.value = '';
          this.dispatchEvent(new Event('input', { bubbles: true }));
        }`,
      });
    } finally {
      await this.releaseObject(objectId);
    }

    await this._session.send("Input.insertText", { text });
    this.recordAction("type", { target: typeof target === "string" ? target : formatTarget(target), text });
  }

  async select(target: string | SemanticLocator, ...values: string[]): Promise<void> {
    this.assertOpen();
    const nodeId = await this.resolveTarget(target);
    if (nodeId === null) {
      throw new Error(`Element not found: ${formatTarget(target)}`);
    }

    const objectId = await this.resolveNodeToObject(nodeId);
    try {
      await this._session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function(values) {
          for (const opt of this.options) {
            opt.selected = values.includes(opt.value);
          }
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
        arguments: [{ value: values }],
      });
    } finally {
      await this.releaseObject(objectId);
    }
  }

  // --- JavaScript Execution ---

  async evaluate<T = unknown>(expression: string): Promise<T> {
    this.assertOpen();
    const result = (await this._session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as unknown as EvaluateResult;

    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${msg}`);
    }

    return result.result.value as T;
  }

  // --- Screenshot ---

  async screenshot(options?: {
    format?: "png" | "jpeg" | "webp";
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer> {
    this.assertOpen();

    const params: Record<string, unknown> = {
      format: options?.format ?? "png",
    };
    if (options?.quality !== undefined) params.quality = options.quality;
    if (options?.fullPage) params.captureBeyondViewport = true;

    const result = (await this._session.send(
      "Page.captureScreenshot",
      params,
    )) as unknown as CaptureScreenshotResult;

    return Buffer.from(result.data, "base64");
  }

  // --- Cookies ---

  async cookies(urls?: string[]): Promise<CdpCookie[]> {
    const params: Record<string, unknown> = {};
    if (urls) params.urls = urls;
    const result = (await this._session.send(
      "Network.getCookies",
      params,
    )) as unknown as GetCookiesResult;
    return result.cookies;
  }

  async setCookie(...cookies: SetCookieParams[]): Promise<void> {
    for (const cookie of cookies) {
      await this._session.send("Network.setCookie", cookie as unknown as Record<string, unknown>);
    }
  }

  async clearCookies(): Promise<void> {
    await this._session.send("Network.clearBrowserCookies");
  }

  // --- Keyboard ---

  /** Focus an element. Target can be a CSS selector, @ref, or semantic locator. */
  async focus(target: string | SemanticLocator): Promise<void> {
    this.assertOpen();
    const nodeId = await this.resolveTarget(target);
    if (nodeId === null) {
      throw new Error(`Element not found: ${formatTarget(target)}`);
    }
    await this._session.send("DOM.focus", { backendNodeId: nodeId });
  }

  /**
   * Press a key (keyDown + keyUp). Accepts named keys (Enter, Tab, Escape,
   * ArrowDown, etc.) or single characters.
   */
  async press(key: string): Promise<void> {
    this.assertOpen();
    await this.keyDown(key);
    await this.keyUp(key);
  }

  /** Dispatch a keyDown event on the focused element. */
  async keyDown(key: string): Promise<void> {
    this.assertOpen();
    const def = this.resolveKey(key);
    await this.dispatchKeyboardEvent("keydown", def);
  }

  /** Dispatch a keyUp event on the focused element. */
  async keyUp(key: string): Promise<void> {
    this.assertOpen();
    const def = this.resolveKey(key);
    await this.dispatchKeyboardEvent("keyup", def);
  }

  /** Resolve a key name to its definition. */
  private resolveKey(key: string): { key: string; code: string; keyCode: number; text?: string } {
    const def = KEY_DEFINITIONS[key];
    if (def) return def;
    if (key.length === 1) {
      return { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
    }
    throw new Error(`Unknown key: "${key}". Use named keys (Enter, Tab, Escape, etc.) or single characters.`);
  }

  /**
   * Dispatch a KeyboardEvent via JavaScript on the focused element.
   * This reliably sets event.key, event.code, etc. in all Chrome modes.
   */
  private async dispatchKeyboardEvent(
    type: "keydown" | "keyup" | "keypress",
    def: { key: string; code: string; keyCode: number; text?: string },
  ): Promise<void> {
    await this.evaluate(`
      document.activeElement?.dispatchEvent(new KeyboardEvent("${type}", {
        key: ${JSON.stringify(def.key)},
        code: ${JSON.stringify(def.code)},
        keyCode: ${def.keyCode},
        which: ${def.keyCode},
        bubbles: true,
        cancelable: true,
      }))
    `);
  }

  // --- Dialog handling ---

  /**
   * Set how JavaScript dialogs (alert, confirm, prompt) are handled.
   * - "accept": auto-accept (OK / confirm)
   * - "dismiss": auto-dismiss (Cancel) — default
   * - "ignore": don't handle (will block the page!)
   */
  setDialogPolicy(policy: DialogPolicy): void {
    this._dialogPolicy = policy;
  }

  /** Get the last dialog that was shown (or null). */
  get lastDialog(): JavaScriptDialogOpeningEvent | null {
    return this._lastDialog;
  }

  // --- Console & error capture ---

  /** Get all captured console messages. */
  get consoleLogs(): readonly ConsoleMessage[] {
    return this._consoleLogs;
  }

  /** Get all captured JavaScript exceptions. */
  get exceptions(): readonly PageException[] {
    return this._exceptions;
  }

  /** Clear captured console messages. */
  clearConsoleLogs(): void {
    this._consoleLogs = [];
  }

  /** Clear captured exceptions. */
  clearExceptions(): void {
    this._exceptions = [];
  }

  // --- Network idle ---

  /**
   * Wait until the network is idle (no inflight requests for `idleMs`).
   * Useful after clicking something that triggers AJAX requests.
   */
  async waitForNetworkIdle(options?: {
    /** How long the network must be quiet before resolving. Default: 500ms */
    idleMs?: number;
    /** Maximum time to wait. Default: 30000ms */
    timeoutMs?: number;
  }): Promise<void> {
    this.assertOpen();
    const idleMs = options?.idleMs ?? 500;
    const timeoutMs = options?.timeoutMs ?? 30_000;

    return new Promise<void>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for network idle after ${timeoutMs}ms (${this._inflightRequests} requests still inflight)`));
      }, timeoutMs);

      const checkIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (this._inflightRequests <= 0) {
          idleTimer = setTimeout(() => {
            cleanup();
            resolve();
          }, idleMs);
        }
      };

      const onRequest = () => { if (idleTimer) clearTimeout(idleTimer); };
      const onDone = () => checkIdle();

      const unsubReq = this._session.on("Network.requestWillBeSent", onRequest);
      const unsubDone = this._session.on("Network.loadingFinished", onDone);
      const unsubFail = this._session.on("Network.loadingFailed", onDone);

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (idleTimer) clearTimeout(idleTimer);
        unsubReq();
        unsubDone();
        unsubFail();
      };

      // Check immediately in case network is already idle
      checkIdle();
    });
  }

  // --- PDF ---

  /** Generate a PDF of the page. Returns the PDF as a Buffer. */
  async pdf(options?: {
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
    paperWidth?: number;
    paperHeight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    pageRanges?: string;
  }): Promise<Buffer> {
    this.assertOpen();
    const params: Record<string, unknown> = {
      printBackground: options?.printBackground ?? true,
    };
    if (options?.landscape !== undefined) params.landscape = options.landscape;
    if (options?.scale !== undefined) params.scale = options.scale;
    if (options?.paperWidth !== undefined) params.paperWidth = options.paperWidth;
    if (options?.paperHeight !== undefined) params.paperHeight = options.paperHeight;
    if (options?.marginTop !== undefined) params.marginTop = options.marginTop;
    if (options?.marginBottom !== undefined) params.marginBottom = options.marginBottom;
    if (options?.marginLeft !== undefined) params.marginLeft = options.marginLeft;
    if (options?.marginRight !== undefined) params.marginRight = options.marginRight;
    if (options?.pageRanges) params.pageRanges = options.pageRanges;

    const result = (await this._session.send("Page.printToPDF", params)) as { data: string };
    return Buffer.from(result.data, "base64");
  }

  // --- Viewport / Device emulation ---

  /** Set the viewport size. */
  async setViewport(width: number, height: number, deviceScaleFactor = 1): Promise<void> {
    this.assertOpen();
    await this._session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile: width <= 768,
    });
  }

  /** Emulate a device by name. */
  async emulateDevice(device: keyof typeof DEVICES): Promise<void> {
    const d = DEVICES[device];
    if (!d) throw new Error(`Unknown device: "${device}". Available: ${Object.keys(DEVICES).join(", ")}`);
    await this.setViewport(d.width, d.height, d.scale);
    if (d.userAgent) {
      await this._session.send("Emulation.setUserAgentOverride", { userAgent: d.userAgent });
    }
  }

  // --- Network interception ---

  private _routes: Map<string, RouteHandler> = new Map();
  private _fetchEnabled = false;
  private _unsubFetch: (() => void) | null = null;

  /**
   * Intercept network requests matching a URL pattern.
   * Pattern can be exact URL, glob (*), or a function.
   */
  async route(pattern: string, handler: RouteHandler): Promise<void> {
    this.assertOpen();
    this._routes.set(pattern, handler);
    if (!this._fetchEnabled) {
      await this._session.send("Fetch.enable", {
        patterns: [{ urlPattern: "*" }],
      });
      this._fetchEnabled = true;
      this._unsubFetch = this._session.on("Fetch.requestPaused", async (params) => {
        const requestId = params.requestId as string;
        const url = (params.request as { url: string }).url;
        const method = (params.request as { method: string }).method;

        for (const [pat, handler] of this._routes) {
          if (matchUrlPattern(pat, url)) {
            try {
              await handler({ url, method, requestId, session: this._session });
            } catch {
              // If handler fails, continue the request
              await this._session.send("Fetch.continueRequest", { requestId }).catch(() => {});
            }
            return;
          }
        }
        // No match — continue
        await this._session.send("Fetch.continueRequest", { requestId }).catch(() => {});
      });
    }
  }

  /** Remove a route by pattern. */
  async unroute(pattern: string): Promise<void> {
    this._routes.delete(pattern);
    if (this._routes.size === 0 && this._fetchEnabled) {
      this._unsubFetch?.();
      this._unsubFetch = null;
      await this._session.send("Fetch.disable").catch(() => {});
      this._fetchEnabled = false;
    }
  }

  /** Block all requests matching a pattern (convenience). */
  async blockRequests(pattern: string): Promise<void> {
    await this.route(pattern, async ({ requestId, session }) => {
      await session.send("Fetch.failRequest", { requestId, reason: "BlockedByClient" });
    });
  }

  // --- Annotated screenshot ---

  /**
   * Take a screenshot with @ref labels overlaid on interactive elements.
   * Returns a PNG Buffer. Labels are drawn via JS canvas overlay.
   */
  async annotatedScreenshot(): Promise<Buffer> {
    this.assertOpen();
    // Build the tree to get refs + positions
    const tree = await this.accessibilityTree();

    // Inject overlay labels via JS
    await this.evaluate(`
      (function() {
        // Remove any previous overlay
        const prev = document.getElementById('__sieve_overlay');
        if (prev) prev.remove();

        const overlay = document.createElement('div');
        overlay.id = '__sieve_overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999';
        document.body.appendChild(overlay);
      })()
    `);

    // For each ref, get the element's bounding rect and add a label
    for (const [ref, backendNodeId] of this._refMap!.byRefNodeId) {
      try {
        const objectId = await this.resolveNodeToObject(backendNodeId);
        try {
          await this._session.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function(ref) {
              const rect = this.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return;
              const label = document.createElement('div');
              label.textContent = ref;
              label.style.cssText = 'position:fixed;background:#ff0;color:#000;font:bold 10px monospace;padding:1px 3px;border:1px solid #000;border-radius:2px;z-index:999999;pointer-events:none;line-height:1.2;'
                + 'left:' + rect.left + 'px;top:' + Math.max(0, rect.top - 14) + 'px;';
              document.getElementById('__sieve_overlay').appendChild(label);
            }`,
            arguments: [{ value: ref }],
          });
        } finally {
          await this.releaseObject(objectId);
        }
      } catch {
        // Element may not be visible
      }
    }

    // Take the screenshot
    const png = await this.screenshot();

    // Remove the overlay
    await this.evaluate("document.getElementById('__sieve_overlay')?.remove()").catch(() => {});

    return png;
  }

  // --- Iframe support ---

  /**
   * Get the accessibility tree of an iframe.
   * Selector should point to the iframe element.
   */
  async iframeTree(selector: string): Promise<CdpAccessibilityTreeHandle | null> {
    this.assertOpen();
    const frameId = await this.evaluate<string | null>(`
      (() => {
        const iframe = document.querySelector(${JSON.stringify(selector)});
        if (!iframe || !iframe.contentDocument) return null;
        return '__sieve_iframe_ok';
      })()
    `);

    if (!frameId) {
      // Cross-origin iframe — use CDP to get the frame's target
      const rootId = await this.ensureDocumentRoot();
      const result = (await this._session.send("DOM.querySelector", {
        nodeId: rootId,
        selector,
      })) as unknown as QuerySelectorResult;
      if (!result.nodeId || result.nodeId === 0) return null;

      const desc = (await this._session.send("DOM.describeNode", {
        nodeId: result.nodeId,
        depth: 0,
      })) as unknown as { node: { frameId?: string; contentDocument?: { nodeId: number } } };

      if (!desc.node.frameId) return null;

      // Get the frame's a11y tree
      try {
        const axResult = (await this._session.send("Accessibility.getFullAXTree", {
          frameId: desc.node.frameId,
        })) as unknown as GetFullAXTreeResult;

        const { root, refMap } = buildA11yTreeFromCdp(axResult.nodes);
        return new CdpAccessibilityTreeHandle(root, refMap);
      } catch {
        return null;
      }
    }

    // Same-origin — evaluate inside the iframe
    return null; // Same-origin iframes are accessible via the main tree
  }

  // --- HAR recording ---

  private _harEntries: HarEntry[] = [];
  private _harRecording = false;
  private _unsubHarReq: (() => void) | null = null;
  private _unsubHarResp: (() => void) | null = null;
  private _harPendingRequests = new Map<string, {
    url: string;
    method: string;
    startTime: number;
    headers: Array<{ name: string; value: string }>;
  }>();

  /** Start recording network requests as HAR entries. */
  startHarRecording(): void {
    if (this._harRecording) return;
    this._harRecording = true;
    this._harEntries = [];
    this._harPendingRequests.clear();

    this._unsubHarReq = this._session.on("Network.requestWillBeSent", (params) => {
      const reqId = params.requestId as string;
      const request = params.request as { url: string; method: string; headers: Record<string, string> };
      this._harPendingRequests.set(reqId, {
        url: request.url,
        method: request.method,
        startTime: Date.now(),
        headers: Object.entries(request.headers).map(([name, value]) => ({ name, value })),
      });
    });

    this._unsubHarResp = this._session.on("Network.responseReceived", (params) => {
      const reqId = params.requestId as string;
      const pending = this._harPendingRequests.get(reqId);
      if (!pending) return;
      this._harPendingRequests.delete(reqId);

      const response = params.response as {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        mimeType: string;
      };

      this._harEntries.push({
        startedDateTime: new Date(pending.startTime).toISOString(),
        time: Date.now() - pending.startTime,
        request: {
          method: pending.method,
          url: pending.url,
          headers: pending.headers,
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.entries(response.headers).map(([name, value]) => ({ name, value })),
          mimeType: response.mimeType,
        },
      });
    });
  }

  /** Stop recording and return the HAR entries. */
  stopHarRecording(): HarEntry[] {
    this._harRecording = false;
    this._unsubHarReq?.();
    this._unsubHarResp?.();
    this._unsubHarReq = null;
    this._unsubHarResp = null;
    return this._harEntries;
  }

  /** Get the current HAR entries (while still recording). */
  get harEntries(): readonly HarEntry[] {
    return this._harEntries;
  }

  /** Export HAR entries as a HAR 1.2 JSON object. */
  exportHar(): object {
    return {
      log: {
        version: "1.2",
        creator: { name: "sieve", version: "1.0" },
        entries: this._harEntries,
      },
    };
  }

  // --- Session recording ---

  private _actionLog: ActionRecord[] = [];
  private _recording = false;

  /** Start recording agent actions. */
  startRecording(): void {
    this._recording = true;
    this._actionLog = [];
  }

  /** Stop recording and return the action transcript. */
  stopRecording(): ActionRecord[] {
    this._recording = false;
    return this._actionLog;
  }

  /** Get the action log (while still recording). */
  get actionLog(): readonly ActionRecord[] {
    return this._actionLog;
  }

  /** Record an action (called internally by action methods). */
  private recordAction(action: string, detail: Record<string, unknown>): void {
    if (!this._recording) return;
    this._actionLog.push({
      action,
      timestamp: Date.now(),
      url: this._url,
      ...detail,
    });
  }

  // --- File upload ---

  /**
   * Set files on a file input element.
   * Target can be a CSS selector, @ref, or semantic locator.
   */
  async upload(target: string | SemanticLocator, ...filePaths: string[]): Promise<void> {
    this.assertOpen();
    const backendNodeId = await this.resolveTarget(target);
    if (backendNodeId === null) {
      throw new Error(`Element not found: ${formatTarget(target)}`);
    }

    // Resolve backendNodeId to a regular nodeId for setFileInputFiles
    const objectId = await this.resolveNodeToObject(backendNodeId);
    try {
      // Verify it's a file input
      const result = (await this._session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() { return this.tagName === 'INPUT' && this.type === 'file'; }`,
        returnByValue: true,
      })) as unknown as CallFunctionOnResult;

      if (!result.result.value) {
        throw new Error("Target element is not a file input");
      }
    } finally {
      await this.releaseObject(objectId);
    }

    await this._session.send("DOM.setFileInputFiles", {
      files: filePaths,
      backendNodeId,
    });
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Unsubscribe event listeners
    this._unsubDialog?.();
    this._unsubNetworkReq?.();
    this._unsubNetworkDone?.();
    this._unsubNetworkFail?.();

    try {
      await this._session.send("Target.closeTarget", { targetId: this._targetId });
    } catch {
      // May already be closed
    }
  }

  get isClosed(): boolean {
    return this._closed;
  }

  get targetId(): string {
    return this._targetId;
  }

  // --- Internal helpers ---

  /**
   * Resolve a target (CSS selector, @ref, or semantic locator) to a backendNodeId.
   */
  private async resolveTarget(target: string | SemanticLocator): Promise<number | null> {
    if (typeof target === "string") {
      // @ref
      if (target.startsWith("@e")) {
        return this.resolveRef(target);
      }

      // CSS selector — resolve to backendNodeId
      const rootId = await this.ensureDocumentRoot();
      try {
        const result = (await this._session.send("DOM.querySelector", {
          nodeId: rootId,
          selector: target,
        })) as unknown as QuerySelectorResult;
        if (!result.nodeId || result.nodeId === 0) return null;

        // Get backendNodeId from nodeId
        const desc = (await this._session.send("DOM.describeNode", {
          nodeId: result.nodeId,
        })) as unknown as DescribeNodeResult;
        return desc.node.backendNodeId;
      } catch {
        return null;
      }
    }

    // Semantic locator — search the a11y tree
    if (!this._refMap) {
      await this.accessibilityTree();
    }

    for (const [ref, node] of this._refMap!.byRef) {
      if (node.role === target.role) {
        if (!target.name || node.name === target.name) {
          return this._refMap!.byRefNodeId.get(ref) ?? null;
        }
      }
    }
    return null;
  }

  /** Convert a backendNodeId to a Runtime objectId for JS calls. */
  private async resolveNodeToObject(backendNodeId: number): Promise<string> {
    const result = (await this._session.send("DOM.resolveNode", {
      backendNodeId,
    })) as unknown as ResolveNodeResult;

    if (!result.object.objectId) {
      throw new Error("Failed to resolve node to JS object");
    }
    return result.object.objectId;
  }

  /** Release a Runtime object handle. */
  private async releaseObject(objectId: string): Promise<void> {
    try {
      await this._session.send("Runtime.releaseObject", { objectId });
    } catch {
      // Ignore — may already be GC'd
    }
  }

  /** Create an element handle from a nodeId. */
  private async makeElementHandle(nodeId: number): Promise<CdpElementHandle> {
    const desc = (await this._session.send("DOM.describeNode", {
      nodeId,
    })) as unknown as DescribeNodeResult;

    const page = this;
    const backendNodeId = desc.node.backendNodeId;

    return {
      nodeId,
      backendNodeId,
      async outerHTML() {
        const result = (await page._session.send("DOM.getOuterHTML", {
          nodeId,
        })) as unknown as GetOuterHTMLResult;
        return result.outerHTML;
      },
      async getProperty(name: string) {
        const objectId = await page.resolveNodeToObject(backendNodeId);
        try {
          const result = (await page._session.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function(prop) { return this[prop]; }`,
            arguments: [{ value: name }],
            returnByValue: true,
          })) as unknown as CallFunctionOnResult;
          return result.result.value;
        } finally {
          await page.releaseObject(objectId);
        }
      },
      async click() {
        await page.click(`@_nodeId_${backendNodeId}`);
      },
      async type(text: string) {
        await page._session.send("DOM.focus", { backendNodeId });
        await page._session.send("Input.insertText", { text });
      },
    };
  }

  /**
   * Brief settle period after actions to let the page react.
   * Waits for any pending navigation or requestAnimationFrame.
   */
  private async settle(): Promise<void> {
    try {
      await this.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    } catch {
      // Page may have navigated — update URL
    }

    // Refresh URL from browser
    try {
      const result = await this.evaluate<string>("location.href");
      this._url = result;
    } catch {
      // Ignore
    }

    // Invalidate DOM cache
    this._rootNodeId = null;
  }

  private assertOpen(): void {
    if (this._closed) throw new Error("Page is closed");
  }
}

function formatTarget(target: string | SemanticLocator): string {
  if (typeof target === "string") return target;
  return `{role: "${target.role}"${target.name ? `, name: "${target.name}"` : ""}}`;
}

// --- Route handler types ---

export interface RouteContext {
  url: string;
  method: string;
  requestId: string;
  session: CdpSession;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

function matchUrlPattern(pattern: string, url: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return regex.test(url);
  }
  return url.includes(pattern);
}

// --- HAR types ---

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
  };
}

// --- Session recording types ---

export interface ActionRecord {
  action: string;
  timestamp: number;
  url: string;
  [key: string]: unknown;
}

// --- Device definitions ---

const DEVICES = {
  "iPhone 14": { width: 390, height: 844, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  "iPhone 14 Pro Max": { width: 430, height: 932, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  "iPad Air": { width: 820, height: 1180, scale: 2, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  "Pixel 7": { width: 412, height: 915, scale: 2.625, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36" },
  "Galaxy S23": { width: 360, height: 780, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36" },
  "Desktop HD": { width: 1920, height: 1080, scale: 1, userAgent: "" },
  "Desktop 4K": { width: 3840, height: 2160, scale: 2, userAgent: "" },
  "Laptop": { width: 1366, height: 768, scale: 1, userAgent: "" },
} as const;

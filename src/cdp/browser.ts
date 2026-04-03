/**
 * CdpBrowser: manages a real browser instance via CDP.
 *
 * Supports Chrome/Chromium and Lightpanda as backends.
 * Handles browser lifecycle (launch, connect, close) and page creation.
 * Each page gets its own CDP target (tab).
 *
 * Usage:
 *   // Chrome (default)
 *   const browser = await CdpBrowser.launch({ headless: true });
 *
 *   // Lightpanda (lightweight, fast)
 *   const browser = await CdpBrowser.launch({ browser: "lightpanda" });
 *
 *   const page = await browser.newPage();
 *   await page.goto("https://example.com");
 *   const tree = await page.accessibilityTree();
 *   await page.click("@e1");
 *   await browser.close();
 */

import type { CdpSession } from "./session.ts";
import { connect } from "./session.ts";
import { launchChrome, type LaunchResult } from "./chrome.ts";
import { launchLightpanda, type LightpandaLaunchOptions } from "./lightpanda.ts";
import type { ChromeLaunchOptions, CreateTargetResult } from "./protocol.ts";
import { CdpPage } from "./page.ts";

export interface CdpBrowserOptions extends ChromeLaunchOptions {
  /** Connect to an already-running browser instance at this WebSocket URL. */
  wsEndpoint?: string;
  /**
   * Which browser backend to use.
   * - "chrome" (default): Google Chrome / Chromium
   * - "lightpanda": Lightpanda headless browser (faster, lighter)
   */
  browser?: "chrome" | "lightpanda";
  /** Lightpanda-specific options (only used when browser is "lightpanda"). */
  lightpanda?: LightpandaLaunchOptions;
}

export class CdpBrowser {
  private _session: CdpSession;
  private _process: ReturnType<typeof Bun.spawn> | null;
  private _wsEndpoint: string;
  private _backend: "chrome" | "lightpanda";
  private _pages: CdpPage[] = [];
  private _closed = false;

  private constructor(
    session: CdpSession,
    wsEndpoint: string,
    process: ReturnType<typeof Bun.spawn> | null,
    backend: "chrome" | "lightpanda" = "chrome",
  ) {
    this._session = session;
    this._wsEndpoint = wsEndpoint;
    this._process = process;
    this._backend = backend;
  }

  /**
   * Launch a new browser instance and connect to it.
   *
   * ```typescript
   * // Chrome (default)
   * const browser = await CdpBrowser.launch({ headless: true });
   *
   * // Lightpanda
   * const browser = await CdpBrowser.launch({ browser: "lightpanda" });
   * ```
   */
  static async launch(options: CdpBrowserOptions = {}): Promise<CdpBrowser> {
    if (options.wsEndpoint) {
      const session = await connect(options.wsEndpoint);
      return new CdpBrowser(session, options.wsEndpoint, null, options.browser ?? "chrome");
    }

    const backend = options.browser ?? "chrome";
    let result: LaunchResult;

    if (backend === "lightpanda") {
      result = await launchLightpanda(options.lightpanda ?? {
        executablePath: options.executablePath,
      });
    } else {
      result = await launchChrome(options);
    }

    return new CdpBrowser(result.session, result.wsEndpoint, result.process, backend);
  }

  /**
   * Connect to an already-running browser instance (Chrome or Lightpanda).
   *
   * ```typescript
   * // Chrome
   * const browser = await CdpBrowser.connect("ws://127.0.0.1:9222/devtools/browser/...");
   *
   * // Lightpanda
   * const browser = await CdpBrowser.connect("ws://127.0.0.1:9222", "lightpanda");
   * ```
   */
  static async connect(wsEndpoint: string, backend: "chrome" | "lightpanda" = "chrome"): Promise<CdpBrowser> {
    const session = await connect(wsEndpoint);
    return new CdpBrowser(session, wsEndpoint, null, backend);
  }

  /** Extract the HTTP base URL from the WebSocket endpoint. */
  private get httpBase(): string {
    return this._wsEndpoint
      .replace("ws://", "http://")
      .replace("wss://", "https://")
      .replace(/\/devtools\/.*$/, "");
  }

  /** Create a new page (browser tab). */
  async newPage(): Promise<CdpPage> {
    this.assertOpen();

    // Create a new target (tab)
    const createResult = (await this._session.send("Target.createTarget", {
      url: "about:blank",
    })) as unknown as CreateTargetResult;

    // Get the target's WebSocket URL
    const targetWsUrl = await this.getTargetWsUrl(createResult.targetId);
    const pageSession = await connect(targetWsUrl);
    const page = new CdpPage(pageSession, createResult.targetId);
    await page._init();
    this._pages.push(page);
    return page;
  }

  /** Get the WebSocket debugger URL for a specific target. */
  private async getTargetWsUrl(targetId: string): Promise<string> {
    try {
      const resp = await fetch(`${this.httpBase}/json/list`);
      const targets = (await resp.json()) as Array<{
        id: string;
        webSocketDebuggerUrl?: string;
      }>;

      const target = targets.find((t) => t.id === targetId);
      if (target?.webSocketDebuggerUrl) {
        return target.webSocketDebuggerUrl;
      }
    } catch {
      // /json/list may not be available (some Lightpanda versions)
    }

    // Fallback: construct the URL from the base endpoint
    // Chrome format: ws://host:port/devtools/page/TARGET_ID
    // Lightpanda format: ws://host:port/devtools/page/TARGET_ID (same)
    const base = this._wsEndpoint.replace(/\/devtools\/.*$/, "");
    return `${base}/devtools/page/${targetId}`;
  }

  /** Get all open pages. */
  get pages(): readonly CdpPage[] {
    return this._pages.filter((p) => !p.isClosed);
  }

  /** The WebSocket endpoint URL. */
  get wsEndpoint(): string {
    return this._wsEndpoint;
  }

  /** The browser backend ("chrome" or "lightpanda"). */
  get backend(): "chrome" | "lightpanda" {
    return this._backend;
  }

  /** Close all pages and shut down Chrome. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Close all pages
    for (const page of this._pages) {
      if (!page.isClosed) {
        try {
          await page.close();
        } catch {
          // Page may already be closed
        }
      }
    }

    // Close the browser session
    try {
      await this._session.send("Browser.close");
    } catch {
      // May already be closed
    }
    this._session.close();

    // Kill Chrome process if we launched it
    if (this._process) {
      try {
        this._process.kill();
      } catch {
        // Already exited
      }
    }
  }

  get isClosed(): boolean {
    return this._closed;
  }

  private assertOpen(): void {
    if (this._closed) throw new Error("Browser is closed");
  }
}

/**
 * Puppeteer compatibility layer.
 *
 * Drop-in adapter so existing Puppeteer-based agent code works with sieve.
 * Covers the 80% of Puppeteer API that agents actually use.
 *
 * What works:
 *   browser.newPage(), browser.close()
 *   page.goto(), page.goBack(), page.goForward()
 *   page.title(), page.url(), page.content()
 *   page.$(selector), page.$$(selector)
 *   page.click(selector), page.type(selector, text)
 *   page.select(selector, ...values)
 *   page.waitForSelector(selector)
 *   page.cookies(), page.setCookie()
 *
 * What doesn't work (no rendering engine):
 *   page.screenshot(), page.pdf()
 *   page.evaluate(), page.evaluateHandle()
 *   page.waitForNavigation() (navigation is synchronous)
 *   page.setViewport(), page.emulate()
 *   Any CDP-specific methods
 */

import { SieveBrowser, type BrowserOptions } from "../browser.ts";
import { SievePage } from "../page.ts";
import { SieveElement } from "../dom/element.ts";
import { querySelector, querySelectorAll } from "../css/selector.ts";
import { getInputValue } from "../forms/state.ts";
import { waitForSelector, waitForVisible } from "../actions/wait.ts";

// --- Types matching Puppeteer's interface ---

export interface PuppeteerCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface PuppeteerElementHandle {
  click(): Promise<void>;
  type(text: string): Promise<void>;
  getProperty(name: string): Promise<string | null>;
  evaluate(fn: (el: any) => any): Promise<any>;
  $(selector: string): Promise<PuppeteerElementHandle | null>;
  $$(selector: string): Promise<PuppeteerElementHandle[]>;
  _element: SieveElement;
}

// --- Element handle wrapper ---

function wrapElement(el: SieveElement, page: SievePage): PuppeteerElementHandle {
  return {
    _element: el,
    async click() {
      await page.click(el);
    },
    async type(text: string) {
      await page.type(el, text);
    },
    async getProperty(name: string) {
      if (name === "textContent") return el.textContent;
      if (name === "innerHTML") return el.textContent; // simplified
      if (name === "value") return getInputValue(el);
      return el.getAttribute(name);
    },
    async evaluate(_fn: (el: any) => any) {
      throw new Error("page.evaluate() is not supported in sieve. Use querySelector + getProperty instead.");
    },
    async $(selector: string) {
      const child = querySelector(el, selector);
      return child ? wrapElement(child, page) : null;
    },
    async $$(selector: string) {
      return querySelectorAll(el, selector).map((c) => wrapElement(c, page));
    },
  };
}

// --- Page wrapper ---

class PuppeteerPageCompat {
  constructor(private page: SievePage) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }

  async goBack(): Promise<void> {
    await this.page.goBack();
  }

  async goForward(): Promise<void> {
    await this.page.goForward();
  }

  async title(): Promise<string> {
    return this.page.title;
  }

  url(): string {
    return this.page.url;
  }

  async content(): Promise<string> {
    return this.page.html;
  }

  async $(selector: string): Promise<PuppeteerElementHandle | null> {
    const el = this.page.querySelector(selector);
    return el ? wrapElement(el, this.page) : null;
  }

  async $$(selector: string): Promise<PuppeteerElementHandle[]> {
    return this.page.querySelectorAll(selector).map((el) => wrapElement(el, this.page));
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async type(selector: string, text: string, _options?: { delay?: number }): Promise<void> {
    await this.page.type(selector, text);
  }

  async select(selector: string, ...values: string[]): Promise<string[]> {
    const result = this.page.select(selector, ...values);
    return result.selectedValues;
  }

  async waitForSelector(
    selector: string,
    _options?: { visible?: boolean; timeout?: number },
  ): Promise<PuppeteerElementHandle | null> {
    const result = _options?.visible
      ? waitForVisible(this.page.document, selector)
      : waitForSelector(this.page.document, selector);
    return result.element ? wrapElement(result.element, this.page) : null;
  }

  async waitForNavigation(): Promise<void> {
    // Navigation is synchronous in sieve — this is a no-op
  }

  async cookies(...urls: string[]): Promise<PuppeteerCookie[]> {
    const url = urls[0] ?? this.page.url;
    return this.page.cookies.getCookies(url).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires ? c.expires.getTime() / 1000 : -1,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite === "strict" ? "Strict" : c.sameSite === "lax" ? "Lax" : "None",
    }));
  }

  async setCookie(...cookies: PuppeteerCookie[]): Promise<void> {
    for (const c of cookies) {
      let header = `${c.name}=${c.value}`;
      if (c.domain) header += `; Domain=${c.domain}`;
      if (c.path) header += `; Path=${c.path}`;
      if (c.httpOnly) header += "; HttpOnly";
      if (c.secure) header += "; Secure";
      if (c.sameSite) header += `; SameSite=${c.sameSite}`;
      const url = c.domain
        ? `https://${c.domain}/`
        : this.page.url;
      this.page.cookies.setCookie(header, url);
    }
  }

  async close(): Promise<void> {
    this.page.close();
  }

  // Unsupported but commonly called — fail gracefully
  async screenshot(): Promise<never> {
    throw new Error("screenshot() is not supported in sieve (no rendering engine).");
  }
  async pdf(): Promise<never> {
    throw new Error("pdf() is not supported in sieve (no rendering engine).");
  }
  async evaluate(): Promise<never> {
    throw new Error("evaluate() is not supported in sieve. Use querySelector + DOM APIs.");
  }
  async setViewport(): Promise<void> {
    // No-op — no viewport
  }
}

// --- Browser wrapper ---

class PuppeteerBrowserCompat {
  constructor(private browser: SieveBrowser) {}

  async newPage(): Promise<PuppeteerPageCompat> {
    const page = await this.browser.newPage();
    return new PuppeteerPageCompat(page);
  }

  async pages(): Promise<PuppeteerPageCompat[]> {
    // Can't easily wrap existing pages — return empty
    return [];
  }

  async close(): Promise<void> {
    this.browser.close();
  }
}

/**
 * Wrap a SieveBrowser in a Puppeteer-compatible API.
 *
 * ```typescript
 * import { SieveBrowser } from "sieve";
 * import { asPuppeteer } from "sieve/compat/puppeteer";
 *
 * const browser = asPuppeteer(new SieveBrowser({ network: "live" }));
 * const page = await browser.newPage();
 * await page.goto("https://example.com");
 * const title = await page.title();
 * ```
 */
export function asPuppeteer(browser: SieveBrowser): PuppeteerBrowserCompat {
  return new PuppeteerBrowserCompat(browser);
}

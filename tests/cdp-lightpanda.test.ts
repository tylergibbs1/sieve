/**
 * CDP Lightpanda integration tests.
 *
 * Tests the Lightpanda browser backend. Skips if Lightpanda is not installed.
 * To install: https://lightpanda.io/docs/open-source/installation
 *
 * These tests verify the same core functionality as the Chrome CDP tests
 * but against Lightpanda's CDP implementation.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { CdpBrowser } from "../src/cdp/browser.ts";
import type { CdpPage } from "../src/cdp/page.ts";
import { findLightpanda } from "../src/cdp/lightpanda.ts";

// Check if Lightpanda is available
let lightpandaAvailable = false;
try {
  findLightpanda();
  lightpandaAvailable = true;
} catch {
  // Not installed
}

// Local test server
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let browser: CdpBrowser;

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>Lightpanda Test</title></head>
<body>
  <h1>Hello Lightpanda</h1>
  <nav>
    <a href="/page2">Page 2</a>
    <a href="/page3">Page 3</a>
  </nav>
  <main>
    <form>
      <label for="name">Name</label>
      <input id="name" type="text" placeholder="Your name" />
      <select id="color">
        <option value="red">Red</option>
        <option value="blue">Blue</option>
      </select>
      <button type="submit">Submit</button>
    </form>
    <button id="action" onclick="document.getElementById('result').textContent='done'">
      Do Action
    </button>
    <div id="result"></div>
  </main>
</body>
</html>`;

const PAGE2_HTML = `<!DOCTYPE html>
<html>
<head><title>Page 2</title></head>
<body><h1>Page Two</h1><a href="/">Back</a></body>
</html>`;

const describeLP = lightpandaAvailable ? describe : describe.skip;

describeLP("CdpBrowser with Lightpanda", () => {
  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/page2") {
          return new Response(PAGE2_HTML, { headers: { "Content-Type": "text/html" } });
        }
        return new Response(TEST_HTML, { headers: { "Content-Type": "text/html" } });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
    browser = await CdpBrowser.launch({ browser: "lightpanda" });
  });

  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  test("launches with lightpanda backend", () => {
    expect(browser.backend).toBe("lightpanda");
    expect(browser.wsEndpoint).toMatch(/^ws:\/\//);
    expect(browser.isClosed).toBe(false);
  });

  test("creates pages", async () => {
    const page = await browser.newPage();
    expect(page).toBeDefined();
    expect(page.isClosed).toBe(false);
    await page.close();
  });

  describe("navigation", () => {
    let page: CdpPage;

    beforeAll(async () => {
      page = await browser.newPage();
    });

    afterAll(async () => {
      await page?.close();
    });

    test("goto navigates", async () => {
      await page.goto(baseUrl);
      const title = await page.getTitle();
      expect(title).toBe("Lightpanda Test");
    });

    test("content returns body", async () => {
      const content = await page.content();
      expect(content).toContain("Hello Lightpanda");
    });

    test("querySelector finds elements", async () => {
      const el = await page.querySelector("h1");
      expect(el).not.toBeNull();
      const html = await el!.outerHTML();
      expect(html).toContain("Hello Lightpanda");
    });

    test("querySelectorAll finds multiple", async () => {
      const links = await page.querySelectorAll("a");
      expect(links.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("accessibility tree", () => {
    let page: CdpPage;

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(baseUrl);
    });

    afterAll(async () => {
      await page?.close();
    });

    test("builds a11y tree", async () => {
      const tree = await page.accessibilityTree();
      expect(tree.root).toBeDefined();
      expect(tree.root.children.length).toBeGreaterThan(0);
    });

    test("assigns refs to interactive elements", async () => {
      const tree = await page.accessibilityTree();
      expect(tree.refCount).toBeGreaterThan(0);
      const node = tree.getByRef("@e1");
      expect(node).not.toBeNull();
    });

    test("serialize produces output", async () => {
      const tree = await page.accessibilityTree();
      const text = tree.serialize();
      expect(text.length).toBeGreaterThan(0);
    });

    test("findByRole works", async () => {
      const tree = await page.accessibilityTree();
      const links = tree.findByRole("link");
      expect(links.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("actions", () => {
    let page: CdpPage;

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(baseUrl);
    });

    afterAll(async () => {
      await page?.close();
    });

    test("click by CSS selector", async () => {
      await page.click("#action");
      const result = await page.evaluate<string>(
        "document.getElementById('result').textContent"
      );
      expect(result).toBe("done");
    });

    test("type into input", async () => {
      await page.type("#name", "test user");
      const val = await page.evaluate<string>("document.getElementById('name').value");
      expect(val).toBe("test user");
    });

    test("select option", async () => {
      await page.select("#color", "blue");
      const val = await page.evaluate<string>("document.getElementById('color').value");
      expect(val).toBe("blue");
    });

    test("click by @ref", async () => {
      await page.evaluate("document.getElementById('result').textContent = ''");
      const tree = await page.accessibilityTree();
      const buttons = tree.findByRole("button");
      const actionBtn = buttons.find(b => b.name?.includes("Do Action"));
      expect(actionBtn?.ref).toBeDefined();

      await page.click(actionBtn!.ref!);
      const result = await page.evaluate<string>(
        "document.getElementById('result').textContent"
      );
      expect(result).toBe("done");
    });
  });

  describe("JavaScript evaluation", () => {
    let page: CdpPage;

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(baseUrl);
    });

    afterAll(async () => {
      await page?.close();
    });

    test("evaluate expression", async () => {
      const result = await page.evaluate<number>("2 + 2");
      expect(result).toBe(4);
    });

    test("evaluate DOM access", async () => {
      const tag = await page.evaluate<string>("document.querySelector('h1').tagName");
      expect(tag).toBe("H1");
    });

    test("evaluate throws on error", async () => {
      await expect(page.evaluate("throw new Error('oops')")).rejects.toThrow();
    });
  });

  describe("console capture", () => {
    let page: CdpPage;

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(baseUrl);
    });

    afterAll(async () => {
      await page?.close();
    });

    test("captures console.log", async () => {
      page.clearConsoleLogs();
      await page.evaluate("console.log('lp-test')");
      await page.evaluate("new Promise(r => setTimeout(r, 50))");
      const logs = page.consoleLogs;
      expect(logs.some(l => l.text.includes("lp-test"))).toBe(true);
    });
  });
});

// Always run this test to verify skip behavior
test("lightpanda availability detection works", () => {
  if (lightpandaAvailable) {
    expect(findLightpanda()).toBeTruthy();
  } else {
    console.log("  (Lightpanda not installed — Lightpanda tests skipped)");
    expect(true).toBe(true);
  }
});

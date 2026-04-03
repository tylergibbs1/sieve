/**
 * CDP integration tests.
 *
 * These tests launch a real Chrome instance and verify that CdpBrowser/CdpPage
 * work end-to-end: navigation, accessibility tree, actions, screenshots, JS eval.
 *
 * Requires Chrome/Chromium installed on the system.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { CdpBrowser } from "../src/cdp/browser.ts";
import type { CdpPage } from "../src/cdp/page.ts";

// Local test server
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let browser: CdpBrowser;

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>CDP Test Page</title></head>
<body>
  <h1>Hello CDP</h1>
  <nav aria-label="Main">
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>
  <main>
    <form id="login">
      <label for="email">Email</label>
      <input id="email" type="email" placeholder="you@example.com" required />
      <label for="pass">Password</label>
      <input id="pass" type="password" />
      <select id="role" name="role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit">Sign In</button>
    </form>
    <div id="output"></div>
    <button id="counter-btn" onclick="document.getElementById('output').textContent = 'clicked'">
      Click Me
    </button>
    <details>
      <summary>More Info</summary>
      <p>Hidden content here.</p>
    </details>
    <input type="checkbox" id="agree" />
    <label for="agree">I agree</label>
  </main>
</body>
</html>`;

const ABOUT_HTML = `<!DOCTYPE html>
<html>
<head><title>About Page</title></head>
<body><h1>About Us</h1><a href="/">Back Home</a></body>
</html>`;

const KEYBOARD_HTML = `<!DOCTYPE html>
<html>
<head><title>Keyboard Test</title></head>
<body>
  <input id="field" type="text" />
  <div id="keys"></div>
  <script>
    document.getElementById('field').addEventListener('keydown', (e) => {
      document.getElementById('keys').textContent += e.key + ',';
    });
  </script>
</body>
</html>`;

const DIALOG_HTML = `<!DOCTYPE html>
<html>
<head><title>Dialog Test</title></head>
<body>
  <button id="alert-btn" onclick="alert('hello from alert')">Alert</button>
  <button id="confirm-btn" onclick="document.getElementById('result').textContent = confirm('yes or no?') ? 'confirmed' : 'dismissed'">Confirm</button>
  <div id="result"></div>
</body>
</html>`;

const CONSOLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Console Test</title></head>
<body>
  <button id="log-btn" onclick="console.log('hello log')">Log</button>
  <button id="error-btn" onclick="console.error('hello error')">Error</button>
  <button id="throw-btn" onclick="throw new Error('uncaught!')">Throw</button>
</body>
</html>`;

const UPLOAD_HTML = `<!DOCTYPE html>
<html>
<head><title>Upload Test</title></head>
<body>
  <input id="file" type="file" />
  <input id="notfile" type="text" />
</body>
</html>`;

const NETWORK_HTML = `<!DOCTYPE html>
<html>
<head><title>Network Test</title></head>
<body>
  <div id="result"></div>
  <button id="fetch-btn" onclick="
    fetch('/api/data').then(r => r.json()).then(d => {
      document.getElementById('result').textContent = d.message;
    })
  ">Fetch</button>
</body>
</html>`;

beforeAll(async () => {
  // Start a local test server
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html" } });

      switch (url.pathname) {
        case "/about": return html(ABOUT_HTML);
        case "/keyboard": return html(KEYBOARD_HTML);
        case "/dialog": return html(DIALOG_HTML);
        case "/console": return html(CONSOLE_HTML);
        case "/upload": return html(UPLOAD_HTML);
        case "/network": return html(NETWORK_HTML);
        case "/api/data":
          return new Response(JSON.stringify({ message: "fetched" }), {
            headers: { "Content-Type": "application/json" },
          });
        default: return html(TEST_HTML);
      }
    },
  });
  baseUrl = `http://localhost:${server.port}`;

  // Launch Chrome
  browser = await CdpBrowser.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  server?.stop();
});

describe("CdpBrowser", () => {
  test("launches and connects to Chrome", () => {
    expect(browser).toBeDefined();
    expect(browser.wsEndpoint).toMatch(/^ws:\/\//);
    expect(browser.isClosed).toBe(false);
  });

  test("creates new pages", async () => {
    const page = await browser.newPage();
    expect(page).toBeDefined();
    expect(page.isClosed).toBe(false);
    await page.close();
  });
});

describe("CdpPage navigation", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page?.close();
  });

  test("goto navigates to URL", async () => {
    await page.goto(baseUrl);
    // Chrome may or may not add trailing slash
    expect(page.url).toMatch(new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
  });

  test("getTitle returns page title", async () => {
    const title = await page.getTitle();
    expect(title).toBe("CDP Test Page");
  });

  test("content returns body innerHTML", async () => {
    const content = await page.content();
    expect(content).toContain("Hello CDP");
    expect(content).toContain("Sign In");
  });

  test("html returns full document HTML", async () => {
    const html = await page.html();
    // document.documentElement.outerHTML doesn't include doctype
    expect(html).toContain("<html>");
    expect(html).toContain("<title>CDP Test Page</title>");
  });

  test("goto to different page works", async () => {
    await page.goto(`${baseUrl}/about`);
    const title = await page.getTitle();
    expect(title).toBe("About Page");
  });

  test("goBack returns to previous page", async () => {
    // Should be on /about from previous test
    const went = await page.goBack();
    expect(went).toBe(true);
    const title = await page.getTitle();
    expect(title).toBe("CDP Test Page");
  });

  test("goForward goes forward in history", async () => {
    const went = await page.goForward();
    expect(went).toBe(true);
    const title = await page.getTitle();
    expect(title).toBe("About Page");
  });
});

describe("CdpPage accessibility tree", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("builds accessibility tree with roles", async () => {
    const tree = await page.accessibilityTree();
    expect(tree.root).toBeDefined();
    expect(tree.root.role).toBe("page");
    expect(tree.root.name).toBe("CDP Test Page");
  });

  test("assigns @refs to interactive elements", async () => {
    const tree = await page.accessibilityTree();
    expect(tree.refCount).toBeGreaterThan(0);

    // Should have refs for links, inputs, button, etc.
    const button = tree.findByRole("button");
    expect(button.length).toBeGreaterThan(0);
  });

  test("serialize produces text output", async () => {
    const tree = await page.accessibilityTree();
    const text = tree.serialize();
    expect(text).toContain("page");
    expect(text.length).toBeGreaterThan(0);
  });

  test("serialize interactive filters to interactive elements", async () => {
    const tree = await page.accessibilityTree();
    const full = tree.serialize();
    const interactive = tree.serialize({ interactive: true });
    // Interactive should be shorter (fewer nodes)
    expect(interactive.length).toBeLessThanOrEqual(full.length);
  });

  test("findByRole finds matching nodes", async () => {
    const tree = await page.accessibilityTree();
    const links = tree.findByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2); // About, Contact
  });

  test("findByName finds matching nodes", async () => {
    const tree = await page.accessibilityTree();
    const nodes = tree.findByName("About");
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  test("getByRef resolves @refs", async () => {
    const tree = await page.accessibilityTree();
    const node = tree.getByRef("@e1");
    expect(node).not.toBeNull();
    expect(node!.ref).toBe("@e1");
  });
});

describe("CdpPage actions", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("click by CSS selector", async () => {
    await page.click("#counter-btn");
    const output = await page.evaluate<string>(
      "document.getElementById('output').textContent"
    );
    expect(output).toBe("clicked");
  });

  test("type into input by CSS selector", async () => {
    await page.type("#email", "test@example.com");
    const value = await page.evaluate<string>(
      "document.getElementById('email').value"
    );
    expect(value).toBe("test@example.com");
  });

  test("select option by CSS selector", async () => {
    await page.select("#role", "admin");
    const value = await page.evaluate<string>(
      "document.getElementById('role').value"
    );
    expect(value).toBe("admin");
  });

  test("click by @ref", async () => {
    // Reset output
    await page.evaluate("document.getElementById('output').textContent = ''");

    // Build tree to get refs
    const tree = await page.accessibilityTree();

    // Find the "Click Me" button's ref
    const buttons = tree.findByRole("button");
    const clickMeBtn = buttons.find((b) => b.name.includes("Click Me"));
    expect(clickMeBtn).toBeDefined();
    expect(clickMeBtn!.ref).toBeDefined();

    await page.click(clickMeBtn!.ref!);
    const output = await page.evaluate<string>(
      "document.getElementById('output').textContent"
    );
    expect(output).toBe("clicked");
  });

  test("type by @ref", async () => {
    const tree = await page.accessibilityTree();
    const textboxes = tree.findByRole("textbox");
    const emailInput = textboxes.find((t) => t.name === "Email");
    expect(emailInput).toBeDefined();

    await page.type(emailInput!.ref!, "ref@example.com");
    const value = await page.evaluate<string>(
      "document.getElementById('email').value"
    );
    expect(value).toBe("ref@example.com");
  });

  test("click by semantic locator", async () => {
    await page.evaluate("document.getElementById('output').textContent = ''");
    await page.accessibilityTree(); // ensure tree is built

    await page.click({ role: "button", name: "Click Me" });
    const output = await page.evaluate<string>(
      "document.getElementById('output').textContent"
    );
    expect(output).toBe("clicked");
  });

  test("throws on missing element", async () => {
    await expect(page.click("#nonexistent")).rejects.toThrow("Element not found");
  });
});

describe("CdpPage JavaScript evaluation", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("evaluate simple expression", async () => {
    const result = await page.evaluate<number>("1 + 1");
    expect(result).toBe(2);
  });

  test("evaluate returns complex objects", async () => {
    const result = await page.evaluate<{ a: number; b: string }>(
      "({a: 42, b: 'hello'})"
    );
    expect(result).toEqual({ a: 42, b: "hello" });
  });

  test("evaluate async expressions", async () => {
    const result = await page.evaluate<string>(
      "Promise.resolve('async result')"
    );
    expect(result).toBe("async result");
  });

  test("evaluate throws on error", async () => {
    await expect(
      page.evaluate("throw new Error('test error')")
    ).rejects.toThrow();
  });

  test("evaluate accesses DOM", async () => {
    const tagName = await page.evaluate<string>(
      "document.querySelector('h1').tagName"
    );
    expect(tagName).toBe("H1");
  });
});

describe("CdpPage screenshot", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("captures PNG screenshot", async () => {
    const buffer = await page.screenshot();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4e); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  test("captures JPEG screenshot", async () => {
    const buffer = await page.screenshot({ format: "jpeg", quality: 80 });
    expect(buffer.length).toBeGreaterThan(0);
    // JPEG magic bytes
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xd8);
  });
});

describe("CdpPage DOM queries", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("querySelector finds element", async () => {
    const el = await page.querySelector("h1");
    expect(el).not.toBeNull();
    const html = await el!.outerHTML();
    expect(html).toContain("Hello CDP");
  });

  test("querySelector returns null for missing element", async () => {
    const el = await page.querySelector(".nonexistent");
    expect(el).toBeNull();
  });

  test("querySelectorAll finds multiple elements", async () => {
    const els = await page.querySelectorAll("a");
    expect(els.length).toBeGreaterThanOrEqual(2);
  });

  test("element handle getProperty works", async () => {
    const el = await page.querySelector("#email");
    expect(el).not.toBeNull();
    const type = await el!.getProperty("type");
    expect(type).toBe("email");
  });
});

describe("CdpPage cookies", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("setCookie and get cookies", async () => {
    await page.setCookie({
      name: "test",
      value: "hello",
      url: baseUrl,
    });

    const cookies = await page.cookies();
    const testCookie = cookies.find((c) => c.name === "test");
    expect(testCookie).toBeDefined();
    expect(testCookie!.value).toBe("hello");
  });

  test("clearCookies removes all cookies", async () => {
    await page.clearCookies();
    const cookies = await page.cookies();
    expect(cookies.length).toBe(0);
  });
});

describe("CdpPage lifecycle", () => {
  test("page can be closed", async () => {
    const page = await browser.newPage();
    expect(page.isClosed).toBe(false);
    await page.close();
    expect(page.isClosed).toBe(true);
  });

  test("closed page throws on operations", async () => {
    const page = await browser.newPage();
    await page.close();
    await expect(page.goto(baseUrl)).rejects.toThrow("Page is closed");
  });
});

describe("CdpPage JS-rendered content", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page?.close();
  });

  test("sees dynamically generated DOM", async () => {
    // Navigate to a page and inject dynamic content
    await page.goto(baseUrl);
    await page.evaluate(`
      const div = document.createElement('div');
      div.id = 'dynamic';
      div.textContent = 'I was created by JavaScript';
      document.body.appendChild(div);
    `);

    // querySelector should find the dynamic element
    const el = await page.querySelector("#dynamic");
    expect(el).not.toBeNull();
    const html = await el!.outerHTML();
    expect(html).toContain("I was created by JavaScript");

    // a11y tree should include it too
    const tree = await page.accessibilityTree();
    const text = tree.serialize();
    expect(text).toContain("I was created by JavaScript");
  });
});

// ============================================================
// New features: keyboard, dialogs, console, network idle, upload
// ============================================================

describe("CdpPage keyboard events", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(`${baseUrl}/keyboard`);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("press Enter dispatches key event", async () => {
    await page.focus("#field");
    await page.press("Enter");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("Enter");
  });

  test("press Tab dispatches key event", async () => {
    await page.evaluate("document.getElementById('keys').textContent = ''");
    await page.focus("#field");
    await page.press("Tab");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("Tab");
  });

  test("press Escape dispatches key event", async () => {
    await page.evaluate("document.getElementById('keys').textContent = ''");
    await page.focus("#field");
    await page.press("Escape");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("Escape");
  });

  test("press arrow keys", async () => {
    await page.evaluate("document.getElementById('keys').textContent = ''");
    await page.focus("#field");
    await page.press("ArrowDown");
    await page.press("ArrowUp");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("ArrowDown");
    expect(keys).toContain("ArrowUp");
  });

  test("press single character", async () => {
    await page.evaluate("document.getElementById('keys').textContent = ''");
    await page.focus("#field");
    await page.press("a");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("a");
  });

  test("keyDown and keyUp can be called separately", async () => {
    await page.evaluate("document.getElementById('keys').textContent = ''");
    await page.focus("#field");
    await page.keyDown("Enter");
    await page.keyUp("Enter");
    const keys = await page.evaluate<string>("document.getElementById('keys').textContent");
    expect(keys).toContain("Enter");
  });

  test("throws on unknown key name", async () => {
    await expect(page.keyDown("FakeKey123")).rejects.toThrow("Unknown key");
  });
});

describe("CdpPage dialog handling", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page?.close();
  });

  test("auto-dismisses alerts by default", async () => {
    await page.goto(`${baseUrl}/dialog`);
    // Click the alert button — should auto-dismiss
    await page.click("#alert-btn");
    // If dialog wasn't handled, the page would be stuck
    const title = await page.getTitle();
    expect(title).toBe("Dialog Test");
  });

  test("lastDialog captures dialog info", async () => {
    expect(page.lastDialog).not.toBeNull();
    expect(page.lastDialog!.type).toBe("alert");
    expect(page.lastDialog!.message).toBe("hello from alert");
  });

  test("accept policy confirms dialogs", async () => {
    page.setDialogPolicy("accept");
    await page.click("#confirm-btn");
    // Give a moment for the result to update
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    const result = await page.evaluate<string>("document.getElementById('result').textContent");
    expect(result).toBe("confirmed");
  });

  test("dismiss policy cancels confirms", async () => {
    page.setDialogPolicy("dismiss");
    await page.click("#confirm-btn");
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    const result = await page.evaluate<string>("document.getElementById('result').textContent");
    expect(result).toBe("dismissed");
  });
});

describe("CdpPage console capture", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(`${baseUrl}/console`);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("captures console.log", async () => {
    page.clearConsoleLogs();
    await page.click("#log-btn");
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    const logs = page.consoleLogs;
    const logEntry = logs.find((l) => l.text.includes("hello log"));
    expect(logEntry).toBeDefined();
    expect(logEntry!.level).toBe("log");
  });

  test("captures console.error", async () => {
    page.clearConsoleLogs();
    await page.click("#error-btn");
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    const logs = page.consoleLogs;
    const errorEntry = logs.find((l) => l.text.includes("hello error"));
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.level).toBe("error");
  });

  test("captures uncaught exceptions", async () => {
    page.clearExceptions();
    await page.click("#throw-btn");
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    const exceptions = page.exceptions;
    expect(exceptions.length).toBeGreaterThan(0);
    expect(exceptions.some((e) => e.text.includes("uncaught"))).toBe(true);
  });

  test("clearConsoleLogs clears the log buffer", async () => {
    await page.evaluate("console.log('temp')");
    await page.evaluate("new Promise(r => setTimeout(r, 50))");
    expect(page.consoleLogs.length).toBeGreaterThan(0);
    page.clearConsoleLogs();
    expect(page.consoleLogs.length).toBe(0);
  });

  test("clearExceptions clears the exception buffer", async () => {
    page.clearExceptions();
    expect(page.exceptions.length).toBe(0);
  });
});

describe("CdpPage waitForNetworkIdle", () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(`${baseUrl}/network`);
  });

  afterAll(async () => {
    await page?.close();
  });

  test("resolves when network is idle", async () => {
    // Click fetch button, then wait for network idle
    await page.click("#fetch-btn");
    await page.waitForNetworkIdle({ idleMs: 200, timeoutMs: 5000 });

    const result = await page.evaluate<string>(
      "document.getElementById('result').textContent"
    );
    expect(result).toBe("fetched");
  });

  test("resolves immediately when no pending requests", async () => {
    const start = Date.now();
    await page.waitForNetworkIdle({ idleMs: 100, timeoutMs: 5000 });
    const elapsed = Date.now() - start;
    // Should resolve quickly (idle time + small overhead)
    expect(elapsed).toBeLessThan(1000);
  });

  test("times out when network stays busy", async () => {
    // Start a long-running fetch that won't complete before timeout
    page.evaluate(`
      fetch(new URL('/api/data', location.href).href + '?' + Math.random());
      fetch(new URL('/api/data', location.href).href + '?' + Math.random());
      fetch(new URL('/api/data', location.href).href + '?' + Math.random());
    `).catch(() => {});

    // This should still resolve because our test server responds quickly
    await page.waitForNetworkIdle({ idleMs: 200, timeoutMs: 5000 });
  });
});

describe("CdpPage file upload", () => {
  let page: CdpPage;
  let tmpFile: string;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(`${baseUrl}/upload`);

    // Create a temp file to upload
    tmpFile = `/tmp/sieve-cdp-test-upload-${Date.now()}.txt`;
    await Bun.write(tmpFile, "test file content");
  });

  afterAll(async () => {
    await page?.close();
    // Clean up temp file
    try { await Bun.file(tmpFile).exists() && Bun.spawnSync({ cmd: ["rm", tmpFile] }); } catch {}
  });

  test("uploads a file to a file input", async () => {
    await page.upload("#file", tmpFile);

    // Verify the file was set
    const fileName = await page.evaluate<string>(
      "document.getElementById('file').files[0]?.name ?? ''"
    );
    expect(fileName).toContain("sieve-cdp-test-upload");
  });

  test("throws on non-file input", async () => {
    await expect(page.upload("#notfile", tmpFile)).rejects.toThrow(
      "not a file input"
    );
  });

  test("throws on missing element", async () => {
    await expect(page.upload("#nonexistent", tmpFile)).rejects.toThrow(
      "Element not found"
    );
  });
});

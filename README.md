<p align="center">
  <img src="assets/logos/sieve-icon.svg" width="120" alt="sieve logo" />
</p>

<h1 align="center">sieve</h1>

<p align="center"><strong>The browser for AI agents. Virtual mode for speed, real browser mode when you need it.</strong></p>

TypeScript. Bun. In-memory virtual DOM or real Chrome/Lightpanda via CDP.

## The Problem

Every AI agent that touches the web spins up a real browser. Puppeteer launches Chromium. Playwright launches Chromium. Even headless browsers optimized for speed are still doing real work: parsing HTML, executing JavaScript, maintaining a live DOM, handling network requests.

For most agent workflows, this is massive overkill. An agent filling out a form doesn't need pixel rendering. An agent extracting prices doesn't need a compositing engine. An agent navigating a checkout flow doesn't need WebGL support.

What agents actually need:
- A structured representation of page state they can reason about
- The ability to "click" things and see what changes
- Form state management
- Navigation and routing
- Cookie and session handling
- An accessibility tree (this is what most agents already extract from real browsers anyway)

sieve gives agents all of this without ever launching a browser process. And when you *do* need a real browser — SPAs, JS-heavy pages, screenshots — sieve's CDP mode controls Chrome or Lightpanda with the same agent-friendly API.

## Performance

| Metric | Chrome Headless | sieve (virtual) | sieve (CDP) |
|---|---|---|---|
| Startup time | ~500ms | **<0.001ms** | ~500ms |
| Memory per page | ~50-200MB | **~13KB** | ~50-200MB |
| Parse + build a11y tree | ~200ms | **<1ms** | ~20ms |
| Concurrent pages (8GB RAM) | ~40-80 | **500,000+** | ~40-80 |
| Snapshot + restore | N/A | **<0.05ms** | N/A |
| Screenshots / PDF | Yes | No | **Yes** |
| Full JS execution | Yes | QuickJS sandbox | **Yes** |

## Install

```bash
bun add sieve
```

> Requires [Bun](https://bun.sh) runtime.

## Quick Start

```typescript
import { SieveBrowser } from "sieve";

const browser = new SieveBrowser({ network: "live" });
const page = await browser.newPage();

await page.goto("https://example.com");

// Query elements (Puppeteer-like API)
const heading = page.querySelector("h1");
console.log(heading?.textContent); // "Example Domain"

// Get the accessibility tree (the money feature for agents)
const tree = page.accessibilityTree();
console.log(tree.serialize());
// [page] Example Domain
//   [heading:1] Example Domain
//   [link] More information...

browser.close();
```

## Core Concepts

### Pages Are Data, Not Pixels

A sieve page is a serializable TypeScript object. No rendering pipeline. The "page" is a data structure that agents can inspect and manipulate directly.

```typescript
// Load from HTML string (no network needed)
const page = new SievePage();
page.setContent('<form><input name="email"><button type="submit">Go</button></form>');

// Interact
await page.type('input[name="email"]', 'user@example.com');
await page.click('button[type="submit"]');

// Read form state
console.log(page.forms[0].data); // { email: "user@example.com" }
```

### The Accessibility Tree Is First-Class

Most browser agents already convert the DOM to an accessibility tree before feeding it to an LLM. sieve makes this the primary interface — always available, always up-to-date, token-efficient.

```typescript
const tree = page.accessibilityTree();
console.log(tree.serialize());
// [page] Example Website
//   [navigation] Main Nav
//     [link] Home (/)
//     [link] Products (/products)
//   [main]
//     [heading:1] Welcome
//     [form] Sign Up
//       [textbox] Email (required, placeholder: "you@example.com")
//       [button] Create Account
```

### Snapshots and Diffing

Capture, compare, and restore page state instantly:

```typescript
const before = page.snapshot();
await page.click("#toggle-menu");
const after = page.snapshot();

// Fast equality check via Bun.hash (no full tree diff)
console.log(page.hasChanged(before)); // true

// Structural diff
const changes = SievePage.diff(before, after);
// [{ type: "attribute", path: "...", detail: "class", from: "hidden", to: "visible" }]

// Instant restore
page.restore(before);
```

## Network Modes

```typescript
// Live HTTP
const browser = new SieveBrowser({ network: "live" });

// Mock responses (for testing / offline)
const browser = new SieveBrowser({
  network: {
    mock: {
      "https://example.com": "<html><body>Hello</body></html>",
      "https://api.example.com/data": { json: { users: [] } },
    },
  },
});

// Record live responses to disk, replay deterministically
const browser = new SieveBrowser({
  network: { record: { directory: "./fixtures" } },
});
// Later:
const browser = new SieveBrowser({
  network: { replayDir: "./fixtures" },
});
```

## HTML Preprocessing

Strip scripts, styles, and noise before parsing using Bun's native HTMLRewriter:

```typescript
import { parseHTMLAsync, stripForAgent, extractMetadata } from "sieve";

// Strip scripts, styles, SVGs, iframes — keep semantic content
const doc = await parseHTMLAsync(html, { stripForAgent: true });

// Or extract just the metadata without full parsing
const meta = await extractMetadata(html);
// { title: "...", description: "...", ogTitle: "...", canonical: "...", lang: "en" }

// Custom rewrite rules
const doc = await parseHTMLAsync(html, {
  rewriteRules: [
    { selector: ".ad-banner", action: { remove: true } },
    { selector: "[data-tracking]", action: { removeAttribute: "data-tracking" } },
  ],
});
```

## JavaScript Execution (Layer 2)

Execute page scripts in a sandboxed QuickJS WASM environment with DOM bindings:

```typescript
// Execute arbitrary JS against the virtual DOM
const result = await page.executeJS(`
  document.querySelector("#app").textContent = "Dynamic";
  document.querySelector("#menu").classList.add("open");
`);
console.log(result.ok); // true — changes persist to the real DOM

// Execute all inline <script> tags in the document
await page.executeScripts();
```

The sandbox has `document.querySelector`, `createElement`, `textContent`, `classList`, `style`, `innerHTML` — but no `fetch`, no `eval`, no network access.

## Real Browser Mode (CDP)

When you need full JavaScript execution, SPA support, or screenshots, sieve can control a real browser via the Chrome DevTools Protocol. Same agent-friendly API — accessibility tree, @refs, click/type/select — backed by a real rendering engine.

Supports **Chrome/Chromium** and **[Lightpanda](https://lightpanda.io)** (a lightweight headless browser designed for AI automation).

```typescript
import { CdpBrowser } from "sieve";

// Chrome (default)
const browser = await CdpBrowser.launch({ headless: true });

// Lightpanda (faster, lighter)
const browser = await CdpBrowser.launch({ browser: "lightpanda" });

// Connect to remote browsers (Lightpanda Cloud, Browserless, etc.)
const browser = await CdpBrowser.connect("wss://cloud.lightpanda.io/ws?token=TOKEN", "lightpanda");

const page = await browser.newPage();
await page.goto("https://example.com");

// Same a11y tree + @ref system as virtual mode
const tree = await page.accessibilityTree();
console.log(tree.serialize({ interactive: true }));
await page.click("@e1");
await page.type("@e3", "hello@example.com");

// Screenshots and PDF
const png = await page.screenshot();
const annotated = await page.annotatedScreenshot(); // with @ref labels overlaid
const pdf = await page.pdf();

// Keyboard events
await page.focus("#search");
await page.press("Enter");
await page.press("Tab");
await page.press("Escape");

// JavaScript evaluation
const title = await page.evaluate("document.title");

// Network control
await page.waitForNetworkIdle();
await page.route("*/api/*", async ({ requestId, session }) => {
  await session.send("Fetch.fulfillRequest", {
    requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: btoa(JSON.stringify({ mock: true })),
  });
});

// Device emulation
await page.setViewport(390, 844);
await page.emulateDevice("iPhone 14");

// Dialog handling (auto-dismiss by default)
page.setDialogPolicy("accept"); // or "dismiss" or "ignore"

// Console and error capture
console.log(page.consoleLogs);
console.log(page.exceptions);

// HAR recording
page.startHarRecording();
await page.goto("https://example.com");
const har = page.exportHar(); // HAR 1.2 format

// Session recording (action transcript)
page.startRecording();
// ... do agent actions ...
const transcript = page.stopRecording();
// [{ action: "goto", target: "...", timestamp: ... }, { action: "click", target: "@e1", ... }]

// File upload
await page.upload("#file-input", "/path/to/file.pdf");

await browser.close();
```

## @Ref Element Addressing

Interactive elements get stable `@e1`, `@e2` refs from the accessibility tree. Agents use refs instead of fragile CSS selectors:

```typescript
const tree = page.accessibilityTree();
console.log(tree.serialize({ interactive: true }));
// [form] Registration
//   [textbox] @e1 Email (required)
//   [textbox] @e2 Password (required)
//   [checkbox] @e3 (unchecked)
//   [button] @e4 Submit

await page.type("@e1", "alice@example.com");
await page.type("@e2", "secret123");
await page.click("@e3");  // check the checkbox
await page.click("@e4");  // submit
```

## Browser Profiles & WAF Solving

Realistic HTTP headers and automatic WAF challenge solving:

```typescript
const browser = new SieveBrowser({
  network: "live",
  profile: "chrome-mac",       // realistic Chrome headers
  solveWafChallenges: true,    // auto-solve Sucuri, Cloudflare simple, meta-refresh
});
```

## Persistence

SQLite-backed storage for cookies, localStorage, and snapshots:

```typescript
const browser = new SieveBrowser({
  network: "live",
  persistence: { path: "./session.sqlite" },
});

// Cookies, storage, and snapshots persist across sessions
const page = await browser.newPage();
await page.goto("https://example.com");

// Save/load manually
browser.persistence.saveCookies(page.cookies, "https://example.com");
browser.persistence.saveStorage("https://example.com", "local", page.localStorage);
```

## API Reference

### SieveBrowser

```typescript
const browser = new SieveBrowser(options?: {
  network?: "live" | { mock: Record<string, MockResponse> } | { replayDir: string } | ...;
  allowedDomains?: string[];
  persistence?: { path?: string } | true;  // true = in-memory SQLite
});

const page = await browser.newPage();
browser.openPages;  // readonly SievePage[]
browser.persistence; // SievePersistence | null
browser.close();
```

### SievePage

```typescript
// Navigation
await page.goto(url);
page.setContent(html, url?);
await page.goBack();
await page.goForward();
page.url;
page.title;

// Queries
page.querySelector(selector);
page.querySelectorAll(selector);
page.content;  // inner HTML of body
page.html;     // full document HTML

// Interactions
await page.click(selectorOrElement);
await page.type(selectorOrElement, text);
page.clear(selectorOrElement);
page.select(selectorOrElement, ...values);
page.selectByText(selectorOrElement, ...labels);

// Forms
page.forms;  // FormHandle[]
page.forms[0].data;     // Record<string, string | string[]>
page.forms[0].validate(); // { valid: boolean, errors: [...] }

// Accessibility
page.accessibilityTree(); // AccessibilityTreeHandle
  .serialize();           // compact text for LLM context
  .findByRole(role);      // A11yNode[]
  .findByName(name);      // A11yNode[]

// Snapshots
page.snapshot();          // DocumentSnapshot
page.restore(snapshot);
page.hasChanged(snapshot); // fast hash comparison
page.snapshotHash();      // Bun.hash (Wyhash)
page.snapshotId();        // CRC32 hex string
SievePage.diff(before, after); // SnapshotChange[]

// State
page.cookies;        // CookieJar
page.localStorage;   // SieveStorage
page.sessionStorage; // SieveStorage
page.history;        // NavigationHistory
page.close();
```

## Structured Data Extraction

Extract tables, lists, forms, links, and headings as typed JSON from any accessibility tree (works in both virtual and CDP mode):

```typescript
import { extractStructured } from "sieve";

const tree = page.accessibilityTree(); // or await cdpPage.accessibilityTree()
const data = extractStructured(tree.root);

data.tables;   // [{ name, headers: ["Name", "Age"], rows: [["Alice", "30"], ...] }]
data.links;    // [{ text: "Sign In", ref: "@e5" }]
data.forms;    // [{ name: "Login", fields: [{ role: "textbox", name: "Email", required: true, ref: "@e3" }] }]
data.headings; // [{ level: 1, text: "Welcome" }, { level: 2, text: "Features" }]
data.lists;    // [{ name: "", items: ["Item 1", "Item 2", "Item 3"] }]
```

### CdpPage

```typescript
// Navigation
await page.goto(url);
await page.goBack();
await page.goForward();
page.url;                     // cached URL
await page.getUrl();          // live URL (handles pushState)
await page.getTitle();

// DOM queries
await page.querySelector(selector);   // CdpElementHandle | null
await page.querySelectorAll(selector);
await page.content();                 // body innerHTML
await page.html();                    // full document HTML

// Accessibility tree
await page.accessibilityTree();  // same serialize/findByRole/findByName/diff API

// Actions (accept CSS selectors, @refs, semantic locators)
await page.click(target);
await page.type(target, text);
await page.select(target, ...values);
await page.focus(target);
await page.press(key);          // "Enter", "Tab", "Escape", "ArrowDown", "a", etc.
await page.upload(target, ...filePaths);

// Screenshots & PDF
await page.screenshot({ format?, quality?, fullPage? });
await page.annotatedScreenshot();  // with @ref labels
await page.pdf({ landscape?, scale?, printBackground? });

// JavaScript
await page.evaluate<T>(expression);

// Network
await page.waitForNetworkIdle({ idleMs?, timeoutMs? });
await page.route(pattern, handler);
await page.blockRequests(pattern);
await page.unroute(pattern);

// Viewport
await page.setViewport(width, height, deviceScaleFactor?);
await page.emulateDevice("iPhone 14" | "Pixel 7" | "iPad Air" | ...);

// Observability
page.consoleLogs;              // captured console messages
page.exceptions;               // captured JS exceptions
page.setDialogPolicy(policy);  // "accept" | "dismiss" | "ignore"
page.startHarRecording();      // start recording network as HAR
page.exportHar();              // HAR 1.2 JSON
page.startRecording();         // record agent actions
page.stopRecording();          // get action transcript

// Cookies
await page.cookies();
await page.setCookie(...);
await page.clearCookies();
```

## Virtual Mode vs CDP Mode

| | Virtual Mode (`SieveBrowser`) | CDP Mode (`CdpBrowser`) |
|---|---|---|
| **Startup** | <0.001ms | ~500ms (Chrome), faster (Lightpanda) |
| **Memory** | ~13KB per page | ~50-200MB (Chrome) |
| **JavaScript** | QuickJS sandbox (basic DOM) | Full browser JS engine |
| **SPAs** | Limited | Full support |
| **Screenshots / PDF** | No | Yes (PNG, JPEG, PDF, annotated) |
| **Network interception** | Mock fetcher | CDP Fetch domain (route, block, mock) |
| **Device emulation** | No | Yes (iPhone, Pixel, iPad, custom) |
| **HAR recording** | No | Yes (HAR 1.2 export) |
| **Bot detection** | HTTP profiles only | Real browser fingerprint |
| **Dependencies** | None (just Bun) | Chrome or Lightpanda binary |
| **Structured extraction** | Yes | Yes |
| **A11y tree / @refs** | Yes | Yes |
| **Session recording** | No | Yes (action transcript) |

Use virtual mode for speed and scale (500K+ concurrent pages). Use CDP mode when you need real JS, screenshots, or SPA support. Both modes share the same accessibility tree, @ref addressing, structured extraction, and action API.

## Tested Against Real Websites

sieve is tested against 47 real websites including Amazon, BBC, GitHub, Wikipedia, GOV.UK, MDN, and Stack Overflow. 910+ tests covering parsing, selectors, accessibility trees, forms, cookies, snapshots, JS sandbox, CDP browser integration (Chrome + Lightpanda), network interception, structured extraction, and edge cases.

```bash
bun test                    # 910+ tests
bun test --timeout 120000   # includes live site tests
bun benchmarks/core.ts      # performance benchmarks
```

## Architecture

```
src/
├── dom/          # Virtual DOM, htmlparser2, serializer, HTMLRewriter preprocessing
├── css/          # CSS selector engine, computed styles (visibility/display)
├── a11y/         # Accessibility tree, @ref addressing, LLM-optimized serializer
├── forms/        # Form state machine, HTML5 validation, serialization
├── actions/      # Click, type, select, scroll, wait simulation
├── rules/        # Declarative rule engine (Layer 1)
├── js/           # QuickJS WASM sandbox (Layer 2)
├── cdp/          # Real browser via Chrome DevTools Protocol (Chrome + Lightpanda)
├── navigation/   # URL routing, cookie jar (RFC 6265), session storage
├── snapshot/     # Capture, diff, restore, Bun.hash change detection
├── network/      # Live HTTP, mock, disk replay, browser profiles, WAF solving
├── persistence/  # SQLite (bun:sqlite) for cookies, storage, snapshots
├── compat/       # Puppeteer compatibility layer
├── page.ts       # SievePage (virtual mode)
├── browser.ts    # SieveBrowser (virtual mode)
├── tool.ts       # AI SDK tool wrapper (Vercel AI SDK)
└── index.ts      # Public API
```

**Core dependencies:** `htmlparser2` for HTML tokenization, `quickjs-emscripten` for JS sandbox. CDP mode uses Chrome or Lightpanda (no npm packages required). Everything else is built on Bun primitives.

## Bun Features Used

- **bun:sqlite** — Cookie/storage/snapshot persistence with WAL mode
- **Bun.hash** — Wyhash for snapshot equality, CRC32 for content IDs, SHA-256 for digests
- **Bun.escapeHTML** — Native HTML entity escaping at 20 GB/s in the serializer
- **Bun.deepEquals** — Structural snapshot comparison without serialization
- **Bun.gzipSync** — Compressed disk replay recordings (5-10x smaller)
- **Bun.nanoseconds** — Precision timing for JS sandbox execution
- **Bun.Transpiler** — Script import/export analysis before sandbox execution
- **HTMLRewriter** — Native streaming HTML preprocessing (strip scripts, sanitize, extract metadata)
- **Bun.file / Bun.write** — Disk-backed replay recording
- **Bun.Glob** — Scanning replay directories

## License

MIT

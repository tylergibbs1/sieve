<p align="center">
  <img src="assets/logos/sieve-icon.svg" width="120" alt="sieve logo" />
</p>

<h1 align="center">sieve</h1>

<p align="center"><strong>A virtual browser for AI agents. No rendering. No Chromium. Just the parts that matter.</strong></p>

TypeScript. Bun. In-memory. Instant.

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

sieve gives agents all of this without ever launching a browser process.

## Performance

| Metric | Chrome Headless | sieve |
|---|---|---|
| Startup time | ~500ms | **<0.001ms** |
| Memory per page | ~50-200MB | **~13KB** |
| Parse + build a11y tree (typical page) | ~200ms | **<1ms** |
| Concurrent pages (8GB RAM) | ~40-80 | **500,000+** |
| Snapshot + restore | N/A | **<0.05ms** |

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

## What sieve Is NOT

- **Not a real browser.** It will never render pixels, play video, or run WebGL.
- **Not trying to pass bot detection.** No TLS fingerprint, no canvas, no WebRTC.
- **Not a full JS runtime.** Static HTML parsing only (Layer 0). JS-heavy SPAs that build their DOM entirely in JavaScript won't produce meaningful output yet.

## Tested Against Real Websites

sieve is tested against 47 real websites including Amazon, BBC, GitHub, Wikipedia, GOV.UK, MDN, and Stack Overflow. 608 tests covering parsing, selectors, accessibility trees, forms, cookies, snapshots, and 141 edge cases.

```bash
bun test                    # 608 tests
bun test --timeout 120000   # includes live site tests
bun benchmarks/core.ts      # performance benchmarks
```

## Architecture

```
src/
├── dom/          # Virtual DOM, htmlparser2, serializer, HTMLRewriter preprocessing
├── css/          # CSS selector engine, computed styles (visibility/display)
├── a11y/         # Accessibility tree builder + LLM-optimized serializer
├── forms/        # Form state machine, HTML5 validation, serialization
├── actions/      # Click, type, select simulation
├── navigation/   # URL routing, cookie jar (RFC 6265), session storage
├── snapshot/     # Capture, diff, restore, Bun.hash change detection
├── network/      # Live HTTP, mock, disk replay (Bun.file/Bun.write)
├── persistence/  # SQLite (bun:sqlite) for cookies, storage, snapshots
├── page.ts       # SievePage
├── browser.ts    # SieveBrowser
└── index.ts      # Public API
```

**Single dependency:** `htmlparser2` for HTML tokenization. Everything else is built on Bun primitives.

## Bun Features Used

- **bun:sqlite** — Cookie/storage/snapshot persistence with WAL mode
- **Bun.hash** — Wyhash for snapshot equality, CRC32 for content IDs, SHA-256 for digests
- **HTMLRewriter** — Native streaming HTML preprocessing (strip scripts, sanitize, extract metadata)
- **Bun.file / Bun.write** — Disk-backed replay recording
- **Bun.Glob** — Scanning replay directories

## License

MIT

/**
 * Core performance benchmarks.
 * Run with: bun benchmarks/core.ts
 */

import { SieveBrowser, SievePage, parseHTML, parseHTMLAsync, buildAccessibilityTree, serializeAccessibilityTree, captureSnapshot, restoreSnapshot, hashSnapshot, snapshotsEqual, snapshotId, snapshotDigest, stripForAgent, extractMetadata, SievePersistence, CookieJar, SieveStorage } from "../src/index.ts";

// --- Test HTML (simulates a typical webpage) ---

function generatePage(numElements: number): string {
  let html = `<!DOCTYPE html><html><head><title>Benchmark Page</title></head><body>`;
  html += `<header><nav aria-label="Main"><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav></header>`;
  html += `<main><h1>Welcome to the Benchmark</h1>`;
  html += `<form><input type="text" name="search" placeholder="Search"><button type="submit">Go</button></form>`;
  html += `<div class="content">`;
  for (let i = 0; i < numElements; i++) {
    html += `<div class="card" id="card-${i}"><h2>Item ${i}</h2><p>Description for item ${i}. This is some sample text content.</p><a href="/item/${i}">View details</a></div>`;
  }
  html += `</div></main>`;
  html += `<footer><p>&copy; 2024 Benchmark Corp</p></footer></body></html>`;
  return html;
}

// --- Benchmarks ---

function bench(name: string, fn: () => void, iterations: number = 1000): void {
  // Warmup
  for (let i = 0; i < 10; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const perOp = elapsed / iterations;
  console.log(`${name}: ${perOp.toFixed(3)}ms/op (${iterations} iterations, ${elapsed.toFixed(1)}ms total)`);
}

async function benchAsync(name: string, fn: () => Promise<void>, iterations: number = 1000): Promise<void> {
  // Warmup
  for (let i = 0; i < 10; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;

  const perOp = elapsed / iterations;
  console.log(`${name}: ${perOp.toFixed(3)}ms/op (${iterations} iterations, ${elapsed.toFixed(1)}ms total)`);
}

console.log("=== sieve Performance Benchmarks ===\n");

// --- Page startup ---
console.log("--- Page Startup ---");

bench("New SievePage creation", () => {
  new SievePage();
}, 10_000);

// --- Parse ---
console.log("\n--- HTML Parsing ---");

const smallPage = generatePage(10);
const mediumPage = generatePage(100);
const largePage = generatePage(500);

bench(`Parse small page (${smallPage.length} chars)`, () => {
  parseHTML(smallPage);
}, 5000);

bench(`Parse medium page (${mediumPage.length} chars)`, () => {
  parseHTML(mediumPage);
}, 1000);

bench(`Parse large page (${largePage.length} chars)`, () => {
  parseHTML(largePage);
}, 200);

// --- A11y tree ---
console.log("\n--- Accessibility Tree ---");

const smallDoc = parseHTML(smallPage);
const mediumDoc = parseHTML(mediumPage);
const largeDoc = parseHTML(largePage);

bench("Build a11y tree (small page)", () => {
  buildAccessibilityTree(smallDoc);
}, 5000);

bench("Build a11y tree (medium page)", () => {
  buildAccessibilityTree(mediumDoc);
}, 1000);

bench("Build a11y tree (large page)", () => {
  buildAccessibilityTree(largeDoc);
}, 200);

const smallTree = buildAccessibilityTree(smallDoc);
const mediumTree = buildAccessibilityTree(mediumDoc);
const largeTree = buildAccessibilityTree(largeDoc);

bench("Serialize a11y tree (small)", () => {
  serializeAccessibilityTree(smallTree);
}, 5000);

bench("Serialize a11y tree (medium)", () => {
  serializeAccessibilityTree(mediumTree);
}, 1000);

bench("Serialize a11y tree (large)", () => {
  serializeAccessibilityTree(largeTree);
}, 200);

// Parse + build + serialize combined
bench("Parse + a11y tree + serialize (medium)", () => {
  const doc = parseHTML(mediumPage);
  const tree = buildAccessibilityTree(doc);
  serializeAccessibilityTree(tree);
}, 500);

// --- Snapshots ---
console.log("\n--- Snapshots ---");

const mediumPageObj = new SievePage();
mediumPageObj.setContent(mediumPage);

bench("Capture snapshot (medium page)", () => {
  captureSnapshot(mediumPageObj.document);
}, 1000);

const snapshot = mediumPageObj.snapshot();

bench("Restore snapshot (medium page)", () => {
  restoreSnapshot(snapshot);
}, 1000);

// --- Concurrent pages ---
console.log("\n--- Concurrent Pages ---");

const startMem = process.memoryUsage().heapUsed;
const pages: SievePage[] = [];
const concurrentStart = performance.now();

for (let i = 0; i < 1000; i++) {
  const page = new SievePage();
  page.setContent(smallPage);
  pages.push(page);
}

const concurrentElapsed = performance.now() - concurrentStart;
const endMem = process.memoryUsage().heapUsed;
const memPerPage = (endMem - startMem) / 1000;

console.log(`Create 1,000 pages: ${concurrentElapsed.toFixed(1)}ms (${(concurrentElapsed / 1000).toFixed(3)}ms/page)`);
console.log(`Memory per page: ~${(memPerPage / 1024).toFixed(0)}KB (${(memPerPage / 1024 / 1024).toFixed(2)}MB)`);

// Cleanup
pages.length = 0;

// --- querySelector performance ---
console.log("\n--- Query Performance ---");

bench("querySelector by ID (large page)", () => {
  largeDoc.querySelector("#card-250");
}, 5000);

bench("querySelectorAll by class (large page)", () => {
  largeDoc.querySelectorAll(".card");
}, 1000);

bench("querySelectorAll complex selector (large page)", () => {
  largeDoc.querySelectorAll("main .content .card h2");
}, 500);

// --- Bun.hash snapshot hashing ---
console.log("\n--- Snapshot Hashing (Bun.hash) ---");

bench("hashSnapshot (medium page)", () => {
  hashSnapshot(snapshot);
}, 5000);

bench("snapshotsEqual (medium page, same)", () => {
  snapshotsEqual(snapshot, snapshot);
}, 5000);

const snapshot2 = captureSnapshot(parseHTML(largePage));
bench("snapshotsEqual (different pages)", () => {
  snapshotsEqual(snapshot, snapshot2);
}, 5000);

bench("snapshotId CRC32 (medium page)", () => {
  snapshotId(snapshot);
}, 5000);

bench("snapshotDigest SHA-256 (medium page)", () => {
  snapshotDigest(snapshot);
}, 1000);

// --- HTMLRewriter preprocessing ---
console.log("\n--- HTMLRewriter Preprocessing ---");

const pageWithJunk = `<html><head><style>body{color:red}</style><script>alert(1)</script></head><body>${mediumPage}<script>more()</script><svg><circle/></svg></body></html>`;

await benchAsync("stripForAgent (medium page with scripts/styles)", async () => {
  await stripForAgent(pageWithJunk);
}, 500);

await benchAsync("extractMetadata (medium page)", async () => {
  await extractMetadata(pageWithJunk);
}, 1000);

await benchAsync("parseHTMLAsync with stripForAgent (medium page)", async () => {
  await parseHTMLAsync(pageWithJunk, { stripForAgent: true });
}, 500);

// --- SQLite persistence ---
console.log("\n--- SQLite Persistence (bun:sqlite) ---");

const persistence = new SievePersistence();

const jar = new CookieJar();
for (let i = 0; i < 50; i++) {
  jar.setCookie(`cookie${i}=value${i}; Path=/`, "https://example.com/");
}

bench("Save 50 cookies to SQLite", () => {
  persistence.saveCookies(jar, "https://example.com/");
}, 500);

bench("Load cookies from SQLite", () => {
  const newJar = new CookieJar();
  persistence.loadCookies(newJar);
}, 500);

const storage = new SieveStorage();
for (let i = 0; i < 100; i++) {
  storage.setItem(`key${i}`, `value${i}`);
}

bench("Save 100-item storage to SQLite", () => {
  persistence.saveStorage("https://example.com", "local", storage);
}, 500);

bench("Load storage from SQLite", () => {
  persistence.loadStorage("https://example.com", "local");
}, 500);

const snapJson = JSON.stringify(snapshot);
bench("Save snapshot to SQLite", () => {
  persistence.saveSnapshot("bench-snap", snapJson);
}, 1000);

bench("Load snapshot from SQLite", () => {
  persistence.loadSnapshot("bench-snap");
}, 1000);

persistence.close();

console.log("\n=== Done ===");

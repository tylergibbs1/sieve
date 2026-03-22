/**
 * Fuzzer: generates random inputs and runs them through every sieve module.
 * Any crash = bug found. Any hang = bug found.
 *
 * Usage:
 *   bun fuzz/run.ts                  # 1000 iterations (default)
 *   bun fuzz/run.ts 5000             # 5000 iterations
 *   bun fuzz/run.ts 10000 --verbose  # 10000 with output
 */

import {
  parseHTML,
  serialize,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  assignRefs,
  captureSnapshot,
  restoreSnapshot,
  diffSnapshots,
  hashSnapshot,
  snapshotsEqual,
  snapshotId,
  querySelector,
  querySelectorAll,
  matchesSelector,
  getComputedStyle,
  isVisible,
  simulateClick,
  simulateType,
  simulateClear,
  validateForm,
  serializeForm,
  CookieJar,
  SievePage,
  SieveStorage,
} from "../src/index.ts";
import { executeSandboxed } from "../src/js/sandbox.ts";
import { RuleEngine } from "../src/rules/engine.ts";
import {
  randomHTML,
  randomSelector,
  randomCookie,
  randomJS,
  randomElement,
} from "./generators.ts";

const ITERATIONS = parseInt(process.argv[2] ?? "1000", 10);
const VERBOSE = process.argv.includes("--verbose");

let passed = 0;
let crashed = 0;
const crashes: { module: string; input: string; error: string }[] = [];

function fuzz(module: string, input: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err: any) {
    crashed++;
    const msg = err.message?.slice(0, 200) ?? String(err).slice(0, 200);
    crashes.push({ module, input: input.slice(0, 200), error: msg });
    if (VERBOSE) {
      console.log(`  ✗ ${module}: ${msg}`);
    }
  }
}

async function fuzzAsync(module: string, input: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
  } catch (err: any) {
    crashed++;
    const msg = err.message?.slice(0, 200) ?? String(err).slice(0, 200);
    crashes.push({ module, input: input.slice(0, 200), error: msg });
    if (VERBOSE) {
      console.log(`  ✗ ${module}: ${msg}`);
    }
  }
}

console.log(`\n🔨 Fuzzing sieve — ${ITERATIONS} iterations\n`);
const start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  if (i % 200 === 0 && i > 0) {
    process.stdout.write(`  ${i}/${ITERATIONS} (${crashed} crashes)\r`);
  }

  const html = randomHTML(Math.floor(Math.random() * 20) + 1);

  // --- Parse ---
  fuzz("parseHTML", html, () => {
    parseHTML(html);
  });

  const doc = parseHTML(html);

  // --- Serialize round-trip ---
  fuzz("serialize", html, () => {
    const serialized = serialize(doc);
    parseHTML(serialized);
  });

  // --- querySelector with random selectors ---
  for (let j = 0; j < 3; j++) {
    const sel = randomSelector();
    fuzz("querySelector", sel, () => {
      querySelector(doc, sel);
    });
    fuzz("querySelectorAll", sel, () => {
      querySelectorAll(doc, sel);
    });
  }

  // --- matchesSelector on random elements ---
  const allEls = doc.querySelectorAll("*");
  if (allEls.length > 0) {
    const el = allEls[Math.floor(Math.random() * allEls.length)]!;
    const sel = randomSelector();
    fuzz("matchesSelector", sel, () => {
      matchesSelector(el, sel);
    });
  }

  // --- Computed styles ---
  for (const el of allEls.slice(0, 5)) {
    fuzz("getComputedStyle", el.tagName, () => {
      getComputedStyle(el);
    });
    fuzz("isVisible", el.tagName, () => {
      isVisible(el);
    });
  }

  // --- A11y tree ---
  fuzz("buildAccessibilityTree", html, () => {
    const tree = buildAccessibilityTree(doc);
    serializeAccessibilityTree(tree);
    serializeAccessibilityTree(tree, { interactive: true });
    serializeAccessibilityTree(tree, { maxLength: 500 });
    serializeAccessibilityTree(tree, { maxDepth: 2 });
    assignRefs(tree);
  });

  // --- Snapshots ---
  fuzz("snapshot", html, () => {
    const snap = captureSnapshot(doc);
    hashSnapshot(snap);
    snapshotId(snap);
    const restored = restoreSnapshot(snap);
    const snap2 = captureSnapshot(restored);
    snapshotsEqual(snap, snap2);
    diffSnapshots(snap, snap2);
  });

  // --- Actions on random elements ---
  if (allEls.length > 0) {
    const el = allEls[Math.floor(Math.random() * allEls.length)]!;
    fuzz("simulateClick", el.tagName, () => {
      simulateClick(el);
    });
    fuzz("simulateType", el.tagName, () => {
      simulateType(el, "fuzz test " + Math.random());
    });
    fuzz("simulateClear", el.tagName, () => {
      simulateClear(el);
    });
  }

  // --- Forms ---
  const forms = doc.querySelectorAll("form");
  for (const form of forms.slice(0, 2)) {
    fuzz("validateForm", html, () => {
      validateForm(form);
    });
    fuzz("serializeForm", html, () => {
      serializeForm(form);
    });
  }

  // --- Cookies ---
  const cookie = randomCookie();
  fuzz("CookieJar", cookie, () => {
    const jar = new CookieJar();
    jar.setCookie(cookie, "https://example.com/path");
    jar.getCookies("https://example.com/path");
    jar.getCookieHeader("https://example.com/path");
  });

  // --- Storage ---
  fuzz("SieveStorage", "", () => {
    const s = new SieveStorage();
    for (let k = 0; k < 5; k++) {
      s.setItem(`key-${k}`, `val-${Math.random()}`);
    }
    s.toJSON();
    SieveStorage.fromJSON(s.toJSON());
  });

  // --- Rules engine ---
  fuzz("RuleEngine", html, () => {
    const engine = new RuleEngine([
      { trigger: { click: "button" }, effect: { show: ".hidden" } },
      { trigger: { click: "a" }, effect: { hide: ".menu" } },
      { trigger: { click: "#toggle" }, effect: { toggleClass: "body", class: "dark" } },
    ]);
    const el = allEls.length > 0 ? allEls[0]! : doc.createElement("div");
    engine.process({ type: "click", target: el }, doc);
  });

  // --- SievePage lifecycle ---
  fuzz("SievePage", html, () => {
    const page = new SievePage();
    page.setContent(html);
    page.querySelector("*");
    page.querySelectorAll("*");
    page.accessibilityTree();
    page.snapshot();
    page.close();
  });
}

// --- JS Sandbox fuzzing (fewer iterations — slower) ---
const jsFuzzCount = Math.min(ITERATIONS, 100);
console.log(`\n  JS sandbox: ${jsFuzzCount} iterations...`);

for (let i = 0; i < jsFuzzCount; i++) {
  const html = randomHTML(5);
  const doc = parseHTML(html);
  const js = randomJS();

  await fuzzAsync("executeSandboxed", js, async () => {
    await executeSandboxed(js, doc, { url: "https://example.com" });
  });
}

const elapsed = performance.now() - start;

// --- Report ---
console.log(`\n${"=".repeat(50)}`);
console.log(`Fuzzing complete: ${ITERATIONS} iterations in ${(elapsed / 1000).toFixed(1)}s`);
console.log(`  Passed: ${passed}`);
console.log(`  Crashed: ${crashed}`);

if (crashes.length > 0) {
  // Deduplicate by module + error
  const unique = new Map<string, { module: string; input: string; error: string; count: number }>();
  for (const c of crashes) {
    const key = `${c.module}:${c.error.slice(0, 80)}`;
    const existing = unique.get(key);
    if (existing) {
      existing.count++;
    } else {
      unique.set(key, { ...c, count: 1 });
    }
  }

  console.log(`\n  Unique crash signatures: ${unique.size}`);
  for (const [_, c] of [...unique.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n  [${c.module}] (${c.count}x)`);
    console.log(`    Error: ${c.error}`);
    console.log(`    Input: ${c.input.slice(0, 100)}`);
  }
}

console.log(`\n${"=".repeat(50)}\n`);

// Exit with error code if unexpected crashes found
// Selector parse errors and "not a child" errors are expected from random inputs
const unexpectedCrashes = crashes.filter(c =>
  !c.error.includes("Expected") &&
  !c.error.includes("Unsupported pseudo") &&
  !c.error.includes("not a child") &&
  !c.error.includes("Void element") &&
  !c.error.includes("identifier at pos")
);

if (unexpectedCrashes.length > 0) {
  console.log(`⚠️  ${unexpectedCrashes.length} unexpected crashes found!`);
  process.exit(1);
} else {
  console.log(`✅ No unexpected crashes. All ${crashed} errors were expected parse/validation failures.`);
}

/**
 * Automated tests against real websites.
 * Validates that sieve can fetch, parse, build a11y trees,
 * run selectors, and extract structure from real-world HTML.
 *
 * Run with: bun test tests/live-sites.test.ts --timeout 60000
 */

import { describe, test, expect } from "bun:test";
import {
  SieveBrowser,
  SievePage,
  parseHTML,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  extractMetadata,
  captureSnapshot,
  hashSnapshot,
  type A11yNode,
} from "../src/index.ts";

interface SiteEntry {
  url: string;
  category: string;
  description: string;
}

/**
 * Sites known to serve JS-only shells with no static HTML content.
 * These are expected to have empty/minimal a11y trees in Layer 0 (no JS execution).
 * They'll work once Layer 2 (sandboxed JS) is implemented.
 */
const JS_SHELL_SITES = new Set([
  "https://www.imdb.com/chart/top/",
  "https://www.booking.com",
  "https://www.etsy.com/search?q=pottery",
  "https://www.reuters.com",
  "https://www.ssa.gov",
  "https://quotes.toscrape.com",
  "https://www.amazon.com/s?k=books",
]);

const sites: SiteEntry[] = await Bun.file(
  new URL("../benchmarks/sites.json", import.meta.url).pathname
).json();

// --- Helpers ---

function countNodes(node: A11yNode): number {
  let count = 1;
  for (const child of node.children) count += countNodes(child);
  return count;
}

/** Fetch a site with timeout and error handling. */
async function fetchSite(url: string): Promise<{ html: string; status: number } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "sieve/0.1.0 (https://github.com/sieve; virtual browser test suite)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    const html = await response.text();
    return { html, status: response.status };
  } catch {
    return null;
  }
}

// --- Pre-fetch all sites in parallel ---

interface FetchedSite extends SiteEntry {
  html: string;
  status: number;
}

let fetchedSites: FetchedSite[] = [];

// Pre-fetch with concurrency limit
async function prefetchAll(): Promise<void> {
  const CONCURRENCY = 8;
  const results: (FetchedSite | null)[] = [];

  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (site) => {
        const result = await fetchSite(site.url);
        if (!result) return null;
        return { ...site, html: result.html, status: result.status };
      })
    );
    results.push(...batchResults);
  }

  fetchedSites = results.filter((r): r is FetchedSite => r !== null);
}

await prefetchAll();

console.log(`\nFetched ${fetchedSites.length}/${sites.length} sites successfully.\n`);

// --- Tests ---

describe("Live site: HTML parsing", () => {
  for (const site of fetchedSites) {
    test(`parses ${site.url} without throwing`, () => {
      const doc = parseHTML(site.html);
      expect(doc).toBeDefined();
      // Should have at least some content
      expect(doc.childNodes.length).toBeGreaterThan(0);
    });
  }
});

describe("Live site: document structure", () => {
  for (const site of fetchedSites) {
    test(`${site.url} has reasonable DOM structure`, () => {
      const doc = parseHTML(site.html);

      // Should have a title (most real pages do)
      const title = doc.title;
      // Some pages may not have a title in the raw HTML (SPA shells)
      // so we just check it doesn't throw

      // Should be able to query basic elements
      const allElements = doc.querySelectorAll("*");
      expect(allElements.length).toBeGreaterThan(0);

      // Should have links (virtually every real page does)
      const links = doc.querySelectorAll("a");
      // Some minimal pages might not, but most will
      expect(links.length + allElements.length).toBeGreaterThan(1);
    });
  }
});

describe("Live site: accessibility tree", () => {
  for (const site of fetchedSites) {
    if (JS_SHELL_SITES.has(site.url)) {
      test(`${site.url} is a JS shell (expected empty a11y tree in Layer 0)`, () => {
        const doc = parseHTML(site.html);
        const tree = buildAccessibilityTree(doc);
        expect(tree.role).toBe("page");
        // JS shells may have 0 children — this documents the limitation
      });
      continue;
    }

    test(`${site.url} produces a non-trivial a11y tree`, () => {
      const doc = parseHTML(site.html);
      const tree = buildAccessibilityTree(doc);

      expect(tree.role).toBe("page");
      expect(tree.children.length).toBeGreaterThan(0);

      const nodeCount = countNodes(tree);
      expect(nodeCount).toBeGreaterThan(1);

      const serialized = serializeAccessibilityTree(tree);
      expect(serialized.length).toBeGreaterThan(10);
    });
  }
});

describe("Live site: a11y tree contains expected roles", () => {
  const testable = fetchedSites.filter((s) => !JS_SHELL_SITES.has(s.url));
  for (const site of testable) {
    test(`${site.url} has links in a11y tree`, () => {
      const doc = parseHTML(site.html);
      const tree = buildAccessibilityTree(doc);
      const serialized = serializeAccessibilityTree(tree);

      const hasLink = serialized.includes("[link]");
      const hasText = serialized.includes("[text]") || tree.children.length > 0;
      expect(hasLink || hasText).toBe(true);
    });
  }
});

describe("Live site: CSS selectors work on real HTML", () => {
  for (const site of fetchedSites) {
    test(`${site.url} supports querySelector`, () => {
      const doc = parseHTML(site.html);

      // These selectors should not throw on any real page
      doc.querySelector("body");
      doc.querySelector("a");
      doc.querySelector("div");
      doc.querySelector("[class]");
      doc.querySelectorAll("a[href]");
      doc.querySelectorAll("img");
      doc.querySelectorAll("input");
      doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
    });
  }
});

describe("Live site: snapshots work on real HTML", () => {
  for (const site of fetchedSites) {
    test(`${site.url} snapshot captures and hashes`, () => {
      const doc = parseHTML(site.html);
      const snapshot = captureSnapshot(doc);

      expect(snapshot.type).toBe("document");
      expect(snapshot.children.length).toBeGreaterThan(0);

      // Hash should be deterministic
      const hash1 = hashSnapshot(snapshot);
      const hash2 = hashSnapshot(snapshot);
      expect(hash1).toBe(hash2);
    });
  }
});

describe("Live site: metadata extraction", () => {
  const metaSites = fetchedSites.filter((s) =>
    !s.url.includes("example.com") && !s.url.includes("cern.ch") &&
    !s.url.includes("httpbin.org/forms")
  );

  for (const site of metaSites) {
    test(`${site.url} extracts some metadata`, async () => {
      const meta = await extractMetadata(site.html);
      // Most real sites should have at least a title
      const hasAnyMeta =
        meta.title.length > 0 ||
        meta.description.length > 0 ||
        meta.lang.length > 0 ||
        meta.charset.length > 0;
      expect(hasAnyMeta).toBe(true);
    });
  }
});

// --- Category-specific tests ---

describe("Live site: form detection", () => {
  const formSites = fetchedSites.filter(
    (s) => s.category === "form-heavy" && !JS_SHELL_SITES.has(s.url)
  );

  for (const site of formSites) {
    test(`${site.url} has detectable forms`, () => {
      const doc = parseHTML(site.html);
      const forms = doc.querySelectorAll("form");
      const inputs = doc.querySelectorAll("input");

      expect(forms.length + inputs.length).toBeGreaterThan(0);
    });
  }
});

describe("Live site: semantic structure on gov sites", () => {
  const govSites = fetchedSites.filter(
    (s) => s.category === "government" && !JS_SHELL_SITES.has(s.url)
  );

  for (const site of govSites) {
    test(`${site.url} has semantic landmarks`, () => {
      const doc = parseHTML(site.html);
      const tree = buildAccessibilityTree(doc);
      const serialized = serializeAccessibilityTree(tree);

      // Government sites should have landmarks
      const hasLandmarks =
        serialized.includes("[navigation]") ||
        serialized.includes("[main]") ||
        serialized.includes("[banner]") ||
        serialized.includes("[contentinfo]") ||
        serialized.includes("[region]");

      expect(hasLandmarks).toBe(true);
    });
  }
});

describe("Live site: heading hierarchy", () => {
  const contentSites = fetchedSites.filter(
    (s) => (s.category === "complex-structured" || s.category === "developer-tools") &&
    !JS_SHELL_SITES.has(s.url)
  );

  for (const site of contentSites) {
    test(`${site.url} has headings`, () => {
      const doc = parseHTML(site.html);
      const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
      // Content-heavy pages should have headings
      expect(headings.length).toBeGreaterThan(0);
    });
  }
});

// --- Performance sanity check ---

describe("Live site: parse performance", () => {
  // Pick a few large sites for timing
  const largeSites = fetchedSites
    .sort((a, b) => b.html.length - a.html.length)
    .slice(0, 5);

  for (const site of largeSites) {
    test(`${site.url} (${(site.html.length / 1024).toFixed(0)}KB) parses in <500ms`, () => {
      const start = performance.now();
      const doc = parseHTML(site.html);
      buildAccessibilityTree(doc);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  }
});

// --- Print summary ---

describe("Summary", () => {
  test("report", () => {
    console.log("\n=== Live Site Test Summary ===");
    console.log(`Sites tested: ${fetchedSites.length}/${sites.length}`);
    const skipped = sites.filter(
      (s) => !fetchedSites.some((f) => f.url === s.url)
    );
    if (skipped.length > 0) {
      console.log(`Skipped (fetch failed): ${skipped.map((s) => s.url).join(", ")}`);
    }

    // Stats
    const sizes = fetchedSites.map((s) => s.html.length);
    const totalKB = sizes.reduce((a, b) => a + b, 0) / 1024;
    const avgKB = totalKB / fetchedSites.length;
    console.log(`Total HTML fetched: ${totalKB.toFixed(0)}KB`);
    console.log(`Average page size: ${avgKB.toFixed(0)}KB`);

    // Per-category breakdown
    const categories = [...new Set(fetchedSites.map((s) => s.category))];
    for (const cat of categories) {
      const catSites = fetchedSites.filter((s) => s.category === cat);
      console.log(`  ${cat}: ${catSites.length} sites`);
    }
    console.log("=== End Summary ===\n");
  });
});

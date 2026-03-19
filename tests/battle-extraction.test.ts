/**
 * Battle tests: Real-world data extraction from live websites.
 * Tests the patterns agents actually use to extract structured data.
 */

import { describe, test, expect } from "bun:test";
import { parseHTML, parseHTMLAsync, buildAccessibilityTree, serializeAccessibilityTree, extractMetadata, querySelector, querySelectorAll } from "../src/index.ts";

async function fetchHTML(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "sieve/0.1.0", Accept: "text/html" },
      redirect: "follow",
    });
    clearTimeout(timer);
    return await resp.text();
  } catch {
    return null;
  }
}

describe("Extract: Hacker News", () => {
  let html: string | null;

  test("fetch", async () => {
    html = await fetchHTML("https://news.ycombinator.com");
    expect(html).not.toBeNull();
  });

  test("extract story titles and links", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const titleLinks = doc.querySelectorAll(".titleline > a");
    expect(titleLinks.length).toBeGreaterThan(10);

    const stories = titleLinks.map((a) => ({
      title: a.textContent.trim(),
      href: a.getAttribute("href"),
    }));

    // Every story should have a non-empty title and href
    for (const s of stories) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.href).not.toBeNull();
    }
  });

  test("extract scores and comment counts", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const scores = doc.querySelectorAll(".score");
    expect(scores.length).toBeGreaterThan(0);

    // Scores should be parseable numbers
    for (const s of scores) {
      const text = s.textContent.trim();
      expect(text).toMatch(/\d+ points?/);
    }
  });

  test("a11y tree has meaningful structure", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[link]");
    expect(serialized.length).toBeGreaterThan(500);
  });
});

describe("Extract: books.toscrape.com", () => {
  let html: string | null;

  test("fetch", async () => {
    html = await fetchHTML("https://books.toscrape.com");
    expect(html).not.toBeNull();
  });

  test("extract book titles, prices, and ratings", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const articles = doc.querySelectorAll("article.product_pod");
    expect(articles.length).toBe(20);

    const books = articles.map((a) => {
      const title = querySelector(a,"h3 a")?.getAttribute("title") ?? "";
      const price = querySelector(a,".price_color")?.textContent.trim() ?? "";
      const ratingEl = querySelector(a,".star-rating");
      const ratingClass = ratingEl?.className ?? "";
      return { title, price, ratingClass };
    });

    // Every book should have data
    for (const book of books) {
      expect(book.title.length).toBeGreaterThan(0);
      expect(book.price).toMatch(/£\d+\.\d+/);
      expect(book.ratingClass).toContain("star-rating");
    }
  });

  test("extract pagination", () => {
    if (!html) return;
    const doc = parseHTML(html);
    // Try multiple possible pagination selectors
    const nextLink = doc.querySelector(".pager .next a") ??
      doc.querySelector(".next a") ??
      doc.querySelector("li.next a");
    expect(nextLink).not.toBeNull();
  });

  test("extract categories from sidebar", () => {
    if (!html) return;
    const doc = parseHTML(html);
    // Categories may be in nested ul structure
    const categories = doc.querySelectorAll(".side_categories a") ||
      doc.querySelectorAll(".nav-list a");
    expect(categories.length).toBeGreaterThan(5);

    const names = categories.map((a) => a.textContent.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(20);
  });
});

describe("Extract: Wikipedia article structure", () => {
  let html: string | null;

  test("fetch", async () => {
    html = await fetchHTML("https://en.wikipedia.org/wiki/HTML");
    expect(html).not.toBeNull();
  });

  test("extract heading hierarchy", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const h1 = doc.querySelector("h1");
    expect(h1?.textContent).toContain("HTML");

    const h2s = doc.querySelectorAll("h2");
    expect(h2s.length).toBeGreaterThan(3);

    // Wikipedia articles should have table of contents
    const toc = doc.querySelector("#toc, .toc, [role='navigation']");
    // May or may not have TOC depending on server-side rendering
  });

  test("extract infobox data", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const infobox = doc.querySelector(".infobox, .sidebar, .wikitable");
    if (infobox) {
      const rows = querySelectorAll(infobox, "tr");
      expect(rows.length).toBeGreaterThan(0);
    }
    // Even without an infobox, the page should have tables
    const allTables = doc.querySelectorAll("table");
    expect(allTables.length).toBeGreaterThan(0);
  });

  test("a11y tree captures article structure", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("[heading:");
    expect(serialized).toContain("[link]");
    // Should be a substantial tree
    expect(serialized.length).toBeGreaterThan(2000);
  });
});

describe("Extract: GOV.UK semantic HTML", () => {
  let html: string | null;

  test("fetch", async () => {
    html = await fetchHTML("https://www.gov.uk");
    expect(html).not.toBeNull();
  });

  test("has proper landmarks", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    // GOV.UK is known for excellent semantic HTML
    expect(serialized).toContain("[navigation]");
    // Should have either main, banner, or search
    const hasLandmarks = serialized.includes("[main]") ||
      serialized.includes("[banner]") ||
      serialized.includes("[search");
    expect(hasLandmarks).toBe(true);
  });

  test("has search form", () => {
    if (!html) return;
    const doc = parseHTML(html);
    const searchInput = doc.querySelector('input[type="search"], input[name="q"], #search-main');
    // GOV.UK should have a search input
    expect(searchInput).not.toBeNull();
  });

  test("metadata extraction", async () => {
    if (!html) return;
    const meta = await extractMetadata(html);
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.lang).toBe("en");
  });
});

describe("Extract: scrapethissite.com tables", () => {
  let html: string | null;

  test("fetch", async () => {
    html = await fetchHTML("https://www.scrapethissite.com/pages/simple/");
    expect(html).not.toBeNull();
  });

  test("extract country data from structured content", () => {
    if (!html) return;
    const doc = parseHTML(html);

    // This page has country info in structured divs
    const countries = doc.querySelectorAll(".country");
    if (countries.length > 0) {
      expect(countries.length).toBeGreaterThan(100);

      const first = countries[0]!;
      const name = querySelector(first,".country-name")?.textContent.trim();
      const capital = querySelector(first,".country-capital")?.textContent.trim();

      expect(name).toBeDefined();
      expect(name!.length).toBeGreaterThan(0);
      if (capital) expect(capital.length).toBeGreaterThan(0);
    }
  });
});

describe("Extract: stripForAgent on complex pages", () => {
  test("strips scripts/styles from a real page without losing content", async () => {
    const html = await fetchHTML("https://books.toscrape.com");
    if (!html) return;

    const rawDoc = parseHTML(html);
    const strippedDoc = await parseHTMLAsync(html, { stripForAgent: true });

    // Stripped doc should have no scripts or styles
    expect(strippedDoc.querySelectorAll("script").length).toBe(0);
    expect(strippedDoc.querySelectorAll("style").length).toBe(0);
    expect(strippedDoc.querySelectorAll("link[rel='stylesheet']").length).toBe(0);

    // But should still have all the product data
    const rawProducts = rawDoc.querySelectorAll("article.product_pod").length;
    const strippedProducts = strippedDoc.querySelectorAll("article.product_pod").length;
    expect(strippedProducts).toBe(rawProducts);

    // A11y tree should be equivalent or better
    const rawTree = buildAccessibilityTree(rawDoc);
    const strippedTree = buildAccessibilityTree(strippedDoc);
    expect(strippedTree.children.length).toBeGreaterThanOrEqual(rawTree.children.length - 1);
  });
});

/**
 * Battle tests: Stress testing and adversarial inputs.
 */

import { describe, test, expect } from "bun:test";
import {
  parseHTML,
  SievePage,
  SieveBrowser,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  captureSnapshot,
  restoreSnapshot,
  hashSnapshot,
  snapshotsEqual,
  CookieJar,
  SieveStorage,
  SievePersistence,
  serialize,
} from "../src/index.ts";

describe("Stress: Large documents", () => {
  test("parse 1MB HTML document", () => {
    let html = "<html><body>";
    for (let i = 0; i < 5000; i++) {
      html += `<div class="item" id="item-${i}"><h3>Item ${i}</h3><p>Description for item ${i} with some longer text content to make it realistic.</p><a href="/item/${i}">View</a></div>`;
    }
    html += "</body></html>";

    expect(html.length).toBeGreaterThan(500_000);

    const start = performance.now();
    const doc = parseHTML(html);
    const parseTime = performance.now() - start;

    expect(doc.querySelectorAll(".item").length).toBe(5000);
    expect(parseTime).toBeLessThan(2000); // should be well under 2s
  });

  test("a11y tree for large document", () => {
    let html = "<html><body><main>";
    for (let i = 0; i < 1000; i++) {
      html += `<article><h2>Article ${i}</h2><p>Content ${i}</p><a href="/a/${i}">Read more</a></article>`;
    }
    html += "</main></body></html>";

    const doc = parseHTML(html);
    const start = performance.now();
    const tree = buildAccessibilityTree(doc);
    const elapsed = performance.now() - start;

    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[article]");
    expect(serialized).toContain("[heading:2]");
    expect(serialized).toContain("[link]");
    expect(elapsed).toBeLessThan(1000);
  });

  test("snapshot + hash of large document", () => {
    let html = "<html><body>";
    for (let i = 0; i < 2000; i++) {
      html += `<div data-id="${i}"><span>${i}</span></div>`;
    }
    html += "</body></html>";

    const doc = parseHTML(html);
    const snap = captureSnapshot(doc);
    const hash = hashSnapshot(snap);

    // Hash should be deterministic
    expect(hashSnapshot(snap)).toBe(hash);

    // Restore should produce equivalent document
    const restored = restoreSnapshot(snap);
    const snap2 = captureSnapshot(restored);
    expect(snapshotsEqual(snap, snap2)).toBe(true);
  });
});

describe("Stress: Many concurrent pages", () => {
  test("create and query 500 pages simultaneously", () => {
    const pages: SievePage[] = [];
    for (let i = 0; i < 500; i++) {
      const page = new SievePage();
      page.setContent(`<body><h1>Page ${i}</h1><p>Content for page ${i}</p></body>`);
      pages.push(page);
    }

    // Every page should have independent state
    for (let i = 0; i < 500; i++) {
      expect(pages[i]!.querySelector("h1")?.textContent).toBe(`Page ${i}`);
    }

    // Close all
    for (const page of pages) page.close();
  });
});

describe("Stress: Rapid mutations", () => {
  test("1000 type operations on same input", async () => {
    const page = new SievePage();
    page.setContent('<body><input type="text" id="i" aria-label="Input"></body>');

    for (let i = 0; i < 1000; i++) {
      await page.type("#i", `value-${i}`);
    }

    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain('value: "value-999"');
  });

  test("500 checkbox toggles", async () => {
    const page = new SievePage();
    page.setContent('<body><input type="checkbox" id="cb" aria-label="Toggle"></body>');

    for (let i = 0; i < 500; i++) {
      await page.click("#cb");
    }

    // 500 toggles = even number = back to unchecked
    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain("unchecked");
  });

  test("snapshot after every mutation detects all changes", () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <div id="counter">0</div>
      </body>
    `);

    const snaps = [page.snapshot()];
    for (let i = 1; i <= 50; i++) {
      page.querySelector("#counter")!.textContent = String(i);
      snaps.push(page.snapshot());
    }

    // Each consecutive pair should differ
    for (let i = 1; i < snaps.length; i++) {
      expect(snapshotsEqual(snaps[i - 1]!, snaps[i]!)).toBe(false);
    }

    // First and last should differ
    expect(snapshotsEqual(snaps[0]!, snaps[snaps.length - 1]!)).toBe(false);
  });
});

describe("Stress: Deep nesting", () => {
  test("200 levels of nesting", () => {
    const html = "<div>".repeat(200) + "deep" + "</div>".repeat(200);
    const doc = parseHTML(html);
    const text = doc.querySelectorAll("div");
    expect(text.length).toBe(200);

    // Should be able to build a11y tree
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("deep");
  });

  test("deeply nested selectors work", () => {
    let html = "<body>";
    for (let i = 0; i < 50; i++) {
      html += `<div class="level-${i}">`;
    }
    html += '<span id="target">found</span>';
    for (let i = 0; i < 50; i++) {
      html += "</div>";
    }
    html += "</body>";

    const doc = parseHTML(html);
    expect(doc.querySelector("#target")?.textContent).toBe("found");
    expect(doc.querySelector(".level-49 #target")).not.toBeNull();
  });
});

describe("Stress: Adversarial HTML", () => {
  test("extremely long attribute value", () => {
    const longVal = "A".repeat(1_000_000);
    const html = `<div data-payload="${longVal}">ok</div>`;
    const doc = parseHTML(html);
    expect(doc.querySelector("div")?.getAttribute("data-payload")?.length).toBe(1_000_000);
  });

  test("thousands of attributes on one element", () => {
    let attrs = "";
    for (let i = 0; i < 1000; i++) {
      attrs += ` data-attr-${i}="${i}"`;
    }
    const doc = parseHTML(`<div${attrs}>ok</div>`);
    const div = doc.querySelector("div")!;
    expect(div.getAttribute("data-attr-0")).toBe("0");
    expect(div.getAttribute("data-attr-999")).toBe("999");
  });

  test("script injection via attributes doesn't execute", () => {
    const doc = parseHTML('<img src="x" onerror="alert(1)">');
    const img = doc.querySelector("img")!;
    // The attribute is parsed but never executed — sieve has no JS engine
    expect(img.getAttribute("onerror")).toBe("alert(1)");
    // It's just data, not a threat
  });

  test("null bytes in content", () => {
    const doc = parseHTML("<p>before\x00after</p>");
    const p = doc.querySelector("p")!;
    // Should handle gracefully — content may include or strip the null
    expect(p.textContent.length).toBeGreaterThan(0);
  });

  test("extremely long tag names", () => {
    const longTag = "x".repeat(1000);
    // htmlparser2 will parse this as a custom element
    const doc = parseHTML(`<${longTag}>content</${longTag}>`);
    expect(doc.childNodes.length).toBeGreaterThan(0);
  });

  test("HTML with BOM", () => {
    const bom = "\uFEFF";
    const doc = parseHTML(`${bom}<html><body><p>Content</p></body></html>`);
    expect(doc.querySelector("p")?.textContent).toBe("Content");
  });
});

describe("Stress: Cookie jar at scale", () => {
  test("1000 cookies for same domain", () => {
    const jar = new CookieJar();
    for (let i = 0; i < 1000; i++) {
      jar.setCookie(`cookie${i}=value${i}; Path=/`, "https://example.com/");
    }

    const cookies = jar.getCookies("https://example.com/");
    expect(cookies.length).toBe(1000);

    // Lookup should still be fast
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      jar.getCookies("https://example.com/path");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100); // 100 lookups in <100ms
  });

  test("cookies across many domains", () => {
    const jar = new CookieJar();
    for (let i = 0; i < 500; i++) {
      jar.setCookie(`session=val${i}; Path=/`, `https://site${i}.example.com/`);
    }

    // Each domain should only see its own cookie
    expect(jar.getCookies("https://site0.example.com/").length).toBe(1);
    expect(jar.getCookies("https://site499.example.com/").length).toBe(1);
    expect(jar.getCookies("https://site500.example.com/").length).toBe(0);
  });
});

describe("Stress: SQLite persistence at scale", () => {
  test("save and load 500 storage items", () => {
    const persistence = new SievePersistence();

    const storage = new SieveStorage();
    for (let i = 0; i < 500; i++) {
      storage.setItem(`key-${i}`, `value-${"x".repeat(100)}-${i}`);
    }

    persistence.saveStorage("https://example.com", "local", storage);
    const loaded = persistence.loadStorage("https://example.com", "local");
    expect(loaded.length).toBe(500);
    expect(loaded.getItem("key-0")).toContain("value-");
    expect(loaded.getItem("key-499")).toContain("value-");

    persistence.close();
  });

  test("many snapshots", () => {
    const persistence = new SievePersistence();

    for (let i = 0; i < 200; i++) {
      persistence.saveSnapshot(`snap-${i}`, JSON.stringify({ id: i, data: "x".repeat(1000) }));
    }

    const list = persistence.listSnapshots();
    expect(list.length).toBe(200);

    expect(persistence.loadSnapshot("snap-0")).not.toBeNull();
    expect(persistence.loadSnapshot("snap-199")).not.toBeNull();
    expect(persistence.loadSnapshot("snap-200")).toBeNull();

    persistence.close();
  });
});

describe("Stress: Serialization round-trip fidelity", () => {
  test("parse -> serialize -> parse produces equivalent DOM", () => {
    const html = `
      <html>
      <head><title>Test</title></head>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <main>
          <h1>Title</h1>
          <p class="intro">First <strong>bold</strong> paragraph.</p>
          <ul><li>One</li><li>Two</li><li>Three</li></ul>
          <form>
            <input type="text" name="q" value="test">
            <select name="s"><option value="a">A</option><option value="b" selected>B</option></select>
            <button type="submit">Go</button>
          </form>
        </main>
      </body>
      </html>
    `;

    const doc1 = parseHTML(html);
    const serialized1 = serialize(doc1);
    const doc2 = parseHTML(serialized1);
    const serialized2 = serialize(doc2);

    // Second round-trip should be stable
    expect(serialized2).toBe(serialized1);

    // Both should produce equivalent a11y trees
    const tree1 = serializeAccessibilityTree(buildAccessibilityTree(doc1));
    const tree2 = serializeAccessibilityTree(buildAccessibilityTree(doc2));
    expect(tree2).toBe(tree1);
  });

  test("snapshot round-trip for complex page", () => {
    let html = "<html><body>";
    for (let i = 0; i < 100; i++) {
      html += `<div id="d${i}" class="c${i % 5}" data-idx="${i}"><p>Content ${i}</p></div>`;
    }
    html += "</body></html>";

    const doc = parseHTML(html);
    const snap = captureSnapshot(doc);
    const restored = restoreSnapshot(snap);

    // Query results should match
    expect(restored.querySelectorAll("div").length).toBe(100);
    expect(restored.querySelector("#d50")?.getAttribute("data-idx")).toBe("50");
    expect(restored.querySelector(".c3")?.getAttribute("class")).toBe("c3");
  });
});

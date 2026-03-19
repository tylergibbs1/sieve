import { describe, test, expect } from "bun:test";
import { parseHTML, querySelector, querySelectorAll, matchesSelector } from "../src/index.ts";

const doc = parseHTML(`
  <html>
  <body>
    <nav id="main-nav" class="navbar primary">
      <a href="/" class="link active">Home</a>
      <a href="/about" class="link">About</a>
      <a href="/contact" class="link">Contact</a>
    </nav>
    <main>
      <h1>Welcome</h1>
      <div class="content">
        <p class="intro">First paragraph</p>
        <p>Second paragraph</p>
        <ul>
          <li class="item">One</li>
          <li class="item special">Two</li>
          <li class="item">Three</li>
        </ul>
      </div>
      <form>
        <input type="text" name="query" placeholder="Search">
        <input type="checkbox" name="agree" checked>
        <input type="hidden" name="token" value="abc">
        <select name="color">
          <option value="red">Red</option>
          <option value="blue" selected>Blue</option>
        </select>
        <button type="submit" disabled>Go</button>
      </form>
    </main>
    <footer>
      <p>Footer text</p>
    </footer>
  </body>
  </html>
`);

describe("CSS selector matching", () => {
  test("tag selector", () => {
    expect(querySelectorAll(doc, "li").length).toBe(3);
  });

  test("id selector", () => {
    const el = querySelector(doc, "#main-nav");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("nav");
  });

  test("class selector", () => {
    expect(querySelectorAll(doc, ".link").length).toBe(3);
    expect(querySelectorAll(doc, ".item.special").length).toBe(1);
  });

  test("attribute selectors", () => {
    expect(querySelector(doc, '[name="query"]')?.tagName).toBe("input");
    expect(querySelector(doc, '[href^="/"]')?.textContent).toBe("Home");
    expect(querySelector(doc, '[href$="out"]')?.textContent).toBe("About");
    expect(querySelector(doc, '[class*="pri"]')?.id).toBe("main-nav");
    expect(querySelector(doc, "[checked]")?.getAttribute("name")).toBe("agree");
  });

  test("descendant combinator", () => {
    expect(querySelectorAll(doc, "main p").length).toBe(2);
    expect(querySelectorAll(doc, "nav a").length).toBe(3);
  });

  test("child combinator", () => {
    expect(querySelectorAll(doc, "main > h1").length).toBe(1);
    expect(querySelectorAll(doc, "main > p").length).toBe(0); // p is inside .content
  });

  test("adjacent sibling combinator", () => {
    const el = querySelector(doc, "h1 + div");
    expect(el).not.toBeNull();
    expect(el!.className).toBe("content");
  });

  test("general sibling combinator", () => {
    const items = querySelectorAll(doc, ".intro ~ p");
    expect(items.length).toBe(1);
  });

  test(":first-child and :last-child", () => {
    const first = querySelector(doc, "li:first-child");
    expect(first?.textContent).toBe("One");

    const last = querySelector(doc, "li:last-child");
    expect(last?.textContent).toBe("Three");
  });

  test(":nth-child", () => {
    const second = querySelector(doc, "li:nth-child(2)");
    expect(second?.textContent).toBe("Two");

    const odd = querySelectorAll(doc, "li:nth-child(odd)");
    expect(odd.length).toBe(2); // 1st and 3rd
  });

  test(":not", () => {
    const items = querySelectorAll(doc, "li:not(.special)");
    expect(items.length).toBe(2);
  });

  test(":checked", () => {
    const el = querySelector(doc, ":checked");
    expect(el?.getAttribute("name")).toBe("agree");
  });

  test(":disabled", () => {
    const el = querySelector(doc, ":disabled");
    expect(el?.tagName).toBe("button");
  });

  test(":empty", () => {
    const inputs = querySelectorAll(doc, "input:empty");
    expect(inputs.length).toBeGreaterThan(0);
  });

  test("comma-separated selectors", () => {
    const els = querySelectorAll(doc, "h1, footer p");
    expect(els.length).toBe(2);
  });

  test("matchesSelector", () => {
    const nav = querySelector(doc, "#main-nav")!;
    expect(matchesSelector(nav, "nav.navbar")).toBe(true);
    expect(matchesSelector(nav, "div")).toBe(false);
  });
});

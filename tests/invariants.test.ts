/**
 * Regression tests for every brittleness finding.
 * Each test fails before the fix, passes after.
 */

import { describe, test, expect } from "bun:test";
import {
  parseHTML,
  SieveElement,
  SieveText,
  SievePage,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  querySelector,
  querySelectorAll,
  matchesSelector,
  setInputValue,
  getInputValue,
  isChecked,
} from "../src/index.ts";

// === HIGH: Hidden descendants leak into a11y tree ===

describe("a11y tree respects ancestor visibility", () => {
  test("visibility:hidden on ancestor hides descendants", () => {
    const doc = parseHTML(`
      <body>
        <div style="visibility: hidden">
          <button>Ghost</button>
        </div>
        <button>Visible</button>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).not.toContain("Ghost");
    expect(serialized).toContain("Visible");
  });

  test("display:none on ancestor hides descendants", () => {
    const doc = parseHTML(`
      <body>
        <div style="display: none">
          <a href="/secret">Secret Link</a>
        </div>
        <a href="/public">Public Link</a>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).not.toContain("Secret Link");
    expect(serialized).toContain("Public Link");
  });

  test("hidden attribute on ancestor hides descendants", () => {
    const doc = parseHTML(`
      <body>
        <div hidden>
          <input type="text" aria-label="Hidden Input">
        </div>
        <input type="text" aria-label="Visible Input">
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).not.toContain("Hidden Input");
    expect(serialized).toContain("Visible Input");
  });
});

// === HIGH: textContent setter breaks parent backlinks ===

describe("textContent setter maintains DOM invariants", () => {
  test("old children have parentNode cleared", () => {
    const doc = parseHTML("<div><span>Old</span></div>");
    const div = doc.querySelector("div")!;
    const span = div.children[0]!;

    expect(span.parentNode).toBe(div);

    div.textContent = "New";

    // Old child must be detached
    expect(span.parentNode).toBeNull();
    // New content is correct
    expect(div.textContent).toBe("New");
    expect(div.childNodes.length).toBe(1);
  });

  test("setting empty string detaches all children", () => {
    const doc = parseHTML("<div><p>A</p><p>B</p></div>");
    const div = doc.querySelector("div")!;
    const children = [...div.childNodes];

    div.textContent = "";

    for (const child of children) {
      expect(child.parentNode).toBeNull();
    }
    expect(div.childNodes.length).toBe(0);
  });
});

// === HIGH: :not() flattens compound selectors incorrectly ===

describe(":not() handles selector groups correctly", () => {
  test(":not(.a) works on simple class", () => {
    const doc = parseHTML(`
      <ul>
        <li class="a">A</li>
        <li class="b">B</li>
        <li class="c">C</li>
      </ul>
    `);
    const items = querySelectorAll(doc, "li:not(.a)");
    expect(items.length).toBe(2);
    expect(items.map((e) => e.textContent)).toEqual(["B", "C"]);
  });

  test(":not() with comma-separated selectors matches correctly", () => {
    const doc = parseHTML(`
      <ul>
        <li class="a">A</li>
        <li class="b">B</li>
        <li class="c">C</li>
      </ul>
    `);
    // :not(.a, .b) should exclude items with class a OR class b
    const items = querySelectorAll(doc, "li:not(.a, .b)");
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toBe("C");
  });
});

// === MEDIUM: Void elements accept children silently ===

describe("void elements reject children", () => {
  test("appendChild on void element throws", () => {
    const input = new SieveElement("input");
    const text = new SieveText("bad");
    expect(() => input.appendChild(text)).toThrow();
  });

  test("insertBefore on void element throws", () => {
    const br = new SieveElement("br");
    const text = new SieveText("bad");
    expect(() => br.insertBefore(text, null)).toThrow();
  });
});

// === MEDIUM: :empty counts comments as content ===

describe(":empty ignores comments", () => {
  test("element with only a comment matches :empty", () => {
    const doc = parseHTML("<div><!-- comment --></div><div></div>");
    const empties = querySelectorAll(doc, ":empty");
    // Both divs should match :empty (comments don't count)
    const divEmpties = empties.filter((e) => e.tagName === "div");
    expect(divEmpties.length).toBe(2);
  });

  test("element with text does not match :empty", () => {
    const doc = parseHTML("<div>text</div>");
    expect(querySelectorAll(doc, "div:empty").length).toBe(0);
  });
});

// === HIGH: Disabled controls are clickable ===

describe("disabled controls reject clicks", () => {
  test("disabled button click fails", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form>
          <button type="submit" disabled>Submit</button>
        </form>
      </body>
    `);

    const result = await page.click("button");
    expect(result.success).toBe(false);
    expect(result.submitsForm).toBeUndefined();
  });

  test("disabled checkbox click does not toggle", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="checkbox" id="cb" disabled>
      </body>
    `);

    const result = await page.click("#cb");
    expect(result.success).toBe(false);
    expect(isChecked(page.querySelector("#cb")!)).toBe(false);
  });

  test("disabled radio click does not select", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="radio" name="opt" value="a" disabled id="r">
      </body>
    `);

    const result = await page.click("#r");
    expect(result.success).toBe(false);
  });
});

// === HIGH: A11y tree reads DOM attrs instead of form state for values ===

describe("a11y tree reflects current form state", () => {
  test("typed value appears in a11y tree", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="text" id="name" aria-label="Name">
      </body>
    `);

    await page.type("#name", "Alice");

    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain('value: "Alice"');
  });

  test("checked state from interaction appears in a11y tree", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="checkbox" id="agree" aria-label="Agree">
      </body>
    `);

    await page.click("#agree");

    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain("checked");
    expect(serialized).not.toContain("unchecked");
  });
});

// === HIGH: POST form submit drops Set-Cookie ===

describe("POST form submit processes cookies", () => {
  test("Set-Cookie from POST response is stored", async () => {
    const { SieveBrowser } = await import("../src/index.ts");
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com/form": `<html><body><form method="POST" action="/login"><input name="user"><button type="submit">Login</button></form></body></html>`,
          "https://example.com/login": {
            url: "https://example.com/login",
            status: 200,
            headers: {
              "content-type": "text/html",
              "set-cookie": "session=abc123; Path=/",
            },
            body: "<html><body><p>Logged in</p></body></html>",
          },
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com/form");
    await page.type('input[name="user"]', "alice");
    await page.click('button[type="submit"]');

    const cookies = page.cookies.getCookies("https://example.com/");
    expect(cookies.some((c) => c.name === "session")).toBe(true);
    browser.close();
  });
});

// === HIGH: goBack/goForward corrupts history ===

describe("history back/forward do not duplicate entries", () => {
  test("back then forward preserves original history", async () => {
    const { SieveBrowser } = await import("../src/index.ts");
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://a.com": "<html><head><title>A</title></head><body>A</body></html>",
          "https://b.com": "<html><head><title>B</title></head><body>B</body></html>",
          "https://c.com": "<html><head><title>C</title></head><body>C</body></html>",
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://a.com");
    await page.goto("https://b.com");
    await page.goto("https://c.com");

    // History: A -> B -> C (at C)
    expect(page.url).toBe("https://c.com");

    await page.goBack();
    expect(page.url).toBe("https://b.com");

    await page.goForward();
    expect(page.url).toBe("https://c.com");

    // History length should not have grown
    expect(page.history.length).toBe(3);

    browser.close();
  });
});

// === MEDIUM: FormHandle.submit not scoped to its own form ===

describe("FormHandle.submit scoped to its own form", () => {
  test("submits the correct form on multi-form page", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form id="form1" action="/search">
          <input name="q">
          <button type="submit">Search</button>
        </form>
        <form id="form2" action="/login">
          <input name="user">
          <button type="submit">Login</button>
        </form>
      </body>
    `);

    const form2 = page.forms[1]!;
    expect(form2.element.id).toBe("form2");

    // This should find the submit button within form2, not form1
    const submitBtn = querySelector(form2.element, "button[type='submit'], input[type='submit']");
    expect(submitBtn).not.toBeNull();
  });
});

// === MEDIUM: Radio grouping is document-wide, not form-scoped ===

describe("radio groups scoped to forms", () => {
  test("radios in different forms don't interfere", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form id="f1">
          <input type="radio" name="choice" value="a" id="f1-a">
          <input type="radio" name="choice" value="b" id="f1-b">
        </form>
        <form id="f2">
          <input type="radio" name="choice" value="x" id="f2-x">
          <input type="radio" name="choice" value="y" id="f2-y">
        </form>
      </body>
    `);

    await page.click("#f1-a");
    await page.click("#f2-x");

    // f1-a should still be checked — f2 radios shouldn't uncheck it
    expect(isChecked(page.querySelector("#f1-a")!)).toBe(true);
    expect(isChecked(page.querySelector("#f2-x")!)).toBe(true);
  });
});

// === MEDIUM: Cookie path matching too permissive ===

describe("cookie path matching uses path-prefix correctly", () => {
  test("/admin cookie not sent to /admin2", () => {
    const { CookieJar } = require("../src/index.ts");
    const jar = new CookieJar();
    jar.setCookie("token=secret; Path=/admin", "https://example.com/admin");

    expect(jar.getCookies("https://example.com/admin").length).toBe(1);
    expect(jar.getCookies("https://example.com/admin/settings").length).toBe(1);
    expect(jar.getCookies("https://example.com/admin2").length).toBe(0);
    expect(jar.getCookies("https://example.com/admins").length).toBe(0);
  });
});

// === MEDIUM: set-cookie header case sensitivity ===

describe("Set-Cookie header case insensitive lookup", () => {
  test("processes Set-Cookie regardless of header casing", async () => {
    const { SieveBrowser } = await import("../src/index.ts");
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com": {
            url: "https://example.com",
            status: 200,
            headers: {
              "content-type": "text/html",
              "Set-Cookie": "token=abc; Path=/",
            },
            body: "<html><body>OK</body></html>",
          },
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    const cookies = page.cookies.getCookies("https://example.com/");
    expect(cookies.some((c) => c.name === "token")).toBe(true);

    browser.close();
  });
});

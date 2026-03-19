/**
 * Edge cases: HTML parsing and DOM manipulation.
 */

import { describe, test, expect } from "bun:test";
import { parseHTML, serialize, SieveElement, SieveText, SieveComment } from "../src/index.ts";

describe("Malformed HTML parsing", () => {
  test("unclosed tags don't crash", () => {
    const doc = parseHTML("<div><p>unclosed");
    expect(doc.querySelector("div")).not.toBeNull();
    expect(doc.querySelector("p")?.textContent).toBe("unclosed");
  });

  test("mismatched closing tags", () => {
    const doc = parseHTML("<div><span>text</div></span>");
    expect(doc.querySelector("div")).not.toBeNull();
    expect(doc.querySelector("span")).not.toBeNull();
  });

  test("self-closing non-void elements", () => {
    const doc = parseHTML("<div/><p>after</p>");
    expect(doc.querySelector("p")?.textContent).toBe("after");
  });

  test("deeply nested malformed markup", () => {
    // 100 unclosed divs
    const html = "<div>".repeat(100) + "deep" + "</div>".repeat(50);
    const doc = parseHTML(html);
    expect(doc.querySelectorAll("div").length).toBeGreaterThan(0);
  });

  test("multiple consecutive closing tags without openers", () => {
    const doc = parseHTML("<div>content</div></div></div></div>");
    expect(doc.querySelector("div")?.textContent).toBe("content");
  });

  test("nested forms (invalid HTML but common)", () => {
    const doc = parseHTML(`
      <form id="outer">
        <form id="inner">
          <input name="field">
        </form>
      </form>
    `);
    // Browser behavior: inner form is ignored but inputs remain
    const inputs = doc.querySelectorAll("input");
    expect(inputs.length).toBe(1);
  });

  test("empty document", () => {
    const doc = parseHTML("");
    expect(doc.childNodes.length).toBe(0);
    expect(doc.body).toBeNull();
    expect(doc.title).toBe("");
  });

  test("only whitespace", () => {
    const doc = parseHTML("   \n\t  ");
    expect(doc.title).toBe("");
  });

  test("only comments", () => {
    const doc = parseHTML("<!-- comment 1 --><!-- comment 2 -->");
    expect(doc.childNodes.length).toBe(2);
  });

  test("script tags with < and > in content", () => {
    const doc = parseHTML("<div><script>if (a < b && c > d) {}</script><p>after</p></div>");
    expect(doc.querySelector("p")?.textContent).toBe("after");
  });

  test("textarea with HTML-looking content", () => {
    const doc = parseHTML('<textarea><p>not a paragraph</p></textarea>');
    const ta = doc.querySelector("textarea")!;
    expect(ta.textContent).toContain("<p>");
  });
});

describe("HTML entity edge cases", () => {
  test("numeric entities", () => {
    const doc = parseHTML("<p>&#65;&#66;&#67;</p>");
    expect(doc.querySelector("p")!.textContent).toBe("ABC");
  });

  test("hex entities", () => {
    const doc = parseHTML("<p>&#x41;&#x42;&#x43;</p>");
    expect(doc.querySelector("p")!.textContent).toBe("ABC");
  });

  test("encoded tags in text", () => {
    const doc = parseHTML("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(doc.querySelector("p")!.textContent).toBe("<script>alert(1)</script>");
    // Should NOT create a script element
    expect(doc.querySelector("script")).toBeNull();
  });

  test("unicode content", () => {
    const doc = parseHTML("<p>日本語テスト 🎉 Ñoño</p>");
    expect(doc.querySelector("p")!.textContent).toBe("日本語テスト 🎉 Ñoño");
  });
});

describe("Attribute edge cases", () => {
  test("empty attribute values", () => {
    const doc = parseHTML('<input value="" disabled>');
    const input = doc.querySelector("input")!;
    expect(input.getAttribute("value")).toBe("");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  test("boolean attributes without values", () => {
    const doc = parseHTML("<input required checked readonly disabled>");
    const input = doc.querySelector("input")!;
    expect(input.hasAttribute("required")).toBe(true);
    expect(input.hasAttribute("checked")).toBe(true);
    expect(input.hasAttribute("readonly")).toBe(true);
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  test("data attributes", () => {
    const doc = parseHTML('<div data-id="42" data-complex=\'{"key":"val"}\'></div>');
    const div = doc.querySelector("div")!;
    expect(div.getAttribute("data-id")).toBe("42");
    expect(div.getAttribute("data-complex")).toBe('{"key":"val"}');
  });

  test("attribute case insensitivity", () => {
    const doc = parseHTML('<DIV CLASS="test" ID="main">content</DIV>');
    expect(doc.querySelector("#main")).not.toBeNull();
    expect(doc.querySelector(".test")).not.toBeNull();
  });

  test("very long attribute value", () => {
    const longVal = "x".repeat(10_000);
    const doc = parseHTML(`<div data-big="${longVal}">ok</div>`);
    expect(doc.querySelector("div")!.getAttribute("data-big")!.length).toBe(10_000);
  });
});

describe("Serialization round-trip edge cases", () => {
  test("preserves comments", () => {
    const html = "<!-- comment --><div>text</div>";
    const doc = parseHTML(html);
    const output = serialize(doc);
    expect(output).toContain("<!-- comment -->");
  });

  test("preserves doctype", () => {
    const html = "<!DOCTYPE html><html><body></body></html>";
    const doc = parseHTML(html);
    const output = serialize(doc);
    expect(output).toContain("<!DOCTYPE html>");
  });

  test("escapes special characters in text", () => {
    const doc = parseHTML("<p>a &amp; b</p>");
    const output = serialize(doc);
    expect(output).toContain("&amp;");
  });

  test("escapes special characters in attributes", () => {
    const doc = parseHTML('<div title="a &quot; b">text</div>');
    const output = serialize(doc);
    expect(output).toContain('title="a &quot; b"');
  });
});

describe("DOM manipulation edge cases", () => {
  test("reparenting detaches from old parent", () => {
    const doc = parseHTML("<div id='a'><span>child</span></div><div id='b'></div>");
    const span = doc.querySelector("span")!;
    const b = doc.querySelector("#b")!;

    b.appendChild(span);
    expect(doc.querySelector("#a")!.children.length).toBe(0);
    expect(b.children.length).toBe(1);
    expect(span.parentNode).toBe(b);
  });

  test("removeChild on non-child throws", () => {
    const doc = parseHTML("<div><span></span></div><p></p>");
    const div = doc.querySelector("div")!;
    const p = doc.querySelector("p")!;

    expect(() => div.removeChild(p)).toThrow("not a child");
  });

  test("clone deep doesn't share children", () => {
    const doc = parseHTML('<div><span class="inner">text</span></div>');
    const original = doc.querySelector("div")!;
    const clone = original.clone(true);

    clone.querySelector = (sel: string) => {
      for (const el of clone.elementDescendants()) {
        if (el.className === "inner") return el;
      }
      return null;
    };

    // Modifying clone shouldn't affect original
    const cloneSpan = [...clone.elementDescendants()][0]!;
    cloneSpan.className = "modified";
    expect(doc.querySelector(".inner")).not.toBeNull();
  });

  test("insertBefore with null reference appends", () => {
    const doc = parseHTML("<div></div>");
    const div = doc.querySelector("div")!;
    const text = new SieveText("appended");
    div.insertBefore(text, null);
    expect(div.lastChild).toBe(text);
  });
});

import { describe, test, expect } from "bun:test";
import { parseHTML, serialize, SieveElement, SieveText } from "../src/index.ts";

describe("HTML parser", () => {
  test("parses a basic document", () => {
    const doc = parseHTML("<html><head><title>Test</title></head><body><p>Hello</p></body></html>");
    expect(doc.title).toBe("Test");
    expect(doc.body).not.toBeNull();
    expect(doc.querySelector("p")?.textContent).toBe("Hello");
  });

  test("parses void elements correctly", () => {
    const doc = parseHTML('<div><input type="text"><br><img src="x.png"></div>');
    const div = doc.querySelector("div")!;
    expect(div.children.length).toBe(3);
    expect(div.children[0]!.tagName).toBe("input");
    expect(div.children[1]!.tagName).toBe("br");
    expect(div.children[2]!.tagName).toBe("img");
  });

  test("handles nested elements", () => {
    const doc = parseHTML("<div><ul><li>One</li><li>Two</li></ul></div>");
    const items = doc.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toBe("One");
    expect(items[1]!.textContent).toBe("Two");
  });

  test("handles attributes", () => {
    const doc = parseHTML('<a href="/about" class="nav-link" data-id="42">About</a>');
    const a = doc.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/about");
    expect(a.getAttribute("class")).toBe("nav-link");
    expect(a.getAttribute("data-id")).toBe("42");
    expect(a.classList.contains("nav-link")).toBe(true);
  });

  test("decodes HTML entities", () => {
    const doc = parseHTML("<p>A &amp; B &lt; C</p>");
    expect(doc.querySelector("p")!.textContent).toBe("A & B < C");
  });
});

describe("DOM serialization", () => {
  test("round-trips simple HTML", () => {
    const html = '<div class="test"><p>Hello <strong>world</strong></p></div>';
    const doc = parseHTML(html);
    const result = serialize(doc);
    expect(result).toContain('<div class="test">');
    expect(result).toContain("<strong>world</strong>");
  });

  test("serializes void elements without closing tags", () => {
    const doc = parseHTML('<input type="text"><br>');
    const result = serialize(doc);
    expect(result).toContain('<input type="text">');
    expect(result).toContain("<br>");
    expect(result).not.toContain("</input>");
    expect(result).not.toContain("</br>");
  });
});

describe("DOM manipulation", () => {
  test("appendChild and removeChild", () => {
    const doc = parseHTML("<div></div>");
    const div = doc.querySelector("div")!;
    const p = new SieveElement("p");
    p.appendChild(new SieveText("Added"));
    div.appendChild(p);

    expect(div.children.length).toBe(1);
    expect(div.textContent).toBe("Added");

    div.removeChild(p);
    expect(div.children.length).toBe(0);
  });

  test("classList manipulation", () => {
    const el = new SieveElement("div");
    el.className = "a b";
    expect(el.classList.contains("a")).toBe(true);
    expect(el.classList.contains("c")).toBe(false);

    el.classList.add("c");
    expect(el.classList.contains("c")).toBe(true);

    el.classList.remove("b");
    expect(el.classList.contains("b")).toBe(false);

    el.classList.toggle("a");
    expect(el.classList.contains("a")).toBe(false);
  });

  test("deep clone", () => {
    const doc = parseHTML('<div id="root"><p class="child">Text</p></div>');
    const original = doc.querySelector("#root")!;
    const clone = original.clone(true);

    expect(clone.id).toBe("root");
    expect(clone.children.length).toBe(1);
    expect(clone.children[0]!.className).toBe("child");
    expect(clone.textContent).toBe("Text");

    // Verify it's a true clone, not a reference
    clone.setAttribute("id", "cloned");
    expect(original.id).toBe("root");
  });
});

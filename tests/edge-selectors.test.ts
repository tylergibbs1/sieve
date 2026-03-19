/**
 * Edge cases: CSS selector parsing and matching.
 */

import { describe, test, expect } from "bun:test";
import { parseHTML, querySelector, querySelectorAll, matchesSelector } from "../src/index.ts";

const doc = parseHTML(`
  <html>
  <body>
    <div id="root">
      <div class="  spaced  classes  ">spaced</div>
      <div id="a:b" class="special-id">colon in id</div>
      <p class="">empty class</p>
      <div data-val="">empty attr</div>
      <div data-val="hello world">spaced attr</div>
      <ul>
        <li>Only child</li>
      </ul>
      <ol>
        <li>First</li>
        <li>Second</li>
        <li>Third</li>
        <li>Fourth</li>
        <li>Fifth</li>
      </ol>
      <!-- comment -->
      <div class="empty-with-comment"><!-- inner comment --></div>
      <div class="truly-empty"></div>
      <div class="text-only">just text</div>
      <div class="mixed"><span>child</span>and text</div>
    </div>
    <form id="form1">
      <input type="text" name="q" value="" placeholder="search">
      <input type="checkbox" name="a">
      <input type="checkbox" name="b" checked>
      <input type="radio" name="r" value="1">
      <input type="radio" name="r" value="2" checked>
      <select name="s">
        <option value="">-- choose --</option>
        <option value="x" selected>X</option>
        <option value="y" disabled>Y</option>
      </select>
      <button disabled>Disabled</button>
      <button>Enabled</button>
    </form>
  </body>
  </html>
`);

describe("Whitespace in selectors", () => {
  test("extra whitespace around combinators", () => {
    expect(querySelector(doc, "div   >   ul")).not.toBeNull();
    expect(querySelector(doc, "  #root  ")).not.toBeNull();
  });
});

describe("Attribute selector edge cases", () => {
  test("empty attribute value match", () => {
    expect(querySelector(doc, '[data-val=""]')).not.toBeNull();
    expect(querySelector(doc, '[data-val=""]')!.textContent).toContain("empty attr");
  });

  test("attribute with spaces in value", () => {
    expect(querySelector(doc, '[data-val="hello world"]')?.textContent).toContain("spaced attr");
  });

  test("~= (word match) with spaced values", () => {
    expect(querySelector(doc, '[data-val~="hello"]')?.textContent).toContain("spaced attr");
    expect(querySelector(doc, '[data-val~="world"]')?.textContent).toContain("spaced attr");
  });

  test("presence selector on boolean attrs", () => {
    expect(querySelectorAll(doc, "[checked]").length).toBe(2);
    expect(querySelectorAll(doc, "[disabled]").length).toBe(2);
    expect(querySelectorAll(doc, "[selected]").length).toBe(1);
  });
});

describe(":nth-child edge cases", () => {
  test(":nth-child(1) same as :first-child", () => {
    const first = querySelector(doc, "ol > li:nth-child(1)")!;
    const firstChild = querySelector(doc, "ol > li:first-child")!;
    expect(first.textContent).toBe(firstChild.textContent);
  });

  test(":nth-child(even) and (odd)", () => {
    const even = querySelectorAll(doc, "ol > li:nth-child(even)");
    const odd = querySelectorAll(doc, "ol > li:nth-child(odd)");
    expect(even.length).toBe(2);
    expect(odd.length).toBe(3);
  });

  test(":nth-child(3n+1)", () => {
    const items = querySelectorAll(doc, "ol > li:nth-child(3n+1)");
    expect(items.length).toBe(2); // 1st and 4th
    expect(items[0]!.textContent).toBe("First");
    expect(items[1]!.textContent).toBe("Fourth");
  });

  test(":nth-last-child(1) same as :last-child", () => {
    const last = querySelector(doc, "ol > li:nth-last-child(1)")!;
    const lastChild = querySelector(doc, "ol > li:last-child")!;
    expect(last.textContent).toBe(lastChild.textContent);
    expect(last.textContent).toBe("Fifth");
  });

  test(":only-child", () => {
    const only = querySelector(doc, "ul > li:only-child");
    expect(only?.textContent).toBe("Only child");
    // ol items are NOT only-children
    expect(querySelectorAll(doc, "ol > li:only-child").length).toBe(0);
  });
});

describe(":empty edge cases", () => {
  test("div with only comment is :empty", () => {
    expect(matchesSelector(
      querySelector(doc, ".empty-with-comment")!, ":empty"
    )).toBe(true);
  });

  test("truly empty div is :empty", () => {
    expect(matchesSelector(
      querySelector(doc, ".truly-empty")!, ":empty"
    )).toBe(true);
  });

  test("div with text is NOT :empty", () => {
    expect(matchesSelector(
      querySelector(doc, ".text-only")!, ":empty"
    )).toBe(false);
  });

  test("div with child element is NOT :empty", () => {
    expect(matchesSelector(
      querySelector(doc, ".mixed")!, ":empty"
    )).toBe(false);
  });
});

describe(":checked/:disabled/:enabled", () => {
  test(":checked finds checked inputs and selected options", () => {
    const checked = querySelectorAll(doc, ":checked");
    expect(checked.length).toBe(3); // checkbox[checked], radio[checked], option[selected]
  });

  test(":disabled finds disabled elements", () => {
    const disabled = querySelectorAll(doc, "#form1 :disabled");
    expect(disabled.length).toBe(2); // button[disabled] + option[disabled]
  });

  test(":enabled excludes disabled", () => {
    const enabled = querySelectorAll(doc, "#form1 button:enabled");
    expect(enabled.length).toBe(1);
    expect(enabled[0]!.textContent).toBe("Enabled");
  });
});

describe(":not() edge cases", () => {
  test(":not with tag selector", () => {
    const nonLi = querySelectorAll(doc, "ol > :not(li)");
    expect(nonLi.length).toBe(0);
  });

  test(":not with compound class", () => {
    const items = querySelectorAll(doc, "div:not(.truly-empty):not(.empty-with-comment):not(.text-only):not(.mixed)");
    // Should match divs without those specific classes
    expect(items.length).toBeGreaterThan(0);
  });

  test(":not(:first-child)", () => {
    const items = querySelectorAll(doc, "ol > li:not(:first-child)");
    expect(items.length).toBe(4);
    expect(items[0]!.textContent).toBe("Second");
  });

  test(":not(:checked)", () => {
    const unchecked = querySelectorAll(doc, '#form1 input[type="checkbox"]:not(:checked)');
    expect(unchecked.length).toBe(1);
    expect(unchecked[0]!.getAttribute("name")).toBe("a");
  });
});

describe(":root", () => {
  test(":root matches html element", () => {
    const root = querySelector(doc, ":root");
    expect(root?.tagName).toBe("html");
  });
});

describe("Complex combined selectors", () => {
  test("multiple combinators", () => {
    expect(querySelector(doc, "#root > ol > li:first-child")).not.toBeNull();
  });

  test("selector with all parts", () => {
    const el = querySelector(doc, 'form#form1 > input[type="text"][name="q"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute("placeholder")).toBe("search");
  });

  test("universal selector with pseudo", () => {
    const all = querySelectorAll(doc, "#form1 > *:disabled");
    expect(all.length).toBe(1); // button[disabled] only (option is inside select)
  });
});

describe("Invalid/unsupported selectors", () => {
  test("unsupported pseudo-class throws", () => {
    expect(() => querySelector(doc, ":hover")).toThrow();
    expect(() => querySelector(doc, ":focus")).toThrow();
    expect(() => querySelector(doc, "::before")).toThrow();
  });

  test("whitespace-only selector matches like universal", () => {
    // An empty simple selector with no constraints matches any element
    // (equivalent to *). This documents current behavior.
    const result = querySelector(doc, " ");
    expect(result).not.toBeNull();
  });
});

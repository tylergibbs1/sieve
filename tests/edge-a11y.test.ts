/**
 * Edge cases: Accessibility tree building, name computation, and visibility.
 */

import { describe, test, expect } from "bun:test";
import {
  parseHTML,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  SievePage,
  setInputValue,
  setChecked,
  setSelectedValues,
} from "../src/index.ts";

describe("A11y name computation edge cases", () => {
  test("aria-label takes precedence over content", () => {
    const doc = parseHTML('<button aria-label="Close dialog">X</button>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[button] Close dialog");
  });

  test("empty aria-label falls back to text content", () => {
    const doc = parseHTML('<button aria-label="">X</button>');
    const tree = buildAccessibilityTree(doc);
    // Empty aria-label is treated as absent — falls back to textContent
    const btn = tree.children.find((n) => n.role === "button");
    expect(btn?.name).toBe("X");
  });

  test("img with empty alt is presentation", () => {
    const doc = parseHTML('<body><img alt=""><img alt="Logo"></body>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    // alt="" means presentation/decorative — should be hidden or marked
    expect(serialized).toContain("[img] Logo");
  });

  test("input labeled by wrapping label", () => {
    const doc = parseHTML(`
      <body>
        <label>Username <input type="text" name="user"></label>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[textbox] Username");
  });

  test("input labeled by for/id association", () => {
    const doc = parseHTML(`
      <body>
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email">
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[textbox] Email Address");
  });

  test("input with placeholder as fallback name", () => {
    const doc = parseHTML('<body><input type="text" placeholder="Search..."></body>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[textbox] Search...");
  });

  test("fieldset named by legend", () => {
    const doc = parseHTML(`
      <body>
        <fieldset>
          <legend>Personal Info</legend>
          <input type="text" aria-label="Name">
        </fieldset>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[group] Personal Info");
  });

  test("table named by caption", () => {
    const doc = parseHTML(`
      <body>
        <table>
          <caption>Monthly Expenses</caption>
          <tr><th>Item</th><th>Cost</th></tr>
          <tr><td>Rent</td><td>$1000</td></tr>
        </table>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[table] Monthly Expenses");
  });

  test("figure named by figcaption", () => {
    const doc = parseHTML(`
      <body>
        <figure>
          <img alt="Chart">
          <figcaption>Revenue over time</figcaption>
        </figure>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[figure] Revenue over time");
  });
});

describe("A11y visibility edge cases", () => {
  test("visibility:hidden child with visibility:visible grandchild", () => {
    // In real browsers, visibility:visible overrides parent's visibility:hidden
    // But our isVisible() walks up and returns false if any ancestor is hidden
    // This is a known simplification — document it
    const doc = parseHTML(`
      <body>
        <div style="visibility: hidden">
          <div style="visibility: visible">
            <button>I should be visible</button>
          </div>
        </div>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    // Our simplified model hides everything under visibility:hidden ancestors.
    // This is a known limitation — real browsers would show the grandchild.
    // The test documents the current behavior.
    expect(serialized).not.toContain("I should be visible");
  });

  test("display:none hides entire subtree", () => {
    const doc = parseHTML(`
      <body>
        <div style="display: none">
          <nav aria-label="Hidden Nav">
            <a href="/">Link</a>
          </nav>
        </div>
        <p>Visible</p>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).not.toContain("Hidden Nav");
    expect(serialized).not.toContain("[link]");
    expect(serialized).toContain("Visible");
  });

  test("aria-hidden=false does not override aria-hidden=true on ancestor", () => {
    const doc = parseHTML(`
      <body>
        <div aria-hidden="true">
          <button aria-hidden="false">Ghost</button>
        </div>
        <button>Real</button>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    // aria-hidden on an element applies to it and descendants
    // aria-hidden=false on child doesn't override parent
    expect(serialized).not.toContain("Ghost");
    expect(serialized).toContain("Real");
  });

  test("hidden attribute hides entire subtree", () => {
    const doc = parseHTML(`
      <body>
        <section hidden>
          <h2>Hidden Section</h2>
          <p>Hidden content</p>
        </section>
        <section>
          <h2>Visible Section</h2>
        </section>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).not.toContain("Hidden Section");
    expect(serialized).toContain("Visible Section");
  });
});

describe("A11y form state reflection", () => {
  test("typed value reflected in a11y tree", () => {
    const doc = parseHTML('<body><input type="text" id="q" aria-label="Search"></body>');
    const input = doc.querySelector("#q")!;
    setInputValue(input, "sieve virtual browser");

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain('value: "sieve virtual browser"');
  });

  test("checkbox checked via interaction reflected", () => {
    const doc = parseHTML('<body><input type="checkbox" id="cb" aria-label="Agree"></body>');
    const cb = doc.querySelector("#cb")!;
    setChecked(cb, true);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("checked");
  });

  test("select value reflected", () => {
    const doc = parseHTML(`
      <body>
        <select id="s" aria-label="Color">
          <option value="r">Red</option>
          <option value="g">Green</option>
          <option value="b">Blue</option>
        </select>
      </body>
    `);
    const select = doc.querySelector("#s")!;
    setSelectedValues(select, new Set(["g"]));

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain('value: "g"');
  });
});

describe("A11y tree structure edge cases", () => {
  test("document without body", () => {
    const doc = parseHTML("<html><head><title>No Body</title></head></html>");
    const tree = buildAccessibilityTree(doc);
    expect(tree.role).toBe("page");
    expect(tree.name).toBe("No Body");
  });

  test("document with only text content", () => {
    const doc = parseHTML("Just plain text, no tags");
    const tree = buildAccessibilityTree(doc);
    // Should handle gracefully — text may or may not appear
    expect(tree.role).toBe("page");
  });

  test("deeply nested transparent wrappers flatten", () => {
    const doc = parseHTML(`
      <body>
        <div><div><div><div><p>Deep text</p></div></div></div></div>
      </body>
    `);
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    // Should flatten generic divs, text should appear
    expect(serialized).toContain("Deep text");
  });

  test("explicit role overrides implicit", () => {
    const doc = parseHTML('<body><div role="alert">Warning!</div></body>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[alert]");
  });

  test("section without label has no role", () => {
    const doc = parseHTML('<body><section><p>Content</p></section></body>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    // Section without aria-label should not be [region]
    expect(serialized).not.toContain("[region]");
  });

  test("section with aria-label is region", () => {
    const doc = parseHTML('<body><section aria-label="Main Content"><p>Content</p></section></body>');
    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toContain("[region] Main Content");
  });
});

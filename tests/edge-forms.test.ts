/**
 * Edge cases: Form state, validation, serialization, and interactions.
 */

import { describe, test, expect } from "bun:test";
import {
  SievePage,
  parseHTML,
  serializeForm,
  validateForm,
  getInputValue,
  setInputValue,
  isChecked,
  setChecked,
  getSelectedValues,
  setSelectedValues,
} from "../src/index.ts";

describe("Form value edge cases", () => {
  test("input with no value attribute returns empty string", () => {
    const doc = parseHTML('<input type="text" name="q">');
    const input = doc.querySelector("input")!;
    expect(getInputValue(input)).toBe("");
  });

  test("textarea value from textContent", () => {
    const doc = parseHTML("<textarea name='bio'>Hello\nWorld</textarea>");
    const ta = doc.querySelector("textarea")!;
    expect(getInputValue(ta)).toBe("Hello\nWorld");
  });

  test("overwriting value clears previous set", () => {
    const doc = parseHTML('<input type="text" name="q" value="initial">');
    const input = doc.querySelector("input")!;
    expect(getInputValue(input)).toBe("initial");

    setInputValue(input, "updated");
    expect(getInputValue(input)).toBe("updated");

    setInputValue(input, "");
    expect(getInputValue(input)).toBe("");
  });

  test("unicode in input values", () => {
    const doc = parseHTML('<input type="text" name="q">');
    const input = doc.querySelector("input")!;
    setInputValue(input, "日本語 🎉 Ñoño");
    expect(getInputValue(input)).toBe("日本語 🎉 Ñoño");
  });

  test("very long input value", () => {
    const doc = parseHTML('<input type="text" name="q">');
    const input = doc.querySelector("input")!;
    const longVal = "x".repeat(100_000);
    setInputValue(input, longVal);
    expect(getInputValue(input).length).toBe(100_000);
  });
});

describe("Checkbox edge cases", () => {
  test("initially unchecked checkbox", () => {
    const doc = parseHTML('<input type="checkbox" name="a">');
    expect(isChecked(doc.querySelector("input")!)).toBe(false);
  });

  test("initially checked checkbox", () => {
    const doc = parseHTML('<input type="checkbox" name="a" checked>');
    expect(isChecked(doc.querySelector("input")!)).toBe(true);
  });

  test("toggle checked state", () => {
    const doc = parseHTML('<input type="checkbox" name="a">');
    const cb = doc.querySelector("input")!;

    setChecked(cb, true);
    expect(isChecked(cb)).toBe(true);

    setChecked(cb, false);
    expect(isChecked(cb)).toBe(false);
  });

  test("multiple checkboxes same name serialization", () => {
    const doc = parseHTML(`
      <form>
        <input type="checkbox" name="opt" value="a" checked>
        <input type="checkbox" name="opt" value="b">
        <input type="checkbox" name="opt" value="c" checked>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);
    // Only checked ones should appear — but same name produces last value
    // Actually with checkboxes, each checked one adds its value
    expect(data["opt"]).toBeDefined();
  });
});

describe("Select edge cases", () => {
  test("select with no selected option", () => {
    const doc = parseHTML(`
      <form>
        <select name="color">
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>
      </form>
    `);
    const select = doc.querySelector("select")!;
    const selected = getSelectedValues(select);
    expect(selected.size).toBe(0);
  });

  test("option without value uses textContent", () => {
    const doc = parseHTML(`
      <form>
        <select name="color">
          <option>Red</option>
          <option selected>Green</option>
        </select>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);
    expect(data["color"]).toBe("Green");
  });

  test("multi-select", () => {
    const doc = parseHTML(`
      <form>
        <select name="colors" multiple>
          <option value="r" selected>Red</option>
          <option value="g" selected>Green</option>
          <option value="b">Blue</option>
        </select>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);
    expect(Array.isArray(data["colors"])).toBe(true);
    expect((data["colors"] as string[]).length).toBe(2);
  });

  test("disabled option", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <select id="s" aria-label="Color">
          <option value="a">A</option>
          <option value="b" disabled>B</option>
          <option value="c">C</option>
        </select>
      </body>
    `);

    // Selecting a disabled option should still work at the DOM level
    // (unlike clicking a disabled button)
    const result = page.select("#s", "b");
    // The select action doesn't check disabled on options
    expect(result.selectedValues).toEqual(["b"]);
  });
});

describe("Form validation edge cases", () => {
  test("required field with whitespace-only value", () => {
    const doc = parseHTML('<form><input type="text" name="q" required></form>');
    const input = doc.querySelector("input")!;
    setInputValue(input, "   ");
    // Whitespace-only should still pass required (matches browser behavior)
    const result = validateForm(doc.querySelector("form")!);
    expect(result.valid).toBe(true);
  });

  test("email with plus addressing", () => {
    const doc = parseHTML('<form><input type="email" name="e" required></form>');
    const input = doc.querySelector("input")!;
    setInputValue(input, "user+tag@example.com");
    expect(validateForm(doc.querySelector("form")!).valid).toBe(true);
  });

  test("url validation with various schemes", () => {
    const doc = parseHTML('<form><input type="url" name="u" required></form>');
    const input = doc.querySelector("input")!;

    setInputValue(input, "https://example.com");
    expect(validateForm(doc.querySelector("form")!).valid).toBe(true);

    setInputValue(input, "ftp://files.example.com");
    expect(validateForm(doc.querySelector("form")!).valid).toBe(true);

    setInputValue(input, "not-a-url");
    expect(validateForm(doc.querySelector("form")!).valid).toBe(false);
  });

  test("number with scientific notation", () => {
    const doc = parseHTML('<form><input type="number" name="n" required></form>');
    const input = doc.querySelector("input")!;
    setInputValue(input, "1e5");
    const result = validateForm(doc.querySelector("form")!);
    // parseFloat("1e5") = 100000, which is a valid number
    expect(result.valid).toBe(true);
  });

  test("disabled required field skipped in validation", () => {
    const doc = parseHTML('<form><input type="text" name="q" required disabled></form>');
    const result = validateForm(doc.querySelector("form")!);
    expect(result.valid).toBe(true);
  });

  test("input without name skipped in validation", () => {
    const doc = parseHTML('<form><input type="text" required></form>');
    const result = validateForm(doc.querySelector("form")!);
    // No name means it's not a submittable field
    expect(result.valid).toBe(true);
  });
});

describe("Form serialization edge cases", () => {
  test("form with no inputs", () => {
    const doc = parseHTML("<form><p>No inputs here</p></form>");
    const data = serializeForm(doc.querySelector("form")!);
    expect(Object.keys(data).length).toBe(0);
  });

  test("hidden inputs included", () => {
    const doc = parseHTML('<form><input type="hidden" name="token" value="abc"></form>');
    const data = serializeForm(doc.querySelector("form")!);
    expect(data["token"]).toBe("abc");
  });

  test("file inputs excluded", () => {
    const doc = parseHTML('<form><input type="file" name="upload"></form>');
    const data = serializeForm(doc.querySelector("form")!);
    expect(data["upload"]).toBeUndefined();
  });

  test("unchecked radio excluded", () => {
    const doc = parseHTML(`
      <form>
        <input type="radio" name="choice" value="a">
        <input type="radio" name="choice" value="b">
      </form>
    `);
    const data = serializeForm(doc.querySelector("form")!);
    expect(data["choice"]).toBeUndefined();
  });
});

describe("Click + form interaction edge cases", () => {
  test("clicking element inside disabled button", async () => {
    const page = new SievePage();
    page.setContent('<body><button disabled><span id="inner">text</span></button></body>');

    // The span is inside a disabled button — click should fail
    const result = await page.click("#inner");
    expect(result.success).toBe(false);
  });

  test("clicking link with fragment-only href", async () => {
    const page = new SievePage();
    page.setContent('<body><a href="#section" id="link">Jump</a></body>');

    const result = await page.click("#link");
    expect(result.success).toBe(true);
    expect(result.navigateTo).toBe("#section");
  });

  test("clicking link with empty href reports no navigation", async () => {
    const page = new SievePage();
    page.setContent('<body><a href="" id="link">Current</a></body>');

    const result = await page.click("#link");
    // Empty href is falsy — click succeeds but no navigation target
    expect(result.success).toBe(true);
    expect(result.navigateTo).toBeUndefined();
  });

  test("clicking link with javascript: href", async () => {
    const page = new SievePage();
    page.setContent('<body><a href="javascript:void(0)" id="link">NoOp</a></body>');

    const result = await page.click("#link");
    expect(result.success).toBe(true);
    expect(result.navigateTo).toBe("javascript:void(0)");
  });

  test("type into readonly input fails", async () => {
    const page = new SievePage();
    page.setContent('<body><input type="text" id="ro" readonly></body>');

    const result = await page.type("#ro", "text");
    expect(result.success).toBe(false);
  });

  test("type empty string", async () => {
    const page = new SievePage();
    page.setContent('<body><input type="text" id="i" value="existing"></body>');

    const result = await page.type("#i", "");
    expect(result.success).toBe(true);
    expect(result.value).toBe("");
  });

  test("click non-existent selector", async () => {
    const page = new SievePage();
    page.setContent("<body><p>hi</p></body>");

    const result = await page.click("#does-not-exist");
    expect(result.success).toBe(false);
  });

  test("type into non-existent selector", async () => {
    const page = new SievePage();
    page.setContent("<body><p>hi</p></body>");

    const result = await page.type("#nope", "text");
    expect(result.success).toBe(false);
  });

  test("details/summary toggle", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <details id="d">
          <summary>Show more</summary>
          <p>Hidden content</p>
        </details>
      </body>
    `);

    expect(page.querySelector("#d")!.hasAttribute("open")).toBe(false);

    await page.click("summary");
    expect(page.querySelector("#d")!.hasAttribute("open")).toBe(true);

    await page.click("summary");
    expect(page.querySelector("#d")!.hasAttribute("open")).toBe(false);
  });
});

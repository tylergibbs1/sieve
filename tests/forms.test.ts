import { describe, test, expect } from "bun:test";
import { parseHTML, serializeForm, validateForm, getInputValue, setInputValue } from "../src/index.ts";

describe("Form validation", () => {
  test("required fields", () => {
    const doc = parseHTML(`
      <form>
        <input type="text" name="username" required>
        <input type="email" name="email" required>
        <button type="submit">Submit</button>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const result = validateForm(form);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });

  test("email validation", () => {
    const doc = parseHTML('<form><input type="email" name="email" required></form>');
    const form = doc.querySelector("form")!;
    const input = doc.querySelector("input")!;

    setInputValue(input, "invalid");
    const result = validateForm(form);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.message).toContain("email");

    setInputValue(input, "valid@example.com");
    const result2 = validateForm(form);
    expect(result2.valid).toBe(true);
  });

  test("pattern validation", () => {
    const doc = parseHTML('<form><input type="text" name="code" pattern="[A-Z]{3}" required></form>');
    const form = doc.querySelector("form")!;
    const input = doc.querySelector("input")!;

    setInputValue(input, "abc");
    expect(validateForm(form).valid).toBe(false);

    setInputValue(input, "ABC");
    expect(validateForm(form).valid).toBe(true);
  });

  test("min/max length", () => {
    const doc = parseHTML('<form><input type="text" name="pw" minlength="8" required></form>');
    const form = doc.querySelector("form")!;
    const input = doc.querySelector("input")!;

    setInputValue(input, "short");
    expect(validateForm(form).valid).toBe(false);

    setInputValue(input, "longenough");
    expect(validateForm(form).valid).toBe(true);
  });

  test("number min/max", () => {
    const doc = parseHTML('<form><input type="number" name="age" min="18" max="99" required></form>');
    const form = doc.querySelector("form")!;
    const input = doc.querySelector("input")!;

    setInputValue(input, "15");
    expect(validateForm(form).valid).toBe(false);

    setInputValue(input, "25");
    expect(validateForm(form).valid).toBe(true);

    setInputValue(input, "100");
    expect(validateForm(form).valid).toBe(false);
  });
});

describe("Form serialization", () => {
  test("serializes all input types", () => {
    const doc = parseHTML(`
      <form>
        <input type="text" name="name" value="Alice">
        <input type="email" name="email" value="alice@example.com">
        <input type="hidden" name="token" value="xyz">
        <textarea name="bio">Hello world</textarea>
        <select name="role">
          <option value="user">User</option>
          <option value="admin" selected>Admin</option>
        </select>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);

    expect(data["name"]).toBe("Alice");
    expect(data["email"]).toBe("alice@example.com");
    expect(data["token"]).toBe("xyz");
    expect(data["bio"]).toBe("Hello world");
    expect(data["role"]).toBe("admin");
  });

  test("skips disabled inputs", () => {
    const doc = parseHTML(`
      <form>
        <input type="text" name="active" value="yes">
        <input type="text" name="inactive" value="no" disabled>
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);

    expect(data["active"]).toBe("yes");
    expect(data["inactive"]).toBeUndefined();
  });

  test("skips inputs without name", () => {
    const doc = parseHTML(`
      <form>
        <input type="text" value="no-name">
        <input type="text" name="named" value="has-name">
      </form>
    `);
    const form = doc.querySelector("form")!;
    const data = serializeForm(form);

    expect(Object.keys(data).length).toBe(1);
    expect(data["named"]).toBe("has-name");
  });
});

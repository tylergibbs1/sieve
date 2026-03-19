import { describe, test, expect } from "bun:test";
import { parseHTML, buildAccessibilityTree, serializeAccessibilityTree } from "../src/index.ts";

describe("Accessibility tree", () => {
  test("builds tree from a typical page", () => {
    const doc = parseHTML(`
      <html>
      <head><title>Example Website</title></head>
      <body>
        <nav aria-label="Main Nav">
          <a href="/">Home</a>
          <a href="/products">Products</a>
          <a href="/about">About</a>
        </nav>
        <main>
          <h1>Welcome</h1>
          <form aria-label="Sign Up">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="you@example.com">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
            <button type="submit">Create Account</button>
          </form>
          <ul>
            <li>Fast performance</li>
            <li>Easy integration</li>
          </ul>
        </main>
        <footer>
          <a href="/privacy">Privacy Policy</a>
        </footer>
      </body>
      </html>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(tree.role).toBe("page");
    expect(tree.name).toBe("Example Website");

    // Check structure
    expect(serialized).toContain("[navigation]");
    expect(serialized).toContain("[link] Home");
    expect(serialized).toContain("[heading:1] Welcome");
    expect(serialized).toContain("[form] Sign Up");
    expect(serialized).toContain("[textbox] Email");
    expect(serialized).toContain("required");
    expect(serialized).toContain("[button] Create Account");
    expect(serialized).toContain("[list]");
    expect(serialized).toContain("[listitem]");
  });

  test("skips hidden elements", () => {
    const doc = parseHTML(`
      <body>
        <div>Visible</div>
        <div hidden>Hidden by attribute</div>
        <div style="display: none">Hidden by style</div>
        <div aria-hidden="true">Hidden from a11y</div>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("Visible");
    expect(serialized).not.toContain("Hidden by attribute");
    expect(serialized).not.toContain("Hidden by style");
    expect(serialized).not.toContain("Hidden from a11y");
  });

  test("handles form controls", () => {
    const doc = parseHTML(`
      <body>
        <input type="checkbox" checked aria-label="Accept terms">
        <input type="text" disabled aria-label="Disabled input">
        <select aria-label="Color">
          <option value="red">Red</option>
          <option value="blue" selected>Blue</option>
        </select>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("[checkbox] Accept terms");
    expect(serialized).toContain("checked");
    expect(serialized).toContain("[textbox] Disabled input");
    expect(serialized).toContain("disabled");
    expect(serialized).toContain("[combobox] Color");
  });

  test("handles heading levels", () => {
    const doc = parseHTML(`
      <body>
        <h1>Title</h1>
        <h2>Subtitle</h2>
        <h3>Section</h3>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("[heading:1] Title");
    expect(serialized).toContain("[heading:2] Subtitle");
    expect(serialized).toContain("[heading:3] Section");
  });

  test("handles landmarks", () => {
    const doc = parseHTML(`
      <body>
        <header>Header content</header>
        <nav>Nav content</nav>
        <main>Main content</main>
        <aside>Sidebar</aside>
        <footer>Footer content</footer>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("[banner]");
    expect(serialized).toContain("[navigation]");
    expect(serialized).toContain("[main]");
    expect(serialized).toContain("[complementary]");
    expect(serialized).toContain("[contentinfo]");
  });
});

import { describe, test, expect } from "bun:test";
import { parseHTML, buildAccessibilityTree, serializeAccessibilityTree } from "../src/index.ts";

describe("Accessibility tree snapshots", () => {
  test("typical page structure", () => {
    const doc = parseHTML(`
      <html>
      <head><title>Example</title></head>
      <body>
        <nav aria-label="Main">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>
          <h1>Welcome</h1>
          <p>Hello world</p>
        </main>
        <footer>
          <a href="/privacy">Privacy</a>
        </footer>
      </body>
      </html>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toMatchSnapshot();
  });

  test("form with all input types", () => {
    const doc = parseHTML(`
      <body>
        <form aria-label="Registration">
          <label for="name">Name</label>
          <input type="text" id="name" name="name" required placeholder="Your name">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required>
          <input type="checkbox" id="agree" name="agree">
          <label for="agree">I agree</label>
          <select id="role" name="role" aria-label="Role">
            <option value="user">User</option>
            <option value="admin" selected>Admin</option>
          </select>
          <button type="submit">Register</button>
        </form>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toMatchSnapshot();
  });

  test("complex nested structure", () => {
    const doc = parseHTML(`
      <body>
        <header>
          <h1>Site Title</h1>
          <nav aria-label="Primary">
            <ul>
              <li><a href="/">Home</a></li>
              <li><a href="/docs">Docs</a></li>
              <li><a href="/blog">Blog</a></li>
            </ul>
          </nav>
        </header>
        <main>
          <article>
            <h2>Article Title</h2>
            <p>First paragraph</p>
            <details>
              <summary>Show more</summary>
              <p>Hidden content</p>
            </details>
          </article>
          <aside>
            <h3>Related</h3>
            <ul>
              <li><a href="/related-1">Related 1</a></li>
              <li><a href="/related-2">Related 2</a></li>
            </ul>
          </aside>
        </main>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toMatchSnapshot();
  });

  test("table structure", () => {
    const doc = parseHTML(`
      <body>
        <table aria-label="Users">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th></tr>
          </thead>
          <tbody>
            <tr><td>Alice</td><td>alice@example.com</td><td>Admin</td></tr>
            <tr><td>Bob</td><td>bob@example.com</td><td>User</td></tr>
          </tbody>
        </table>
      </body>
    `);

    const tree = buildAccessibilityTree(doc);
    const serialized = serializeAccessibilityTree(tree);
    expect(serialized).toMatchSnapshot();
  });
});

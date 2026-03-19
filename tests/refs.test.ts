/**
 * Tests for @ref element addressing, interactive-only serialization,
 * output limits, and ref-based actions.
 */

import { describe, test, expect } from "bun:test";
import {
  SievePage,
  parseHTML,
  buildAccessibilityTree,
  serializeAccessibilityTree,
  assignRefs,
  resolveRef,
} from "../src/index.ts";

const FORM_HTML = `
  <html><head><title>Registration</title></head>
  <body>
    <header>
      <nav aria-label="Main">
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
    </header>
    <main>
      <h1>Register</h1>
      <p>Fill out the form below to create your account.</p>
      <form aria-label="Registration Form">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com">
        <label for="pw">Password</label>
        <input type="password" id="pw" name="password" required>
        <label for="role">Role</label>
        <select id="role" name="role">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <input type="checkbox" id="tos" name="tos">
        <label for="tos">I agree to the Terms</label>
        <button type="submit">Create Account</button>
      </form>
    </main>
    <footer>
      <a href="/privacy">Privacy Policy</a>
    </footer>
  </body>
  </html>
`;

describe("Ref assignment", () => {
  test("assigns refs to interactive elements only", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);
    const refs = assignRefs(tree);

    // Links: Home, About, Contact, Privacy = 4
    // Inputs: email, password = 2 textboxes
    // Select: role = 1 combobox
    // Checkbox: tos = 1
    // Button: Create Account = 1
    // Options don't get refs in interactive-only mode since they're inside combobox
    expect(refs.count).toBeGreaterThanOrEqual(8);

    // Every ref should resolve to an element
    for (const [ref, node] of refs.byRef) {
      expect(ref).toMatch(/^@e\d+$/);
      expect(node.element).toBeDefined();
    }
  });

  test("refs are in tree order", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);
    const refs = assignRefs(tree);

    // First refs should be the nav links (they come first in DOM)
    const e1 = refs.byRef.get("@e1")!;
    expect(e1.role).toBe("link");
    expect(e1.name).toBe("Home");

    const e2 = refs.byRef.get("@e2")!;
    expect(e2.role).toBe("link");
    expect(e2.name).toBe("About");
  });

  test("refs appear in serialized output", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);
    assignRefs(tree);
    const serialized = serializeAccessibilityTree(tree);

    expect(serialized).toContain("@e1");
    expect(serialized).toContain("[link] @e1 Home");
    expect(serialized).toContain("[button]");
    expect(serialized).toContain("@e");
  });
});

describe("Interactive-only serialization", () => {
  test("filters to only interactive + landmark nodes", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);
    assignRefs(tree);

    const full = serializeAccessibilityTree(tree);
    const interactive = serializeAccessibilityTree(tree, { interactive: true });

    // Interactive should be shorter
    expect(interactive.length).toBeLessThan(full.length);

    // Interactive should still have refs and landmarks
    expect(interactive).toContain("@e1");
    expect(interactive).toContain("[link]");
    expect(interactive).toContain("[textbox]");
    expect(interactive).toContain("[button]");
    expect(interactive).toContain("[navigation]");
    expect(interactive).toContain("[form]");
    expect(interactive).toContain("[main]");

    // Interactive should NOT have text content
    expect(interactive).not.toContain("Fill out the form below");
  });

  test("interactive mode on large page cuts output significantly", () => {
    let html = "<html><body><nav><a href='/'>Home</a></nav><main>";
    for (let i = 0; i < 100; i++) {
      html += `<article><h2>Article ${i}</h2><p>Long paragraph of text about article ${i} that takes up space but isn't interactive.</p><a href="/a/${i}">Read more</a></article>`;
    }
    html += "</main></body></html>";

    const doc = parseHTML(html);
    const tree = buildAccessibilityTree(doc);
    assignRefs(tree);

    const full = serializeAccessibilityTree(tree);
    const interactive = serializeAccessibilityTree(tree, { interactive: true });

    // Interactive should be much shorter
    expect(interactive.length).toBeLessThan(full.length * 0.5);

    // But should still have all 101 links
    const linkCount = (interactive.match(/\[link\]/g) ?? []).length;
    expect(linkCount).toBe(101);
  });
});

describe("Output limits", () => {
  test("maxLength truncates output", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);
    assignRefs(tree);

    const full = serializeAccessibilityTree(tree);
    const limited = serializeAccessibilityTree(tree, { maxLength: 200 });

    expect(limited.length).toBeLessThanOrEqual(200);
    expect(limited).toContain("... (truncated)");
    expect(full.length).toBeGreaterThan(200);
  });

  test("maxDepth limits tree depth", () => {
    const doc = parseHTML(FORM_HTML);
    const tree = buildAccessibilityTree(doc);

    const shallow = serializeAccessibilityTree(tree, { maxDepth: 1 });
    const deep = serializeAccessibilityTree(tree);

    expect(shallow.length).toBeLessThan(deep.length);
  });
});

describe("Ref-based page actions", () => {
  test("click by ref", async () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);

    // Build refs
    const tree = page.accessibilityTree();
    expect(tree.refCount).toBeGreaterThanOrEqual(8);

    // Find the checkbox ref
    const checkboxNode = tree.findByRole("checkbox")[0]!;
    expect(checkboxNode.ref).toBeDefined();

    // Click by ref
    const result = await page.click(checkboxNode.ref!);
    expect(result.success).toBe(true);
    expect(result.effect).toContain("checked");
  });

  test("type by ref", async () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);

    const tree = page.accessibilityTree();

    // Find the email textbox ref
    const emailNode = tree.findByRole("textbox").find((n) => n.name === "Email")!;
    expect(emailNode.ref).toBeDefined();

    const result = await page.type(emailNode.ref!, "test@example.com");
    expect(result.success).toBe(true);
    expect(result.value).toBe("test@example.com");
  });

  test("select by ref", () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);

    const tree = page.accessibilityTree();

    // Find the combobox ref
    const selectNode = tree.findByRole("combobox")[0]!;
    expect(selectNode.ref).toBeDefined();

    const result = page.select(selectNode.ref!, "admin");
    expect(result.success).toBe(true);
    expect(result.selectedValues).toEqual(["admin"]);
  });

  test("resolveRef returns null for invalid ref", () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);
    page.accessibilityTree(); // build refs

    expect(page.resolveRef("@e999")).toBeNull();
    expect(page.resolveRef("invalid")).toBeNull();
  });

  test("refs work in full agent workflow", async () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);

    // Step 1: Agent gets the interactive snapshot
    const tree = page.accessibilityTree();
    const snapshot = tree.serialize({ interactive: true });

    // The snapshot should contain refs the agent can act on
    expect(snapshot).toContain("@e");

    // Step 2: Agent finds the email input ref from the snapshot
    const emailRef = tree.findByRole("textbox").find((n) => n.name === "Email")!.ref!;
    const pwRef = tree.findByRole("textbox").find((n) => n.name === "Password")!.ref!;
    const tosRef = tree.findByRole("checkbox")[0]!.ref!;
    const submitRef = tree.findByRole("button").find((n) => n.name === "Create Account")!.ref!;
    const selectRef = tree.findByRole("combobox")[0]!.ref!;

    // Step 3: Agent acts using refs
    await page.type(emailRef, "alice@example.com");
    await page.type(pwRef, "secure123!");
    page.select(selectRef, "admin");
    await page.click(tosRef);

    // Step 4: Verify state
    const form = page.forms[0]!;
    expect(form.data["email"]).toBe("alice@example.com");
    expect(form.data["password"]).toBe("secure123!");
    expect(form.data["role"]).toBe("admin");
    expect(form.data["tos"]).toBe("on");

    // Step 5: Agent gets updated snapshot — values reflected
    const updated = page.accessibilityTree();
    const updatedSnapshot = updated.serialize({ interactive: true });
    expect(updatedSnapshot).toContain('value: "alice@example.com"');
    expect(updatedSnapshot).toContain("checked");
  });
});

describe("AccessibilityTreeHandle API", () => {
  test("refCount reflects interactive elements", () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);
    const tree = page.accessibilityTree();
    expect(tree.refCount).toBeGreaterThanOrEqual(8);
  });

  test("getByRef returns a11y node", () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);
    const tree = page.accessibilityTree();

    const node = tree.getByRef("@e1");
    expect(node).not.toBeNull();
    expect(node!.role).toBe("link");
    expect(node!.name).toBe("Home");
  });

  test("getByRef returns null for invalid ref", () => {
    const page = new SievePage();
    page.setContent(FORM_HTML);
    const tree = page.accessibilityTree();

    expect(tree.getByRef("@e999")).toBeNull();
  });
});

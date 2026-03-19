import { describe, test, expect } from "bun:test";
import { SieveBrowser, SievePage } from "../src/index.ts";

describe("SievePage", () => {
  test("setContent and query", () => {
    const page = new SievePage();
    page.setContent(`
      <html>
      <head><title>Test Page</title></head>
      <body>
        <h1>Hello</h1>
        <p class="intro">World</p>
      </body>
      </html>
    `);

    expect(page.title).toBe("Test Page");
    expect(page.querySelector("h1")?.textContent).toBe("Hello");
    expect(page.querySelector(".intro")?.textContent).toBe("World");
    expect(page.querySelectorAll("p").length).toBe(1);
  });

  test("type into input", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="text" name="email" placeholder="Email">
        <textarea name="bio"></textarea>
      </body>
    `);

    const result1 = await page.type('input[name="email"]', "user@example.com");
    expect(result1.success).toBe(true);
    expect(result1.value).toBe("user@example.com");

    const result2 = await page.type("textarea", "Hello world");
    expect(result2.success).toBe(true);
  });

  test("click checkbox", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="checkbox" id="agree">
      </body>
    `);

    const result = await page.click("#agree");
    expect(result.success).toBe(true);
    expect(result.effect).toBe("Checkbox checked");

    // Click again to uncheck
    const result2 = await page.click("#agree");
    expect(result2.success).toBe(true);
    expect(result2.effect).toBe("Checkbox unchecked");
  });

  test("click link returns navigateTo", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <a href="/about">About</a>
      </body>
    `);

    const result = await page.click("a");
    expect(result.success).toBe(true);
    expect(result.navigateTo).toBe("/about");
  });

  test("click submit button returns submitsForm", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form action="/submit">
          <input name="q" value="test">
          <button type="submit">Go</button>
        </form>
      </body>
    `);

    const result = await page.click('button[type="submit"]');
    expect(result.success).toBe(true);
    expect(result.submitsForm).not.toBeUndefined();
  });

  test("select options", () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <select name="color">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
          <option value="green">Green</option>
        </select>
      </body>
    `);

    const result = page.select("select", "blue");
    expect(result.success).toBe(true);
    expect(result.selectedValues).toEqual(["blue"]);
  });

  test("form data serialization", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form>
          <input type="text" name="username">
          <input type="email" name="email">
          <input type="checkbox" name="agree">
          <select name="role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </form>
      </body>
    `);

    await page.type('input[name="username"]', "alice");
    await page.type('input[name="email"]', "alice@example.com");
    await page.click('input[name="agree"]');
    page.select('select[name="role"]', "admin");

    const form = page.forms[0]!;
    const data = form.data;
    expect(data["username"]).toBe("alice");
    expect(data["email"]).toBe("alice@example.com");
    expect(data["agree"]).toBe("on");
    expect(data["role"]).toBe("admin");
  });

  test("snapshot and restore", () => {
    const page = new SievePage();
    page.setContent('<body><div id="test" class="original">Hello</div></body>');

    const snapshot = page.snapshot();

    // Modify the page
    const div = page.querySelector("#test")!;
    div.className = "modified";
    div.textContent = "Changed";

    expect(page.querySelector("#test")!.className).toBe("modified");

    // Restore
    page.restore(snapshot);
    expect(page.querySelector("#test")!.className).toBe("original");
    expect(page.querySelector("#test")!.textContent).toBe("Hello");
  });

  test("snapshot diff", () => {
    const page = new SievePage();
    page.setContent('<body><div id="test" class="a">Hello</div></body>');
    const before = page.snapshot();

    const div = page.querySelector("#test")!;
    div.className = "b";
    const after = page.snapshot();

    const changes = SievePage.diff(before, after);
    expect(changes.length).toBeGreaterThan(0);
    const attrChange = changes.find((c) => c.type === "attribute" && c.detail === "class");
    expect(attrChange).toBeDefined();
    expect(attrChange!.from).toBe("a");
    expect(attrChange!.to).toBe("b");
  });

  test("accessibility tree from page", () => {
    const page = new SievePage();
    page.setContent(`
      <html>
      <head><title>Test</title></head>
      <body>
        <nav aria-label="Main">
          <a href="/">Home</a>
        </nav>
        <main>
          <h1>Title</h1>
          <p>Content</p>
        </main>
      </body>
      </html>
    `);

    const tree = page.accessibilityTree();
    const serialized = tree.serialize();

    expect(serialized).toContain("[page] Test");
    expect(serialized).toContain("[navigation] Main");
    expect(serialized).toContain("[link]");
    expect(serialized).toContain("Home");
    expect(serialized).toContain("[heading:1] Title");

    // Find by role
    const headings = tree.findByRole("heading");
    expect(headings.length).toBe(1);
    expect(headings[0]!.name).toBe("Title");

    // Find by name (link node + text child both have name "Home")
    const links = tree.findByName("Home");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links.some((n) => n.role === "link")).toBe(true);
  });

  test("radio button groups", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="radio" name="size" value="s" id="small">
        <input type="radio" name="size" value="m" id="medium">
        <input type="radio" name="size" value="l" id="large">
      </body>
    `);

    await page.click("#small");
    expect(page.querySelector("#small")!.hasAttribute("checked")).toBe(true);

    await page.click("#large");
    expect(page.querySelector("#small")!.hasAttribute("checked")).toBe(false);
    expect(page.querySelector("#large")!.hasAttribute("checked")).toBe(true);
  });

  test("close prevents further interaction", async () => {
    const page = new SievePage();
    page.setContent("<body>Hello</body>");
    page.close();

    expect(page.isClosed).toBe(true);
    expect(() => page.setContent("<body>New</body>")).toThrow("Page is closed");
    await expect(page.click("body")).rejects.toThrow("Page is closed");
  });
});

describe("SieveBrowser", () => {
  test("creates and manages pages", async () => {
    const browser = new SieveBrowser();
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    expect(browser.openPages.length).toBe(2);

    page1.close();
    expect(browser.openPages.length).toBe(1);

    browser.close();
    expect(browser.openPages.length).toBe(0);
  });

  test("mock network mode", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com": "<html><head><title>Example</title></head><body><h1>Hello</h1></body></html>",
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    expect(page.title).toBe("Example");
    expect(page.querySelector("h1")?.textContent).toBe("Hello");
    expect(page.url).toBe("https://example.com");
  });
});

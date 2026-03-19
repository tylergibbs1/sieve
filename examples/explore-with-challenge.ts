/**
 * Explore a URL with sieve, handling Sucuri WAF challenges.
 * Usage: bun examples/explore-with-challenge.ts <url>
 */

import { SieveBrowser, parseHTML, extractMetadata, querySelector, querySelectorAll } from "../src/index.ts";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun examples/explore-with-challenge.ts <url>");
  process.exit(1);
}

const browser = new SieveBrowser({ network: "live" });
const page = await browser.newPage();

console.log(`\n🔍 Fetching ${url}...\n`);
const response = await page.goto(url);

// Check for Sucuri WAF challenge
if (response.body.includes("sucuri_cloudproxy_js") || response.body.includes("You are being redirected")) {
  console.log("⚡ Detected Sucuri WAF challenge — solving...\n");

  // Extract the base64 payload
  const b64Match = response.body.match(/S='([^']+)'/);
  if (b64Match) {
    const decoded = atob(b64Match[1]!);

    // Evaluate the challenge in a sandbox — it sets document.cookie
    const cookieStr: string = new Function(`
      var document = { cookie: "" };
      ${decoded.replace("location.reload();", "")}
      return document.cookie;
    `)();

    if (cookieStr) {
      console.log(`  Setting cookie: ${cookieStr.slice(0, 80)}...`);
      page.cookies.setCookie(cookieStr, url);

      console.log("  Re-fetching with challenge cookie...\n");
      await page.goto(url);
    }
  }
}

console.log(`Status: ${response.status}`);
console.log(`Title: ${page.title}`);
console.log(`URL: ${page.url}`);
console.log(`HTML size: ${(page.html.length / 1024).toFixed(0)}KB`);

// Metadata
const meta = await extractMetadata(page.html);
if (meta.description) console.log(`Description: ${meta.description}`);
if (meta.lang) console.log(`Language: ${meta.lang}`);

// DOM stats
const links = page.querySelectorAll("a[href]");
const forms = page.querySelectorAll("form");
const inputs = page.querySelectorAll("input, textarea, select");
const headings = page.querySelectorAll("h1, h2, h3, h4, h5, h6");
const images = page.querySelectorAll("img");
const tables = page.querySelectorAll("table");

console.log(`\n--- DOM Stats ---`);
console.log(`Links: ${links.length}`);
console.log(`Forms: ${forms.length}`);
console.log(`Inputs: ${inputs.length}`);
console.log(`Headings: ${headings.length}`);
console.log(`Images: ${images.length}`);
console.log(`Tables: ${tables.length}`);

// Forms detail
if (forms.length > 0) {
  console.log(`\n--- Forms ---`);
  for (const [i, form] of page.forms.entries()) {
    const action = form.element.getAttribute("action") ?? "(none)";
    const method = form.element.getAttribute("method") ?? "GET";
    const formId = form.element.getAttribute("id") ?? "";
    console.log(`\nForm ${i}${formId ? ` #${formId}` : ""}: ${method.toUpperCase()} ${action}`);

    const formInputs = querySelectorAll(form.element, "input, select, textarea");
    for (const input of formInputs) {
      const name = input.getAttribute("name") ?? "(unnamed)";
      const type = input.getAttribute("type") ?? input.tagName;
      const required = input.hasAttribute("required") ? " (required)" : "";
      const placeholder = input.getAttribute("placeholder") ?? "";
      const label = input.getAttribute("aria-label") ?? "";
      const id = input.getAttribute("id") ?? "";

      let detail = `  [${type}] ${name}${required}`;
      if (placeholder) detail += ` placeholder="${placeholder}"`;
      if (label) detail += ` aria-label="${label}"`;
      if (id) detail += ` id="${id}"`;

      // Show options for selects
      if (input.tagName === "select") {
        const options = querySelectorAll(input, "option");
        const optStr = options
          .map((o) => `${o.getAttribute("value") ?? o.textContent.trim()}`)
          .join(", ");
        detail += ` options=[${optStr}]`;
      }

      console.log(detail);
    }
  }
}

// Accessibility tree
const tree = page.accessibilityTree();
const serialized = tree.serialize();

console.log(`\n--- Accessibility Tree (first 3000 chars) ---`);
console.log(serialized.slice(0, 3000));
if (serialized.length > 3000) {
  console.log(`\n... (${serialized.length} total chars, ${serialized.split("\n").length} lines)`);
}

// Cookies
const cookies = page.cookies.getCookies(page.url);
if (cookies.length > 0) {
  console.log(`\n--- Cookies (${cookies.length}) ---`);
  for (const c of cookies) {
    console.log(`  ${c.name}=${c.value.slice(0, 50)}${c.value.length > 50 ? "..." : ""}`);
  }
}

browser.close();

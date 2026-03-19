/**
 * Explore a URL with sieve.
 * Usage: bun examples/explore.ts <url>
 */

import { SieveBrowser, parseHTMLAsync, extractMetadata, serializeAccessibilityTree } from "../src/index.ts";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun examples/explore.ts <url>");
  process.exit(1);
}

const browser = new SieveBrowser({ network: "live" });
const page = await browser.newPage();

console.log(`\n🔍 Fetching ${url}...\n`);
const response = await page.goto(url);

console.log(`Status: ${response.status}`);
console.log(`Title: ${page.title}`);
console.log(`URL: ${page.url}`);
console.log(`HTML size: ${(response.body.length / 1024).toFixed(0)}KB`);

// Metadata
const meta = await extractMetadata(response.body);
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
    console.log(`Form ${i}: ${method} ${action}`);
    const formInputs = form.element.childNodes.length > 0
      ? page.querySelectorAll("form input, form select, form textarea")
      : [];
    for (const input of formInputs) {
      const name = input.getAttribute("name") ?? "(unnamed)";
      const type = input.getAttribute("type") ?? input.tagName;
      const required = input.hasAttribute("required") ? " *" : "";
      console.log(`  [${type}] ${name}${required}`);
    }
  }
}

// Accessibility tree
const tree = page.accessibilityTree();
const serialized = tree.serialize();

console.log(`\n--- Accessibility Tree ---`);
console.log(serialized);

// Cookies
const cookies = page.cookies.getCookies(page.url);
if (cookies.length > 0) {
  console.log(`\n--- Cookies (${cookies.length}) ---`);
  for (const c of cookies) {
    console.log(`  ${c.name}=${c.value.slice(0, 40)}${c.value.length > 40 ? "..." : ""}`);
  }
}

browser.close();

import { describe, test, expect } from "bun:test";
import {
  stripForAgent,
  sanitizeHTML,
  extractMetadata,
  parseHTMLAsync,
} from "../src/index.ts";

describe("HTMLRewriter preprocessing", () => {
  test("stripForAgent removes scripts and styles", async () => {
    const html = `
      <html>
      <head>
        <style>body { color: red; }</style>
        <script>alert("xss")</script>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Title</h1>
        <script>document.write("bad")</script>
        <svg><circle r="10"/></svg>
        <p>Content</p>
        <iframe src="https://evil.com"></iframe>
      </body>
      </html>
    `;

    const result = await stripForAgent(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<style");
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<link");
    expect(result).toContain("<h1>Title</h1>");
    expect(result).toContain("<p>Content</p>");
  });

  test("sanitizeHTML removes event handlers", async () => {
    const html = `
      <body>
        <img src="x.png" onerror="alert(1)" onload="track()">
        <div onclick="steal()">Click me</div>
        <a href="/safe" onmouseover="phish()">Link</a>
        <p>Safe content</p>
      </body>
    `;

    const result = await sanitizeHTML(html);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onmouseover");
    expect(result).toContain("Safe content");
    expect(result).toContain('href="/safe"');
  });

  test("extractMetadata extracts page metadata", async () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>My Page</title>
        <meta name="description" content="A test page">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <meta property="og:image" content="https://example.com/image.png">
        <link rel="canonical" href="https://example.com/page">
      </head>
      <body><p>Content</p></body>
      </html>
    `;

    const meta = await extractMetadata(html);
    expect(meta.title).toBe("My Page");
    expect(meta.description).toBe("A test page");
    expect(meta.ogTitle).toBe("OG Title");
    expect(meta.ogDescription).toBe("OG Description");
    expect(meta.ogImage).toBe("https://example.com/image.png");
    expect(meta.canonical).toBe("https://example.com/page");
    expect(meta.lang).toBe("en");
    expect(meta.charset).toBe("utf-8");
  });

  test("parseHTMLAsync with stripForAgent", async () => {
    const html = `
      <html><head><script>bad()</script></head>
      <body><h1>Title</h1><script>worse()</script><p>Content</p></body>
      </html>
    `;

    const doc = await parseHTMLAsync(html, { stripForAgent: true });
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toBe("Title");
    expect(doc.querySelector("p")?.textContent).toBe("Content");
  });

  test("parseHTMLAsync with custom rewrite rules", async () => {
    const html = `
      <body>
        <div class="ad-banner">Buy stuff!</div>
        <div class="content">Real content</div>
        <div class="ad-sidebar">More ads</div>
      </body>
    `;

    const doc = await parseHTMLAsync(html, {
      rewriteRules: [
        { selector: ".ad-banner", action: { remove: true } },
        { selector: ".ad-sidebar", action: { remove: true } },
      ],
    });

    expect(doc.querySelector(".ad-banner")).toBeNull();
    expect(doc.querySelector(".ad-sidebar")).toBeNull();
    expect(doc.querySelector(".content")?.textContent).toBe("Real content");
  });
});

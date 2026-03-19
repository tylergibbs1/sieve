/**
 * Price Monitor Agent: Track product prices and compare across sites.
 *
 * Claude visits e-commerce/product sites, extracts prices,
 * compares them, and reports findings. Demonstrates structured
 * data extraction, @ref navigation, and snapshot diffing.
 *
 * Usage:
 *   bun examples/agent-monitor.ts "Find the cheapest copy of 'Sapiens' book online"
 *   bun examples/agent-monitor.ts "Compare prices of the top 5 books on books.toscrape.com with their ratings"
 *   bun examples/agent-monitor.ts "What are the 10 most expensive books on books.toscrape.com?"
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SieveBrowser, SievePage, querySelector, querySelectorAll, captureSnapshot, diffSnapshots, type DocumentSnapshot } from "../src/index.ts";

const browser = new SieveBrowser({
  network: "live",
  profile: "chrome-mac",
  solveWafChallenges: true,
});

let page: SievePage | null = null;
let lastSnapshot: DocumentSnapshot | null = null;

async function getPage(): Promise<SievePage> {
  if (!page || page.isClosed) page = await browser.newPage();
  return page;
}

const navigateTool = tool(
  "navigate",
  "Navigate to a URL. Returns interactive elements with @refs for clicking.",
  { url: z.string() },
  async (args) => {
    const p = await getPage();
    await p.goto(args.url);
    lastSnapshot = p.snapshot();
    const tree = p.accessibilityTree();
    return {
      content: [{
        type: "text" as const,
        text: `📄 ${p.title} (${p.url})\n${tree.refCount} interactive elements\n\n${tree.serialize({ interactive: true, maxLength: 6000 })}`,
      }],
    };
  }
);

const clickTool = tool(
  "click",
  "Click an element by @ref (e.g. @e5) or CSS selector. Shows what changed after clicking.",
  { target: z.string() },
  async (args) => {
    const p = await getPage();
    const before = p.snapshot();
    const result = await p.click(args.target);

    let text = `${result.success ? "✓" : "✗"} ${result.effect}`;

    if (result.success) {
      // Show what changed
      if (p.hasChanged(before)) {
        const changes = diffSnapshots(before, p.snapshot());
        if (changes.length > 0 && changes.length < 20) {
          text += `\n\nChanges:\n${changes.map(c => `  ${c.type}: ${c.path} ${c.detail ?? ""} ${c.from ?? ""} → ${c.to ?? ""}`).join("\n")}`;
        }
      }
      const tree = p.accessibilityTree();
      text += `\n\n📄 ${p.title}\n${tree.serialize({ interactive: true, maxLength: 4000 })}`;
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

const extractTool = tool(
  "extract_products",
  "Extract product data from the current page. Specify CSS selectors for the container, name, and price elements.",
  {
    containerSelector: z.string().describe("CSS selector for each product container (e.g. '.product', 'article')"),
    nameSelector: z.string().describe("CSS selector for product name within container (e.g. 'h3', '.title')"),
    priceSelector: z.string().describe("CSS selector for price within container (e.g. '.price', '.amount')"),
    linkSelector: z.string().optional().describe("CSS selector for product link (e.g. 'a')"),
    ratingSelector: z.string().optional().describe("CSS selector for rating (e.g. '.rating', '.stars')"),
    nameAttribute: z.string().optional().describe("Attribute to read for name (e.g. 'title'). Default: textContent"),
    linkAttribute: z.string().optional().describe("Attribute to read for link (e.g. 'href'). Default: href"),
  },
  async (args) => {
    const p = await getPage();
    const containers = p.querySelectorAll(args.containerSelector);

    const products = containers.map((container, i) => {
      const nameEl = querySelector(container, args.nameSelector);
      const priceEl = querySelector(container, args.priceSelector);
      const linkEl = args.linkSelector ? querySelector(container, args.linkSelector) : null;
      const ratingEl = args.ratingSelector ? querySelector(container, args.ratingSelector) : null;

      const name = args.nameAttribute
        ? nameEl?.getAttribute(args.nameAttribute) ?? ""
        : nameEl?.textContent.trim() ?? "";
      const price = priceEl?.textContent.trim() ?? "";
      const link = linkEl?.getAttribute(args.linkAttribute ?? "href") ?? "";
      const rating = ratingEl?.getAttribute("class") ?? ratingEl?.textContent.trim() ?? "";

      return { index: i, name, price, link, rating };
    }).filter(p => p.name || p.price);

    const lines = products.map(p => {
      let line = `${p.price.padEnd(10)} ${p.name}`;
      if (p.rating) line += ` [${p.rating}]`;
      if (p.link) line += ` → ${p.link}`;
      return line;
    });

    return {
      content: [{
        type: "text" as const,
        text: `Found ${products.length} products:\n\n${lines.join("\n")}`,
      }],
    };
  }
);

const rawExtractTool = tool(
  "extract",
  "Extract raw text or attribute values from elements matching a CSS selector.",
  {
    selector: z.string(),
    attribute: z.string().optional(),
  },
  async (args) => {
    const p = await getPage();
    const els = p.querySelectorAll(args.selector);
    const data = els.map((el, i) => {
      const val = args.attribute ? el.getAttribute(args.attribute) ?? "" : el.textContent.trim();
      return `[${i}] ${val.slice(0, 150)}`;
    });
    return {
      content: [{
        type: "text" as const,
        text: `${els.length} elements:\n${data.join("\n")}`,
      }],
    };
  }
);

const serverConfig = createSdkMcpServer({
  name: "browser",
  version: "1.0.0",
  tools: [navigateTool, clickTool, extractTool, rawExtractTool],
});

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: bun examples/agent-monitor.ts \"<what to find/compare>\"");
  process.exit(1);
}

console.log(`\n💰 Price Monitor Agent: ${prompt}\n`);

const systemPrompt = `You are a price monitoring agent with a virtual web browser. Your job is to find products, extract prices, and compare them.

You have specialized tools:
- navigate: go to a URL and see interactive elements
- click: click elements by @ref to navigate or paginate
- extract_products: structured product extraction — give it container/name/price selectors
- extract: raw CSS selector extraction for any data

Strategy:
1. Navigate to relevant product pages
2. Use extract_products with the right selectors for structured data
3. If you need to paginate, use click on pagination links
4. Present results in a clear table with prices sorted

For books.toscrape.com, the selectors are:
- container: "article.product_pod"
- name: "h3 a" (use nameAttribute: "title")
- price: ".price_color"
- rating: ".star-rating"
- link: "h3 a" (use linkAttribute: "href")

Always present a clear, sorted comparison at the end.`;

for await (const message of query({
  prompt: `${systemPrompt}\n\nTask: ${prompt}`,
  options: {
    model: "sonnet",
    mcpServers: { browser: serverConfig },
    allowedTools: [
      "mcp__browser__navigate",
      "mcp__browser__click",
      "mcp__browser__extract_products",
      "mcp__browser__extract",
    ],
    maxTurns: 30,
  },
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block && block.text) console.log(block.text);
      else if ("name" in block) {
        const input = "input" in block ? JSON.stringify(block.input) : "";
        console.log(`\n🔧 ${block.name} ${input}\n`);
      }
    }
  } else if (message.type === "result") {
    console.log(`\n✅ Done\n`);
  }
}

browser.close();

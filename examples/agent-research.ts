/**
 * Research Agent: Multi-site research and summarization.
 *
 * Claude navigates multiple sites, extracts key information,
 * and synthesizes a research brief. Demonstrates multi-page
 * browsing, cross-site navigation, and data extraction.
 *
 * Usage:
 *   bun examples/agent-research.ts "What is Bun and how does it compare to Node.js?"
 *   bun examples/agent-research.ts "What are the latest developments in WebAssembly?"
 *   bun examples/agent-research.ts "Find the top 3 TypeScript ORMs and compare them"
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SieveBrowser, SievePage, querySelector, querySelectorAll } from "../src/index.ts";

const browser = new SieveBrowser({
  network: "live",
  profile: "chrome-mac",
  solveWafChallenges: true,
});

const pages = new Map<string, SievePage>();

async function getPage(tab: string): Promise<SievePage> {
  if (!pages.has(tab) || pages.get(tab)!.isClosed) {
    pages.set(tab, await browser.newPage());
  }
  return pages.get(tab)!;
}

const navigateTool = tool(
  "navigate",
  "Navigate a browser tab to a URL. Use different tab names to keep multiple pages open simultaneously. Returns the interactive accessibility tree with @ref elements.",
  {
    tab: z.string().describe("Tab name (e.g. 'wiki', 'docs', 'search')"),
    url: z.string().describe("URL to navigate to"),
  },
  async (args) => {
    const p = await getPage(args.tab);
    try {
      await p.goto(args.url);
      const tree = p.accessibilityTree();
      return {
        content: [{
          type: "text" as const,
          text: `[${args.tab}] ${p.title} (${p.url})\n${tree.refCount} interactive elements\n\n${tree.serialize({ interactive: true, maxLength: 6000 })}`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Navigation failed: ${err.message}` }] };
    }
  }
);

const readTool = tool(
  "read_page",
  "Read the full accessibility tree of a tab. Use for content-heavy pages where you need text, not just interactive elements.",
  {
    tab: z.string().describe("Tab name to read"),
    mode: z.enum(["full", "interactive"]).default("full").describe("'full' for all content, 'interactive' for just actionable elements"),
  },
  async (args) => {
    const p = await getPage(args.tab);
    const tree = p.accessibilityTree();
    const opts = args.mode === "interactive"
      ? { interactive: true, maxLength: 6000 }
      : { maxLength: 8000 };
    return {
      content: [{
        type: "text" as const,
        text: `[${args.tab}] ${p.title}\n\n${tree.serialize(opts)}`,
      }],
    };
  }
);

const extractTool = tool(
  "extract",
  "Extract text from elements matching a CSS selector. Good for scraping specific data from a page.",
  {
    tab: z.string().describe("Tab name"),
    selector: z.string().describe("CSS selector"),
    attribute: z.string().optional().describe("Extract attribute value instead of text"),
  },
  async (args) => {
    const p = await getPage(args.tab);
    const els = p.querySelectorAll(args.selector);
    const data = els.map((el, i) => {
      const val = args.attribute ? el.getAttribute(args.attribute) ?? "" : el.textContent.trim();
      return `[${i}] ${val.slice(0, 200)}`;
    });
    return {
      content: [{
        type: "text" as const,
        text: `Found ${els.length} elements matching "${args.selector}":\n${data.join("\n")}`,
      }],
    };
  }
);

const clickTool = tool(
  "click",
  "Click an element by @ref or CSS selector.",
  {
    tab: z.string().describe("Tab name"),
    target: z.string().describe("@ref (like @e3) or CSS selector"),
  },
  async (args) => {
    const p = await getPage(args.tab);
    const result = await p.click(args.target);
    let text = `${result.success ? "Clicked" : "Failed"}: ${result.effect}`;
    if (result.success) {
      const tree = p.accessibilityTree();
      text += `\n\n[${args.tab}] ${p.title}\n${tree.serialize({ interactive: true, maxLength: 4000 })}`;
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

const serverConfig = createSdkMcpServer({
  name: "browser",
  version: "1.0.0",
  tools: [navigateTool, readTool, extractTool, clickTool],
});

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: bun examples/agent-research.ts \"<research question>\"");
  process.exit(1);
}

console.log(`\n🔬 Research Agent: ${prompt}\n`);

const systemPrompt = `You are a research agent with access to a virtual web browser. Your job is to research a topic by visiting multiple authoritative sources, extracting key information, and producing a clear summary.

Strategy:
1. Start with a broad search or known authoritative sources
2. Open different tabs for different sources (use tab names like 'wiki', 'docs', 'article')
3. Extract specific data points and quotes
4. Synthesize findings into a clear, sourced brief

Always cite which page/URL information came from. Be thorough but concise.`;

for await (const message of query({
  prompt: `${systemPrompt}\n\nResearch question: ${prompt}`,
  options: {
    model: "sonnet",
    mcpServers: { browser: serverConfig },
    allowedTools: [
      "mcp__browser__navigate",
      "mcp__browser__read_page",
      "mcp__browser__extract",
      "mcp__browser__click",
    ],
    maxTurns: 25,
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

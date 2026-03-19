/**
 * Form Automation Agent: Navigate to a site, find forms, fill them out.
 *
 * Claude reads the page structure, identifies form fields via the
 * accessibility tree, fills them using @refs, validates, and submits.
 * Demonstrates the full form lifecycle without a real browser.
 *
 * Usage:
 *   bun examples/agent-form.ts "Go to httpbin.org/forms/post and fill out the form with realistic data, then submit it"
 *   bun examples/agent-form.ts "Go to books.toscrape.com and search for science fiction books"
 *   bun examples/agent-form.ts "Go to duckduckgo.com and search for 'virtual browser for AI agents'"
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SieveBrowser, SievePage, querySelector, querySelectorAll } from "../src/index.ts";

const browser = new SieveBrowser({
  network: "live",
  profile: "chrome-mac",
  solveWafChallenges: true,
});

let page: SievePage | null = null;

async function getPage(): Promise<SievePage> {
  if (!page || page.isClosed) page = await browser.newPage();
  return page;
}

const navigateTool = tool(
  "navigate",
  "Navigate to a URL. Returns the page with @ref identifiers for every interactive element (inputs, buttons, links, selects).",
  { url: z.string() },
  async (args) => {
    const p = await getPage();
    await p.goto(args.url);
    const tree = p.accessibilityTree();
    return {
      content: [{
        type: "text" as const,
        text: `📄 ${p.title} (${p.url})\n${tree.refCount} interactive elements\n\n${tree.serialize({ interactive: true, maxLength: 6000 })}`,
      }],
    };
  }
);

const typeTool = tool(
  "type",
  "Type text into an input field. Use @ref to target the field (e.g. @e3).",
  {
    target: z.string().describe("@ref or CSS selector of the input"),
    text: z.string().describe("Text to type"),
  },
  async (args) => {
    const p = await getPage();
    const result = await p.type(args.target, args.text);
    return {
      content: [{
        type: "text" as const,
        text: result.success
          ? `✓ Typed "${args.text}" into ${args.target}`
          : `✗ Failed: ${result.effect}`,
      }],
    };
  }
);

const clickTool = tool(
  "click",
  "Click an element by @ref or CSS selector. Use this for buttons, links, checkboxes, radio buttons.",
  { target: z.string() },
  async (args) => {
    const p = await getPage();
    const result = await p.click(args.target);
    let text = `${result.success ? "✓" : "✗"} ${result.effect}`;
    if (result.success) {
      const tree = p.accessibilityTree();
      text += `\n\n📄 ${p.title} (${p.url})\n${tree.serialize({ interactive: true, maxLength: 5000 })}`;
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

const selectTool = tool(
  "select",
  "Select a value in a <select> dropdown by @ref.",
  {
    target: z.string().describe("@ref or CSS selector of the select element"),
    value: z.string().describe("Option value to select"),
  },
  async (args) => {
    const p = await getPage();
    const result = p.select(args.target, args.value);
    return {
      content: [{
        type: "text" as const,
        text: result.success
          ? `✓ Selected "${args.value}" in ${args.target}`
          : `✗ Failed: ${result.effect}`,
      }],
    };
  }
);

const formsTool = tool(
  "inspect_forms",
  "Show all forms on the page with their current data, validation state, and fields.",
  {},
  async () => {
    const p = await getPage();
    const forms = p.forms;
    if (forms.length === 0) {
      return { content: [{ type: "text" as const, text: "No forms found on page." }] };
    }

    const output = forms.map((form, i) => {
      const action = form.element.getAttribute("action") ?? "(none)";
      const method = form.element.getAttribute("method") ?? "GET";
      const validation = form.validate();
      const data = form.data;

      let text = `Form ${i}: ${method.toUpperCase()} ${action}\n`;
      text += `  Data: ${JSON.stringify(data, null, 2)}\n`;
      text += `  Valid: ${validation.valid}`;
      if (validation.errors.length > 0) {
        text += `\n  Errors:\n${validation.errors.map(e => `    - ${e.message}`).join("\n")}`;
      }

      // List fields
      const inputs = querySelectorAll(form.element, "input, select, textarea");
      text += `\n  Fields (${inputs.length}):`;
      for (const inp of inputs) {
        const type = inp.getAttribute("type") ?? inp.tagName;
        const name = inp.getAttribute("name") ?? "(unnamed)";
        const required = inp.hasAttribute("required") ? " *" : "";
        if (type !== "hidden") {
          text += `\n    [${type}] ${name}${required}`;
        }
      }

      return text;
    });

    return { content: [{ type: "text" as const, text: output.join("\n\n") }] };
  }
);

const readTool = tool(
  "read_page",
  "Read the full page content (not just interactive elements). Use when you need to read text, articles, or results.",
  {},
  async () => {
    const p = await getPage();
    const tree = p.accessibilityTree();
    return {
      content: [{
        type: "text" as const,
        text: `📄 ${p.title} (${p.url})\n\n${tree.serialize({ maxLength: 8000 })}`,
      }],
    };
  }
);

const serverConfig = createSdkMcpServer({
  name: "browser",
  version: "1.0.0",
  tools: [navigateTool, typeTool, clickTool, selectTool, formsTool, readTool],
});

const prompt = process.argv[2];
if (!prompt) {
  console.error("Usage: bun examples/agent-form.ts \"<task involving forms>\"");
  process.exit(1);
}

console.log(`\n📝 Form Automation Agent: ${prompt}\n`);

const systemPrompt = `You are a form automation agent with a virtual web browser. Your job is to navigate websites, find forms, fill them out correctly, and submit them.

You have these tools:
- navigate: go to a URL and see all interactive elements with @refs
- type: fill a text input by @ref (e.g. type @e3 "hello")
- click: click buttons, links, checkboxes, radios by @ref
- select: choose dropdown options by @ref
- inspect_forms: see current form data and validation errors
- read_page: read the full page text (for reading results after submission)

Strategy:
1. Navigate to the target page
2. Read the interactive snapshot to identify form fields and their @refs
3. Fill each field using the appropriate tool (type for text, click for checkboxes, select for dropdowns)
4. Use inspect_forms to check if the form validates before submitting
5. Click the submit button
6. Read the resulting page

IMPORTANT: Use @refs (like @e1, @e3) from the accessibility tree to target elements. This is more reliable than CSS selectors.`;

for await (const message of query({
  prompt: `${systemPrompt}\n\nTask: ${prompt}`,
  options: {
    model: "sonnet",
    mcpServers: { browser: serverConfig },
    allowedTools: [
      "mcp__browser__navigate",
      "mcp__browser__type",
      "mcp__browser__click",
      "mcp__browser__select",
      "mcp__browser__inspect_forms",
      "mcp__browser__read_page",
    ],
    maxTurns: 20,
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

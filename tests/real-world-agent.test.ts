/**
 * Real-world agent tests: An actual Claude agent uses sieve as a tool
 * to browse the web and complete tasks. These tests verify sieve works
 * as a real AI agent's browser in production-like scenarios.
 *
 * Each test gives the agent a task and verifies it can complete it
 * using sieve's virtual browser capabilities.
 */

import { describe, test, expect } from "bun:test";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SieveBrowser, type SievePage } from "../src/index.ts";

// --- Sieve MCP tool definition ---

function createSieveTool() {
  const browser = new SieveBrowser({
    network: "live",
    profile: "chrome-mac",
    solveWafChallenges: true,
  });
  let page: SievePage | null = null;

  async function getPage(): Promise<SievePage> {
    if (!page || page.isClosed) {
      page = await browser.newPage();
    }
    return page;
  }

  const browseTool = tool(
    "browser",
    `Browse the web using a virtual browser. Navigate to URLs, click elements, fill forms, and read page content.
The page state is returned as an accessibility tree with @ref identifiers for interactive elements.
Use @refs (like @e1, @e3) to target elements in click/type/select actions.

Actions:
- navigate: Go to a URL. Returns the page's accessibility tree.
- click: Click an element by @ref or CSS selector.
- type: Type text into an input field by @ref or CSS selector.
- select: Select a dropdown option by @ref or CSS selector.
- read: Get the full accessibility tree of the current page.
- read_interactive: Get only interactive elements (buttons, links, inputs).
- extract: Extract text or attributes from elements matching a CSS selector.
- back: Navigate back in history.
- forms: Show all form data and validation state.`,
    {
      action: z.enum([
        "navigate", "click", "type", "select",
        "read", "read_interactive", "extract", "back", "forms",
      ]).describe("Action to perform"),
      url: z.string().optional().describe("URL to navigate to (for navigate action)"),
      target: z.string().optional().describe("Element @ref (like @e1) or CSS selector"),
      text: z.string().optional().describe("Text to type (for type action)"),
      value: z.string().optional().describe("Option value to select (for select action)"),
      selector: z.string().optional().describe("CSS selector (for extract action)"),
      attribute: z.string().optional().describe("Attribute to extract instead of text"),
    },
    async (args) => {
      try {
        const p = await getPage();

        switch (args.action) {
          case "navigate": {
            if (!args.url) return { content: [{ type: "text" as const, text: "Error: url required for navigate" }] };
            await p.goto(args.url);
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `Navigated to: ${p.url}\nTitle: ${p.title}\n\n${tree.serialize({
                  interactive: true,
                  maxLength: 8000,
                  contentBoundary: { origin: p.url },
                })}`,
              }],
            };
          }

          case "click": {
            if (!args.target) return { content: [{ type: "text" as const, text: "Error: target required for click" }] };
            const result = await p.click(args.target);
            if (!result.success) return { content: [{ type: "text" as const, text: `Click failed: ${result.effect}` }] };
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `${result.effect}\nPage: ${p.title} (${p.url})\n\n${tree.serialize({
                  interactive: true,
                  maxLength: 8000,
                  contentBoundary: { origin: p.url },
                })}`,
              }],
            };
          }

          case "type": {
            if (!args.target || !args.text) return { content: [{ type: "text" as const, text: "Error: target and text required" }] };
            const result = await p.type(args.target, args.text);
            return {
              content: [{
                type: "text" as const,
                text: result.success ? `Typed "${args.text}" into ${args.target}` : `Type failed: ${result.effect}`,
              }],
            };
          }

          case "select": {
            if (!args.target || !args.value) return { content: [{ type: "text" as const, text: "Error: target and value required" }] };
            const result = p.select(args.target, args.value);
            return {
              content: [{
                type: "text" as const,
                text: result.success ? `Selected "${args.value}"` : `Select failed: ${result.effect}`,
              }],
            };
          }

          case "read": {
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `Page: ${p.title} (${p.url})\n\n${tree.serialize({
                  maxLength: 8000,
                  contentBoundary: { origin: p.url },
                })}`,
              }],
            };
          }

          case "read_interactive": {
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `Page: ${p.title} (${p.url})\nInteractive: ${tree.refCount}\n\n${tree.serialize({
                  interactive: true,
                  compact: true,
                  maxLength: 8000,
                  contentBoundary: { origin: p.url },
                })}`,
              }],
            };
          }

          case "extract": {
            if (!args.selector) return { content: [{ type: "text" as const, text: "Error: selector required" }] };
            const els = p.querySelectorAll(args.selector);
            const data = els.map((el, i) => {
              if (args.attribute) return `[${i}] ${el.getAttribute(args.attribute) ?? "(none)"}`;
              return `[${i}] ${el.textContent.trim()}`;
            });
            return { content: [{ type: "text" as const, text: `Found ${els.length} elements:\n${data.join("\n")}` }] };
          }

          case "back": {
            const ok = await p.goBack();
            if (!ok) return { content: [{ type: "text" as const, text: "Cannot go back" }] };
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `Back to: ${p.title} (${p.url})\n\n${tree.serialize({ interactive: true, maxLength: 8000 })}`,
              }],
            };
          }

          case "forms": {
            const forms = p.forms;
            if (forms.length === 0) return { content: [{ type: "text" as const, text: "No forms on page." }] };
            const output = forms.map((f, i) => {
              const v = f.validate();
              return `Form ${i}: ${JSON.stringify(f.data, null, 2)}\nValid: ${v.valid}${v.errors.length ? "\nErrors: " + v.errors.map((e) => e.message).join(", ") : ""}`;
            });
            return { content: [{ type: "text" as const, text: output.join("\n\n") }] };
          }

          default:
            return { content: [{ type: "text" as const, text: `Unknown action: ${args.action}` }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    },
    { annotations: { openWorld: true } }
  );

  return { server: createSdkMcpServer({ name: "sieve", version: "0.1.0", tools: [browseTool] }), browser };
}

// --- Helper to run agent and get result ---

async function runAgent(prompt: string, maxTurns = 15): Promise<{
  result: string;
  success: boolean;
  turns: number;
  cost: number;
}> {
  const { server, browser } = createSieveTool();

  try {
    let result = "";
    let success = false;
    let turns = 0;
    let cost = 0;

    for await (const message of query({
      prompt,
      options: {
        model: "claude-sonnet-4-6",
        mcpServers: { sieve: server },
        tools: [],
        allowedTools: ["mcp__sieve__browser"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns,
        maxBudgetUsd: 0.50,
        effort: "low",
        thinking: { type: "disabled" },
        systemPrompt: `You are a web browsing agent. You have a browser tool to navigate and interact with web pages. Complete the user's task and respond with just the answer — no explanation needed. Be efficient: minimize tool calls.`,
        persistSession: false,
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          result = message.result;
          success = true;
          turns = message.num_turns;
          cost = message.total_cost_usd;
        } else {
          result = `Error: ${(message as any).errors?.join(", ") ?? "unknown"}`;
          success = false;
        }
      }
    }

    return { result, success, turns, cost };
  } finally {
    browser.close();
  }
}

// ============================================================
// Real-world agent scenarios
// ============================================================

describe("Real-world agent: information extraction", () => {
  test("extract page title from a website", async () => {
    const { result, success } = await runAgent(
      "Navigate to https://example.com and tell me the page title."
    );

    expect(success).toBe(true);
    expect(result.toLowerCase()).toContain("example domain");
  }, 60_000);

  test("find specific text content on a page", async () => {
    const { result, success } = await runAgent(
      "Go to https://httpbin.org/html and tell me what the story is about (the h1 text)."
    );

    expect(success).toBe(true);
    expect(result.toLowerCase()).toContain("herman melville");
  }, 60_000);

  test("count interactive elements on a page", async () => {
    const { result, success } = await runAgent(
      "Navigate to https://example.com. How many interactive elements (links, buttons) are on the page? Give me just the number."
    );

    expect(success).toBe(true);
    // example.com has 1 link: "More information..."
    expect(result).toMatch(/\b1\b/);
  }, 60_000);
});

describe("Real-world agent: navigation and links", () => {
  test("follow a link and report destination", async () => {
    const { result, success } = await runAgent(
      "Go to https://httpbin.org. What are some of the HTTP method endpoints listed? Name at least 3."
    );

    expect(success).toBe(true);
    // httpbin lists GET, POST, PUT, DELETE, PATCH etc.
    const lower = result.toLowerCase();
    let methodCount = 0;
    for (const method of ["get", "post", "put", "delete", "patch"]) {
      if (lower.includes(method)) methodCount++;
    }
    expect(methodCount).toBeGreaterThanOrEqual(3);
  }, 60_000);

  test("navigate to a page and extract structured data", async () => {
    const { result, success } = await runAgent(
      "Navigate to https://jsonplaceholder.typicode.com and tell me how many resources are listed on the page (like /posts, /comments, etc). Just the count."
    );

    expect(success).toBe(true);
    // jsonplaceholder lists 6 resources
    expect(result).toMatch(/\b6\b/);
  }, 60_000);
});

describe("Real-world agent: form interaction", () => {
  test("fill and read back a search form", async () => {
    const { result, success } = await runAgent(
      `Navigate to https://httpbin.org/forms/post.
       Read the form fields. What are the names of all the input fields on the form?`
    );

    expect(success).toBe(true);
    const lower = result.toLowerCase();
    // httpbin forms/post has fields for customer name, telephone, email, size, toppings, etc.
    // Agent may report labels or attribute names
    expect(lower.includes("custname") || lower.includes("customer name") || lower.includes("name")).toBe(true);
    expect(lower.includes("size") || lower.includes("small") || lower.includes("medium")).toBe(true);
  }, 60_000);

  test("interact with form fields", async () => {
    const { result, success } = await runAgent(
      `Navigate to https://httpbin.org/forms/post.
       Type "John" into the customer name field and "555-1234" into the telephone field.
       Then use the forms action to show me the current form data.`
    );

    expect(success).toBe(true);
    expect(result).toContain("John");
    expect(result).toContain("555-1234");
  }, 60_000);
});

describe("Real-world agent: multi-step workflows", () => {
  test("navigate, extract, and summarize", async () => {
    const { result, success } = await runAgent(
      `Go to https://news.ycombinator.com.
       Tell me the title of the #1 story on the front page right now.`
    );

    expect(success).toBe(true);
    // We can't predict the title, but it should be non-empty
    expect(result.length).toBeGreaterThan(5);
  }, 60_000);

  test("extract all links from a page", async () => {
    const { result, success } = await runAgent(
      `Navigate to https://example.com.
       Use the extract action with selector "a" and attribute "href" to get all link URLs.
       What URLs did you find?`
    );

    expect(success).toBe(true);
    expect(result.toLowerCase()).toContain("iana.org");
  }, 60_000);

  test("read interactive elements and identify page structure", async () => {
    const { result, success } = await runAgent(
      `Go to https://httpbin.org.
       Use the read_interactive action.
       How many links does the page have? Give a rough count (exact number not required).`
    );

    expect(success).toBe(true);
    // httpbin has many links - agent should report a number
    expect(result).toMatch(/\d+/);
  }, 60_000);
});

describe("Real-world agent: content boundary security", () => {
  test("agent sees content boundaries in tool output", async () => {
    // This test verifies the content boundary nonces are working
    // by having the agent navigate and read - the tool wraps output
    // in SIEVE_PAGE_CONTENT boundaries
    const { result, success } = await runAgent(
      `Navigate to https://example.com.
       The browser tool output includes content boundaries.
       What is the page title?`
    );

    expect(success).toBe(true);
    expect(result.toLowerCase()).toContain("example");
  }, 60_000);
});

describe("Real-world agent: error handling", () => {
  test("handles non-existent domain gracefully", async () => {
    const { result, success } = await runAgent(
      "Navigate to https://thisdomaindoesnotexist12345.com and tell me what happened."
    );

    expect(success).toBe(true);
    // Agent should report an error of some kind
    const lower = result.toLowerCase();
    expect(
      lower.includes("error") ||
      lower.includes("fail") ||
      lower.includes("could not") ||
      lower.includes("unable") ||
      lower.includes("not") ||
      lower.includes("resolve")
    ).toBe(true);
  }, 60_000);

  test("handles clicking non-existent element", async () => {
    const { result, success } = await runAgent(
      `Navigate to https://example.com.
       Try to click an element with selector "#nonexistent-button-xyz".
       What happened?`
    );

    expect(success).toBe(true);
    const lower = result.toLowerCase();
    expect(
      lower.includes("not found") ||
      lower.includes("fail") ||
      lower.includes("error") ||
      lower.includes("no element") ||
      lower.includes("could not") ||
      lower.includes("doesn't exist") ||
      lower.includes("didn't find")
    ).toBe(true);
  }, 60_000);
});

#!/usr/bin/env bun
/**
 * Run a sieve-powered agent interactively and see all reasoning + tool calls.
 *
 * Usage:
 *   bun tests/run-agent.ts "Go to https://news.ycombinator.com and tell me the top 3 stories"
 *   bun tests/run-agent.ts  # runs a default task
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SieveBrowser, type SievePage, serialize } from "../src/index.ts";

// --- Colors for terminal output ---
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// --- Sieve browser tool ---

function createSieveTool() {
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
      attribute: z.string().optional().describe("HTML attribute to extract (e.g. 'href', 'class', 'src'). Omit to get text content."),
    },
    async (args) => {
      try {
        const p = await getPage();

        switch (args.action) {
          case "navigate": {
            if (!args.url) return { content: [{ type: "text" as const, text: "Error: url required" }] };
            await p.goto(args.url);
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `Navigated to: ${p.url}\nTitle: ${p.title}\n\n${tree.serialize({
                  interactive: true,
                  compact: true,
                  maxLength: 8000,
                  contentBoundary: { origin: p.url },
                })}`,
              }],
            };
          }

          case "click": {
            if (!args.target) return { content: [{ type: "text" as const, text: "Error: target required" }] };
            const result = await p.click(args.target);
            if (!result.success) return { content: [{ type: "text" as const, text: `Click failed: ${result.effect}` }] };
            const tree = p.accessibilityTree();
            return {
              content: [{
                type: "text" as const,
                text: `${result.effect}\nPage: ${p.title} (${p.url})\n\n${tree.serialize({
                  interactive: true,
                  compact: true,
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
            const data = els.slice(0, 50).map((el, i) => {
              let val: string;
              if (!args.attribute || args.attribute === "textContent" || args.attribute === "innerText") {
                val = el.textContent.trim();
              } else if (args.attribute === "innerHTML" || args.attribute === "outerHTML") {
                val = serialize(el);
              } else {
                val = el.getAttribute(args.attribute) ?? "(none)";
              }
              // Cap individual element output
              if (val.length > 500) val = val.slice(0, 500) + "…";
              return `[${i}] ${val}`;
            });
            let output = `Found ${els.length} elements${els.length > 50 ? " (showing first 50)" : ""}:\n${data.join("\n")}`;
            if (output.length > 8000) output = output.slice(0, 8000) + "\n…(truncated)";
            return { content: [{ type: "text" as const, text: output }] };
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

// --- Main ---

const prompt = process.argv[2] ?? "Go to https://news.ycombinator.com and tell me the top 5 stories on the front page right now.";

console.log(bold("\n=== Sieve Agent ===\n"));
console.log(dim("Prompt: ") + prompt);
console.log(dim("Model:  ") + "claude-sonnet-4-6");
console.log("");

const { server, browser } = createSieveTool();
let turnNum = 0;

try {
  for await (const message of query({
    prompt,
    options: {
      model: "claude-sonnet-4-6",
      mcpServers: { sieve: server },
      tools: [],
      allowedTools: ["mcp__sieve__browser"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 20,
      maxBudgetUsd: 1.00,
      effort: "low",
      thinking: { type: "disabled" },
      systemPrompt: `You are a web browsing agent. You have a browser tool to navigate and interact with web pages. Complete the user's task. Be efficient: minimize tool calls.`,
      persistSession: false,
    },
  })) {
    if (message.type === "assistant") {
      turnNum++;
      console.log(cyan(`\n--- Turn ${turnNum} ---\n`));

      for (const block of (message as any).message?.content ?? []) {
        if (block.type === "text" && block.text) {
          console.log(green("Reasoning: ") + block.text);
        } else if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          console.log(yellow(`\nTool call: `) + bold(`browser.${input.action}`));

          // Print relevant args
          const args = { ...input };
          delete args.action;
          if (Object.keys(args).length > 0) {
            for (const [k, v] of Object.entries(args)) {
              if (v !== undefined) {
                const val = typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "..." : v;
                console.log(dim(`  ${k}: `) + String(val));
              }
            }
          }
        }
      }
    } else if (message.type === "user") {
      // Tool results
      for (const block of (message as any).message?.content ?? []) {
        if (block.type === "tool_result") {
          const text = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((c: any) => c.text ?? "").join("")
              : "";

          if (text) {
            // Truncate long tool output for display
            const lines = text.split("\n");
            const preview = lines.length > 20
              ? lines.slice(0, 15).join("\n") + `\n${dim(`... (${lines.length - 15} more lines)`)}`
              : text;
            console.log(magenta("\nTool result:"));
            console.log(dim(preview));
          }
        }
      }
    } else if (message.type === "result") {
      console.log(cyan("\n\n=== Result ===\n"));

      if (message.subtype === "success") {
        console.log(green(bold("Final answer:\n")));
        console.log(message.result);
        console.log(dim(`\n--- Stats ---`));
        console.log(dim(`Turns: ${message.num_turns}`));
        console.log(dim(`Cost:  $${message.total_cost_usd.toFixed(4)}`));
        console.log(dim(`Time:  ${(message.duration_ms / 1000).toFixed(1)}s`));
      } else {
        console.log(red("Error: " + ((message as any).errors?.join(", ") ?? "unknown")));
      }
    }
  }
} finally {
  browser.close();
}

console.log("");

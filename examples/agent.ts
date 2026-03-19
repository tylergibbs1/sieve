/**
 * Web browsing agent powered by Claude Agent SDK + sieve.
 *
 * Gives Claude a virtual browser it can navigate, read, click, type, and
 * extract data from — without launching Chromium.
 *
 * Usage:
 *   bun examples/agent.ts "Go to books.toscrape.com and find the 3 cheapest books"
 *   bun examples/agent.ts "Go to news.ycombinator.com and summarize the top 5 stories"
 *   bun examples/agent.ts "Go to https://www.gov.uk and find information about renewing a passport"
 */

import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  SieveBrowser,
  SievePage,
  querySelector,
  querySelectorAll,
  type ClickResult,
} from "../src/index.ts";

// --- Shared browser instance ---

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

// --- Tools ---

const browseTool = tool(
  "navigate",
  "Navigate to a URL. Returns the page title and accessibility tree showing the page structure.",
  {
    url: z.string().describe("The URL to navigate to"),
  },
  async (args) => {
    const p = await getPage();
    try {
      await p.goto(args.url);
      const tree = p.accessibilityTree().serialize();
      return {
        content: [
          {
            type: "text" as const,
            text: `Navigated to: ${p.url}\nTitle: ${p.title}\n\n${tree}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Navigation failed: ${err.message}` }],
      };
    }
  }
);

const clickTool = tool(
  "click",
  "Click an element on the current page by CSS selector. Returns what happened (navigation, form submit, toggle, etc).",
  {
    selector: z.string().describe("CSS selector of the element to click"),
  },
  async (args) => {
    const p = await getPage();
    const result = await p.click(args.selector);
    let response = `Click ${result.success ? "succeeded" : "failed"}: ${result.effect}`;

    if (result.success) {
      // Show updated a11y tree after click
      const tree = p.accessibilityTree().serialize();
      response += `\n\nPage after click:\nTitle: ${p.title}\nURL: ${p.url}\n\n${tree}`;
    }

    return {
      content: [{ type: "text" as const, text: response }],
    };
  }
);

const typeTool = tool(
  "type_text",
  "Type text into an input or textarea on the current page.",
  {
    selector: z.string().describe("CSS selector of the input element"),
    text: z.string().describe("Text to type"),
  },
  async (args) => {
    const p = await getPage();
    const result = await p.type(args.selector, args.text);
    return {
      content: [
        {
          type: "text" as const,
          text: `Type ${result.success ? "succeeded" : "failed"}: ${result.effect}`,
        },
      ],
    };
  }
);

const selectTool = tool(
  "select_option",
  "Select an option in a <select> dropdown.",
  {
    selector: z.string().describe("CSS selector of the select element"),
    value: z.string().describe("Value to select"),
  },
  async (args) => {
    const p = await getPage();
    const result = p.select(args.selector, args.value);
    return {
      content: [
        {
          type: "text" as const,
          text: `Select ${result.success ? "succeeded" : "failed"}: ${result.effect}`,
        },
      ],
    };
  }
);

const readPageTool = tool(
  "read_page",
  "Read the current page's accessibility tree. Use this to understand page structure, find elements, and read content.",
  {},
  async () => {
    const p = await getPage();
    const tree = p.accessibilityTree().serialize();
    return {
      content: [
        {
          type: "text" as const,
          text: `Current page: ${p.title} (${p.url})\n\n${tree}`,
        },
      ],
    };
  }
);

const extractTool = tool(
  "extract_data",
  "Extract data from the current page using CSS selectors. Returns the text content of all matching elements.",
  {
    selector: z.string().describe("CSS selector to match elements"),
    attribute: z
      .string()
      .optional()
      .describe("Optional: extract an attribute value instead of text content"),
  },
  async (args) => {
    const p = await getPage();
    const elements = p.querySelectorAll(args.selector);

    const data = elements.map((el, i) => {
      if (args.attribute) {
        return `[${i}] ${el.getAttribute(args.attribute) ?? "(no attribute)"}`;
      }
      return `[${i}] ${el.textContent.trim()}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${elements.length} elements matching "${args.selector}":\n${data.join("\n")}`,
        },
      ],
    };
  }
);

const formDataTool = tool(
  "get_form_data",
  "Get the current form data for a form on the page.",
  {
    formSelector: z
      .string()
      .optional()
      .describe("CSS selector for the form (default: first form on page)"),
  },
  async (args) => {
    const p = await getPage();
    const forms = p.forms;
    if (forms.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No forms found on page." }],
      };
    }

    const form = args.formSelector
      ? forms.find((f) => {
          const el = p.querySelector(args.formSelector!);
          return el === f.element;
        }) ?? forms[0]!
      : forms[0]!;

    const data = form.data;
    const validation = form.validate();

    return {
      content: [
        {
          type: "text" as const,
          text: `Form data:\n${JSON.stringify(data, null, 2)}\n\nValid: ${validation.valid}${
            validation.errors.length > 0
              ? "\nErrors:\n" +
                validation.errors.map((e) => `  - ${e.message}`).join("\n")
              : ""
          }`,
        },
      ],
    };
  }
);

const goBackTool = tool(
  "go_back",
  "Navigate back in browser history.",
  {},
  async () => {
    const p = await getPage();
    const success = await p.goBack();
    if (!success) {
      return {
        content: [{ type: "text" as const, text: "Cannot go back — at start of history." }],
      };
    }
    const tree = p.accessibilityTree().serialize();
    return {
      content: [
        {
          type: "text" as const,
          text: `Went back to: ${p.title} (${p.url})\n\n${tree}`,
        },
      ],
    };
  }
);

// --- MCP Server ---

const browserServer = createSdkMcpServer({
  name: "browser",
  version: "1.0.0",
  tools: [
    browseTool,
    clickTool,
    typeTool,
    selectTool,
    readPageTool,
    extractTool,
    formDataTool,
    goBackTool,
  ],
});

// --- Run the agent ---

const prompt = process.argv[2];
if (!prompt) {
  console.error(
    "Usage: bun examples/agent.ts <prompt>\n\nExamples:\n" +
      '  bun examples/agent.ts "Go to books.toscrape.com and find the 3 cheapest books"\n' +
      '  bun examples/agent.ts "Go to news.ycombinator.com and summarize the top 5 stories"'
  );
  process.exit(1);
}

console.log(`\n🤖 Agent prompt: ${prompt}\n`);

for await (const message of query({
  prompt,
  options: {
    model: "sonnet",
    mcpServers: {
      browser: browserServer,
    },
    allowedTools: [
      "mcp__browser__navigate",
      "mcp__browser__click",
      "mcp__browser__type_text",
      "mcp__browser__select_option",
      "mcp__browser__read_page",
      "mcp__browser__extract_data",
      "mcp__browser__get_form_data",
      "mcp__browser__go_back",
    ],
    maxTurns: 20,
  },
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block && block.text) {
        console.log(block.text);
      } else if ("name" in block) {
        const input = "input" in block ? JSON.stringify(block.input) : "";
        console.log(`\n🔧 Tool: ${block.name} ${input}\n`);
      }
    }
  } else if (message.type === "result") {
    console.log(`\n✅ Done (${message.subtype})\n`);
  }
}

browser.close();

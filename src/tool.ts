/**
 * sieve-tool: AI SDK tool wrapper.
 *
 * Exposes sieve as a single tool for Vercel AI SDK's generateText/streamText.
 * The agent gets one "browser" tool that accepts commands like navigate, click,
 * type, read, extract — and returns accessibility tree snapshots.
 *
 * Usage with Vercel AI SDK:
 *
 * ```typescript
 * import { createBrowserTool } from "sieve/tool";
 * import { generateText } from "ai";
 *
 * const browserTool = createBrowserTool({ network: "live" });
 *
 * const result = await generateText({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   tools: { browser: browserTool },
 *   prompt: "Go to example.com and find the pricing page.",
 * });
 * ```
 */

import { SieveBrowser, type BrowserOptions } from "./browser.ts";
import { SievePage } from "./page.ts";
import { querySelector, querySelectorAll } from "./css/selector.ts";

export type BrowserAction =
  | { action: "navigate"; url: string }
  | { action: "click"; target: string }
  | { action: "type"; target: string; text: string }
  | { action: "select"; target: string; value: string }
  | { action: "read" }
  | { action: "read_interactive" }
  | { action: "extract"; selector: string; attribute?: string }
  | { action: "back" }
  | { action: "forms" };

export interface BrowserToolOptions extends BrowserOptions {
  /** Maximum length of a11y tree output. Default: 8000 */
  maxOutputLength?: number;
}

/**
 * Create a browser tool definition compatible with Vercel AI SDK.
 * Returns a tool object with `description`, `parameters`, and `execute`.
 */
export function createBrowserTool(options: BrowserToolOptions = {}) {
  const browser = new SieveBrowser({
    network: "live",
    profile: "chrome-mac",
    solveWafChallenges: true,
    ...options,
  });

  const maxOutput = options.maxOutputLength ?? 8000;
  let page: SievePage | null = null;

  async function getPage(): Promise<SievePage> {
    if (!page || page.isClosed) {
      page = await browser.newPage();
    }
    return page;
  }

  return {
    description:
      "Browse the web. Navigate to URLs, click elements, fill forms, and read page content. " +
      "The page state is returned as an accessibility tree with @ref identifiers for interactive elements. " +
      "Use @refs (like @e1, @e3) to target elements in click/type/select actions.",

    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: [
            "navigate",
            "click",
            "type",
            "select",
            "read",
            "read_interactive",
            "extract",
            "back",
            "forms",
          ],
          description:
            "Action to perform. 'navigate' goes to a URL. 'click' clicks an element by @ref or CSS selector. " +
            "'type' fills an input. 'select' chooses a dropdown option. 'read' returns the full a11y tree. " +
            "'read_interactive' returns only actionable elements. 'extract' gets text from matching elements. " +
            "'back' navigates back. 'forms' shows form data and validation state.",
        },
        url: {
          type: "string" as const,
          description: "URL to navigate to (for 'navigate' action).",
        },
        target: {
          type: "string" as const,
          description: "Element @ref (like @e1) or CSS selector (for click/type/select actions).",
        },
        text: {
          type: "string" as const,
          description: "Text to type (for 'type' action).",
        },
        value: {
          type: "string" as const,
          description: "Option value to select (for 'select' action).",
        },
        selector: {
          type: "string" as const,
          description: "CSS selector to match elements (for 'extract' action).",
        },
        attribute: {
          type: "string" as const,
          description: "Optional attribute to extract instead of text content.",
        },
      },
      required: ["action"],
    },

    async execute(input: BrowserAction): Promise<string> {
      try {
        const p = await getPage();

        switch (input.action) {
          case "navigate": {
            await p.goto(input.url);
            const tree = p.accessibilityTree();
            return `Navigated to: ${p.url}\nTitle: ${p.title}\n\n${tree.serialize({ interactive: true, maxLength: maxOutput })}`;
          }

          case "click": {
            const result = await p.click(input.target);
            if (!result.success) return `Click failed: ${result.effect}`;
            const tree = p.accessibilityTree();
            return `${result.effect}\nPage: ${p.title} (${p.url})\n\n${tree.serialize({ interactive: true, maxLength: maxOutput })}`;
          }

          case "type": {
            const result = await p.type(input.target, input.text);
            return result.success
              ? `Typed "${input.text}" into ${input.target}`
              : `Type failed: ${result.effect}`;
          }

          case "select": {
            const result = p.select(input.target, input.value);
            return result.success
              ? `Selected "${input.value}" in ${input.target}`
              : `Select failed: ${result.effect}`;
          }

          case "read": {
            const tree = p.accessibilityTree();
            return `Page: ${p.title} (${p.url})\n\n${tree.serialize({ maxLength: maxOutput })}`;
          }

          case "read_interactive": {
            const tree = p.accessibilityTree();
            return `Page: ${p.title} (${p.url})\nInteractive elements: ${tree.refCount}\n\n${tree.serialize({ interactive: true, maxLength: maxOutput })}`;
          }

          case "extract": {
            const els = p.querySelectorAll(input.selector);
            const data = els.map((el, i) => {
              if (input.attribute) {
                return `[${i}] ${el.getAttribute(input.attribute) ?? "(none)"}`;
              }
              return `[${i}] ${el.textContent.trim()}`;
            });
            return `Found ${els.length} elements:\n${data.join("\n")}`;
          }

          case "back": {
            const ok = await p.goBack();
            if (!ok) return "Cannot go back — at start of history.";
            const tree = p.accessibilityTree();
            return `Went back to: ${p.title} (${p.url})\n\n${tree.serialize({ interactive: true, maxLength: maxOutput })}`;
          }

          case "forms": {
            const forms = p.forms;
            if (forms.length === 0) return "No forms on page.";
            const output = forms.map((f, i) => {
              const v = f.validate();
              return `Form ${i}: ${JSON.stringify(f.data, null, 2)}\nValid: ${v.valid}${
                v.errors.length ? "\nErrors: " + v.errors.map((e) => e.message).join(", ") : ""
              }`;
            });
            return output.join("\n\n");
          }

          default:
            return `Unknown action: ${(input as any).action}`;
        }
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  };
}

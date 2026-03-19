/**
 * HTML parser: converts an HTML string into a SieveDocument.
 * Uses htmlparser2 for tokenization.
 * Optionally preprocesses with Bun's HTMLRewriter for stripping/sanitization.
 */

import { Parser, type Handler } from "htmlparser2";
import { SieveDocument } from "./document.ts";
import { SieveElement } from "./element.ts";
import { SieveText, SieveComment } from "./text.ts";
import { SieveDocumentType } from "./document.ts";
import type { SieveNode } from "./node.ts";
import { rewriteHTMLAsync, AGENT_STRIP_RULES, type RewriteRule } from "./rewriter.ts";

export interface ParseOptions {
  /** HTMLRewriter rules to apply before DOM construction. */
  rewriteRules?: RewriteRule[];
  /** Strip scripts, styles, SVGs etc. for agent consumption. */
  stripForAgent?: boolean;
}

/** Synchronous parse — no preprocessing. */
export function parseHTML(html: string): SieveDocument {
  return parseRaw(html);
}

/**
 * Async parse with HTMLRewriter preprocessing.
 * Strips scripts/styles/SVGs and applies custom rewrite rules
 * using Bun's native HTMLRewriter before building the DOM.
 */
export async function parseHTMLAsync(html: string, options: ParseOptions = {}): Promise<SieveDocument> {
  let input = html;

  if (options.stripForAgent) {
    input = await rewriteHTMLAsync(input, AGENT_STRIP_RULES);
  }
  if (options.rewriteRules) {
    input = await rewriteHTMLAsync(input, options.rewriteRules);
  }

  return parseRaw(input);
}

/** Core parser — htmlparser2 tokenization into SieveDocument. */
function parseRaw(html: string): SieveDocument {
  const doc = new SieveDocument();
  const stack: SieveNode[] = [doc];

  function current(): SieveNode {
    return stack[stack.length - 1]!;
  }

  const handler: Partial<Handler> = {
    onprocessinginstruction(name: string, _data: string) {
      if (name.toLowerCase() === "!doctype") {
        current().appendChild(new SieveDocumentType());
      }
    },

    onopentag(name: string, attribs: Record<string, string>) {
      const el = new SieveElement(name);
      for (const [k, v] of Object.entries(attribs)) {
        el.setAttribute(k, v);
      }
      current().appendChild(el);

      if (!el.isVoid) {
        stack.push(el);
      }
    },

    ontext(text: string) {
      current().appendChild(new SieveText(text));
    },

    oncomment(data: string) {
      current().appendChild(new SieveComment(data));
    },

    onclosetag(name: string) {
      const el = new SieveElement(name);
      if (el.isVoid) return;
      if (stack.length > 1) {
        stack.pop();
      }
    },
  };

  const parser = new Parser(handler as Handler, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
    recognizeSelfClosing: true,
  });

  parser.write(html);
  parser.end();

  return doc;
}

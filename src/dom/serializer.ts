/**
 * Serializes a DOM tree back to an HTML string.
 * Uses Bun.escapeHTML for native-speed HTML entity escaping (20 GB/s).
 */

import { SieveElement } from "./element.ts";
import { SieveText, SieveComment } from "./text.ts";
import { SieveDocument, SieveDocumentType } from "./document.ts";
import type { SieveNode } from "./node.ts";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Escape text content. Bun.escapeHTML handles &, <, >, ", ' at native speed. */
function escapeText(text: string): string {
  return Bun.escapeHTML(text);
}

/** Escape attribute values. Bun.escapeHTML covers all needed characters. */
function escapeAttr(text: string): string {
  return Bun.escapeHTML(text);
}

function serializeNode(node: SieveNode): string {
  if (node instanceof SieveDocument) {
    return node.childNodes.map(serializeNode).join("");
  }

  if (node instanceof SieveDocumentType) {
    return "<!DOCTYPE html>";
  }

  if (node instanceof SieveText) {
    return escapeText(node.data);
  }

  if (node instanceof SieveComment) {
    return `<!--${node.data}-->`;
  }

  if (node instanceof SieveElement) {
    let html = `<${node.tagName}`;
    for (const [key, value] of node.attributes) {
      html += ` ${key}="${escapeAttr(value)}"`;
    }
    html += ">";

    if (VOID_ELEMENTS.has(node.tagName)) {
      return html;
    }

    // Raw text elements (script, style) don't escape content
    if (node.tagName === "script" || node.tagName === "style") {
      html += node.textContent;
    } else {
      html += node.childNodes.map(serializeNode).join("");
    }

    html += `</${node.tagName}>`;
    return html;
  }

  return "";
}

export function serialize(node: SieveNode): string {
  return serializeNode(node);
}

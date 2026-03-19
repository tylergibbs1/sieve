/**
 * Serializes a DOM tree back to an HTML string.
 */

import { SieveElement } from "./element.ts";
import { SieveText, SieveComment } from "./text.ts";
import { SieveDocument, SieveDocumentType } from "./document.ts";
import type { SieveNode } from "./node.ts";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function serializeNode(node: SieveNode): string {
  if (node instanceof SieveDocument) {
    return node.childNodes.map(serializeNode).join("");
  }

  if (node instanceof SieveDocumentType) {
    return "<!DOCTYPE html>";
  }

  if (node instanceof SieveText) {
    return escapeHtml(node.data);
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

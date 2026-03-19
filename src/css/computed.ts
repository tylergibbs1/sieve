/**
 * Minimal computed style resolution.
 * Determines visibility, display mode, and ARIA-relevant properties
 * without a full CSS engine. Uses inline styles and common attribute patterns.
 */

import { SieveElement } from "../dom/element.ts";

export interface ComputedStyle {
  display: string;
  visibility: string;
  hidden: boolean;
  ariaHidden: boolean;
}

/** Elements that are display:none by default in the browser. */
const HIDDEN_ELEMENTS = new Set([
  "head", "title", "meta", "link", "style", "script", "noscript",
  "template", "base",
]);

/** Elements that are display:inline by default. */
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
  "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u",
  "var", "wbr", "label", "button", "input", "select", "textarea",
  "img", "svg",
]);

function parseInlineStyles(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().toLowerCase();
    if (prop && value) map.set(prop, value);
  }
  return map;
}

export function getComputedStyle(el: SieveElement): ComputedStyle {
  const inlineStyle = el.getAttribute("style") ?? "";
  const styles = parseInlineStyles(inlineStyle);

  // Default display based on tag
  let display = HIDDEN_ELEMENTS.has(el.tagName)
    ? "none"
    : INLINE_ELEMENTS.has(el.tagName)
      ? "inline"
      : "block";

  // Override with inline style
  const inlineDisplay = styles.get("display");
  if (inlineDisplay) display = inlineDisplay;

  // Visibility
  let visibility = "visible";
  const inlineVisibility = styles.get("visibility");
  if (inlineVisibility) visibility = inlineVisibility;

  // Hidden attribute
  const hidden = el.hasAttribute("hidden") || display === "none";

  // aria-hidden
  const ariaHidden = el.getAttribute("aria-hidden") === "true";

  return { display, visibility, hidden, ariaHidden };
}

/** Whether this element should be considered visible for interaction purposes. */
export function isVisible(el: SieveElement): boolean {
  const style = getComputedStyle(el);
  if (style.hidden || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }

  // Walk ancestors — if any ancestor is hidden, so is this element
  let parent = el.parentNode;
  while (parent instanceof SieveElement) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.hidden) return false;
    if (parentStyle.visibility === "hidden") return false;
    parent = parent.parentNode;
  }

  return true;
}

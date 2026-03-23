/**
 * Builds an accessibility tree from the DOM.
 * The a11y tree is the primary interface for agents.
 */

import { SieveElement } from "../dom/element.ts";
import { SieveText } from "../dom/text.ts";
import { SieveDocument } from "../dom/document.ts";
import type { SieveNode } from "../dom/node.ts";
import { getComputedStyle, isVisible } from "../css/computed.ts";
import { getRole, getHeadingLevel } from "./roles.ts";
import { getInputValue, isChecked, getSelectedValues } from "../forms/state.ts";

export interface A11yNode {
  role: string;
  name: string;
  description?: string;
  level?: number;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  required?: boolean;
  expanded?: boolean;
  selected?: boolean;
  readonly?: boolean;
  placeholder?: string;
  /** Stable ref for agent interaction (@e1, @e2, etc). Assigned by assignRefs(). */
  ref?: string;
  children: A11yNode[];
  /** Back-reference to the DOM element. */
  element?: SieveElement;
}

/** Elements that are "transparent" — they pass through to children in the a11y tree. */
const TRANSPARENT_ROLES = new Set([
  null, undefined, "presentation", "none", "generic",
]);

/** Tags to always skip in the a11y tree. */
const SKIP_TAGS = new Set([
  "head", "script", "style", "template", "noscript", "meta", "link", "base",
]);

/** Compute the accessible name for an element, given its resolved role. */
function computeName(el: SieveElement, role: string | null = null): string {
  // aria-label takes precedence
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // aria-labelledby — we'd need to resolve references, simplified for now
  // to just use the attribute value

  // Special cases by tag
  switch (el.tagName) {
    case "img":
      return el.getAttribute("alt") ?? "";
    case "input":
    case "textarea":
    case "select": {
      // Look for associated label
      const id = el.id;
      if (id) {
        // Walk up to find the document, then look for label[for=id]
        let root: SieveNode = el;
        while (root.parentNode) root = root.parentNode;
        if (root instanceof SieveDocument) {
          const label = root.querySelector(`label[for="${id}"]`);
          if (label) return label.textContent.trim();
        }
      }
      // Check if wrapped in a label
      let parent = el.parentNode;
      while (parent) {
        if (parent instanceof SieveElement && parent.tagName === "label") {
          // Get label text minus the input's own text
          return getDirectTextContent(parent).trim();
        }
        parent = parent.parentNode;
      }
      return el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? "";
    }
    case "a":
      return el.textContent.trim();
    case "button":
      return el.textContent.trim();
    case "fieldset": {
      // Look for legend child
      const legend = el.children.find((c) => c.tagName === "legend");
      return legend?.textContent.trim() ?? "";
    }
    case "figure": {
      const caption = el.children.find((c) => c.tagName === "figcaption");
      return caption?.textContent.trim() ?? "";
    }
    case "table": {
      const caption = el.children.find((c) => c.tagName === "caption");
      return caption?.textContent.trim() ?? "";
    }
    default:
      break;
  }

  // Headings, sections with labels
  if (el.tagName.match(/^h[1-6]$/)) {
    return el.textContent.trim();
  }

  // Cursor-interactive elements (div[onclick], div[tabindex], etc.)
  // that got a role via heuristics — use textContent like real buttons
  if (role === "button" || role === "textbox") {
    return el.textContent.trim();
  }

  // For landmark roles, try aria-label
  return el.getAttribute("aria-label") ?? "";
}

/** Get direct text content of an element, excluding child elements' text. */
function getDirectTextContent(el: SieveElement): string {
  let text = "";
  for (const child of el.childNodes) {
    if (child instanceof SieveText) {
      text += child.data;
    }
  }
  return text;
}

function buildNode(el: SieveElement, doc: SieveDocument | null): A11yNode | null {
  // Skip invisible elements — uses ancestor-aware visibility check
  if (!isVisible(el)) return null;
  const computed = getComputedStyle(el);
  if (computed.ariaHidden) return null;
  if (SKIP_TAGS.has(el.tagName)) return null;

  const role = getRole(el);
  const children: A11yNode[] = [];

  // Build children
  for (const child of el.childNodes) {
    if (child instanceof SieveElement) {
      const childNode = buildNode(child, doc);
      if (childNode) {
        children.push(childNode);
      }
    } else if (child instanceof SieveText) {
      const text = child.data.trim();
      if (text) {
        children.push({ role: "text", name: text, children: [] });
      }
    }
  }

  // Transparent elements: just pass through children
  if (TRANSPARENT_ROLES.has(role) && !el.getAttribute("aria-label")) {
    if (children.length === 1) return children[0]!;
    if (children.length === 0) return null;
    // Multiple children but transparent role — wrap in generic
    if (el.tagName === "div" || el.tagName === "span") {
      // Flatten: return children directly (caller will spread them)
      return { role: "generic", name: "", children, element: el };
    }
  }

  if (!role && children.length === 0) return null;

  const node: A11yNode = {
    role: role ?? "generic",
    name: computeName(el, role),
    children,
    element: el,
  };

  // Add properties based on role/tag
  const headingLevel = getHeadingLevel(el);
  if (headingLevel) node.level = headingLevel;

  if (el.tagName === "input" || el.tagName === "textarea") {
    const type = el.getAttribute("type")?.toLowerCase() ?? "text";
    if (type === "checkbox" || type === "radio") {
      node.checked = isChecked(el);
    }
    if (el.hasAttribute("disabled")) node.disabled = true;
    if (el.hasAttribute("required")) node.required = true;
    if (el.hasAttribute("readonly")) node.readonly = true;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) node.placeholder = placeholder;

    // Value — read from form state (WeakMap), not DOM attribute
    const value = getInputValue(el);
    if (value) node.value = value;
  }

  if (el.tagName === "select") {
    if (el.hasAttribute("disabled")) node.disabled = true;
    if (el.hasAttribute("required")) node.required = true;
    const selected = [...getSelectedValues(el)];
    if (selected.length > 0) node.value = selected.join(", ");
  }

  if (el.tagName === "button") {
    if (el.hasAttribute("disabled")) node.disabled = true;
  }

  if (el.tagName === "details") {
    node.expanded = el.hasAttribute("open");
  }

  if (el.tagName === "option") {
    node.selected = el.hasAttribute("selected");
  }

  // aria-expanded
  const ariaExpanded = el.getAttribute("aria-expanded");
  if (ariaExpanded !== null) {
    node.expanded = ariaExpanded === "true";
  }

  return node;
}

/** Flatten "generic" wrapper nodes that just pass through children. */
function flatten(nodes: A11yNode[]): A11yNode[] {
  const result: A11yNode[] = [];
  for (const node of nodes) {
    if (node.role === "generic" && !node.name) {
      result.push(...flatten(node.children));
    } else {
      node.children = flatten(node.children);
      result.push(node);
    }
  }
  return result;
}

export function buildAccessibilityTree(doc: SieveDocument): A11yNode {
  const root: A11yNode = {
    role: "page",
    name: doc.title,
    children: [],
  };

  const body = doc.body;
  if (!body) {
    // No body — try to build from all child elements
    for (const child of doc.childNodes) {
      if (child instanceof SieveElement) {
        const node = buildNode(child, doc);
        if (node) root.children.push(node);
      }
    }
  } else {
    for (const child of body.childNodes) {
      if (child instanceof SieveElement) {
        const node = buildNode(child, doc);
        if (node) root.children.push(node);
      } else if (child instanceof SieveText) {
        const text = child.data.trim();
        if (text) {
          root.children.push({ role: "text", name: text, children: [] });
        }
      }
    }
  }

  root.children = flatten(root.children);
  return root;
}

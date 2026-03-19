/**
 * Ref-based element addressing.
 *
 * Assigns stable @e1, @e2, @e3 references to interactive elements
 * in the accessibility tree. Agents use refs instead of fragile CSS
 * selectors: `click @e5` instead of `click button.submit:nth-child(2)`.
 *
 * Refs are assigned in tree order to interactive roles only:
 * buttons, links, inputs, selects, checkboxes, radios, tabs, etc.
 */

import type { A11yNode } from "./tree.ts";
import type { SieveElement } from "../dom/element.ts";

/** Roles that get refs (agent can interact with them). */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
]);

/** Roles that are structural landmarks — not interactive but useful context. */
const LANDMARK_ROLES = new Set([
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "form",
  "search",
  "region",
]);

export interface RefMap {
  /** @eN → A11yNode */
  byRef: Map<string, A11yNode>;
  /** @eN → SieveElement (for actions) */
  byRefElement: Map<string, SieveElement>;
  /** SieveElement → @eN */
  byElement: Map<SieveElement, string>;
  /** Total refs assigned. */
  count: number;
}

/** Assign @eN refs to interactive nodes in tree order. */
export function assignRefs(root: A11yNode): RefMap {
  const map: RefMap = {
    byRef: new Map(),
    byRefElement: new Map(),
    byElement: new Map(),
    count: 0,
  };

  let nextId = 1;

  function walk(node: A11yNode): void {
    if (isInteractive(node)) {
      const ref = `@e${nextId++}`;
      node.ref = ref;
      map.byRef.set(ref, node);
      if (node.element) {
        map.byRefElement.set(ref, node.element);
        map.byElement.set(node.element, ref);
      }
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  map.count = nextId - 1;
  return map;
}

/** Whether a node should get a ref. */
function isInteractive(node: A11yNode): boolean {
  return INTERACTIVE_ROLES.has(node.role);
}

/** Whether a node is a landmark. */
export function isLandmark(node: A11yNode): boolean {
  return LANDMARK_ROLES.has(node.role);
}

/** Whether a node is interactive or a landmark (useful for filtering). */
export function isSignificant(node: A11yNode): boolean {
  return INTERACTIVE_ROLES.has(node.role) || LANDMARK_ROLES.has(node.role);
}

/** Resolve a ref string like "@e5" to its element, or null. */
export function resolveRef(ref: string, refMap: RefMap): SieveElement | null {
  return refMap.byRefElement.get(ref) ?? null;
}

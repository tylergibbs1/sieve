/**
 * Convert Chrome's accessibility tree to sieve's A11yNode format.
 *
 * Chrome returns a flat list of AXNodes from Accessibility.getFullAXTree().
 * We reconstruct the tree, normalize roles/properties, and assign @refs
 * to interactive elements — same format as sieve's virtual DOM a11y tree.
 */

import type { A11yNode } from "../a11y/tree.ts";
import type { AXNode, AXProperty } from "./protocol.ts";

/** Roles that get @refs (interactive). Same set as src/a11y/refs.ts. */
const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio",
  "combobox", "listbox", "slider", "spinbutton", "switch", "tab",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem",
]);

/**
 * Ref map for CDP-backed pages.
 * Maps @eN refs to backendDOMNodeId instead of SieveElement.
 */
export interface CdpRefMap {
  /** @eN → A11yNode */
  byRef: Map<string, A11yNode>;
  /** @eN → backendDOMNodeId */
  byRefNodeId: Map<string, number>;
  /** backendDOMNodeId → @eN */
  byNodeId: Map<number, string>;
  /** Total refs assigned. */
  count: number;
}

/** Result of building the a11y tree from Chrome's AX data. */
export interface CdpA11yResult {
  root: A11yNode;
  refMap: CdpRefMap;
}

/**
 * Build sieve's A11yNode tree from Chrome's flat AXNode list.
 */
export function buildA11yTreeFromCdp(axNodes: AXNode[]): CdpA11yResult {
  // Index nodes by their CDP nodeId
  const nodeIndex = new Map<string, AXNode>();
  for (const node of axNodes) {
    nodeIndex.set(node.nodeId, node);
  }

  // Find root (first non-ignored node, typically "RootWebArea")
  const rootAx = axNodes.find((n) => !n.ignored && !n.parentId);
  if (!rootAx) {
    return {
      root: { role: "page", name: "", children: [] },
      refMap: emptyRefMap(),
    };
  }

  const refMap: CdpRefMap = {
    byRef: new Map(),
    byRefNodeId: new Map(),
    byNodeId: new Map(),
    count: 0,
  };

  let nextRefId = 1;

  function convertNode(ax: AXNode): A11yNode | null {
    if (ax.ignored) {
      // Still process children — ignored containers may have visible children
      const children = buildChildren(ax);
      if (children.length === 1) return children[0]!;
      if (children.length > 1) {
        return { role: "generic", name: "", children };
      }
      return null;
    }

    const role = normalizeRole(ax.role?.value as string | undefined);
    const name = (ax.name?.value as string) ?? "";

    const node: A11yNode = {
      role,
      name,
      children: [],
    };

    // Extract properties
    const props = extractProperties(ax);
    if (props.description) node.description = props.description;
    if (props.level !== undefined) node.level = props.level;
    if (props.value !== undefined) node.value = props.value;
    if (props.checked !== undefined) node.checked = props.checked;
    if (props.disabled) node.disabled = true;
    if (props.required) node.required = true;
    if (props.expanded !== undefined) node.expanded = props.expanded;
    if (props.selected) node.selected = true;
    if (props.readonly) node.readonly = true;
    if (props.placeholder) node.placeholder = props.placeholder;

    // Assign ref for interactive elements
    if (INTERACTIVE_ROLES.has(role)) {
      const ref = `@e${nextRefId++}`;
      node.ref = ref;
      refMap.byRef.set(ref, node);
      if (ax.backendDOMNodeId !== undefined) {
        refMap.byRefNodeId.set(ref, ax.backendDOMNodeId);
        refMap.byNodeId.set(ax.backendDOMNodeId, ref);
      }
    }

    node.children = buildChildren(ax);

    return node;
  }

  function buildChildren(ax: AXNode): A11yNode[] {
    const children: A11yNode[] = [];
    if (!ax.childIds) return children;

    for (const childId of ax.childIds) {
      const childAx = nodeIndex.get(childId);
      if (!childAx) continue;
      const child = convertNode(childAx);
      if (child) children.push(child);
    }

    return children;
  }

  const root = convertNode(rootAx) ?? { role: "page", name: "", children: [] };

  // Normalize root role
  if (root.role === "rootwebarea" || root.role === "webarea") {
    root.role = "page";
  }

  refMap.count = nextRefId - 1;

  return { root, refMap };
}

/** Normalize Chrome's role string to sieve's lowercase convention. */
function normalizeRole(role: string | undefined): string {
  if (!role) return "generic";

  const lower = role.toLowerCase();

  // Chrome-specific role mappings
  const mappings: Record<string, string> = {
    rootwebarea: "page",
    webarea: "page",
    statictext: "text",
    inlinetextbox: "text",
    genericcontainer: "generic",
    linebreak: "text",
    labeltext: "label",
    abbr: "text",
    paragraph: "paragraph",
    listmarker: "text",
  };

  return mappings[lower] ?? lower;
}

/** Extract typed properties from Chrome's AXNode property array. */
function extractProperties(ax: AXNode): {
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
} {
  const result: ReturnType<typeof extractProperties> = {};

  if (ax.description?.value) {
    result.description = ax.description.value as string;
  }

  // Value from the AXNode value field
  if (ax.value?.value !== undefined && ax.value.value !== "") {
    result.value = String(ax.value.value);
  }

  if (!ax.properties) return result;

  for (const prop of ax.properties) {
    switch (prop.name) {
      case "level":
        result.level = prop.value.value as number;
        break;
      case "checked":
        result.checked = prop.value.value === "true" || prop.value.value === true;
        break;
      case "disabled":
        result.disabled = prop.value.value === "true" || prop.value.value === true;
        break;
      case "required":
        result.required = prop.value.value === "true" || prop.value.value === true;
        break;
      case "expanded":
        result.expanded = prop.value.value === "true" || prop.value.value === true;
        break;
      case "selected":
        result.selected = prop.value.value === "true" || prop.value.value === true;
        break;
      case "readonly":
        result.readonly = prop.value.value === "true" || prop.value.value === true;
        break;
      case "placeholder":
        result.placeholder = prop.value.value as string;
        break;
      case "invalid":
        // Skip — not in sieve's A11yNode
        break;
    }
  }

  return result;
}

function emptyRefMap(): CdpRefMap {
  return {
    byRef: new Map(),
    byRefNodeId: new Map(),
    byNodeId: new Map(),
    count: 0,
  };
}

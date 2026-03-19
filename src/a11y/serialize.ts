/**
 * Serializes the accessibility tree to a compact text format
 * optimized for LLM token efficiency.
 */

import type { A11yNode } from "./tree.ts";
import { isSignificant, isLandmark } from "./refs.ts";

export interface SerializeOptions {
  /**
   * Only show interactive elements (buttons, links, inputs) and
   * landmarks (nav, main, banner). Drastically reduces output for agents.
   */
  interactive?: boolean;
  /**
   * Maximum output length in characters. Truncates with a
   * "... (truncated)" message when exceeded.
   */
  maxLength?: number;
  /**
   * Maximum tree depth. Nodes beyond this depth are collapsed.
   */
  maxDepth?: number;
}

function serializeProps(node: A11yNode): string {
  const parts: string[] = [];

  if (node.disabled) parts.push("disabled");
  if (node.required) parts.push("required");
  if (node.readonly) parts.push("readonly");
  if (node.checked === true) parts.push("checked");
  if (node.checked === false) parts.push("unchecked");
  if (node.expanded === true) parts.push("expanded");
  if (node.expanded === false) parts.push("collapsed");
  if (node.selected) parts.push("selected");
  if (node.placeholder) parts.push(`placeholder: "${node.placeholder}"`);
  if (node.value !== undefined && node.value !== "") parts.push(`value: "${node.value}"`);

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function serializeNode(
  node: A11yNode,
  indent: number,
  opts: SerializeOptions,
): string {
  // Depth limit
  if (opts.maxDepth !== undefined && indent > opts.maxDepth) {
    return "";
  }

  const prefix = "  ".repeat(indent);

  // Interactive mode: skip non-significant nodes but keep their significant children
  if (opts.interactive) {
    if (node.role === "text") {
      // In interactive mode, only show text that's a direct child of a landmark
      return "";
    }
    if (node.role === "page" || isSignificant(node) || node.ref) {
      // Show this node and recurse
    } else {
      // Not significant — skip but show significant descendants
      let result = "";
      for (const child of node.children) {
        result += serializeNode(child, indent, opts);
      }
      return result;
    }
  }

  // Text nodes are just their content
  if (node.role === "text") {
    return `${prefix}${node.name}\n`;
  }

  // Role label
  let roleLabel = node.role;
  if (node.level !== undefined && node.role === "heading") {
    roleLabel = `heading:${node.level}`;
  }

  // Build the line
  let line = `${prefix}[${roleLabel}]`;

  // Ref
  if (node.ref) {
    line += ` ${node.ref}`;
  }

  // Name
  if (node.name) {
    line += ` ${node.name}`;
  }

  // Properties (excluding level which is in the role label)
  const props = { ...node, level: undefined };
  const propStr = serializeProps(props);
  line += propStr;

  let result = `${line}\n`;

  // Children
  for (const child of node.children) {
    result += serializeNode(child, indent + 1, opts);
  }

  return result;
}

export function serializeAccessibilityTree(
  tree: A11yNode,
  options?: SerializeOptions,
): string {
  const opts = options ?? {};
  let result = serializeNode(tree, 0, opts).trimEnd();

  if (opts.maxLength && result.length > opts.maxLength) {
    result = result.slice(0, opts.maxLength - 30) + "\n\n... (truncated)";
  }

  return result;
}

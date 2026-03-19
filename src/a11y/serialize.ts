/**
 * Serializes the accessibility tree to a compact text format
 * optimized for LLM token efficiency.
 */

import type { A11yNode } from "./tree.ts";

function serializeProps(node: A11yNode): string {
  const parts: string[] = [];

  if (node.level !== undefined) parts.push(`level ${node.level}`);
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

function serializeNode(node: A11yNode, indent: number): string {
  const prefix = "  ".repeat(indent);

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
    result += serializeNode(child, indent + 1);
  }

  return result;
}

export function serializeAccessibilityTree(tree: A11yNode): string {
  return serializeNode(tree, 0).trimEnd();
}

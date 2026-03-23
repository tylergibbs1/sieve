/**
 * Serializes the accessibility tree to a compact text format
 * optimized for LLM token efficiency.
 */

import type { A11yNode } from "./tree.ts";
import { isSignificant, isLandmark } from "./refs.ts";
import { generateNonce } from "./nonce.ts";

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
  /**
   * Compact mode: strips structural-only nodes (generic, group, list,
   * rowgroup, row) while keeping their children. Reduces token count
   * for deep, wrapper-heavy DOMs.
   */
  compact?: boolean;
  /**
   * Wrap output in content boundaries with a CSPRNG nonce to prevent
   * prompt injection. Page content cannot spoof the boundary because
   * the nonce is cryptographically random.
   */
  contentBoundary?: { origin: string };
}

/** Roles that are purely structural — compact mode strips them. */
const STRUCTURAL_ROLES = new Set([
  "generic", "group", "list", "rowgroup", "row", "table",
]);

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

/** Build a map of role+name → count for disambiguation. */
function buildDisambiguationMap(root: A11yNode): Map<string, number> {
  const counts = new Map<string, number>();
  function walk(node: A11yNode): void {
    if (node.ref && node.name) {
      const key = `${node.role}:${node.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const child of node.children) walk(child);
  }
  walk(root);
  return counts;
}

function serializeNode(
  node: A11yNode,
  indent: number,
  opts: SerializeOptions,
  disambig: { counts: Map<string, number>; seen: Map<string, number> },
): string {
  // Depth limit
  if (opts.maxDepth !== undefined && indent > opts.maxDepth) {
    return "";
  }

  const prefix = "  ".repeat(indent);

  // Compact mode: skip structural-only nodes but keep their children
  if (opts.compact) {
    if (STRUCTURAL_ROLES.has(node.role) && !node.ref && !node.name && node.role !== "page") {
      let result = "";
      for (const child of node.children) {
        result += serializeNode(child, indent, opts, disambig);
      }
      return result;
    }
  }

  // Interactive mode: skip non-significant nodes but keep their significant children
  if (opts.interactive) {
    if (node.role === "text") {
      return "";
    }
    if (node.role === "page" || isSignificant(node) || node.ref) {
      // Show this node and recurse
    } else {
      let result = "";
      for (const child of node.children) {
        result += serializeNode(child, indent, opts, disambig);
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

  // Disambiguation: "(2 of 3)" when multiple refs share same role+name
  if (node.ref && node.name) {
    const key = `${node.role}:${node.name}`;
    const total = disambig.counts.get(key) ?? 1;
    if (total > 1) {
      const idx = (disambig.seen.get(key) ?? 0) + 1;
      disambig.seen.set(key, idx);
      line += ` (${idx} of ${total})`;
    }
  }

  // Properties (excluding level which is in the role label)
  const props = { ...node, level: undefined };
  const propStr = serializeProps(props);
  line += propStr;

  let result = `${line}\n`;

  // Children
  for (const child of node.children) {
    result += serializeNode(child, indent + 1, opts, disambig);
  }

  return result;
}

export function serializeAccessibilityTree(
  tree: A11yNode,
  options?: SerializeOptions,
): string {
  const opts = options ?? {};

  const counts = buildDisambiguationMap(tree);
  const disambig = { counts, seen: new Map<string, number>() };

  let result = serializeNode(tree, 0, opts, disambig).trimEnd();

  if (opts.maxLength && result.length > opts.maxLength) {
    result = result.slice(0, opts.maxLength - 30) + "\n\n... (truncated)";
  }

  // Wrap in content boundaries if requested
  if (opts.contentBoundary) {
    const nonce = generateNonce();
    const { origin } = opts.contentBoundary;
    const boundary = `--- SIEVE_PAGE_CONTENT nonce=${nonce} origin=${origin} ---`;
    result = `${boundary}\n${result}\n${boundary}`;
  }

  return result;
}

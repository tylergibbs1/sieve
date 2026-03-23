/**
 * Text-based accessibility tree diffing.
 * Produces unified diffs of serialized a11y trees for agent consumption.
 * Uses the Myers diff algorithm (line-level) for minimal, readable output.
 */

import type { A11yNode } from "./tree.ts";
import { serializeAccessibilityTree, type SerializeOptions } from "./serialize.ts";

/**
 * Compute a unified text diff between two serialized a11y trees.
 * Returns a string like:
 *   - [button] @e1 Save
 *   + [button] @e1 Save (disabled)
 *     [textbox] @e2 Email
 */
export function diffAccessibilityTrees(
  before: A11yNode,
  after: A11yNode,
  options?: SerializeOptions,
): string {
  const textBefore = serializeAccessibilityTree(before, options);
  const textAfter = serializeAccessibilityTree(after, options);

  if (textBefore === textAfter) return "";

  const linesBefore = textBefore.split("\n");
  const linesAfter = textAfter.split("\n");

  return unifiedDiff(linesBefore, linesAfter);
}

/**
 * Produce a unified diff string from two arrays of lines.
 * Lines prefixed with '-' are removed, '+' are added, '  ' are context.
 */
function unifiedDiff(a: string[], b: string[]): string {
  const edits = computeEdits(a, b);
  const lines: string[] = [];

  for (const edit of edits) {
    switch (edit.type) {
      case "equal":
        lines.push(`  ${edit.line}`);
        break;
      case "delete":
        lines.push(`- ${edit.line}`);
        break;
      case "insert":
        lines.push(`+ ${edit.line}`);
        break;
    }
  }

  return lines.join("\n");
}

interface Edit {
  type: "equal" | "delete" | "insert";
  line: string;
}

/**
 * Compute edit sequence using LCS (longest common subsequence).
 * Simpler and more reliable than full Myers backtracking.
 */
function computeEdits(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;

  // Fast path: empty
  if (n === 0) return b.map((line) => ({ type: "insert" as const, line }));
  if (m === 0) return a.map((line) => ({ type: "delete" as const, line }));

  // Build LCS table (space-optimized would be possible but clarity wins here)
  // Use Uint16Array rows for small inputs, fall back to regular arrays for large
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1).fill(0);
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to produce edits
  const edits: Edit[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.push({ type: "equal", line: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      edits.push({ type: "insert", line: b[j - 1]! });
      j--;
    } else {
      edits.push({ type: "delete", line: a[i - 1]! });
      i--;
    }
  }

  edits.reverse();
  return edits;
}

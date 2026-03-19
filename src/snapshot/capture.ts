/**
 * Page state snapshots: capture, diff, and restore.
 */

import { SieveElement } from "../dom/element.ts";
import { SieveText, SieveComment } from "../dom/text.ts";
import { SieveDocument, SieveDocumentType } from "../dom/document.ts";
import type { SieveNode } from "../dom/node.ts";

// --- Snapshot types ---

export type SnapshotNode =
  | DocumentSnapshot
  | DocumentTypeSnapshot
  | ElementSnapshot
  | TextSnapshot
  | CommentSnapshot;

export interface DocumentSnapshot {
  type: "document";
  children: SnapshotNode[];
}

interface DocumentTypeSnapshot {
  type: "doctype";
}

interface ElementSnapshot {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: SnapshotNode[];
}

interface TextSnapshot {
  type: "text";
  data: string;
}

interface CommentSnapshot {
  type: "comment";
  data: string;
}

// --- Capture ---

function captureNode(node: SieveNode): SnapshotNode {
  if (node instanceof SieveDocument) {
    return {
      type: "document",
      children: node.childNodes.map(captureNode),
    };
  }
  if (node instanceof SieveDocumentType) {
    return { type: "doctype" };
  }
  if (node instanceof SieveElement) {
    return {
      type: "element",
      tag: node.tagName,
      attrs: Object.fromEntries(node.attributes),
      children: node.childNodes.map(captureNode),
    };
  }
  if (node instanceof SieveText) {
    return { type: "text", data: node.data };
  }
  if (node instanceof SieveComment) {
    return { type: "comment", data: node.data };
  }
  throw new Error("Unknown node type");
}

export function captureSnapshot(doc: SieveDocument): DocumentSnapshot {
  return captureNode(doc) as DocumentSnapshot;
}

// --- Restore ---

function restoreNode(snapshot: SnapshotNode): SieveNode {
  switch (snapshot.type) {
    case "document": {
      const doc = new SieveDocument();
      for (const child of snapshot.children) {
        doc.appendChild(restoreNode(child));
      }
      return doc;
    }
    case "doctype":
      return new SieveDocumentType();
    case "element": {
      const el = new SieveElement(snapshot.tag);
      for (const [k, v] of Object.entries(snapshot.attrs)) {
        el.setAttribute(k, v);
      }
      for (const child of snapshot.children) {
        el.appendChild(restoreNode(child));
      }
      return el;
    }
    case "text":
      return new SieveText(snapshot.data);
    case "comment":
      return new SieveComment(snapshot.data);
  }
}

export function restoreSnapshot(snapshot: DocumentSnapshot): SieveDocument {
  return restoreNode(snapshot) as SieveDocument;
}

// --- Diff ---

export interface SnapshotChange {
  type: "attribute" | "text" | "added" | "removed" | "reordered";
  path: string;
  detail?: string;
  from?: string;
  to?: string;
}

function pathFor(base: string, node: SnapshotNode, index: number): string {
  if (node.type === "element") {
    const id = node.attrs["id"] ? `#${node.attrs["id"]}` : "";
    return `${base} > ${node.tag}${id}:nth-child(${index + 1})`;
  }
  return `${base} > [${node.type}]:nth-child(${index + 1})`;
}

export function diffSnapshots(
  before: DocumentSnapshot,
  after: DocumentSnapshot,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  diffChildren(before.children, after.children, "document", changes);
  return changes;
}

function diffChildren(
  before: SnapshotNode[],
  after: SnapshotNode[],
  parentPath: string,
  changes: SnapshotChange[],
): void {
  const maxLen = Math.max(before.length, after.length);
  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];

    if (!b && a) {
      changes.push({
        type: "added",
        path: pathFor(parentPath, a, i),
      });
      continue;
    }

    if (b && !a) {
      changes.push({
        type: "removed",
        path: pathFor(parentPath, b, i),
      });
      continue;
    }

    if (!b || !a) continue;

    if (b.type !== a.type) {
      changes.push({
        type: "removed",
        path: pathFor(parentPath, b, i),
      });
      changes.push({
        type: "added",
        path: pathFor(parentPath, a, i),
      });
      continue;
    }

    if (b.type === "text" && a.type === "text") {
      if (b.data !== a.data) {
        changes.push({
          type: "text",
          path: pathFor(parentPath, b, i),
          from: b.data,
          to: a.data,
        });
      }
      continue;
    }

    if (b.type === "element" && a.type === "element") {
      const elPath = pathFor(parentPath, b, i);

      // Compare attributes
      const allKeys = new Set([...Object.keys(b.attrs), ...Object.keys(a.attrs)]);
      for (const key of allKeys) {
        const bv = b.attrs[key];
        const av = a.attrs[key];
        if (bv !== av) {
          changes.push({
            type: "attribute",
            path: elPath,
            detail: key,
            from: bv ?? "(none)",
            to: av ?? "(none)",
          });
        }
      }

      // Recurse into children
      diffChildren(b.children, a.children, elPath, changes);
    }
  }
}

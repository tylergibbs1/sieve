/**
 * Fast snapshot hashing using Bun.hash.
 * Enables O(1) equality checks between snapshots without full tree diffing.
 */

import type { DocumentSnapshot, SnapshotNode } from "./capture.ts";

/**
 * Compute a fast hash of a snapshot for change detection.
 * Uses Bun's native Wyhash (non-cryptographic, extremely fast).
 * Two snapshots with the same hash represent the same DOM state.
 */
export function hashSnapshot(snapshot: DocumentSnapshot): number | bigint {
  const serialized = serializeForHash(snapshot);
  return Bun.hash(serialized);
}

/**
 * Check if two snapshots represent the same DOM state
 * without performing a full structural diff.
 */
export function snapshotsEqual(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return hashSnapshot(a) === hashSnapshot(b);
}

/**
 * Compute a content-addressable ID for a snapshot.
 * Uses CRC32 for compact, readable IDs suitable for storage keys.
 */
export function snapshotId(snapshot: DocumentSnapshot): string {
  const serialized = serializeForHash(snapshot);
  const crc = Bun.hash.crc32(serialized);
  return crc.toString(16).padStart(8, "0");
}

/**
 * Compute a cryptographic hash for integrity verification.
 * Uses SHA-256 via Bun.CryptoHasher.
 */
export function snapshotDigest(snapshot: DocumentSnapshot): string {
  const serialized = serializeForHash(snapshot);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(serialized);
  return hasher.digest("hex");
}

/** Deterministic serialization of a snapshot for hashing. */
function serializeForHash(node: SnapshotNode): string {
  switch (node.type) {
    case "document":
      return `D[${node.children.map(serializeForHash).join("")}]`;
    case "doctype":
      return "!";
    case "element": {
      // Sort attributes for deterministic output
      const attrs = Object.entries(node.attrs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      const children = node.children.map(serializeForHash).join("");
      return `E<${node.tag}{${attrs}}[${children}]>`;
    }
    case "text":
      return `T{${node.data}}`;
    case "comment":
      return `C{${node.data}}`;
  }
}

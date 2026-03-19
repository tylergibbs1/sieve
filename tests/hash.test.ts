import { describe, test, expect } from "bun:test";
import {
  parseHTML,
  captureSnapshot,
  hashSnapshot,
  snapshotsEqual,
  snapshotId,
  snapshotDigest,
} from "../src/index.ts";

describe("Snapshot hashing (Bun.hash)", () => {
  test("identical DOMs produce identical hashes", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const snap1 = captureSnapshot(parseHTML(html));
    const snap2 = captureSnapshot(parseHTML(html));

    expect(hashSnapshot(snap1)).toBe(hashSnapshot(snap2));
    expect(snapshotsEqual(snap1, snap2)).toBe(true);
  });

  test("different DOMs produce different hashes", () => {
    const snap1 = captureSnapshot(parseHTML("<p>Hello</p>"));
    const snap2 = captureSnapshot(parseHTML("<p>World</p>"));

    expect(snapshotsEqual(snap1, snap2)).toBe(false);
  });

  test("attribute changes produce different hashes", () => {
    const snap1 = captureSnapshot(parseHTML('<div class="a">X</div>'));
    const snap2 = captureSnapshot(parseHTML('<div class="b">X</div>'));

    expect(snapshotsEqual(snap1, snap2)).toBe(false);
  });

  test("snapshotId returns stable CRC32 hex string", () => {
    const html = "<div>Test</div>";
    const snap = captureSnapshot(parseHTML(html));

    const id1 = snapshotId(snap);
    const id2 = snapshotId(snap);
    expect(id1).toBe(id2);
    expect(id1.length).toBe(8); // CRC32 = 8 hex chars
  });

  test("snapshotDigest returns SHA-256 hex string", () => {
    const snap = captureSnapshot(parseHTML("<p>Test</p>"));
    const digest = snapshotDigest(snap);

    expect(digest.length).toBe(64); // SHA-256 = 64 hex chars
    expect(digest).toMatch(/^[0-9a-f]+$/);
  });

  test("hash is fast for large documents", () => {
    let html = "<html><body>";
    for (let i = 0; i < 500; i++) {
      html += `<div class="item" id="item-${i}"><p>Content ${i}</p></div>`;
    }
    html += "</body></html>";

    const snap = captureSnapshot(parseHTML(html));

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      hashSnapshot(snap);
    }
    const elapsed = performance.now() - start;

    // Should be well under 1ms per hash for a 500-element doc
    expect(elapsed / 1000).toBeLessThan(1);
  });

  test("page.hasChanged detects mutations", () => {
    const { SievePage } = require("../src/index.ts");
    const page = new SievePage();
    page.setContent('<div id="test">Original</div>');

    const snap = page.snapshot();
    expect(page.hasChanged(snap)).toBe(false);

    // Mutate
    page.querySelector("#test")!.textContent = "Modified";
    expect(page.hasChanged(snap)).toBe(true);
  });
});

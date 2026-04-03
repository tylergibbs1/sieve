/**
 * Dogfooding: all new CDP features against real websites.
 *
 * Tests: PDF, viewport emulation, network interception, structured extraction,
 * annotated screenshots, HAR recording, session recording.
 */

import { CdpBrowser } from "../src/cdp/browser.ts";
import type { CdpPage } from "../src/cdp/page.ts";
import { extractStructured, extractTables, extractLinks } from "../src/a11y/extract.ts";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`  FAIL: ${msg}`); failures++; }
  else { console.log(`  OK: ${msg}`); }
}

async function testPdf(page: CdpPage) {
  console.log("\n--- PDF generation ---");
  await page.goto("https://news.ycombinator.com");

  const pdf = await page.pdf({ printBackground: true });
  assert(pdf.slice(0, 4).toString() === "%PDF", `PDF generated: ${pdf.length} bytes`);
  await Bun.write("/tmp/sieve-hn.pdf", pdf);
  console.log("  Saved to /tmp/sieve-hn.pdf");
}

async function testViewport(page: CdpPage) {
  console.log("\n--- Viewport / device emulation ---");
  await page.goto("https://news.ycombinator.com");

  // Desktop
  await page.setViewport(1920, 1080);
  let width = await page.evaluate<number>("screen.width");
  console.log(`  Desktop screen.width: ${width}`);

  // Mobile
  await page.emulateDevice("iPhone 14");
  width = await page.evaluate<number>("screen.width");
  console.log(`  iPhone 14 screen.width: ${width}`);
  assert(width === 390, `iPhone 14 emulated (${width})`);

  // Screenshot at mobile size
  const mobilePng = await page.screenshot();
  await Bun.write("/tmp/sieve-hn-mobile.png", mobilePng);
  console.log(`  Mobile screenshot: ${mobilePng.length} bytes → /tmp/sieve-hn-mobile.png`);
}

async function testNetworkInterception(page: CdpPage) {
  console.log("\n--- Network interception ---");

  // Mock an API response
  let intercepted = false;
  await page.route("*/y18.svg", async ({ requestId, session }) => {
    intercepted = true;
    // Return a 1x1 transparent PNG instead of the real image
    await session.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "image/svg+xml" }],
      body: btoa("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>"),
    });
  });

  await page.goto("https://news.ycombinator.com");
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 10_000 });
  assert(intercepted, "Intercepted y18.svg request");

  await page.unroute("*/y18.svg");
}

async function testStructuredExtraction(page: CdpPage) {
  console.log("\n--- Structured data extraction ---");

  // Wikipedia has great structured content
  await page.goto("https://en.wikipedia.org/wiki/TypeScript");
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 15_000 }).catch(() => {
    console.log("  (network idle timeout — Wikipedia has long-running requests, continuing)");
  });

  const tree = await page.accessibilityTree();
  const data = extractStructured(tree.root);

  console.log(`  Headings: ${data.headings.length}`);
  for (const h of data.headings.slice(0, 5)) {
    console.log(`    [h${h.level}] ${h.text}`);
  }

  console.log(`  Tables: ${data.tables.length}`);
  if (data.tables.length > 0) {
    const t = data.tables[0]!;
    console.log(`    First table: "${t.name}" (${t.headers.length} cols, ${t.rows.length} rows)`);
    if (t.headers.length > 0) console.log(`    Headers: ${t.headers.join(", ")}`);
  }

  console.log(`  Links: ${data.links.length}`);
  console.log(`  Lists: ${data.lists.length}`);
  console.log(`  Forms: ${data.forms.length}`);

  assert(data.headings.length > 5, `found ${data.headings.length} headings`);
  assert(data.links.length > 50, `found ${data.links.length} links`);
}

async function testAnnotatedScreenshot(page: CdpPage) {
  console.log("\n--- Annotated screenshot ---");
  await page.goto("https://news.ycombinator.com");

  const annotated = await page.annotatedScreenshot();
  await Bun.write("/tmp/sieve-hn-annotated.png", annotated);
  assert(annotated.length > 10_000, `annotated screenshot: ${annotated.length} bytes`);
  console.log("  Saved to /tmp/sieve-hn-annotated.png");

  // Compare sizes
  const plain = await page.screenshot();
  console.log(`  Plain: ${plain.length} bytes, Annotated: ${annotated.length} bytes`);
}

async function testHarRecording(page: CdpPage) {
  console.log("\n--- HAR recording ---");
  page.startHarRecording();

  await page.goto("https://news.ycombinator.com");
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 10_000 });

  const entries = page.stopHarRecording();
  console.log(`  Recorded ${entries.length} network requests`);

  if (entries.length > 0) {
    for (const e of entries.slice(0, 5)) {
      console.log(`    ${e.request.method} ${e.response.status} ${e.request.url.slice(0, 80)} (${e.time}ms)`);
    }
    if (entries.length > 5) console.log(`    ... and ${entries.length - 5} more`);
  }

  const har = page.exportHar() as any;
  assert(har.log.version === "1.2", "HAR 1.2 format");
  assert(har.log.entries.length > 0, `${har.log.entries.length} HAR entries`);

  // Save HAR file
  await Bun.write("/tmp/sieve-hn.har", JSON.stringify(har, null, 2));
  console.log("  Saved to /tmp/sieve-hn.har");
}

async function testSessionRecording(page: CdpPage) {
  console.log("\n--- Session recording ---");
  page.startRecording();

  await page.goto("https://news.ycombinator.com");
  const tree = await page.accessibilityTree();

  // Find a link and click it
  const links = tree.findByRole("link").filter(l => l.name && l.name.length > 15 && l.ref);
  if (links[0]) {
    await page.click(links[0].ref!);
    await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 }).catch(() => {});
  }

  await page.goBack();
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 5_000 }).catch(() => {});

  const log = page.stopRecording();
  console.log(`  Recorded ${log.length} actions:`);
  for (const entry of log) {
    console.log(`    [${new Date(entry.timestamp).toISOString().slice(11, 19)}] ${entry.action}: ${entry.target ?? ""}`);
  }

  assert(log.length >= 2, `recorded ${log.length} actions`);
  assert(log[0]!.action === "goto", "first action is goto");
}

async function testConsoleCaptureOnRealSite(page: CdpPage) {
  console.log("\n--- Console capture on real site ---");
  await page.goto("https://github.com/anthropics");
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 });

  const logs = page.consoleLogs;
  const errors = page.exceptions;
  console.log(`  Console messages: ${logs.length}`);
  console.log(`  JS exceptions: ${errors.length}`);

  if (logs.length > 0) {
    for (const l of logs.slice(0, 3)) {
      console.log(`    [${l.level}] ${l.text.slice(0, 80)}`);
    }
  }
}

async function main() {
  console.log("=== Sieve CDP Advanced Features Dogfood ===");
  const browser = await CdpBrowser.launch({ headless: true });

  const tests = [
    testPdf,
    testViewport,
    testNetworkInterception,
    testStructuredExtraction,
    testAnnotatedScreenshot,
    testHarRecording,
    testSessionRecording,
    testConsoleCaptureOnRealSite,
  ];

  for (const testFn of tests) {
    const page = await browser.newPage();
    try {
      await testFn(page);
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`);
      failures++;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`\n=== Results: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main();

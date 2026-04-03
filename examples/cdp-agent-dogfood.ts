/**
 * Dogfooding: use sieve's CDP browser like an AI agent would.
 *
 * Tests real-world scenarios an AI agent encounters:
 * 1. Browse Hacker News, read a11y tree, click stories, navigate
 * 2. Search on HN Algolia (find inputs by multiple roles)
 * 3. Fill out a real form (GitHub search)
 * 4. Handle keyboard events and JS-heavy pages
 */

import { CdpBrowser } from "../src/cdp/browser.ts";
import type { CdpPage } from "../src/cdp/page.ts";
import type { A11yNode } from "../src/a11y/tree.ts";

let failures = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`   FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`   OK: ${msg}`);
  }
}

async function testHackerNews(page: CdpPage) {
  console.log("\n--- Test 1: Hacker News browsing ---");

  await page.goto("https://news.ycombinator.com");
  const title = await page.getTitle();
  assert(title === "Hacker News", `title is "${title}"`);

  // Agent reads the page
  const tree = await page.accessibilityTree();
  const links = tree.findByRole("link");
  assert(links.length > 50, `found ${links.length} links`);

  // Agent identifies stories (links with substantial text that aren't nav)
  const stories = links.filter(l =>
    l.name && l.name.length > 20 && !l.name.includes("|") && l.ref
  );
  assert(stories.length > 10, `found ${stories.length} story links`);
  console.log(`   Top 3 stories:`);
  for (const s of stories.slice(0, 3)) {
    console.log(`     ${s.ref}: ${s.name}`);
  }

  // Agent clicks a story by @ref
  const story = stories[0]!;
  console.log(`   Clicking ${story.ref} ("${story.name}")...`);
  await page.click(story.ref!);
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 });
  const newUrl = page.url;
  assert(newUrl !== "https://news.ycombinator.com", `navigated to ${newUrl}`);

  // Agent goes back
  await page.goBack();
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 5_000 });
  const backTitle = await page.getTitle();
  assert(backTitle === "Hacker News", `back at HN: "${backTitle}"`);

  // Screenshot
  const png = await page.screenshot();
  assert(png.length > 10_000, `screenshot: ${png.length} bytes`);
}

async function testSearch(page: CdpPage) {
  console.log("\n--- Test 2: HN Algolia search ---");

  await page.goto("https://hn.algolia.com");
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 });

  const tree = await page.accessibilityTree();

  // Agent tries multiple strategies to find the search box
  const inputRoles = ["searchbox", "textbox", "combobox"];
  let searchInput: A11yNode | undefined;
  for (const role of inputRoles) {
    const candidates = tree.findByRole(role);
    if (candidates.length > 0) {
      searchInput = candidates[0];
      console.log(`   Found search input via role="${role}": "${searchInput!.name}" (${searchInput!.ref})`);
      break;
    }
  }

  if (!searchInput?.ref) {
    // Fallback: try CSS selector
    console.log("   No input found via a11y roles, trying CSS selector...");
    await page.type("input[type='search'], input[type='text'], input.SearchInput", "test query");
  } else {
    await page.type(searchInput.ref, "virtual browser agent");
    await page.press("Enter");
    await page.waitForNetworkIdle({ idleMs: 1500, timeoutMs: 10_000 });
  }

  const resultUrl = page.url;
  console.log(`   URL after search: ${resultUrl}`);

  // Read results
  const resultsTree = await page.accessibilityTree();
  const resultLinks = resultsTree.findByRole("link");
  console.log(`   Found ${resultLinks.length} links in search results`);
  assert(resultLinks.length > 5, `got search results`);
}

async function testGitHub(page: CdpPage) {
  console.log("\n--- Test 3: GitHub navigation ---");

  await page.goto("https://github.com/anthropics");
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 });

  const title = await page.getTitle();
  console.log(`   Title: ${title}`);

  // Read the page
  const tree = await page.accessibilityTree();
  const headings = tree.findByRole("heading");
  console.log(`   Found ${headings.length} headings`);
  for (const h of headings.slice(0, 5)) {
    console.log(`     [h${h.level ?? "?"}] ${h.name}`);
  }

  // Find repository links
  const links = tree.findByRole("link");
  const repoLinks = links.filter(l => l.name && !l.name.includes("\n") && l.name.length > 3 && l.name.length < 50);
  console.log(`   Found ${repoLinks.length} repo-like links`);

  // Take screenshot
  const png = await page.screenshot();
  await Bun.write("/tmp/sieve-github-screenshot.png", png);
  assert(png.length > 10_000, `screenshot: ${png.length} bytes`);
}

async function testConsoleCaptureAndErrors(page: CdpPage) {
  console.log("\n--- Test 4: Console capture on real site ---");

  await page.goto("https://news.ycombinator.com");
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 5_000 });

  page.clearConsoleLogs();
  page.clearExceptions();

  // Inject some JS and check console capture
  await page.evaluate("console.log('agent-test: hello from eval')");
  await page.evaluate("console.warn('agent-test: this is a warning')");

  const logs = page.consoleLogs;
  const agentLogs = logs.filter(l => l.text.includes("agent-test"));
  assert(agentLogs.length === 2, `captured ${agentLogs.length} agent logs`);
  for (const l of agentLogs) {
    console.log(`   [${l.level}] ${l.text}`);
  }

  // Trigger an exception
  try {
    await page.evaluate("throw new Error('agent deliberate error')");
  } catch { /* expected */ }
  const exceptions = page.exceptions;
  console.log(`   Exceptions captured: ${exceptions.length}`);
}

async function testKeyboardInteraction(page: CdpPage) {
  console.log("\n--- Test 5: Keyboard interaction ---");

  // Use GitHub search which responds to keyboard
  await page.goto("https://github.com/search");
  await page.waitForNetworkIdle({ idleMs: 1000, timeoutMs: 10_000 });

  const tree = await page.accessibilityTree();

  // Find search input
  const inputs = [...tree.findByRole("textbox"), ...tree.findByRole("searchbox"), ...tree.findByRole("combobox")];
  console.log(`   Found ${inputs.length} input-like elements`);

  if (inputs.length > 0) {
    const searchInput = inputs[0]!;
    console.log(`   Using: "${searchInput.name}" (${searchInput.ref})`);

    await page.focus(searchInput.ref!);
    // Type character by character using keyboard events (not page.type)
    for (const char of "sieve") {
      await page.press(char);
    }
    await page.press("Enter");
    await page.waitForNetworkIdle({ idleMs: 1500, timeoutMs: 10_000 });

    const url = page.url;
    console.log(`   After Enter: ${url}`);
    assert(url.includes("search") || url.includes("q="), `navigated to search results`);
  }
}

async function testDiffAcrossNavigation(page: CdpPage) {
  console.log("\n--- Test 6: A11y tree diff across navigation ---");

  await page.goto("https://news.ycombinator.com");
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 5_000 });

  const treeBefore = await page.accessibilityTree();
  const beforeCount = treeBefore.refCount;
  console.log(`   Before: ${beforeCount} interactive elements`);

  // Navigate to "new" page
  await page.click("@e3"); // "new" link
  await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 5_000 });

  const treeAfter = await page.accessibilityTree();
  const afterCount = treeAfter.refCount;
  console.log(`   After clicking 'new': ${afterCount} interactive elements`);

  // Diff
  const diff = treeBefore.diff(treeAfter);
  const diffLines = diff.split("\n").length;
  console.log(`   Diff: ${diffLines} lines`);
  assert(diffLines > 0, `got a diff`);
  // Show first few lines
  for (const line of diff.split("\n").slice(0, 8)) {
    console.log(`   ${line}`);
  }
}

async function main() {
  console.log("=== Sieve CDP Agent Dogfood ===");
  console.log("Testing real-world agent scenarios with actual websites\n");

  const browser = await CdpBrowser.launch({ headless: true });

  try {
    // Each test gets its own page (like an agent would)
    for (const [name, testFn] of [
      ["HN browsing", testHackerNews],
      ["HN search", testSearch],
      ["GitHub", testGitHub],
      ["Console capture", testConsoleCaptureAndErrors],
      ["Keyboard", testKeyboardInteraction],
      ["A11y diff", testDiffAcrossNavigation],
    ] as const) {
      const page = await browser.newPage();
      try {
        await (testFn as (page: CdpPage) => Promise<void>)(page);
      } catch (err: any) {
        console.error(`   ERROR in ${name}: ${err.message}`);
        failures++;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n=== Results: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main();

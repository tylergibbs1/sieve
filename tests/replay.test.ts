import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DiskReplayFetcher, RecordingFetcher, MockFetcher, SieveBrowser } from "../src/index.ts";
import { rmSync, mkdirSync } from "fs";

const REPLAY_DIR = `/tmp/sieve-replay-test-${Date.now()}`;

beforeEach(() => {
  mkdirSync(REPLAY_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(REPLAY_DIR, { recursive: true, force: true });
});

describe("Disk replay fetcher (Bun.file/Bun.write)", () => {
  test("record and replay a response", async () => {
    const replay = new DiskReplayFetcher(REPLAY_DIR);

    // Record
    await replay.record("https://example.com", {
      url: "https://example.com",
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><body><h1>Hello</h1></body></html>",
    });

    // Replay
    const response = await replay.fetch("https://example.com");
    expect(response.status).toBe(200);
    expect(response.body).toContain("<h1>Hello</h1>");
    expect(response.headers["content-type"]).toBe("text/html");
  });

  test("throws on missing recording", async () => {
    const replay = new DiskReplayFetcher(REPLAY_DIR);
    await expect(replay.fetch("https://missing.com")).rejects.toThrow("No recording found");
  });

  test("listRecordings returns recorded URLs", async () => {
    const replay = new DiskReplayFetcher(REPLAY_DIR);

    await replay.record("https://example.com", {
      url: "https://example.com",
      status: 200,
      headers: {},
      body: "a",
    });
    await replay.record("https://example.com/about", {
      url: "https://example.com/about",
      status: 200,
      headers: {},
      body: "b",
    });

    const urls = await replay.listRecordings();
    expect(urls.length).toBe(2);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://example.com/about");
  });

  test("recording fetcher passes through to live and records", async () => {
    const mockLive = new MockFetcher({
      routes: {
        "https://example.com": "<html><body>Live response</body></html>",
      },
    });

    const recorder = new RecordingFetcher(mockLive, REPLAY_DIR);

    // Fetch through recorder (proxies to mock)
    const response = await recorder.fetch("https://example.com");
    expect(response.body).toContain("Live response");

    // Switch to replay mode — should return the same response from disk
    const replay = recorder.toReplay();
    const replayed = await replay.fetch("https://example.com");
    expect(replayed.body).toContain("Live response");
    expect(replayed.status).toBe(200);
  });

  test("SieveBrowser with replayDir config", async () => {
    // Pre-record a response
    const replay = new DiskReplayFetcher(REPLAY_DIR);
    await replay.record("https://example.com", {
      url: "https://example.com",
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><head><title>Replayed</title></head><body><p>From disk</p></body></html>",
    });

    // Create browser with replayDir
    const browser = new SieveBrowser({
      network: { replayDir: REPLAY_DIR },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    expect(page.title).toBe("Replayed");
    expect(page.querySelector("p")?.textContent).toBe("From disk");

    browser.close();
  });

  test("SieveBrowser with record config", async () => {
    const mockLive = new MockFetcher({
      routes: {
        "https://example.com": "<html><head><title>Recorded</title></head><body>OK</body></html>",
      },
    });

    const browser = new SieveBrowser({
      network: { record: { fetcher: mockLive, directory: REPLAY_DIR } },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");
    expect(page.title).toBe("Recorded");

    browser.close();

    // Verify recording exists on disk
    const replayBrowser = new SieveBrowser({
      network: { replayDir: REPLAY_DIR },
    });
    const page2 = await replayBrowser.newPage();
    await page2.goto("https://example.com");
    expect(page2.title).toBe("Recorded");

    replayBrowser.close();
  });
});

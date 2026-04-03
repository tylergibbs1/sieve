/**
 * Chrome process launcher.
 *
 * Finds and launches Chrome/Chromium, extracts the DevTools WebSocket URL,
 * and returns a connected CdpSession.
 */

import { connect, type CdpSession } from "./session.ts";
import type { ChromeLaunchOptions } from "./protocol.ts";

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

/** Find the Chrome executable on this system. */
export function findChrome(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath) return envPath;

  const platform = process.platform;
  const candidates = CHROME_PATHS[platform] ?? [];

  for (const candidate of candidates) {
    try {
      // For absolute paths, check if file exists
      if (candidate.startsWith("/") || candidate.startsWith("C:\\")) {
        const file = Bun.file(candidate);
        // Bun.file doesn't throw on missing, but we can check via stat
        const stat = Bun.spawnSync({ cmd: ["test", "-x", candidate] });
        if (stat.exitCode === 0) return candidate;
      } else {
        // For bare names (linux), check if it's in PATH
        const which = Bun.spawnSync({ cmd: ["which", candidate] });
        if (which.exitCode === 0) {
          return which.stdout.toString().trim();
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "Chrome not found. Install Chrome or set CHROME_PATH environment variable."
  );
}

const DEFAULT_ARGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-background-networking",
  "--disable-translate",
  "--metrics-recording-only",
  "--no-service-autorun",
  "--password-store=basic",
];

export interface LaunchResult {
  session: CdpSession;
  process: ReturnType<typeof Bun.spawn>;
  wsEndpoint: string;
}

/**
 * Launch Chrome and connect via CDP.
 * Returns a ready CdpSession plus a handle to the Chrome process.
 */
export async function launchChrome(options: ChromeLaunchOptions = {}): Promise<LaunchResult> {
  const executablePath = options.executablePath ?? findChrome();
  const headless = options.headless ?? true;
  const userArgs = options.args ?? [];

  const args = [
    executablePath,
    "--remote-debugging-port=0", // ephemeral port
    ...DEFAULT_ARGS,
    ...(headless ? ["--headless=new"] : []),
    ...userArgs,
  ];

  if (options.userDataDir) {
    args.push(`--user-data-dir=${options.userDataDir}`);
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Extract the WebSocket URL from stderr
  const wsEndpoint = await extractWsEndpoint(proc);

  const session = await connect(wsEndpoint);

  return { session, process: proc, wsEndpoint };
}

/**
 * Read Chrome's stderr until we find the DevTools WebSocket URL.
 */
async function extractWsEndpoint(
  proc: ReturnType<typeof Bun.spawn>,
): Promise<string> {
  const stderr = proc.stderr;
  if (!stderr || typeof stderr === "number") {
    throw new Error("Chrome stderr not available");
  }

  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeout = setTimeout(() => {
    reader.cancel();
  }, 10_000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        // Release the reader so Chrome can continue writing
        reader.releaseLock();
        return match[1]!;
      }
    }
  } catch {
    // reader.cancel() from timeout will throw
  }

  clearTimeout(timeout);
  throw new Error(`Failed to extract DevTools WebSocket URL from Chrome.\nStderr: ${buffer.slice(0, 500)}`);
}

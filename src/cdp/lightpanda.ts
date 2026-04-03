/**
 * Lightpanda process launcher.
 *
 * Lightpanda is a lightweight headless browser designed for AI and automation.
 * It speaks the same Chrome DevTools Protocol as Chrome but is much faster
 * and uses less memory.
 *
 * Launch modes:
 * 1. Binary: finds and runs the `lightpanda` binary
 * 2. npm package: uses `@lightpanda/browser` if installed
 * 3. Connect: connects to an already-running instance
 *
 * @see https://lightpanda.io/docs
 */

import { connect, type CdpSession } from "./session.ts";
import type { LaunchResult } from "./chrome.ts";

export interface LightpandaLaunchOptions {
  /** Path to the Lightpanda binary. Auto-detected if omitted. */
  executablePath?: string;
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
  /** Port to listen on. Default: 9222 */
  port?: number;
  /** Extra CLI args for the Lightpanda binary. */
  args?: string[];
}

const LIGHTPANDA_PATHS: Record<string, string[]> = {
  darwin: [
    "lightpanda",
    "/usr/local/bin/lightpanda",
    "/opt/homebrew/bin/lightpanda",
  ],
  linux: [
    "lightpanda",
    "/usr/local/bin/lightpanda",
    "/usr/bin/lightpanda",
  ],
  win32: [
    "lightpanda.exe",
  ],
};

/** Find the Lightpanda executable on this system. */
export function findLightpanda(): string {
  const envPath = process.env.LIGHTPANDA_PATH;
  if (envPath) return envPath;

  const platform = process.platform;
  const candidates = LIGHTPANDA_PATHS[platform] ?? [];

  for (const candidate of candidates) {
    try {
      if (candidate.startsWith("/")) {
        const stat = Bun.spawnSync({ cmd: ["test", "-x", candidate] });
        if (stat.exitCode === 0) return candidate;
      } else {
        const which = Bun.spawnSync({ cmd: ["which", candidate] });
        if (which.exitCode === 0) {
          return which.stdout.toString().trim();
        }
      }
    } catch {
      continue;
    }
  }

  // Try the @lightpanda/browser npm package as fallback
  try {
    const npmBin = findNpmLightpanda();
    if (npmBin) return npmBin;
  } catch {
    // Not installed
  }

  throw new Error(
    "Lightpanda not found. Install it (https://lightpanda.io/docs) or set LIGHTPANDA_PATH environment variable."
  );
}

/**
 * Try to find the Lightpanda binary via the @lightpanda/browser npm package.
 * The package bundles the binary and exports its path.
 */
function findNpmLightpanda(): string | null {
  try {
    // Try to resolve the package's binary path
    const resolved = require.resolve("@lightpanda/browser");
    // The package typically puts the binary adjacent to the main module
    const dir = resolved.replace(/[/\\][^/\\]+$/, "");
    const candidates = [
      `${dir}/lightpanda`,
      `${dir}/bin/lightpanda`,
      `${dir}/../bin/lightpanda`,
    ];
    for (const candidate of candidates) {
      const stat = Bun.spawnSync({ cmd: ["test", "-x", candidate] });
      if (stat.exitCode === 0) return candidate;
    }
  } catch {
    // Package not installed
  }
  return null;
}

/**
 * Launch Lightpanda and connect via CDP.
 *
 * Lightpanda uses a fixed host:port (unlike Chrome's ephemeral port),
 * and its WebSocket URL is simply `ws://host:port`.
 */
export async function launchLightpanda(options: LightpandaLaunchOptions = {}): Promise<LaunchResult> {
  const executablePath = options.executablePath ?? findLightpanda();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9222;
  const userArgs = options.args ?? [];

  const args = [
    executablePath,
    "serve",
    "--host", host,
    "--port", String(port),
    ...userArgs,
  ];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for Lightpanda to be ready by polling the HTTP endpoint
  const wsEndpoint = `ws://${host}:${port}`;
  await waitForReady(`http://${host}:${port}`, proc);

  const session = await connect(wsEndpoint);

  return { session, process: proc, wsEndpoint };
}

/**
 * Poll until the Lightpanda CDP server is accepting connections.
 * Also watches the process to bail early if it exits.
 */
async function waitForReady(
  httpUrl: string,
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const checkInterval = 100;

  while (Date.now() < deadline) {
    // Check if process died
    try {
      const exitCode = proc.exitCode;
      if (exitCode !== null) {
        const stderr = proc.stderr;
        let msg = "";
        if (stderr && typeof stderr !== "number") {
          const reader = stderr.getReader();
          try {
            const { value } = await reader.read();
            if (value) msg = new TextDecoder().decode(value);
          } finally {
            reader.releaseLock();
          }
        }
        throw new Error(`Lightpanda exited with code ${exitCode}${msg ? `: ${msg.slice(0, 300)}` : ""}`);
      }
    } catch (e: any) {
      if (e.message.startsWith("Lightpanda exited")) throw e;
    }

    // Try connecting
    try {
      const resp = await fetch(`${httpUrl}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }

    await Bun.sleep(checkInterval);
  }

  throw new Error(`Lightpanda did not become ready within ${timeoutMs}ms`);
}

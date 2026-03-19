/**
 * WAF challenge solvers.
 *
 * Many websites use Web Application Firewalls that serve a JavaScript
 * challenge page instead of the actual content. The challenge sets a
 * cookie via JS and reloads. Since sieve doesn't execute page JS,
 * we detect these challenges and solve them programmatically.
 *
 * Supported:
 *   - Sucuri/GoDaddy WAF (sucuri_cloudproxy_uuid)
 *   - Generic meta-refresh redirects
 */

import type { FetchResponse } from "./fetcher.ts";
import type { CookieJar } from "../navigation/cookies.ts";

export interface ChallengeSolution {
  /** Cookies to set before retrying. */
  cookies: string[];
  /** Whether the response should be retried with these cookies. */
  shouldRetry: boolean;
}

export interface ChallengeSolver {
  /** Name of this solver (for logging). */
  name: string;
  /** Return true if this solver can handle the response. */
  detect(response: FetchResponse): boolean;
  /** Solve the challenge. Returns cookies to set. */
  solve(response: FetchResponse, requestUrl: string): ChallengeSolution | null;
}

// --- Sucuri WAF ---

const SUCURI_SOLVER: ChallengeSolver = {
  name: "sucuri",

  detect(response: FetchResponse): boolean {
    return response.body.includes("sucuri_cloudproxy_js") ||
      (response.body.includes("You are being redirected") &&
       response.body.includes("S='"));
  },

  solve(response: FetchResponse, requestUrl: string): ChallengeSolution | null {
    // Extract the base64-encoded challenge payload
    const b64Match = response.body.match(/S='([^']+)'/);
    if (!b64Match) return null;

    let decoded: string;
    try {
      decoded = atob(b64Match[1]!);
    } catch {
      return null;
    }

    // The decoded JS sets a variable (name varies: y, f, etc.) to a hex string,
    // then assigns document.cookie = <name> + "=" + <variable> + ";path=/;max-age=86400"
    // We evaluate the whole thing in a sandbox with a fake document object.
    let cookieStr: string;
    try {
      cookieStr = new Function(`
        var document = { cookie: "" };
        ${decoded.replace(/location\.reload\(\);?/g, "")}
        return document.cookie;
      `)();
    } catch {
      return null;
    }

    if (!cookieStr || !cookieStr.includes("=")) return null;

    return {
      cookies: [cookieStr],
      shouldRetry: true,
    };
  },
};

// --- Generic meta-refresh ---

const META_REFRESH_SOLVER: ChallengeSolver = {
  name: "meta-refresh",

  detect(response: FetchResponse): boolean {
    // <meta http-equiv="refresh" content="0;url=...">
    return /meta[^>]+http-equiv\s*=\s*["']refresh["']/i.test(response.body);
  },

  solve(response: FetchResponse, _requestUrl: string): ChallengeSolution | null {
    const match = response.body.match(
      /meta[^>]+content\s*=\s*["']\d+;\s*url=([^"']+)["']/i
    );
    if (!match) return null;

    // Meta-refresh doesn't set cookies, but we signal a retry
    // The caller should re-fetch the redirect URL
    return {
      cookies: [],
      shouldRetry: true,
    };
  },
};

// --- Cloudflare "checking your browser" (limited) ---
// NOTE: Full Cloudflare challenges require a real browser.
// This only handles the simplest cookie-based variant.

const CLOUDFLARE_SIMPLE_SOLVER: ChallengeSolver = {
  name: "cloudflare-simple",

  detect(response: FetchResponse): boolean {
    return response.status === 403 &&
      response.body.includes("cf-browser-verification") &&
      response.body.includes("document.cookie");
  },

  solve(response: FetchResponse, requestUrl: string): ChallengeSolution | null {
    // Try to extract any simple cookie-setting JS
    // Full Cloudflare challenges with CAPTCHA/Turnstile can't be solved here
    const cookieMatch = response.body.match(
      /document\.cookie\s*=\s*["']([^"']+)["']/
    );
    if (!cookieMatch) return null;

    return {
      cookies: [cookieMatch[1]!],
      shouldRetry: true,
    };
  },
};

// --- Public API ---

/** All built-in challenge solvers, in priority order. */
export const DEFAULT_SOLVERS: readonly ChallengeSolver[] = [
  SUCURI_SOLVER,
  META_REFRESH_SOLVER,
  CLOUDFLARE_SIMPLE_SOLVER,
];

/**
 * Try to solve a WAF challenge from a response.
 * Returns the solution or null if no solver matched.
 */
export function solveChallenge(
  response: FetchResponse,
  requestUrl: string,
  solvers: readonly ChallengeSolver[] = DEFAULT_SOLVERS,
): { solver: string; solution: ChallengeSolution } | null {
  for (const solver of solvers) {
    if (solver.detect(response)) {
      const solution = solver.solve(response, requestUrl);
      if (solution) {
        return { solver: solver.name, solution };
      }
    }
  }
  return null;
}

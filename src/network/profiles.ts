/**
 * Browser header profiles.
 *
 * Real browsers send a specific set of headers in a specific order.
 * Most bot detection starts by checking these headers. A custom
 * User-Agent with missing Accept-Language and Sec-Fetch-* headers
 * is trivially detectable.
 *
 * These profiles replicate the exact headers a real browser sends
 * on initial navigation. They don't fake TLS fingerprints or JS
 * execution — those require a real browser engine.
 *
 * What this fixes:
 *   ✓ User-Agent string
 *   ✓ Accept / Accept-Language / Accept-Encoding
 *   ✓ Sec-Fetch-* headers
 *   ✓ Sec-CH-UA client hints
 *   ✓ Upgrade-Insecure-Requests
 *   ✓ Cache-Control on first load
 *
 * What this can't fix:
 *   ✗ TLS fingerprint (JA3/JA4) — determined by Bun's BoringSSL, not headers
 *   ✗ HTTP/2 fingerprint (SETTINGS frame order, priorities)
 *   ✗ JS execution challenges (Cloudflare Turnstile, DataDome, PerimeterX)
 *   ✗ Canvas/WebGL fingerprinting
 *   ✗ Navigator/window API probing
 */

export interface BrowserProfile {
  name: string;
  headers: Record<string, string>;
  /** Headers to add on navigation (page load), not on subresource requests. */
  navigationHeaders: Record<string, string>;
  /** Headers to add when navigating from a same-site page. */
  sameSiteNavigationHeaders: Record<string, string>;
  /** Headers to add when navigating from a cross-site page. */
  crossSiteNavigationHeaders: Record<string, string>;
}

export const CHROME_MAC: BrowserProfile = {
  name: "chrome-mac",
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    "Upgrade-Insecure-Requests": "1",
  },
  navigationHeaders: {
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
  },
  sameSiteNavigationHeaders: {
    "Sec-Fetch-Site": "same-origin",
  },
  crossSiteNavigationHeaders: {
    "Sec-Fetch-Site": "none",
  },
};

export const CHROME_WINDOWS: BrowserProfile = {
  name: "chrome-windows",
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
  },
  navigationHeaders: {
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
  },
  sameSiteNavigationHeaders: {
    "Sec-Fetch-Site": "same-origin",
  },
  crossSiteNavigationHeaders: {
    "Sec-Fetch-Site": "none",
  },
};

export const FIREFOX_MAC: BrowserProfile = {
  name: "firefox-mac",
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-User": "?1",
  },
  navigationHeaders: {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
  },
  sameSiteNavigationHeaders: {
    "Sec-Fetch-Site": "same-origin",
  },
  crossSiteNavigationHeaders: {
    "Sec-Fetch-Site": "cross-site",
  },
};

export const SAFARI_MAC: BrowserProfile = {
  name: "safari-mac",
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
  },
  navigationHeaders: {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  },
  sameSiteNavigationHeaders: {
    "Sec-Fetch-Site": "same-origin",
  },
  crossSiteNavigationHeaders: {
    "Sec-Fetch-Site": "cross-site",
  },
};

/** All available profiles. */
export const PROFILES = {
  "chrome-mac": CHROME_MAC,
  "chrome-windows": CHROME_WINDOWS,
  "firefox-mac": FIREFOX_MAC,
  "safari-mac": SAFARI_MAC,
} as const;

export type ProfileName = keyof typeof PROFILES;

/** Build the full header set for a navigation request. */
export function buildNavigationHeaders(
  profile: BrowserProfile,
  currentUrl: string | null,
  targetUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...profile.headers,
    ...profile.navigationHeaders,
  };

  // Determine same-site vs cross-site
  if (currentUrl && currentUrl !== "about:blank") {
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (current.hostname === target.hostname ||
          current.hostname.endsWith(`.${target.hostname}`) ||
          target.hostname.endsWith(`.${current.hostname}`)) {
        Object.assign(headers, profile.sameSiteNavigationHeaders);
        // Set Referer for same-site navigation
        headers["Referer"] = currentUrl;
      } else {
        Object.assign(headers, profile.crossSiteNavigationHeaders);
        // Cross-site: send origin-only referer
        headers["Referer"] = new URL(currentUrl).origin + "/";
      }
    } catch {
      Object.assign(headers, profile.crossSiteNavigationHeaders);
    }
  } else {
    // First navigation — no referer, cross-site headers
    Object.assign(headers, profile.crossSiteNavigationHeaders);
  }

  return headers;
}

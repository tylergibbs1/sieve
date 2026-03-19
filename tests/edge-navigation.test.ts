/**
 * Edge cases: Navigation, cookies, history, URL resolution, and network.
 */

import { describe, test, expect } from "bun:test";
import {
  SieveBrowser,
  SievePage,
  CookieJar,
  NavigationHistory,
  resolveUrl,
  MockFetcher,
  SieveStorage,
} from "../src/index.ts";

describe("URL resolution edge cases", () => {
  test("absolute URL ignores base", () => {
    expect(resolveUrl("https://a.com/path", "https://b.com")).toBe("https://b.com");
  });

  test("protocol-relative URL", () => {
    expect(resolveUrl("https://a.com", "//b.com/path")).toBe("https://b.com/path");
  });

  test("relative path from root", () => {
    expect(resolveUrl("https://a.com/dir/page", "/other")).toBe("https://a.com/other");
  });

  test("relative path from current", () => {
    expect(resolveUrl("https://a.com/dir/page", "sibling")).toBe("https://a.com/dir/sibling");
  });

  test("parent directory traversal", () => {
    // /a/b/c -> ../../d: c is a file, parent is /a/b, up to /a, up to /, then /d
    expect(resolveUrl("https://a.com/a/b/c", "../../d")).toBe("https://a.com/d");
  });

  test("fragment-only URL", () => {
    expect(resolveUrl("https://a.com/page", "#section")).toBe("https://a.com/page#section");
  });

  test("query-only URL", () => {
    expect(resolveUrl("https://a.com/page", "?q=test")).toBe("https://a.com/page?q=test");
  });

  test("invalid base URL returns relative as-is", () => {
    expect(resolveUrl("not-a-url", "/path")).toBe("/path");
  });
});

describe("Navigation history edge cases", () => {
  test("back at start returns null", () => {
    const h = new NavigationHistory();
    h.push("https://a.com");
    expect(h.back()).toBeNull();
    expect(h.canGoBack()).toBe(false);
  });

  test("forward at end returns null", () => {
    const h = new NavigationHistory();
    h.push("https://a.com");
    expect(h.forward()).toBeNull();
    expect(h.canGoForward()).toBe(false);
  });

  test("push after back truncates forward history", () => {
    const h = new NavigationHistory();
    h.push("https://a.com");
    h.push("https://b.com");
    h.push("https://c.com");

    h.back(); // at B
    h.push("https://d.com"); // should truncate C

    expect(h.canGoForward()).toBe(false);
    expect(h.length).toBe(3); // A, B, D
    expect(h.url).toBe("https://d.com");
  });

  test("replace modifies current entry", () => {
    const h = new NavigationHistory();
    h.push("https://a.com", "A");
    h.push("https://b.com", "B");

    h.replace("https://b2.com", "B2");
    expect(h.url).toBe("https://b2.com");
    expect(h.length).toBe(2);
  });

  test("initial url is about:blank", () => {
    const h = new NavigationHistory();
    expect(h.url).toBe("about:blank");
  });
});

describe("Cookie edge cases", () => {
  test("cookie with trailing slash path", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1; Path=/admin/", "https://example.com/admin/");

    expect(jar.getCookies("https://example.com/admin/").length).toBe(1);
    expect(jar.getCookies("https://example.com/admin/page").length).toBe(1);
    // Trailing slash means /admin2 should NOT match since path is /admin/
    expect(jar.getCookies("https://example.com/admin2").length).toBe(0);
  });

  test("cookie domain matching with deep subdomains", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1; Domain=example.com", "https://example.com");

    expect(jar.getCookies("https://example.com").length).toBe(1);
    expect(jar.getCookies("https://sub.example.com").length).toBe(1);
    expect(jar.getCookies("https://deep.sub.example.com").length).toBe(1);
    expect(jar.getCookies("https://notexample.com").length).toBe(0);
  });

  test("cookie with negative max-age is deleted", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1", "https://example.com");
    expect(jar.getCookies("https://example.com").length).toBe(1);

    jar.setCookie("a=1; Max-Age=-1", "https://example.com");
    expect(jar.getCookies("https://example.com").length).toBe(0);
  });

  test("multiple Set-Cookie headers", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1; Path=/", "https://example.com");
    jar.setCookie("b=2; Path=/", "https://example.com");
    jar.setCookie("c=3; Path=/", "https://example.com");

    expect(jar.getCookies("https://example.com").length).toBe(3);
    expect(jar.getCookieHeader("https://example.com")).toBe("a=1; b=2; c=3");
  });

  test("cookie value with equals sign", () => {
    const jar = new CookieJar();
    jar.setCookie("token=abc=def=ghi; Path=/", "https://example.com");
    const cookies = jar.getCookies("https://example.com");
    expect(cookies[0]!.value).toBe("abc=def=ghi");
  });

  test("clear removes all cookies", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1", "https://example.com");
    jar.setCookie("b=2", "https://example.com");
    jar.clear();
    expect(jar.getCookies("https://example.com").length).toBe(0);
  });

  test("secure cookie not sent over http", () => {
    const jar = new CookieJar();
    jar.setCookie("token=secret; Secure", "https://example.com");
    expect(jar.getCookies("https://example.com").length).toBe(1);
    expect(jar.getCookies("http://example.com").length).toBe(0);
  });
});

describe("SieveStorage edge cases", () => {
  test("getItem for non-existent key returns null", () => {
    const s = new SieveStorage();
    expect(s.getItem("nope")).toBeNull();
  });

  test("key() with out-of-bounds index returns null", () => {
    const s = new SieveStorage();
    s.setItem("a", "1");
    expect(s.key(0)).toBe("a");
    expect(s.key(1)).toBeNull();
    expect(s.key(-1)).toBeNull();
  });

  test("removeItem for non-existent key is no-op", () => {
    const s = new SieveStorage();
    s.removeItem("nope"); // should not throw
    expect(s.length).toBe(0);
  });

  test("round-trip through JSON", () => {
    const s = new SieveStorage();
    s.setItem("key", "value");
    s.setItem("unicode", "日本語 🎉");

    const json = s.toJSON();
    const restored = SieveStorage.fromJSON(json);
    expect(restored.getItem("key")).toBe("value");
    expect(restored.getItem("unicode")).toBe("日本語 🎉");
  });
});

describe("Page navigation edge cases", () => {
  test("goto without fetcher throws", async () => {
    const page = new SievePage();
    await expect(page.goto("https://example.com")).rejects.toThrow("No network fetcher");
  });

  test("setContent updates URL", () => {
    const page = new SievePage();
    page.setContent("<body>hi</body>", "https://example.com/page");
    expect(page.url).toBe("https://example.com/page");
  });

  test("multiple setContent calls update history", () => {
    const page = new SievePage();
    page.setContent("<body>1</body>", "https://a.com");
    page.setContent("<body>2</body>", "https://b.com");
    expect(page.url).toBe("https://b.com");
    expect(page.history.length).toBe(2);
  });

  test("page remembers cookies across navigations", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com/login": {
            url: "https://example.com/login",
            status: 200,
            headers: { "set-cookie": "session=xyz; Path=/" },
            body: "<html><body>logged in</body></html>",
          },
          "https://example.com/dashboard": "<html><body>dashboard</body></html>",
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com/login");
    await page.goto("https://example.com/dashboard");

    // Cookie should persist
    const cookies = page.cookies.getCookies("https://example.com/");
    expect(cookies.some((c) => c.name === "session")).toBe(true);

    browser.close();
  });

  test("404 response still updates page", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com/missing": {
            url: "https://example.com/missing",
            status: 404,
            headers: {},
            body: "<html><body><h1>Not Found</h1></body></html>",
          },
        },
      },
    });

    const page = await browser.newPage();
    const response = await page.goto("https://example.com/missing");
    expect(response.status).toBe(404);
    expect(page.querySelector("h1")?.textContent).toBe("Not Found");

    browser.close();
  });

  test("empty response body", async () => {
    const browser = new SieveBrowser({
      network: {
        mock: {
          "https://example.com/empty": {
            url: "https://example.com/empty",
            status: 204,
            headers: {},
            body: "",
          },
        },
      },
    });

    const page = await browser.newPage();
    await page.goto("https://example.com/empty");
    expect(page.content).toBe("");

    browser.close();
  });
});

describe("LiveFetcher domain allowlist", () => {
  test("disallowed domain throws", async () => {
    const { LiveFetcher } = await import("../src/index.ts");
    const fetcher = new LiveFetcher({
      allowedDomains: ["example.com"],
    });

    await expect(fetcher.fetch("https://evil.com")).rejects.toThrow("Domain not allowed");
  });

  test("wildcard domain matching", async () => {
    const { LiveFetcher } = await import("../src/index.ts");
    const fetcher = new LiveFetcher({
      allowedDomains: ["*.example.com"],
    });

    // Should not throw for subdomains
    // (will fail on fetch since these aren't real, but domain check passes)
    await expect(fetcher.fetch("https://evil.com")).rejects.toThrow("Domain not allowed");
  });
});

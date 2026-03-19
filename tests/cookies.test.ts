import { describe, test, expect } from "bun:test";
import { CookieJar } from "../src/index.ts";

describe("CookieJar", () => {
  test("set and get cookies", () => {
    const jar = new CookieJar();
    jar.setCookie("session=abc123", "https://example.com/page");
    jar.setCookie("theme=dark; Path=/", "https://example.com/page");

    const cookies = jar.getCookies("https://example.com/page");
    expect(cookies.length).toBe(2);
    expect(jar.getCookieHeader("https://example.com/page")).toBe("session=abc123; theme=dark");
  });

  test("domain scoping", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1; Domain=example.com", "https://example.com");
    jar.setCookie("b=2; Domain=other.com", "https://other.com");

    expect(jar.getCookies("https://example.com").length).toBe(1);
    expect(jar.getCookies("https://sub.example.com").length).toBe(1); // subdomain match
    expect(jar.getCookies("https://other.com").length).toBe(1);
  });

  test("path scoping", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1; Path=/admin", "https://example.com/admin");
    jar.setCookie("b=2; Path=/", "https://example.com");

    expect(jar.getCookies("https://example.com/admin/settings").length).toBe(2);
    expect(jar.getCookies("https://example.com/").length).toBe(1);
  });

  test("secure cookies", () => {
    const jar = new CookieJar();
    jar.setCookie("token=secret; Secure", "https://example.com");

    expect(jar.getCookies("https://example.com").length).toBe(1);
    expect(jar.getCookies("http://example.com").length).toBe(0);
  });

  test("cookie expiration", () => {
    const jar = new CookieJar();
    jar.setCookie("expired=val; Max-Age=0", "https://example.com");
    expect(jar.getCookies("https://example.com").length).toBe(0);

    jar.setCookie("future=val; Max-Age=3600", "https://example.com");
    expect(jar.getCookies("https://example.com").length).toBe(1);
  });

  test("cookie replacement", () => {
    const jar = new CookieJar();
    jar.setCookie("a=1", "https://example.com");
    jar.setCookie("a=2", "https://example.com");

    const cookies = jar.getCookies("https://example.com");
    expect(cookies.length).toBe(1);
    expect(cookies[0]!.value).toBe("2");
  });
});

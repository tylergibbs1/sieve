/**
 * Battle tests: WAF challenge solving.
 */

import { describe, test, expect } from "bun:test";
import {
  SieveBrowser,
  SievePage,
  solveChallenge,
  type ChallengeSolver,
} from "../src/index.ts";

describe("Sucuri WAF solver", () => {
  test("detects and solves Sucuri challenge from real response", () => {
    // Simulated Sucuri challenge (same structure as real ones)
    const challengeBody = `<html><title>You are being redirected...</title>
      <noscript>Javascript is required.</noscript>
      <script>var s={},u,c,U,r,i,l=0,a,e=eval,w=String.fromCharCode,sucuri_cloudproxy_js='',S='eT0nMScgKyAnMicgKyAnMycgKyAnNCc7ZG9jdW1lbnQuY29va2llPSd0ZXN0X2Nvb2tpZT0nICsgeSArICc7cGF0aD0vO21heC1hZ2U9ODY0MDAnOyBsb2NhdGlvbi5yZWxvYWQoKTs=';L=S.length;U=0;r='';var A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';for(u=0;u<64;u++){s[A.charAt(u)]=u;}for(i=0;i<L;i++){c=s[S.charAt(i)];U=(U<<6)+c;l+=6;while(l>=8){((a=(U>>>(l-=8))&0xff)||(i<(L-2)))&&(r+=w(a));}}e(r);</script></html>`;

    const response = {
      url: "https://example.com",
      status: 200,
      headers: {},
      body: challengeBody,
    };

    const result = solveChallenge(response, "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.solver).toBe("sucuri");
    expect(result!.solution.shouldRetry).toBe(true);
    expect(result!.solution.cookies.length).toBe(1);
    expect(result!.solution.cookies[0]).toContain("test_cookie=1234");
  });

  test("does not trigger on normal HTML", () => {
    const response = {
      url: "https://example.com",
      status: 200,
      headers: {},
      body: "<html><body><h1>Hello World</h1></body></html>",
    };

    const result = solveChallenge(response, "https://example.com");
    expect(result).toBeNull();
  });
});

describe("Automatic WAF solving via page.goto()", () => {
  test("solves Sucuri challenge transparently", async () => {
    let requestCount = 0;

    // The challenge response
    const challengeBody = `<html><title>You are being redirected...</title>
      <noscript>Javascript is required.</noscript>
      <script>var s={},u,c,U,r,i,l=0,a,e=eval,w=String.fromCharCode,sucuri_cloudproxy_js='',S='eT0nMScgKyAnMicgKyAnMycgKyAnNCc7ZG9jdW1lbnQuY29va2llPSd0ZXN0X2Nvb2tpZT0nICsgeSArICc7cGF0aD0vO21heC1hZ2U9ODY0MDAnOyBsb2NhdGlvbi5yZWxvYWQoKTs=';L=S.length;U=0;r='';var A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';for(u=0;u<64;u++){s[A.charAt(u)]=u;}for(i=0;i<L;i++){c=s[S.charAt(i)];U=(U<<6)+c;l+=6;while(l>=8){((a=(U>>>(l-=8))&0xff)||(i<(L-2)))&&(r+=w(a));}}e(r);</script></html>`;

    const browser = new SieveBrowser({
      network: {
        custom: {
          async fetch(url, options) {
            requestCount++;
            const hasCookie = options?.headers?.["Cookie"]?.includes("test_cookie=");

            if (!hasCookie) {
              return {
                url,
                status: 200,
                headers: {},
                body: challengeBody,
              };
            }

            // Cookie present — return real content
            return {
              url,
              status: 200,
              headers: { "content-type": "text/html" },
              body: "<html><head><title>Real Page</title></head><body><h1>Welcome</h1></body></html>",
            };
          },
        },
      },
      solveWafChallenges: true,
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    expect(page.title).toBe("Real Page");
    expect(page.querySelector("h1")?.textContent).toBe("Welcome");
    expect(requestCount).toBe(2); // challenge + retry

    browser.close();
  });

  test("gives up after maxChallengeRetries", async () => {
    let requestCount = 0;

    const challengeBody = `<html><title>You are being redirected...</title>
      <script>var sucuri_cloudproxy_js='',S='eT0nMScgKyAnMicgKyAnMycgKyAnNCc7ZG9jdW1lbnQuY29va2llPSd0ZXN0X2Nvb2tpZT0nICsgeSArICc7cGF0aD0vO21heC1hZ2U9ODY0MDAnOyBsb2NhdGlvbi5yZWxvYWQoKTs=';</script></html>`;

    const browser = new SieveBrowser({
      network: {
        custom: {
          async fetch(url) {
            requestCount++;
            // Always return challenge (simulate unsolvable)
            return { url, status: 200, headers: {}, body: challengeBody };
          },
        },
      },
      solveWafChallenges: true,
      maxChallengeRetries: 2,
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    // Should give up after 2 retries (3 requests total: initial + 2 retries)
    expect(requestCount).toBe(3);
    expect(page.title).toContain("redirected");

    browser.close();
  });

  test("does not solve challenges when disabled", async () => {
    let requestCount = 0;

    const challengeBody = `<html><title>You are being redirected...</title>
      <script>var sucuri_cloudproxy_js='',S='eT0nMScgKyAnMicgKyAnMycgKyAnNCc7ZG9jdW1lbnQuY29va2llPSd0ZXN0X2Nvb2tpZT0nICsgeSArICc7cGF0aD0vO21heC1hZ2U9ODY0MDAnOyBsb2NhdGlvbi5yZWxvYWQoKTs=';</script></html>`;

    const browser = new SieveBrowser({
      network: {
        custom: {
          async fetch(url) {
            requestCount++;
            return { url, status: 200, headers: {}, body: challengeBody };
          },
        },
      },
      // solveWafChallenges defaults to false
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    expect(requestCount).toBe(1); // no retry
    expect(page.title).toContain("redirected");

    browser.close();
  });
});

describe("Custom challenge solver", () => {
  test("custom solver is used alongside built-in ones", async () => {
    const customSolver: ChallengeSolver = {
      name: "custom-challenge",
      detect(response) {
        return response.body.includes("CUSTOM_CHALLENGE_TOKEN");
      },
      solve(response, requestUrl) {
        const match = response.body.match(/TOKEN=([a-f0-9]+)/);
        if (!match) return null;
        return {
          cookies: [`custom_auth=${match[1]}; Path=/`],
          shouldRetry: true,
        };
      },
    };

    let requestCount = 0;

    const browser = new SieveBrowser({
      network: {
        custom: {
          async fetch(url, options) {
            requestCount++;
            if (!options?.headers?.["Cookie"]?.includes("custom_auth=")) {
              return {
                url,
                status: 200,
                headers: {},
                body: "<html>CUSTOM_CHALLENGE_TOKEN TOKEN=deadbeef42</html>",
              };
            }
            return {
              url,
              status: 200,
              headers: {},
              body: "<html><head><title>Authenticated</title></head><body>OK</body></html>",
            };
          },
        },
      },
      solveWafChallenges: true,
      challengeSolvers: [customSolver],
    });

    const page = await browser.newPage();
    await page.goto("https://example.com");

    expect(page.title).toBe("Authenticated");
    expect(requestCount).toBe(2);

    browser.close();
  });
});

describe("Live: Sucuri WAF site", () => {
  test("solves Clayton County court inquiry challenge", async () => {
    const browser = new SieveBrowser({
      network: "live",
      solveWafChallenges: true,
    });

    const page = await browser.newPage();
    await page.goto("https://www.claytoncountyga.gov/government/courts/court-case-inquiry/");

    // Should have solved the Sucuri challenge and loaded real content
    expect(page.title).toContain("Clayton County");
    expect(page.querySelectorAll("a").length).toBeGreaterThan(10);

    const tree = page.accessibilityTree();
    const serialized = tree.serialize();
    expect(serialized).toContain("[link]");
    expect(serialized.length).toBeGreaterThan(500);

    browser.close();
  });
});

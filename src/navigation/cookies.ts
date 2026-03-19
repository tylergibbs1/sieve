/**
 * Cookie jar implementation.
 * Handles Set-Cookie parsing, domain scoping, and expiration.
 */

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: Date;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
}

export class CookieJar {
  private cookies: Cookie[] = [];

  /** Parse a Set-Cookie header and add the cookie. */
  setCookie(header: string, requestUrl: string): void {
    const url = new URL(requestUrl);
    const parts = header.split(";").map((p) => p.trim());
    const [nameValue, ...attrs] = parts;
    if (!nameValue) return;

    const eqIdx = nameValue.indexOf("=");
    if (eqIdx === -1) return;

    const name = nameValue.slice(0, eqIdx).trim();
    const value = nameValue.slice(eqIdx + 1).trim();

    const cookie: Cookie = {
      name,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "lax",
    };

    for (const attr of attrs) {
      const [key, val] = attr.split("=").map((s) => s.trim());
      if (!key) continue;
      switch (key.toLowerCase()) {
        case "domain":
          if (val) cookie.domain = val.startsWith(".") ? val.slice(1) : val;
          break;
        case "path":
          if (val) cookie.path = val;
          break;
        case "expires":
          if (val) cookie.expires = new Date(val);
          break;
        case "max-age":
          if (val) {
            const seconds = parseInt(val, 10);
            if (seconds <= 0) {
              cookie.expires = new Date(0); // expired
            } else {
              cookie.expires = new Date(Date.now() + seconds * 1000);
            }
          }
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "samesite":
          if (val) cookie.sameSite = val.toLowerCase() as Cookie["sameSite"];
          break;
      }
    }

    // Remove existing cookie with same name/domain/path
    this.cookies = this.cookies.filter(
      (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
    );

    // Don't add expired cookies
    if (cookie.expires && cookie.expires.getTime() < Date.now()) return;

    this.cookies.push(cookie);
  }

  /** Get all cookies matching the given URL. */
  getCookies(requestUrl: string): Cookie[] {
    const url = new URL(requestUrl);
    const now = Date.now();

    return this.cookies.filter((c) => {
      if (c.expires && c.expires.getTime() < now) return false;
      if (c.secure && url.protocol !== "https:") return false;
      if (!this.domainMatches(url.hostname, c.domain)) return false;
      if (!this.pathMatches(url.pathname, c.path)) return false;
      return true;
    });
  }

  /** Format cookies as a Cookie header value. */
  getCookieHeader(requestUrl: string): string {
    return this.getCookies(requestUrl)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  /** Clear all cookies. */
  clear(): void {
    this.cookies = [];
  }

  /** Clear expired cookies. */
  clearExpired(): void {
    const now = Date.now();
    this.cookies = this.cookies.filter(
      (c) => !c.expires || c.expires.getTime() > now,
    );
  }

  private domainMatches(hostname: string, cookieDomain: string): boolean {
    if (hostname === cookieDomain) return true;
    if (hostname.endsWith(`.${cookieDomain}`)) return true;
    return false;
  }

  /** RFC 6265 path matching: cookie path must be a prefix at a boundary. */
  private pathMatches(requestPath: string, cookiePath: string): boolean {
    if (requestPath === cookiePath) return true;
    if (!requestPath.startsWith(cookiePath)) return false;
    // Cookie path "/admin" should match "/admin/x" but not "/admin2"
    // Either the cookie path ends with "/" or the next char in request path is "/"
    if (cookiePath.endsWith("/")) return true;
    return requestPath[cookiePath.length] === "/";
  }
}

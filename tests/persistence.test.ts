import { describe, test, expect } from "bun:test";
import { SievePersistence, CookieJar, SieveStorage } from "../src/index.ts";

describe("SQLite persistence", () => {
  test("save and load cookies", () => {
    const persistence = new SievePersistence(); // in-memory

    // Create a cookie jar with some cookies
    const jar = new CookieJar();
    jar.setCookie("session=abc123; Path=/", "https://example.com/");
    jar.setCookie("theme=dark; Path=/; Max-Age=3600", "https://example.com/");

    // Save cookies for example.com
    persistence.saveCookies(jar, "https://example.com/");

    // Load into a fresh jar
    const newJar = new CookieJar();
    persistence.loadCookies(newJar);

    const cookies = newJar.getCookies("https://example.com/");
    expect(cookies.length).toBe(2);
    expect(cookies.find((c) => c.name === "session")?.value).toBe("abc123");
    expect(cookies.find((c) => c.name === "theme")?.value).toBe("dark");

    persistence.close();
  });

  test("save and load cookies directly from list", () => {
    const persistence = new SievePersistence();

    persistence.saveCookiesFromList([
      { name: "a", value: "1", domain: "example.com", path: "/", httpOnly: false, secure: false, sameSite: "lax" },
      { name: "b", value: "2", domain: "example.com", path: "/", httpOnly: true, secure: true, sameSite: "strict" },
    ]);

    const jar = new CookieJar();
    persistence.loadCookies(jar);

    const cookies = jar.getCookies("https://example.com/");
    expect(cookies.length).toBe(2);
    expect(cookies.find((c) => c.name === "b")?.httpOnly).toBe(true);

    persistence.close();
  });

  test("save and load storage", () => {
    const persistence = new SievePersistence();

    const storage = new SieveStorage();
    storage.setItem("user", "alice");
    storage.setItem("theme", "dark");

    persistence.saveStorage("https://example.com", "local", storage);

    const loaded = persistence.loadStorage("https://example.com", "local");
    expect(loaded.getItem("user")).toBe("alice");
    expect(loaded.getItem("theme")).toBe("dark");
    expect(loaded.length).toBe(2);

    // Session storage is separate
    const session = persistence.loadStorage("https://example.com", "session");
    expect(session.length).toBe(0);

    persistence.close();
  });

  test("save and load snapshots", () => {
    const persistence = new SievePersistence();

    const data = JSON.stringify({ type: "document", children: [] });
    persistence.saveSnapshot("snap-001", data);
    persistence.saveSnapshot("snap-002", "other data");

    expect(persistence.loadSnapshot("snap-001")).toBe(data);
    expect(persistence.loadSnapshot("snap-002")).toBe("other data");
    expect(persistence.loadSnapshot("snap-999")).toBeNull();

    const list = persistence.listSnapshots();
    expect(list.length).toBe(2);

    persistence.deleteSnapshot("snap-001");
    expect(persistence.loadSnapshot("snap-001")).toBeNull();
    expect(persistence.listSnapshots().length).toBe(1);

    persistence.close();
  });

  test("file-based persistence survives close/reopen", () => {
    const path = `/tmp/sieve-test-${Date.now()}.sqlite`;

    // Write
    const p1 = new SievePersistence({ path });
    const storage = new SieveStorage();
    storage.setItem("key", "value");
    p1.saveStorage("https://example.com", "local", storage);
    p1.close();

    // Read
    const p2 = new SievePersistence({ path });
    const loaded = p2.loadStorage("https://example.com", "local");
    expect(loaded.getItem("key")).toBe("value");
    p2.close();

    // Cleanup
    Bun.spawnSync(["rm", path]);
  });
});

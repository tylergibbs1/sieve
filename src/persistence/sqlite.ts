/**
 * SQLite-backed persistence for cookies and storage.
 * Uses bun:sqlite for zero-dependency, synchronous, in-process persistence.
 */

import { Database } from "bun:sqlite";
import { CookieJar, type Cookie } from "../navigation/cookies.ts";
import { SieveStorage } from "../navigation/session.ts";

export interface PersistenceOptions {
  /** Path to the SQLite database file. Use ":memory:" for in-memory only. */
  path?: string;
}

export class SievePersistence {
  readonly db: Database;

  constructor(options: PersistenceOptions = {}) {
    this.db = new Database(options.path ?? ":memory:");
    this.db.run("PRAGMA journal_mode = WAL;");
    this.init();
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cookies (
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        domain TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '/',
        expires INTEGER,
        http_only INTEGER NOT NULL DEFAULT 0,
        secure INTEGER NOT NULL DEFAULT 0,
        same_site TEXT NOT NULL DEFAULT 'lax',
        PRIMARY KEY (name, domain, path)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS storage (
        origin TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('local', 'session')),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (origin, type, key)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  // --- Cookies ---

  /** Save cookies retrieved for a specific URL. */
  saveCookies(jar: CookieJar, url: string): void {
    this.saveCookiesFromList(jar.getCookies(url));
  }

  /** Save a list of cookies directly. */
  saveCookiesFromList(cookies: Cookie[]): void {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO cookies (name, value, domain, path, expires, http_only, secure, same_site) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const tx = this.db.transaction((cookies: Cookie[]) => {
      for (const c of cookies) {
        insert.run(
          c.name,
          c.value,
          c.domain,
          c.path,
          c.expires ? c.expires.getTime() : null,
          c.httpOnly ? 1 : 0,
          c.secure ? 1 : 0,
          c.sameSite,
        );
      }
    });
    tx(cookies);
  }

  /** Load persisted cookies into a CookieJar. */
  loadCookies(jar: CookieJar): void {
    const now = Date.now();
    this.db.run("DELETE FROM cookies WHERE expires IS NOT NULL AND expires < ?", [now]);

    const rows = this.db.query(
      "SELECT name, value, domain, path, expires, http_only, secure, same_site FROM cookies"
    ).all() as Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number | null;
      http_only: number;
      secure: number;
      same_site: string;
    }>;

    for (const row of rows) {
      let header = `${row.name}=${row.value}`;
      header += `; Domain=${row.domain}`;
      header += `; Path=${row.path}`;
      if (row.expires) {
        header += `; Expires=${new Date(row.expires).toUTCString()}`;
      }
      if (row.http_only) header += "; HttpOnly";
      if (row.secure) header += "; Secure";
      header += `; SameSite=${row.same_site}`;

      jar.setCookie(header, `https://${row.domain}/`);
    }
  }

  // --- Storage ---

  /** Persist a SieveStorage instance. */
  saveStorage(origin: string, type: "local" | "session", storage: SieveStorage): void {
    const data = storage.toJSON();

    const tx = this.db.transaction(() => {
      this.db.run(
        "DELETE FROM storage WHERE origin = ? AND type = ?",
        [origin, type]
      );
      const insert = this.db.prepare(
        "INSERT INTO storage (origin, type, key, value) VALUES (?, ?, ?, ?)"
      );
      for (const [key, value] of Object.entries(data)) {
        insert.run(origin, type, key, value);
      }
    });
    tx();
  }

  /** Load a persisted SieveStorage. */
  loadStorage(origin: string, type: "local" | "session"): SieveStorage {
    const rows = this.db.query(
      "SELECT key, value FROM storage WHERE origin = ? AND type = ?"
    ).all(origin, type) as Array<{ key: string; value: string }>;

    const data: Record<string, string> = {};
    for (const row of rows) {
      data[row.key] = row.value;
    }
    return SieveStorage.fromJSON(data);
  }

  // --- Snapshots ---

  /** Save a serialized snapshot. */
  saveSnapshot(id: string, data: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO snapshots (id, data, created_at) VALUES (?, ?, ?)",
      [id, data, Date.now()]
    );
  }

  /** Load a snapshot by ID. */
  loadSnapshot(id: string): string | null {
    const row = this.db.query(
      "SELECT data FROM snapshots WHERE id = ?"
    ).get(id) as { data: string } | null;
    return row?.data ?? null;
  }

  /** List all saved snapshots. */
  listSnapshots(): Array<{ id: string; createdAt: number }> {
    return this.db.query(
      "SELECT id, created_at as createdAt FROM snapshots ORDER BY created_at DESC"
    ).all() as Array<{ id: string; createdAt: number }>;
  }

  /** Delete a snapshot by ID. */
  deleteSnapshot(id: string): void {
    this.db.run("DELETE FROM snapshots WHERE id = ?", [id]);
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }
}

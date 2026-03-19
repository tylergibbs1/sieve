/**
 * Session storage simulation (localStorage/sessionStorage).
 */

export class SieveStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    const keys = [...this.store.keys()];
    return keys[index] ?? null;
  }

  get length(): number {
    return this.store.size;
  }

  /** Snapshot the storage for serialization. */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.store);
  }

  /** Restore from a snapshot. */
  static fromJSON(data: Record<string, string>): SieveStorage {
    const storage = new SieveStorage();
    for (const [k, v] of Object.entries(data)) {
      storage.store.set(k, v);
    }
    return storage;
  }
}

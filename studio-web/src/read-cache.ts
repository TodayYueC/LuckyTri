type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };

export class ReadCache {
  version = 0;
  private entries = new Map<string, Entry>();
  constructor(privateClock?: () => number) {
    this.clock = privateClock || Date.now;
  }
  private clock: () => number;
  snapshot(key: string): any {
    const value = this.entries.get(key)?.value;
    return value === undefined ? undefined : structuredClone(value);
  }
  get(key: string, load: () => Promise<unknown>, ttl = 15000): Promise<any> {
    let entry = this.entries.get(key);
    if (entry?.value !== undefined && entry.expires > this.clock())
      return Promise.resolve(this.snapshot(key));
    if (!entry) {
      entry = { expires: 0 };
      this.entries.set(key, entry);
      if (this.entries.size > 48)
        this.entries.delete(this.entries.keys().next().value!);
    }
    if (!entry.pending) {
      const current = entry;
      const pending = Promise.resolve()
        .then(load)
        .then((value) => {
          if (
            this.entries.get(key) === current &&
            current.pending === pending
          ) {
            current.value = structuredClone(value);
            current.expires = this.clock() + ttl;
          }
          return value;
        })
        .finally(() => {
          if (current.pending === pending) current.pending = undefined;
        });
      entry.pending = pending;
    }
    return entry.pending.then((value) => structuredClone(value));
  }
  expire() {
    this.version++;
    // Keep a picture for immediate rendering, but re-read after a server change.
    for (const entry of this.entries.values()) {
      entry.expires = 0;
      entry.pending = undefined;
    }
  }
  clear() {
    this.version++;
    this.entries.clear();
  }
}

export const reads = new ReadCache();

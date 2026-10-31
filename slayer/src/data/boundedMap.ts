/* A Map that keeps the `max` most recently used entries, for the per-name and per-contract caches a long-open tab would
   otherwise grow without end (every name a watchlist ever showed, every contract a chain ever priced). Re-exported by
   feedStore.ts, where it began. */

/** A map that keeps the `max` most recently read or written entries; an older one is read again when asked */
export class BoundedMap<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  /** Read without marking it used */
  peek(k: K): V | undefined {
    return this.m.get(k);
  }
  has(k: K): boolean {
    return this.m.has(k);
  }
  set(k: K, v: V): this {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
    return this;
  }
  delete(k: K): boolean {
    return this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  get size(): number {
    return this.m.size;
  }
  keys(): IterableIterator<K> {
    return this.m.keys();
  }
  values(): IterableIterator<V> {
    return this.m.values();
  }
  entries(): IterableIterator<[K, V]> {
    return this.m.entries();
  }
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.m.entries();
  }
}

/** A map that keeps its `max` most recently used entries, never letting go of one still in use (`inUse`): a chart's
    tape or print slot is dropped only once no pane wants it and newer ones have pushed it out. While more than `max`
    are in use it holds them all and lets go of the oldest unused ones first. */
export class InUseLru<K, V> {
  private m = new Map<K, V>();
  constructor(
    readonly max: number,
    private inUse: (k: K) => boolean,
  ) {}
  /** Read it and mark it used */
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  /** Read without marking it used */
  peek(k: K): V | undefined {
    return this.m.get(k);
  }
  has(k: K): boolean {
    return this.m.has(k);
  }
  /** Write it as the newest; it is never the one let go by its own write (its want may be counted just after) */
  set(k: K, v: V): this {
    this.m.delete(k);
    this.m.set(k, v);
    this.trim(k);
    return this;
  }
  /** Let go of the least recently used entries no one wants, down to `max` (call once a want is released) */
  trim(keep?: K): void {
    if (this.m.size <= this.max) return;
    for (const k of this.m.keys()) {
      if (this.m.size <= this.max) break;
      if (k !== keep && !this.inUse(k)) this.m.delete(k);
    }
  }
  delete(k: K): boolean {
    return this.m.delete(k);
  }
  get size(): number {
    return this.m.size;
  }
  keys(): IterableIterator<K> {
    return this.m.keys();
  }
}

/** A Set that keeps the `max` most recently added members */
export class BoundedSet<T> {
  private m: BoundedMap<T, true>;
  constructor(max: number) {
    this.m = new BoundedMap(max);
  }
  add(v: T): this {
    this.m.set(v, true);
    return this;
  }
  has(v: T): boolean {
    return this.m.has(v);
  }
  delete(v: T): boolean {
    return this.m.delete(v);
  }
  get size(): number {
    return this.m.size;
  }
}

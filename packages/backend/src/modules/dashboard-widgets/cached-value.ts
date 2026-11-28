/**
 * Keeps the result of an expensive read for a while and shares one read between concurrent callers. When a refresh
 * fails the previous value is returned, so a transient Docker or disk error does not blank a widget.
 */
export class CachedValue<T> {
  private cache: { value: T; at: number } | null = null;
  private pending: Promise<T> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly now: () => number = Date.now,
  ) {}

  public get(): Promise<T> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) {
      return Promise.resolve(this.cache.value);
    }

    if (this.pending) return this.pending;

    this.pending = this.load()
      .then((value) => {
        this.cache = { value, at: this.now() };
        return value;
      })
      .catch((error) => {
        if (this.cache) return this.cache.value;

        throw error;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  public clear() {
    this.cache = null;
  }
}

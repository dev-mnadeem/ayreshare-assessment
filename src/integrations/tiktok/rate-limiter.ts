export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spaces out call *starts* by at least `minIntervalMs` (the Marketing API sandbox allows 1 QPS).
 * Calls queue in arrival order. Single-process only; a multi-instance deployment would need a
 * shared limiter (e.g. Redis) keyed per advertiser/app.
 */
export class RateLimiter {
  private nextSlot = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    const current = this.now();
    const slot = Math.max(current, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > current) await this.sleep(slot - current);
    return task();
  }
}

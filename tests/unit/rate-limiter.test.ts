import { afterEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter } from '../../src/integrations/tiktok/rate-limiter.js';

/** A controllable clock; sleep() records the requested wait and moves time forward. */
function fakeClock() {
  let now = 0;
  const waits: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      const wakeAt = now + ms;
      await Promise.resolve();
      now = Math.max(now, wakeAt);
    },
    advance: (ms: number) => {
      now += ms;
    },
    waits,
  };
}

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces call starts by the interval (1 QPS) using real timers', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = new RateLimiter(1000); // default Date.now + setTimeout-based sleep
    const starts: number[] = [];
    const task = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };

    const all = Promise.all([
      limiter.schedule(task),
      limiter.schedule(task),
      limiter.schedule(task),
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    await all;

    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('asks the sleeper for exactly the gap to the next slot', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1000, clock.now, clock.sleep);

    await Promise.all([1, 2, 3].map(() => limiter.schedule(() => Promise.resolve())));

    expect(clock.waits).toEqual([1000, 2000]);
  });

  it('does not wait when calls are already far enough apart', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1000, clock.now, clock.sleep);

    await limiter.schedule(() => Promise.resolve());
    clock.advance(5000);
    await limiter.schedule(() => Promise.resolve());

    expect(clock.waits).toEqual([]);
  });

  it('returns the task result and propagates errors', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock.now, clock.sleep);

    await expect(limiter.schedule(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(limiter.schedule(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

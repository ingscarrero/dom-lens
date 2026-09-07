import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, runPool } from '@/lib/concurrency/pool';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('runPool', () => {
  it('resolves immediately with an empty array when there are no items', async () => {
    const results = await runPool([], async () => 1);
    expect(results).toEqual([]);
  });

  it('preserves input order regardless of completion order', async () => {
    const delays = [30, 5, 15];
    const results = await runPool(delays, (ms, i) =>
      new Promise<string>((r) => setTimeout(() => r(`job-${i}`), ms)),
    );
    expect(results).toEqual([
      { ok: true, value: 'job-0' },
      { ok: true, value: 'job-1' },
      { ok: true, value: 'job-2' },
    ]);
  });

  it('never runs more than the requested concurrency at once', async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runPool(
      items,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        await tick();
        running -= 1;
      },
      { concurrency: 2 },
    );
    expect(peak).toBe(2);
  });

  it('hard-caps concurrency at MAX_CONCURRENCY even when asked for more', async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runPool(
      items,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        await tick();
        running -= 1;
      },
      { concurrency: 50 },
    );
    expect(peak).toBe(MAX_CONCURRENCY);
    expect(DEFAULT_CONCURRENCY).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });

  it('isolates failures per job and wraps non-Error rejections', async () => {
    const results = await runPool([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom');
      if (n === 3) throw 'plain string';
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(false);
    if (!results[1].ok) expect(results[1].error.message).toBe('boom');
    if (!results[2].ok) expect(results[2].error.message).toBe('plain string');
  });

  it('reports progress with done / total / running counters', async () => {
    const seen: { done: number; total: number; running: number }[] = [];
    await runPool([1, 2, 3], async () => tick(), {
      concurrency: 1,
      onProgress: (p) => seen.push({ ...p }),
    });
    expect(seen.at(-1)).toEqual({ done: 3, total: 3, running: 0 });
    expect(seen.every((p) => p.running <= 1)).toBe(true);
    expect(seen.every((p) => p.done <= p.total)).toBe(true);
  });

  it('fast-fails the remaining queue once the signal is aborted', async () => {
    const controller = new AbortController();
    let started = 0;
    const results = await runPool(
      [1, 2, 3, 4, 5],
      async () => {
        started += 1;
        if (started === 1) controller.abort();
        await tick();
        return 'ok';
      },
      { concurrency: 1, signal: controller.signal },
    );
    expect(started).toBe(1);
    expect(results[0]).toEqual({ ok: true, value: 'ok' });
    for (const r of results.slice(1)) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe('aborted');
    }
  });

  it('resolves with every job marked aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runPool([1, 2], async () => 'never', { signal: controller.signal });
    expect(results.every((r) => !r.ok)).toBe(true);
  });
});

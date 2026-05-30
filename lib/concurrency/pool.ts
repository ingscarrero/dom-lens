/**
 * Bounded-concurrency promise pool.
 *
 * Runs at most `n` jobs at a time. Order of results matches the input
 * array, regardless of completion order. Errors are caught per-job so a
 * single failure doesn't take the whole batch down — failed jobs land
 * as `{ ok: false, error }` entries in the result.
 *
 * Why a cap at all?
 *   - HTTP servers (and our background SW) get unhappy when a panel
 *     fires 200 simultaneous fetches at them. Most browsers cap at 6
 *     concurrent connections per origin anyway, so going higher is
 *     wasted.
 *   - LM Studio / Ollama default to ~4 parallel inference slots —
 *     pushing more concurrent LLM requests just queues them at the
 *     server with no speedup.
 *   - 4 is the sweet spot empirically: fast enough to finish a
 *     hundred-module probe in a second or two, slow enough not to
 *     thrash the connection table.
 *
 * Callers can pass a lower `n` but we hard-cap the upper bound at
 * MAX_CONCURRENCY so the panel never accidentally spams a target site.
 */

export const MAX_CONCURRENCY = 4;
export const DEFAULT_CONCURRENCY = 4;

export type PoolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export interface PoolProgress {
  done: number;
  total: number;
  running: number;
}

export async function runPool<I, T>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<T>,
  opts?: {
    concurrency?: number;
    onProgress?: (p: PoolProgress) => void;
    /** When set, calling abort.signal.aborted causes pending jobs to be
     * skipped (resolved as failed with reason 'aborted'). In-flight jobs
     * are left to settle. */
    signal?: AbortSignal;
  },
): Promise<PoolResult<T>[]> {
  const want = Math.max(1, Math.min(MAX_CONCURRENCY, opts?.concurrency ?? DEFAULT_CONCURRENCY));
  const results: PoolResult<T>[] = new Array(items.length);
  let nextIndex = 0;
  let done = 0;
  let running = 0;

  const report = () => opts?.onProgress?.({ done, total: items.length, running });

  return new Promise((resolve) => {
    if (items.length === 0) {
      resolve(results);
      return;
    }

    const launch = () => {
      while (running < want && nextIndex < items.length) {
        if (opts?.signal?.aborted) {
          // Fast-fail remaining indices
          for (let i = nextIndex; i < items.length; i++) {
            results[i] = { ok: false, error: new Error('aborted') };
            done += 1;
          }
          nextIndex = items.length;
          report();
          if (running === 0) resolve(results);
          return;
        }
        const i = nextIndex++;
        running += 1;
        report();
        Promise.resolve()
          .then(() => fn(items[i], i))
          .then(
            (value) => {
              results[i] = { ok: true, value };
            },
            (e: unknown) => {
              results[i] = {
                ok: false,
                error: e instanceof Error ? e : new Error(String(e)),
              };
            },
          )
          .finally(() => {
            running -= 1;
            done += 1;
            report();
            if (done === items.length) resolve(results);
            else launch();
          });
      }
    };

    launch();
  });
}

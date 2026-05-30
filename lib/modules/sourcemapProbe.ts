import type { HeadProxy } from './fetchProxy';
import { runPool, type PoolProgress } from '@/lib/concurrency/pool';
import type { LoadedModule } from './types';
import { viewerFor } from './viewers';

/**
 * Concurrent sourcemap availability probe.
 *
 * Three-layer detection, cheapest to most expensive:
 *
 *   1. `sourceMapStatus === 'declared'` already set by classifyEntries
 *      from the `SourceMap` / `X-SourceMap` response header. Free —
 *      no probe needed.
 *
 *   2. HEAD probe on the conventional `<url>.map` sibling. Most
 *      production servers either 200 or 404 promptly. Some CDNs
 *      reject HEAD; the background SW falls back to a Range:0-0 GET.
 *
 *   3. (Not done here — done lazily on user action via
 *      `fetchAndParseSourceMap`.) Full GET + VLQ parse.
 *
 * Concurrency is capped at MAX_CONCURRENCY=4 — both for politeness to
 * the target site and because the browser already caps concurrent
 * connections per origin at 6. Going higher just queues at the socket.
 */

export type ProbeStatus =
  | 'unknown' // initial
  | 'declared' // header-only — no probe needed
  | 'probing'
  | 'found'
  | 'missing'
  | 'skipped' // kind doesn't have sourcemaps
  | 'error';

export interface ProbeRecord {
  status: ProbeStatus;
  mapUrl?: string;
  /** HTTP status code returned by the probe, when applicable. */
  httpStatus?: number;
  message?: string;
}

export interface ProbeProgress extends PoolProgress {
  declared: number;
  found: number;
  missing: number;
  skipped: number;
}

/**
 * Run the probe pass. Returns a Map<moduleId, ProbeRecord>. The caller
 * uses it to overlay status onto the module list (rendering badges,
 * counters, etc.) without mutating the underlying Snapshot.
 */
export async function probeSourcemaps(
  modules: readonly LoadedModule[],
  head: HeadProxy,
  opts?: {
    concurrency?: number;
    onProgress?: (p: ProbeProgress) => void;
    signal?: AbortSignal;
  },
): Promise<Map<string, ProbeRecord>> {
  const out = new Map<string, ProbeRecord>();

  // First pass: classify each module into "already declared", "needs probing",
  // or "skipped". Skipped modules never had a sourcemap concept.
  type Job = { mod: LoadedModule; probeUrl: string };
  const jobs: Job[] = [];
  let declared = 0;
  let skipped = 0;

  for (const m of modules) {
    const spec = viewerFor(m.classification.chunkKind);
    if (!spec.supportsSourcemap) {
      out.set(m.id, { status: 'skipped' });
      skipped += 1;
      continue;
    }
    if (m.sourceMapStatus === 'declared' && m.sourceMapUrl) {
      out.set(m.id, {
        status: 'declared',
        mapUrl: m.sourceMapUrl,
      });
      declared += 1;
      continue;
    }
    // Default conventional URL: `<url>.map`. Stripping a trailing
    // query-string / fragment first so we probe the asset's identity,
    // not its cache buster.
    let probeUrl: string;
    try {
      const u = new URL(m.url);
      u.search = '';
      u.hash = '';
      probeUrl = u.toString() + '.map';
    } catch {
      probeUrl = m.url + '.map';
    }
    out.set(m.id, { status: 'probing' });
    jobs.push({ mod: m, probeUrl });
  }

  let found = 0;
  let missing = 0;

  const reportProgress = (p: PoolProgress) => {
    opts?.onProgress?.({
      ...p,
      declared,
      found,
      missing,
      skipped,
    });
  };
  reportProgress({ done: 0, total: jobs.length, running: 0 });

  await runPool(
    jobs,
    async (job) => {
      const res = await head(job.probeUrl);
      const rec = out.get(job.mod.id)!;
      if (res.error) {
        rec.status = 'error';
        rec.message = res.error;
      } else if (res.status >= 200 && res.status < 300) {
        rec.status = 'found';
        rec.mapUrl = job.probeUrl;
        rec.httpStatus = res.status;
        found += 1;
      } else if (res.status === 0) {
        rec.status = 'error';
      } else {
        rec.status = 'missing';
        rec.httpStatus = res.status;
        missing += 1;
      }
    },
    {
      concurrency: opts?.concurrency,
      signal: opts?.signal,
      onProgress: reportProgress,
    },
  );

  return out;
}

/**
 * Tally per category — used to render the summary card at the top of the
 * Modules tab.
 */
export interface ProbeSummary {
  total: number;
  declared: number;
  found: number;
  missing: number;
  skipped: number;
  pending: number;
  available: number;
}

export function summarizeProbe(
  records: Map<string, ProbeRecord>,
  totalModules: number,
): ProbeSummary {
  let declared = 0;
  let found = 0;
  let missing = 0;
  let skipped = 0;
  let pending = 0;
  for (const [, r] of records) {
    switch (r.status) {
      case 'declared':
        declared += 1;
        break;
      case 'found':
        found += 1;
        break;
      case 'missing':
        missing += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'probing':
      case 'unknown':
        pending += 1;
        break;
    }
  }
  return {
    total: totalModules,
    declared,
    found,
    missing,
    skipped,
    pending,
    available: declared + found,
  };
}

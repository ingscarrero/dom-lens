/**
 * MAIN-world inventory of every resource the page has actually loaded — not
 * just the subset DevTools' network panel saw while it was open.
 *
 * `chrome.devtools.network.onRequestFinished` only fires while the panel is
 * attached. On any non-trivial app the initial bundle and most chunks load
 * long before the user opens DevTools, so they never show up in our
 * `network` array. `performance.getEntriesByType('resource')` is the
 * browser's own running tally — it's present on every page and survives
 * back/forward cache, lazy chunks, dynamic imports, fetch(), etc.
 */
export interface PageResourceEntry {
  url: string;
  initiatorType?: string;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  duration?: number;
  startTime?: number;
  /** Best-effort MIME guess from `nextHopProtocol`/extension; the perf API
   * doesn't expose Content-Type. */
  mimeHint?: string;
}

export function inventoryPageResources(): PageResourceEntry[] {
  const out: PageResourceEntry[] = [];
  const seen = new Set<string>();

  // 1) Performance Resource Timing — the canonical "what got loaded" feed.
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const e of entries) {
      if (!e.name || seen.has(e.name)) continue;
      seen.add(e.name);
      out.push({
        url: e.name,
        initiatorType: (e as any).initiatorType,
        transferSize: numOrUndef((e as any).transferSize),
        encodedBodySize: numOrUndef((e as any).encodedBodySize),
        decodedBodySize: numOrUndef((e as any).decodedBodySize),
        duration: numOrUndef(e.duration),
        startTime: numOrUndef(e.startTime),
        mimeHint: guessMime(e.name, (e as any).initiatorType),
      });
    }
  } catch {
    /* perf API may be unavailable on very old engines */
  }

  // 2) Declared <script src> — covers cases where Resource Timing was
  //    cleared (some pages call `performance.clearResourceTimings()`).
  try {
    const scripts = document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i++) {
      const src = (scripts[i] as HTMLScriptElement).src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push({ url: src, initiatorType: 'script', mimeHint: 'application/javascript' });
    }
  } catch {
    /* ignore */
  }

  // 3) Declared <link rel="stylesheet"> and modulepreload.
  try {
    const links = document.querySelectorAll(
      'link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="preload"][as="style"]',
    );
    for (let i = 0; i < links.length; i++) {
      const href = (links[i] as HTMLLinkElement).href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const rel = (links[i] as HTMLLinkElement).rel;
      const asAttr = (links[i] as HTMLLinkElement).getAttribute('as') ?? '';
      const isStyle = rel.includes('stylesheet') || asAttr === 'style';
      out.push({
        url: href,
        initiatorType: isStyle ? 'link' : 'script',
        mimeHint: isStyle ? 'text/css' : 'application/javascript',
      });
    }
  } catch {
    /* ignore */
  }

  return out;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function guessMime(url: string, initiator?: string): string | undefined {
  const u = url.toLowerCase();
  if (/\.(js|mjs|cjs)(\?|#|$)/.test(u)) return 'application/javascript';
  if (/\.css(\?|#|$)/.test(u)) return 'text/css';
  if (/\.json(\?|#|$)/.test(u)) return 'application/json';
  if (/\.wasm(\?|#|$)/.test(u)) return 'application/wasm';
  if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/.test(u)) return 'font/woff2';
  if (/\.svg(\?|#|$)/.test(u)) return 'image/svg+xml';
  if (/\.(png|jpe?g|gif|webp|avif|ico)(\?|#|$)/.test(u)) return 'image/png';
  if (/\.map(\?|#|$)/.test(u)) return 'application/json';
  if (initiator === 'script') return 'application/javascript';
  if (initiator === 'link' || initiator === 'css') return 'text/css';
  if (initiator === 'fetch' || initiator === 'xmlhttprequest') return 'application/octet-stream';
  return undefined;
}

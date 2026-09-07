import { decode } from '@jridgewell/sourcemap-codec';
import type { LoadedModule, ParsedSourceMap, SourceFileNode } from './types';

/**
 * Minimal JSON shape we care about. We used to import this from
 * `source-map-js`, but that package's SourceMapConsumer triggers a CSP
 * `unsafe-eval` violation inside the Chrome extension page (it uses
 * `new Function(...)` for its lazy index-list construction). Chrome's
 * own Sources panel can ignore that because DevTools' frontend runs
 * with relaxed CSP — extension pages don't.
 *
 * @jridgewell/sourcemap-codec is pure JS (~2 KB) with no Function/eval
 * — used by Vite, Rollup, Svelte, esbuild's REPL, etc. We only need
 * VLQ decoding + per-source byte attribution, so we read the JSON
 * directly and walk decoded segments.
 */
export interface RawSourceMap {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
}

/**
 * Resolves the source-map URL associated with a JS file.
 *
 * Strategy:
 * 1. If the file content is available, look for the trailing
 *    `//# sourceMappingURL=...` comment (data: URI or relative path).
 * 2. Otherwise fall back to `<url>.map` — covers the common case where
 *    bundlers emit alongside.
 *
 * `fetchText` is provided by the panel and is expected to proxy through
 * the background service worker so CORS doesn't block us.
 */
export async function resolveSourceMapUrl(
  jsUrl: string,
  fetchText: (url: string) => Promise<string>,
): Promise<{ url: string; inlineMap?: RawSourceMap } | null> {
  // Try to read the JS file and parse the trailing comment.
  try {
    const body = await fetchText(jsUrl);
    const m = body.match(/[#@]\s*sourceMappingURL=([^\s\n'"]+)/i);
    if (m) {
      const ref = m[1].trim();
      if (ref.startsWith('data:')) {
        const inline = decodeInlineSourceMap(ref);
        if (inline) return { url: jsUrl + ' (inline)', inlineMap: inline };
      }
      try {
        const abs = new URL(ref, jsUrl).toString();
        return { url: abs };
      } catch {
        /* fall through to .map */
      }
    }
  } catch {
    /* fall through to .map */
  }
  // Conventional fallback
  try {
    return { url: jsUrl + '.map' };
  } catch {
    return null;
  }
}

function decodeInlineSourceMap(dataUri: string): RawSourceMap | null {
  try {
    const m = dataUri.match(/^data:application\/json(?:;[^,]*)?,(.*)$/i);
    if (!m) return null;
    let payload = m[1];
    // Only inspect the media-type header (everything before the first
    // comma) so a `;base64` flag is never confused with payload content.
    const header = dataUri.slice(0, dataUri.indexOf(','));
    if (/;base64$/i.test(header)) {
      payload = atob(payload);
    } else {
      payload = decodeURIComponent(payload);
    }
    return JSON.parse(payload) as RawSourceMap;
  } catch {
    return null;
  }
}

/**
 * Fetch + parse a sourcemap and attribute bytes per-source by VLQ-walking the
 * mappings. The resulting tree groups sources by path segment so the UI can
 * render a folder-style breakdown.
 */
/**
 * Typed error so the panel can present `step` + `mapUrl` + the underlying
 * cause in a useful way, instead of dumping a raw "Unexpected token <"
 * (which used to leak through when a 404 HTML page was JSON.parse'd).
 */
export class SourcemapFetchError extends Error {
  readonly step: 'resolve' | 'fetch' | 'parse';
  readonly mapUrl?: string;
  readonly cause?: unknown;
  constructor(
    message: string,
    opts: { step: 'resolve' | 'fetch' | 'parse'; mapUrl?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'SourcemapFetchError';
    this.step = opts.step;
    this.mapUrl = opts.mapUrl;
    this.cause = opts.cause;
  }
}

export async function fetchAndParseSourceMap(
  module: LoadedModule,
  fetchText: (url: string) => Promise<string>,
): Promise<ParsedSourceMap> {
  let resolved: { url: string; inlineMap?: RawSourceMap } | null;
  try {
    resolved = await resolveSourceMapUrl(module.url, fetchText);
  } catch (e) {
    throw new SourcemapFetchError(
      `Could not resolve sourcemap URL for ${module.url}: ${errMsg(e)}`,
      { step: 'resolve', cause: e },
    );
  }
  if (!resolved) {
    throw new SourcemapFetchError(
      `No sourcemap reference found for ${module.url} (no //# sourceMappingURL trailer, no .map sibling).`,
      { step: 'resolve' },
    );
  }

  let raw: RawSourceMap;
  if (resolved.inlineMap) {
    raw = resolved.inlineMap;
  } else {
    let text: string;
    try {
      text = await fetchText(resolved.url);
    } catch (e) {
      throw new SourcemapFetchError(`${errMsg(e)}`, {
        step: 'fetch',
        mapUrl: resolved.url,
        cause: e,
      });
    }
    try {
      raw = JSON.parse(text) as RawSourceMap;
    } catch (e) {
      // Most often happens when a 404 HTML page got through (now
      // prevented at the SW level, but still possible on weird hosts
      // that return 200 for not-found). Include a short snippet of the
      // body so the user can recognise an HTML response at a glance.
      const peek = text.slice(0, 80).replace(/\s+/g, ' ');
      throw new SourcemapFetchError(
        `Sourcemap at ${resolved.url} was not valid JSON. First 80 chars: "${peek}…"`,
        { step: 'parse', mapUrl: resolved.url, cause: e },
      );
    }
  }

  try {
    return parseSourceMap(raw);
  } catch (e) {
    throw new SourcemapFetchError(
      `Sourcemap at ${resolved.url} parsed as JSON but VLQ walk failed: ${errMsg(e)}`,
      { step: 'parse', mapUrl: resolved.url, cause: e },
    );
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Walk the VLQ-encoded `mappings` string and attribute generated-column
 * spans back to the originating source.
 *
 * `@jridgewell/sourcemap-codec`'s `decode` returns a 2D array
 * `SourceMapSegment[][]`:
 *   - outer index = generated line (zero-based)
 *   - inner index = segments on that line, in generated-column order
 *   - each segment is one of:
 *       [genCol]
 *       [genCol, sourceIdx, srcLine, srcCol]
 *       [genCol, sourceIdx, srcLine, srcCol, nameIdx]
 *
 * Bytes are estimated by summing the gap between successive segments
 * on the same generated line — same approximation that
 * `source-map-explorer` and webpack-bundle-analyzer use.
 *
 * No external SourceMapConsumer needed — and crucially no `new Function`,
 * so the parser runs inside the extension page's strict CSP without
 * tripping `unsafe-eval`.
 */
export function parseSourceMap(raw: RawSourceMap): ParsedSourceMap {
  const sources = raw.sources ?? [];
  const sizes = new Array<number>(sources.length).fill(0);

  const decoded = raw.mappings ? decode(raw.mappings) : [];

  for (let lineIdx = 0; lineIdx < decoded.length; lineIdx++) {
    const segments = decoded[lineIdx];
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
      // Segments with only the generated column carry no source — skip.
      if (seg.length < 4) continue;
      const genCol = seg[0];
      const srcIdx = seg[1] as number;
      if (srcIdx < 0 || srcIdx >= sizes.length) continue;
      const next = segments[segIdx + 1];
      // Span = horizontal gap to the next segment on this line. Last
      // segment on the line gets 1 byte (we don't have the actual line
      // width from the codec alone).
      const span = next ? Math.max(0, (next[0] as number) - genCol) : 1;
      sizes[srcIdx] += span;
    }
  }

  let totalBytes = 0;
  for (const s of sizes) totalBytes += s;

  const tree = buildSourceTree(sources, sizes);

  // sourcesContent is optional in the spec; when present it's aligned by
  // index with `sources`. Missing entries (null) just mean the bundler
  // chose not to embed that file (typical for node_modules in some
  // configs, or any 'nosources-source-map' build).
  const rawSourcesContent = raw.sourcesContent;
  const sourcesContent: Array<string | null> = new Array(sources.length).fill(null);
  if (Array.isArray(rawSourcesContent)) {
    for (let i = 0; i < sources.length; i++) {
      const v = rawSourcesContent[i];
      if (typeof v === 'string') sourcesContent[i] = v;
    }
  }

  return { sources, sizes, totalBytes, tree, sourcesContent };
}

/**
 * Build a hierarchical tree from a flat sources/sizes pair. Sources are
 * normalized (webpack:///, ../../, leading slashes) before grouping.
 */
export function buildSourceTree(sources: string[], sizes: number[]): SourceFileNode {
  const root: SourceFileNode = { name: '/', fullPath: '', bytes: 0, children: [] };
  for (let i = 0; i < sources.length; i++) {
    const path = normalizeSourcePath(sources[i]);
    if (!path) continue;
    const segments = path.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      acc = acc ? acc + '/' + seg : seg;
      const isLeaf = s === segments.length - 1;
      cur.children = cur.children ?? [];
      let next = cur.children.find((c) => c.name === seg);
      if (!next) {
        next = {
          name: seg,
          fullPath: acc,
          bytes: 0,
          children: isLeaf ? undefined : [],
        };
        cur.children.push(next);
      }
      next.bytes += sizes[i];
      cur = next;
    }
    root.bytes += sizes[i];
  }
  sortTree(root);
  return root;
}

function normalizeSourcePath(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // Strip common bundler prefixes
  s = s.replace(/^webpack:\/\/+/, '');
  s = s.replace(/^webpack-internal:\/\/+/, '');
  s = s.replace(/^vite:\/\/+/, '');
  s = s.replace(/^rollup:\/\/+/, '');
  // Strip module-federation cross-origin marker
  s = s.replace(/^\(([^)]+)\)\//, '$1/');
  // Collapse leading dots
  s = s.replace(/^(\.\.\/)+/, '');
  s = s.replace(/^\.\//, '');
  // Normalize backslashes
  s = s.replace(/\\/g, '/');
  // Strip query/fragment
  s = s.replace(/[?#].*$/, '');
  // Collapse repeated slashes
  s = s.replace(/\/{2,}/g, '/');
  return s;
}

function sortTree(node: SourceFileNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => b.bytes - a.bytes);
  for (const c of node.children) sortTree(c);
}

/**
 * Flatten the top-N largest leaves under a node. Useful for "biggest files"
 * lists in the Modules tab.
 */
export function topLeaves(node: SourceFileNode, limit = 20): SourceFileNode[] {
  const leaves: SourceFileNode[] = [];
  const walk = (n: SourceFileNode) => {
    if (!n.children || n.children.length === 0) {
      leaves.push(n);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  leaves.sort((a, b) => b.bytes - a.bytes);
  return leaves.slice(0, limit);
}

/**
 * Pretty-print bytes for UI labels (KB / MB).
 */
export function formatBytes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

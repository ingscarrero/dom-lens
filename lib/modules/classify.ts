import type { HarEntry } from '@/lib/snapshot/types';
import type { ChunkKind, LoadedModule, ModuleClassification } from './types';

/**
 * Pure URL/MIME-based classifier. Runs panel-side over devtools network entries
 * to bucket script & asset URLs into LoadedModule rows. Light heuristics — the
 * sourcemap pipeline is where we actually attribute bytes to source files.
 */
export function classifyEntries(entries: HarEntry[]): LoadedModule[] {
  const out: LoadedModule[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.url) continue;
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    if (!shouldInclude(e)) continue;
    const mod = classifyEntry(e);
    if (mod) out.push(mod);
  }
  // Largest first — bundle-size readers care about the heavy hitters.
  out.sort((a, b) => (b.transferredBytes ?? 0) - (a.transferredBytes ?? 0));
  return out;
}

function shouldInclude(e: HarEntry): boolean {
  const rt = (e.resourceType ?? '').toLowerCase();
  const mime = (e.mimeType ?? '').toLowerCase();
  if (rt === 'script' || rt === 'stylesheet' || rt === 'document') return true;
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('css')) return true;
  if (mime.includes('wasm')) return true;
  if (mime.includes('font')) return true;
  if (mime.startsWith('image/')) return true;
  // Heuristic by extension
  return /\.(js|mjs|cjs|css|wasm|woff2?|ttf|otf|map|json)(\?|$)/i.test(e.url);
}

function classifyEntry(e: HarEntry): LoadedModule | null {
  let parsed: URL | null = null;
  try {
    parsed = new URL(e.url);
  } catch {
    return null;
  }
  const classification = classifyUrl(e.url, e.mimeType, e.resourceType);
  return {
    id: e.url,
    url: e.url,
    origin: parsed.origin,
    pathname: parsed.pathname,
    resourceType: e.resourceType,
    mimeType: e.mimeType,
    transferredBytes: e.responseSize,
    responseBytes: e.responseSize,
    timeMs: e.timeMs,
    startedDateTime: e.startedDateTime,
    classification,
    sourceMapStatus: 'unknown',
  };
}

export function classifyUrl(
  url: string,
  mimeType?: string,
  resourceType?: string,
): ModuleClassification {
  const lower = url.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  const rt = (resourceType ?? '').toLowerCase();

  let chunkKind: ChunkKind = 'other';
  if (lower.endsWith('.map') || /\.[a-z0-9]+\.map(\?|$)/i.test(lower)) chunkKind = 'sourcemap';
  else if (mime.includes('css') || /\.css(\?|$)/i.test(lower)) chunkKind = 'css';
  else if (mime.includes('font') || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(lower)) chunkKind = 'font';
  else if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|ico)(\?|$)/i.test(lower))
    chunkKind = 'image';
  else if (mime.includes('wasm') || /\.wasm(\?|$)/i.test(lower)) chunkKind = 'wasm';
  else if (/remoteentry/i.test(lower) || /\bmf-manifest\b/i.test(lower)) chunkKind = 'remoteEntry';
  else if (/mf-manifest|importmap|manifest\.json/i.test(lower)) chunkKind = 'manifest';
  else if (/\bruntime[~.\-]/.test(lower) || /\bwebpack[\-_]runtime\b/.test(lower))
    chunkKind = 'runtime';
  else if (/\bvendor/i.test(lower) || /\bvendors[~.\-]/.test(lower) || /\bcommon[s.\-]/i.test(lower))
    chunkKind = 'vendor';
  else if (/\bmain[.\-]/i.test(lower) || /\bapp[.\-]/i.test(lower) || /\bindex[.\-][a-f0-9]/i.test(lower))
    chunkKind = 'main';
  else if (
    rt === 'script' ||
    mime.includes('javascript') ||
    /\.(js|mjs|cjs)(\?|$)/i.test(lower)
  )
    chunkKind = 'chunk';

  const framework = guessFramework(lower);
  const bundler = guessBundler(lower);
  const library = guessLibrary(lower);
  const label = makeLabel(url, chunkKind);

  return { chunkKind, framework, bundler, library, label };
}

function guessFramework(lower: string): string | undefined {
  if (/_next\//.test(lower)) return 'Next.js';
  if (/_nuxt\//.test(lower)) return 'Nuxt';
  if (/\/_app\/immutable\//.test(lower)) return 'SvelteKit';
  if (/page-data|gatsby/i.test(lower)) return 'Gatsby';
  if (/astro-island|\bastro[@\-/]/i.test(lower)) return 'Astro';
  if (/react-dom|\breact[@\-/]/i.test(lower)) return 'React';
  if (/\bvue[@\-/]\d|vue\.global/i.test(lower)) return 'Vue';
  if (/@angular\//i.test(lower)) return 'Angular';
  if (/svelte\/internal|\bsvelte[@\-/]/i.test(lower)) return 'Svelte';
  return undefined;
}

function guessBundler(lower: string): string | undefined {
  if (/_next\/static\/chunks\/.*_app-pages-browser/i.test(lower)) return 'Turbopack';
  if (/\bwebpackjsonp|chunk-[a-f0-9]+\.js/i.test(lower)) return 'Webpack';
  if (/\/@vite\/|\/node_modules\/\.vite\//.test(lower)) return 'Vite';
  if (/parcelrequire/i.test(lower)) return 'Parcel';
  if (/assets\/index-[a-z0-9]+\.js/i.test(lower)) return 'Rollup';
  return undefined;
}

function guessLibrary(lower: string): string | undefined {
  const probes: Array<[RegExp, string]> = [
    [/@mui\/|material-ui/i, 'MUI'],
    [/@chakra-ui\//i, 'Chakra UI'],
    [/@radix-ui\//i, 'Radix UI'],
    [/@ant-design\/|\bantd[@\-/]/i, 'Ant Design'],
    [/tailwind/i, 'Tailwind'],
    [/\bbootstrap[@\-/]/i, 'Bootstrap'],
    [/\blodash[@\-/]/i, 'Lodash'],
    [/\bmoment[@\-/]/i, 'Moment'],
    [/\bdayjs[@\-/]/i, 'Day.js'],
    [/\bdate-fns[@\-/]/i, 'date-fns'],
    [/\brxjs[@\-/]/i, 'RxJS'],
    [/\baxios[@\-/]/i, 'Axios'],
    [/\bthree[@\-/]/i, 'three.js'],
    [/\bd3[@\-/]|\bd3\.min/i, 'D3'],
    [/@tanstack\/react-query|\breact-query\b/i, 'TanStack Query'],
    [/@tanstack\/react-router/i, 'TanStack Router'],
    [/react-router/i, 'React Router'],
    [/redux-toolkit|@reduxjs\/toolkit|\bredux[@\-/]/i, 'Redux'],
    [/\bmobx[@\-/]/i, 'MobX'],
    [/\bzustand[@\-/]/i, 'Zustand'],
    [/\bjotai[@\-/]/i, 'Jotai'],
    [/\brecoil[@\-/]/i, 'Recoil'],
    [/\bxstate[@\-/]|@xstate\//i, 'XState'],
    [/@apollo\/|apollo-client/i, 'Apollo'],
    [/googletagmanager\.com|google-analytics\.com|gtag\/js/i, 'GTM/GA'],
    [/segment\.com\/analytics\.js/i, 'Segment'],
    [/mixpanel/i, 'Mixpanel'],
    [/sentry\.io|@sentry\//i, 'Sentry'],
  ];
  for (const [re, name] of probes) if (re.test(lower)) return name;
  return undefined;
}

function makeLabel(url: string, kind: ChunkKind): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).slice(-2).join('/');
    if (last) return `${kind}: ${last}`;
    return `${kind}: ${u.host}`;
  } catch {
    return kind;
  }
}

/**
 * Pull totals + counts by chunk kind for the Modules tab header.
 */
export function summarizeModules(mods: LoadedModule[]): {
  total: number;
  totalBytes: number;
  byKind: Partial<Record<ChunkKind, { count: number; bytes: number }>>;
} {
  const byKind: Partial<Record<ChunkKind, { count: number; bytes: number }>> = {};
  let total = 0;
  let totalBytes = 0;
  for (const m of mods) {
    total += 1;
    const b = m.transferredBytes ?? 0;
    totalBytes += b;
    const slot = byKind[m.classification.chunkKind] ?? { count: 0, bytes: 0 };
    slot.count += 1;
    slot.bytes += b;
    byKind[m.classification.chunkKind] = slot;
  }
  return { total, totalBytes, byKind };
}

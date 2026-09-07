import { describe, expect, it } from 'vitest';
import { classifyEntries, classifyUrl, summarizeModules } from '@/lib/modules/classify';
import type { HarEntry } from '@/lib/snapshot/types';
import type { PageResourceEntry } from '@/lib/modules/pageInventory';

const har = (over: Partial<HarEntry>): HarEntry => ({
  url: 'https://app.example.com/static/main.abc123.js',
  method: 'GET',
  status: 200,
  resourceType: 'script',
  mimeType: 'application/javascript',
  responseSize: 1000,
  ...over,
});

describe('classifyUrl', () => {
  it.each([
    ['https://x.com/main.js.map', 'sourcemap'],
    ['https://x.com/styles/app.css?v=3', 'css'],
    ['https://x.com/fonts/inter.woff2', 'font'],
    ['https://x.com/img/logo.svg', 'image'],
    ['https://x.com/engine.wasm', 'wasm'],
    ['https://remote.x.com/remoteEntry.js', 'remoteEntry'],
    ['https://x.com/mf-manifest.json', 'remoteEntry'],
    ['https://x.com/importmap.json', 'manifest'],
    ['https://x.com/runtime~main.js', 'runtime'],
    ['https://x.com/vendors~main.js', 'vendor'],
    ['https://x.com/main.abc.js', 'main'],
    ['https://x.com/assets/index-Ab12Cd.js', 'main'],
    ['https://x.com/chunks/823.js', 'chunk'],
    ['https://x.com/data.bin', 'other'],
  ])('classifies %s as %s', (url, kind) => {
    expect(classifyUrl(url).chunkKind).toBe(kind);
  });

  it('prefers MIME type over extension when both are present', () => {
    expect(classifyUrl('https://x.com/asset', 'text/css').chunkKind).toBe('css');
    expect(classifyUrl('https://x.com/asset', 'image/png').chunkKind).toBe('image');
    expect(classifyUrl('https://x.com/asset', undefined, 'script').chunkKind).toBe('chunk');
  });

  it('guesses framework, bundler and library from URL fingerprints', () => {
    const next = classifyUrl('https://x.com/_next/static/chunks/_app-pages-browser_x.js');
    expect(next.framework).toBe('Next.js');
    expect(next.bundler).toBe('Turbopack');

    const vite = classifyUrl('https://x.com/@vite/client');
    expect(vite.bundler).toBe('Vite');

    const mui = classifyUrl('https://cdn.x.com/@mui/material/index.js');
    expect(mui.library).toBe('MUI');

    const react = classifyUrl('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');
    expect(react.framework).toBe('React');

    const vue = classifyUrl('https://unpkg.com/vue@3/dist/vue.global.js');
    expect(vue.framework).toBe('Vue');
  });

  it('builds a readable label from the last two path segments', () => {
    expect(classifyUrl('https://x.com/static/js/main.js').label).toBe('main: js/main.js');
    expect(classifyUrl('https://x.com/').label).toBe('other: x.com');
  });
});

describe('classifyEntries', () => {
  it('dedupes by URL and lets the DevTools entry win over the perf entry', () => {
    const url = 'https://x.com/main.js';
    const entries = [har({ url, responseSize: 4321 })];
    const page: PageResourceEntry[] = [
      { url, initiatorType: 'script', transferSize: 1 },
      { url: 'https://x.com/other.js', initiatorType: 'script', transferSize: 50 },
    ];
    const out = classifyEntries(entries, page);
    expect(out.map((m) => m.url)).toEqual([url, 'https://x.com/other.js']);
    expect(out[0].transferredBytes).toBe(4321);
  });

  it('sorts largest first and skips unrelated resources', () => {
    const out = classifyEntries(
      [
        har({ url: 'https://x.com/a.js', responseSize: 10 }),
        har({ url: 'https://x.com/b.js', responseSize: 999 }),
        har({ url: 'https://x.com/tracking', resourceType: 'xhr', mimeType: 'text/plain' }),
        har({ url: 'not a url' }),
      ],
    );
    expect(out.map((m) => m.url)).toEqual(['https://x.com/b.js', 'https://x.com/a.js']);
  });

  it('falls back to encodedBodySize when transferSize is 0 (cached)', () => {
    const out = classifyEntries([], [
      { url: 'https://x.com/c.js', initiatorType: 'script', transferSize: 0, encodedBodySize: 777 },
    ]);
    expect(out[0].transferredBytes).toBe(777);
    expect(out[0].sourceMapStatus).toBe('unknown');
  });

  it('resolves a SourceMap response header relative to the module URL', () => {
    const out = classifyEntries([
      har({ url: 'https://x.com/js/main.js', sourceMapHeader: 'main.js.map' }),
    ]);
    expect(out[0].sourceMapStatus).toBe('declared');
    expect(out[0].sourceMapUrl).toBe('https://x.com/js/main.js.map');
  });

  it('drops perf entries that are not valid URLs', () => {
    const out = classifyEntries([], [{ url: 'chunk.js', initiatorType: 'script' }]);
    expect(out).toEqual([]);
  });
});

describe('summarizeModules', () => {
  it('tallies count and bytes per chunk kind', () => {
    const mods = classifyEntries([
      har({ url: 'https://x.com/main.js', responseSize: 100 }),
      har({ url: 'https://x.com/app.css', mimeType: 'text/css', responseSize: 20 }),
      har({ url: 'https://x.com/x.css', mimeType: 'text/css', responseSize: 30 }),
    ]);
    const s = summarizeModules(mods);
    expect(s.total).toBe(3);
    expect(s.totalBytes).toBe(150);
    expect(s.byKind.css).toEqual({ count: 2, bytes: 50 });
    expect(s.byKind.main).toEqual({ count: 1, bytes: 100 });
  });
});

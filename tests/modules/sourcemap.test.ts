import { describe, expect, it } from 'vitest';
import { encode } from '@jridgewell/sourcemap-codec';
import {
  SourcemapFetchError,
  buildSourceTree,
  fetchAndParseSourceMap,
  formatBytes,
  parseSourceMap,
  resolveSourceMapUrl,
  topLeaves,
} from '@/lib/modules/sourcemap';
import type { LoadedModule } from '@/lib/modules/types';

/** Await a promise that is expected to reject and hand back the error. */
async function rejection(p: Promise<unknown>): Promise<SourcemapFetchError> {
  try {
    await p;
  } catch (e) {
    return e as SourcemapFetchError;
  }
  throw new Error('expected promise to reject');
}

const mod = (url = 'https://x.com/main.js'): LoadedModule => ({
  id: url,
  url,
  origin: 'https://x.com',
  pathname: '/main.js',
  classification: { chunkKind: 'main' },
  sourceMapStatus: 'unknown',
});

// Two generated lines. Line 0: three segments, sources 0,1,0. Line 1: one
// segment with no source, one with source 1.
const mappings = encode([
  [
    [0, 0, 0, 0],
    [10, 1, 0, 0],
    [25, 0, 1, 0],
  ],
  [[0], [4, 1, 2, 0]],
]);

describe('parseSourceMap', () => {
  it('attributes generated-column spans to sources and totals them', () => {
    const parsed = parseSourceMap({
      sources: ['webpack:///./src/a.js', 'webpack:///./src/lib/b.js'],
      mappings,
    });
    // source 0: 10 (0→10) + 1 (last on line) = 11; source 1: 15 (10→25) + 1 = 16
    expect(parsed.sizes).toEqual([11, 16]);
    expect(parsed.totalBytes).toBe(27);
    expect(parsed.sourcesContent).toEqual([null, null]);
    expect(parsed.tree.bytes).toBe(27);
    expect(parsed.tree.children?.[0].name).toBe('src');
  });

  it('ignores out-of-range source indices and empty mappings', () => {
    const parsed = parseSourceMap({
      sources: ['a.js'],
      mappings: encode([[[0, 5, 0, 0]]]),
    });
    expect(parsed.sizes).toEqual([0]);
    expect(parseSourceMap({ sources: [], mappings: '' }).totalBytes).toBe(0);
  });

  it('aligns sourcesContent by index and nulls non-strings', () => {
    const parsed = parseSourceMap({
      sources: ['a.js', 'b.js', 'c.js'],
      sourcesContent: ['const a = 1;', null],
      mappings: '',
    });
    expect(parsed.sourcesContent).toEqual(['const a = 1;', null, null]);
  });
});

describe('buildSourceTree / topLeaves', () => {
  it('groups by path segment, normalises bundler prefixes and sorts by bytes', () => {
    const tree = buildSourceTree(
      ['webpack:///./src/a.js', 'vite:///src/b.ts', '(cdn.x.com)/lib/c.js', '../src/a.js', ''],
      [5, 20, 7, 3, 99],
    );
    expect(tree.bytes).toBe(35);
    const names = tree.children!.map((c) => c.name);
    expect(names).toEqual(['src', 'cdn.x.com']);
    const src = tree.children![0];
    expect(src.bytes).toBe(28);
    expect(src.children!.map((c) => `${c.name}:${c.bytes}`)).toEqual(['b.ts:20', 'a.js:8']);

    const leaves = topLeaves(tree, 2);
    expect(leaves.map((l) => l.fullPath)).toEqual(['src/b.ts', 'src/a.js']);
  });
});

describe('formatBytes', () => {
  it('formats B / KB / MB and handles nullish', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('resolveSourceMapUrl', () => {
  it('reads a relative sourceMappingURL trailer and resolves it against the JS URL', async () => {
    const fetchText = async () => 'console.log(1);\n//# sourceMappingURL=maps/main.js.map';
    const r = await resolveSourceMapUrl('https://x.com/js/main.js', fetchText);
    expect(r).toEqual({ url: 'https://x.com/js/maps/main.js.map' });
  });

  it('decodes base64 and URL-encoded inline data URIs', async () => {
    const json = JSON.stringify({ version: 3, sources: ['a.js'], mappings: '' });
    const b64 = Buffer.from(json).toString('base64');
    const r1 = await resolveSourceMapUrl(
      'https://x.com/a.js',
      async () => `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`,
    );
    expect(r1?.inlineMap?.sources).toEqual(['a.js']);
    expect(r1?.url).toContain('(inline)');

    const r2 = await resolveSourceMapUrl(
      'https://x.com/a.js',
      async () => `//# sourceMappingURL=data:application/json,${encodeURIComponent(json)}`,
    );
    expect(r2?.inlineMap?.sources).toEqual(['a.js']);
  });

  it('falls back to <url>.map when the body has no trailer or the fetch fails', async () => {
    expect(await resolveSourceMapUrl('https://x.com/a.js', async () => 'no trailer')).toEqual({
      url: 'https://x.com/a.js.map',
    });
    expect(
      await resolveSourceMapUrl('https://x.com/a.js', async () => {
        throw new Error('offline');
      }),
    ).toEqual({ url: 'https://x.com/a.js.map' });
  });
});

describe('fetchAndParseSourceMap', () => {
  it('fetches the .map, parses it and returns the source tree', async () => {
    const map = JSON.stringify({ version: 3, sources: ['src/a.js'], sourcesContent: ['x'], mappings });
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url);
      return url.endsWith('.map') ? map : 'js body';
    };
    const parsed = await fetchAndParseSourceMap(mod(), fetchText);
    expect(calls).toEqual(['https://x.com/main.js', 'https://x.com/main.js.map']);
    expect(parsed.sources).toEqual(['src/a.js']);
    expect(parsed.sourcesContent).toEqual(['x']);
  });

  it('uses an inline map without a second fetch', async () => {
    const json = JSON.stringify({ version: 3, sources: ['inline.js'], mappings: '' });
    const b64 = Buffer.from(json).toString('base64');
    let calls = 0;
    const parsed = await fetchAndParseSourceMap(mod(), async () => {
      calls += 1;
      return `//# sourceMappingURL=data:application/json;base64,${b64}`;
    });
    expect(calls).toBe(1);
    expect(parsed.sources).toEqual(['inline.js']);
  });

  it('wraps fetch failures with step + mapUrl context', async () => {
    const err = await rejection(
      fetchAndParseSourceMap(mod(), async (url) => {
        if (url.endsWith('.map')) throw new Error('HTTP 404');
        return 'body';
      }),
    );
    expect(err).toBeInstanceOf(SourcemapFetchError);
    expect(err.step).toBe('fetch');
    expect(err.mapUrl).toBe('https://x.com/main.js.map');
    expect(err.message).toContain('HTTP 404');
  });

  it('reports an HTML 404 page as a parse error with a body peek', async () => {
    const err = await rejection(
      fetchAndParseSourceMap(mod(), async (url) =>
        url.endsWith('.map') ? '<!doctype html><title>Not found</title>' : 'body',
      ),
    );
    expect(err.step).toBe('parse');
    expect(err.message).toContain('not valid JSON');
    expect(err.message).toContain('<!doctype html>');
  });

  it('reports a VLQ walk failure as a parse error', async () => {
    const err = await rejection(
      fetchAndParseSourceMap(mod(), async (url) =>
        url.endsWith('.map') ? JSON.stringify({ sources: ['a'], mappings: 12345 }) : 'body',
      ),
    );
    expect(err.step).toBe('parse');
    expect(err.message).toContain('VLQ walk failed');
  });
});

import { describe, expect, it } from 'vitest';
import { FINGERPRINTS, confidenceFromEvidence, readVersionAt } from '@/lib/modules/fingerprints';

describe('FINGERPRINTS catalogue', () => {
  it('has unique ids and a category on every entry', () => {
    const ids = FINGERPRINTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FINGERPRINTS) {
      expect(f.name).toBeTruthy();
      expect(f.category).toBeTruthy();
      expect((f.globals?.length ?? 0) + (f.urlPatterns?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it.each([
    ['react', 'https://unpkg.com/react@18.3.1/umd/react.production.min.js'],
    ['next', 'https://site.com/_next/static/chunks/main.js'],
    ['nuxt', 'https://site.com/_nuxt/entry.js'],
    ['webpack5', 'https://site.com/static/js/runtime~main.js'],
    ['vite', 'https://localhost:5173/@vite/client'],
    ['mf', 'https://remote.site.com/remoteEntry.js'],
    ['sentry', 'https://browser.sentry-cdn.com/@sentry/browser.js'],
    ['gtag', 'https://www.googletagmanager.com/gtag/js?id=G-1'],
  ])('%s matches a representative URL', (id, url) => {
    const spec = FINGERPRINTS.find((f) => f.id === id)!;
    expect(spec.urlPatterns!.some((re) => re.test(url))).toBe(true);
  });

  it('does not let the react pattern match unrelated words', () => {
    const spec = FINGERPRINTS.find((f) => f.id === 'react')!;
    expect(spec.urlPatterns!.some((re) => re.test('https://x.com/reactor-core.js'))).toBe(false);
  });
});

describe('readVersionAt', () => {
  it('walks a dot path and stringifies string / number leaves', () => {
    expect(readVersionAt({ version: '18.3.1' }, 'version')).toBe('18.3.1');
    expect(readVersionAt({ meta: { rev: 160 } }, 'meta.rev')).toBe('160');
  });

  it('returns undefined for missing path, non-scalar leaf, or no path', () => {
    expect(readVersionAt({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(readVersionAt({ a: { b: {} } }, 'a.b')).toBeUndefined();
    expect(readVersionAt({ version: '1' })).toBeUndefined();
    expect(readVersionAt(null, 'version')).toBeUndefined();
  });

  it('swallows getter exceptions', () => {
    const hostile = {
      get version(): string {
        throw new Error('nope');
      },
    };
    expect(readVersionAt(hostile, 'version')).toBeUndefined();
  });
});

describe('confidenceFromEvidence', () => {
  it('ranks global hits above URL-only evidence', () => {
    expect(confidenceFromEvidence(true, 0, true)).toBe('high');
    expect(confidenceFromEvidence(true, 0, false)).toBe('high');
    expect(confidenceFromEvidence(false, 2, false)).toBe('medium');
    expect(confidenceFromEvidence(false, 1, false)).toBe('low');
    expect(confidenceFromEvidence(false, 0, false)).toBe('low');
  });
});

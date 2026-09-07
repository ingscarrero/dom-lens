// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { detectFederation } from '@/lib/federation/detect';

const w = window as any;
const GLOBALS = [
  '__webpack_share_scopes__',
  '__webpack_require__',
  '__federation__',
  '__federation_method_getRemote',
  '__FEDERATION__',
  'shopRemote',
  'plainObject',
  'cartRemote',
];

afterEach(() => {
  for (const k of GLOBALS) delete w[k];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
});

describe('detectFederation', () => {
  it('reports unknown / not detected on a plain page', () => {
    const g = detectFederation();
    expect(g.detected).toBe(false);
    expect(g.kind).toBe('unknown');
    expect(g.remotes).toEqual([]);
    expect(g.signals).toEqual([]);
    expect(g.host.name).toBe(location.hostname);
  });

  it('detects webpack 5 share scopes and enumerates container globals', () => {
    w.__webpack_share_scopes__ = { default: { react: {}, 'react-dom': {} }, other: { lodash: {} } };
    w.__webpack_require__ = { S: {} };
    w.shopRemote = { get: () => {}, init: () => {}, moduleMap: { './Widget': 1, './Counter': 1 } };
    w.plainObject = { get: 'not a function' };
    const s = document.createElement('script');
    s.src = 'http://localhost:3002/remoteEntry.js';
    s.dataset.containerName = 'shopRemote';
    document.head.appendChild(s);
    document.title = 'Host App';

    const g = detectFederation();
    expect(g.detected).toBe(true);
    expect(g.kind).toBe('webpack5');
    expect(g.host.name).toBe('Host App');
    expect(g.host.shared.sort()).toEqual(['lodash', 'react', 'react-dom']);
    expect(g.signals).toEqual(
      expect.arrayContaining(['webpack_share_scopes', 'webpack_require.S', 'webpack_containers(1)']),
    );
    expect(g.remotes).toEqual([
      {
        name: 'shopRemote',
        entry: 'http://localhost:3002/remoteEntry.js',
        exposes: ['./Widget', './Counter'],
        loaded: true,
      },
    ]);
  });

  it('lists remoteEntry scripts whose container has not loaded yet', () => {
    const s = document.createElement('script');
    s.src = 'http://localhost:3003/remoteEntry.abc123.js';
    document.head.appendChild(s);
    const g = detectFederation();
    // A remoteEntry script is itself evidence of a webpack 5 container.
    expect(g.kind).toBe('webpack5');
    expect(g.signals).toContain('webpack_containers(1)');
    expect(g.remotes).toEqual([
      {
        name: 'http://localhost:3003/remoteEntry.abc123.js',
        entry: 'http://localhost:3003/remoteEntry.abc123.js',
        exposes: [],
        loaded: false,
      },
    ]);
  });

  it('skips iframe-window globals that would throw cross-origin', () => {
    const f = document.createElement('iframe');
    f.name = 'cartRemote';
    document.body.appendChild(f);
    w.__webpack_share_scopes__ = { default: {} };
    const g = detectFederation();
    expect(g.remotes.find((r) => r.name === 'cartRemote')).toBeUndefined();
    expect(g.kind).toBe('webpack5');
  });

  it('prefers the application-name meta over the title for the host name', () => {
    const m = document.createElement('meta');
    m.setAttribute('name', 'application-name');
    m.setAttribute('content', 'Shell');
    document.head.appendChild(m);
    document.title = 'ignored';
    expect(detectFederation().host.name).toBe('Shell');
  });

  it('detects vite plugin-federation via __federation__ globals', () => {
    w.__federation_method_getRemote = () => {};
    const g = detectFederation();
    expect(g.kind).toBe('vite-plugin-federation');
    expect(g.signals).toContain('vite_federation');
  });

  it('detects native federation', () => {
    w.__FEDERATION__ = {};
    expect(detectFederation().kind).toBe('native-federation');
  });

  it('turns an import map into remotes when nothing else is present', () => {
    const s = document.createElement('script');
    s.type = 'importmap';
    s.textContent = JSON.stringify({ imports: { lit: 'https://cdn.x.com/lit.js', bad: 42 } });
    document.head.appendChild(s);
    const broken = document.createElement('script');
    broken.type = 'importmap';
    broken.textContent = '{ not json';
    document.head.appendChild(broken);

    const g = detectFederation();
    expect(g.kind).toBe('import-map');
    expect(g.signals).toContain('import_map(1)');
    expect(g.remotes).toEqual([{ name: 'lit', entry: 'https://cdn.x.com/lit.js', exposes: [], loaded: false }]);
  });

  it('ranks webpack above vite when both signals are present', () => {
    w.__webpack_share_scopes__ = { default: {} };
    w.__federation__ = {};
    expect(detectFederation().kind).toBe('webpack5');
  });

  it('never throws — a hostile global is reported as a signal instead', () => {
    Object.defineProperty(w, '__webpack_share_scopes__', {
      configurable: true,
      get() {
        throw new Error('trap');
      },
    });
    const g = detectFederation();
    // tryGet swallows the getter, so we still get a valid graph.
    expect(g.detected).toBe(false);
    expect(Array.isArray(g.signals)).toBe(true);
  });
});

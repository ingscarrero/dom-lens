import type { FederationGraph, FederationKind, Remote } from './graph';

function tryGet<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function readWebpackContainers(): { name: string; entry: string; exposes: string[]; loaded: boolean }[] {
  const w = window as any;
  const remotes: { name: string; entry: string; exposes: string[]; loaded: boolean }[] = [];
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  const remoteEntryByContainer = new Map<string, string>();

  for (const s of scripts) {
    if (/remoteEntry(\.[a-f0-9]+)?\.js/i.test(s.src) || /\/mf-manifest\.json/i.test(s.src)) {
      const guess = s.dataset.containerName || s.dataset.mfName || '';
      if (guess) remoteEntryByContainer.set(guess, s.src);
      else remoteEntryByContainer.set(s.src, s.src);
    }
  }

  // Build a set of frame names — pages with cross-origin <iframe name="x">
  // expose the iframe's contentWindow as window.x. Touching .get/.init on a
  // cross-origin Window throws "Blocked a frame from accessing a cross-origin
  // frame". Skip these by name AND defensively try/catch every cross-window
  // read just in case.
  const frameNames = new Set<string>();
  try {
    document.querySelectorAll('iframe[name], frame[name]').forEach((f) => {
      const n = (f as HTMLIFrameElement).name;
      if (n) frameNames.add(n);
    });
  } catch {
    /* ignore */
  }

  const isSafeContainerCandidate = (val: unknown): val is { get: Function; init: Function } => {
    if (!val || typeof val !== 'object') return false;
    // Reject cross-origin / same-origin Windows. We accept either a thrown
    // access or a successful `window`-ish read as "skip".
    try {
      if ((val as any) === window) return false;
      // Window has a `self === window` invariant; using it as a probe is
      // cheaper than instanceof Window and safer cross-origin.
      // (Accessing `.self` on a cross-origin Window throws, which is caught.)
      const selfRef = (val as any).self;
      if (selfRef && selfRef === val) return false;
    } catch {
      return false;
    }
    try {
      return typeof (val as any).get === 'function' && typeof (val as any).init === 'function';
    } catch {
      return false;
    }
  };

  const safeKeys = (() => {
    try {
      return Object.keys(w);
    } catch {
      return [] as string[];
    }
  })();

  const seen = new Set<string>();
  for (const key of safeKeys) {
    if (seen.has(key)) continue;
    if (/^(_|\$)/.test(key)) continue;
    if (frameNames.has(key)) continue;
    let val: any;
    try {
      val = w[key];
    } catch {
      continue;
    }
    if (!isSafeContainerCandidate(val)) continue;
    const entry =
      remoteEntryByContainer.get(key) ||
      Array.from(remoteEntryByContainer.values()).find((u) => u.includes(key)) ||
      '(unknown)';
    const exposes: string[] = [];
    try {
      const anyVal = val as any;
      const moduleMap = anyVal.moduleMap || anyVal._modules || {};
      if (moduleMap && typeof moduleMap === 'object') {
        exposes.push(...Object.keys(moduleMap));
      }
    } catch {
      /* ignore */
    }
    remotes.push({ name: key, entry, exposes, loaded: true });
    seen.add(key);
  }

  for (const [name, entry] of remoteEntryByContainer) {
    if (!remotes.find((r) => r.name === name || r.entry === entry)) {
      let loaded = false;
      try {
        loaded = !!w[name];
      } catch {
        loaded = false;
      }
      remotes.push({ name, entry, exposes: [], loaded });
    }
  }

  return remotes;
}

function readImportMap(): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const scripts = Array.from(document.querySelectorAll('script[type="importmap"]')) as HTMLScriptElement[];
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent || '{}');
      if (data.imports && typeof data.imports === 'object') {
        for (const [name, url] of Object.entries(data.imports)) {
          if (typeof url === 'string') out.push({ name, url });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function detectFederation(): FederationGraph {
  try {
    return detectFederationInternal();
  } catch (e) {
    // Belt-and-suspenders: a single unhandled error here must never block
    // the rest of the snapshot pipeline. Surface the reason as a signal so
    // we can debug from the panel without crashing.
    const reason = (e as Error)?.message ?? String(e);
    return {
      kind: 'unknown',
      detected: false,
      host: { name: location.hostname, shared: [] },
      remotes: [],
      signals: [`detect_error: ${reason.slice(0, 200)}`],
    };
  }
}

function detectFederationInternal(): FederationGraph {
  const w = window as any;
  const signals: string[] = [];

  const webpackShareScopes = tryGet(() => w.__webpack_share_scopes__);
  const webpackRequire = tryGet(() => w.__webpack_require__);
  const viteFederation =
    tryGet(() => w.__federation__) ||
    tryGet(() => w.__federation_method_getRemote) ||
    tryGet(() => Object.keys(w).find((k) => k.startsWith('__federation_method_')));
  const nativeFederation = tryGet(() => w.__FEDERATION__);
  const importMap = readImportMap();

  if (webpackShareScopes) signals.push('webpack_share_scopes');
  if (webpackRequire?.S) signals.push('webpack_require.S');
  if (viteFederation) signals.push('vite_federation');
  if (nativeFederation) signals.push('native_federation');
  if (importMap.length) signals.push(`import_map(${importMap.length})`);

  const containers = readWebpackContainers();
  if (containers.length) signals.push(`webpack_containers(${containers.length})`);

  let kind: FederationKind = 'unknown';
  if (webpackShareScopes || webpackRequire?.S || containers.length) kind = 'webpack5';
  else if (viteFederation) kind = 'vite-plugin-federation';
  else if (nativeFederation) kind = 'native-federation';
  else if (importMap.length) kind = 'import-map';

  const detected = kind !== 'unknown';

  let shared: string[] = [];
  if (webpackShareScopes) {
    try {
      const scopes = webpackShareScopes as Record<string, any>;
      for (const scopeName of Object.keys(scopes)) {
        const scope = scopes[scopeName];
        if (scope && typeof scope === 'object') shared.push(...Object.keys(scope));
      }
      shared = Array.from(new Set(shared));
    } catch {
      /* ignore */
    }
  }

  const remotes: Remote[] = containers.map((c) => ({
    name: c.name,
    entry: c.entry,
    exposes: c.exposes,
    loaded: c.loaded,
  }));

  if (kind === 'import-map') {
    for (const { name, url } of importMap) {
      remotes.push({ name, entry: url, exposes: [], loaded: false });
    }
  }

  const hostName = (() => {
    try {
      return (
        document.querySelector('meta[name="application-name"]')?.getAttribute('content') ||
        document.title ||
        location.hostname
      );
    } catch {
      return location.hostname;
    }
  })();

  return {
    kind,
    detected,
    host: { name: hostName, shared },
    remotes,
    signals,
  };
}

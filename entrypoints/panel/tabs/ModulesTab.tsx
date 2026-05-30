import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { summarizeModules } from '@/lib/modules/classify';
import { fetchAndParseSourceMap, formatBytes, topLeaves } from '@/lib/modules/sourcemap';
import { viewerFor } from '@/lib/modules/viewers';
import { buildReformatPayload, parseReformatResponse, languageLabel } from '@/lib/modules/reformat';
import { callFindAssetUsages } from '../hooks/useInspectedEval';
import type { LoadedModule, ParsedSourceMap, SourceFileNode } from '@/lib/modules/types';
import type { OneshotProxy } from '@/lib/lm-studio/oneshotProxy';

interface Props {
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
}

export default function ModulesTab({ fetchText, oneshot }: Props) {
  const snap = useStore((s) => s.snapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const modules = snap?.modules ?? [];
  const techStack = snap?.techStack;

  const summary = useMemo(() => summarizeModules(modules), [modules]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modules.filter((m) => {
      if (kindFilter !== 'all' && m.classification.chunkKind !== kindFilter) return false;
      if (!q) return true;
      return (
        m.url.toLowerCase().includes(q) ||
        (m.classification.library ?? '').toLowerCase().includes(q) ||
        (m.classification.framework ?? '').toLowerCase().includes(q) ||
        (m.classification.bundler ?? '').toLowerCase().includes(q)
      );
    });
  }, [modules, kindFilter, query]);

  if (!snap) {
    return (
      <div className="p-4 text-xs text-panel-muted">
        Capture a snapshot to see the loaded JS modules + tech stack.
      </div>
    );
  }

  const kinds = ['all', ...Object.keys(summary.byKind)].sort();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="font-semibold text-white">
            {summary.total} modules · {formatBytes(summary.totalBytes)}
          </span>
          <span className="text-panel-muted">|</span>
          {Object.entries(summary.byKind).map(([kind, v]) => (
            <span key={kind} className="text-panel-muted">
              <span className="text-white">{kind}</span> {v!.count}/{formatBytes(v!.bytes)}
            </span>
          ))}
        </div>
        {techStack && techStack.matches.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {techStack.matches.map((m) => (
              <span
                key={m.id}
                className={
                  'rounded border px-1.5 py-0.5 ' +
                  (m.confidence === 'high'
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                    : m.confidence === 'medium'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                      : 'border-panel-border text-panel-muted')
                }
                title={m.evidence.join('\n')}
              >
                {m.name}
                {m.version ? ` ${m.version}` : ''}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-[11px] text-panel-text"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by URL or library…"
            className="flex-1 rounded border border-panel-border bg-panel-bg px-2 py-1 text-[11px] text-panel-text"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10 bg-panel-surface text-panel-muted">
            <tr>
              <th className="px-2 py-1 text-left">Kind</th>
              <th className="px-2 py-1 text-left">URL</th>
              <th className="px-2 py-1 text-left">Library</th>
              <th className="px-2 py-1 text-right">Size</th>
              <th className="px-2 py-1 text-left">Sourcemap</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const isOpen = openId === m.id;
              const lib =
                m.classification.library ??
                m.classification.framework ??
                m.classification.bundler ??
                '';
              const spec = viewerFor(m.classification.chunkKind);
              return (
                <>
                  <tr
                    key={m.id}
                    className={
                      'border-b border-panel-border/40 align-top hover:bg-panel-surface/40 ' +
                      (isOpen ? 'bg-panel-surface/30' : '')
                    }
                  >
                    <td className="px-2 py-1">
                      <span className="rounded bg-slate-700/40 px-1 py-0.5 text-[10px] uppercase text-panel-muted">
                        {m.classification.chunkKind}
                      </span>
                    </td>
                    <td className="break-all px-2 py-1 font-mono">
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : m.id)}
                        className="text-left text-panel-accent hover:text-sky-300"
                      >
                        {shorten(m.pathname)}
                      </button>
                      <div className="text-[10px] text-panel-muted">{m.origin}</div>
                    </td>
                    <td className="px-2 py-1">{lib}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatBytes(m.transferredBytes)}
                    </td>
                    <td className="px-2 py-1 text-[10px] text-panel-muted">{spec.label}</td>
                  </tr>
                  {isOpen && (
                    <tr key={m.id + ':detail'} className="border-b border-panel-border/40 bg-panel-surface/20">
                      <td colSpan={5} className="px-2 py-2">
                        <ModuleDetail
                          module={m}
                          fetchText={fetchText}
                          oneshot={oneshot}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-panel-muted">
                  No modules match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Per-kind detail dispatcher ---------- */

function ModuleDetail({
  module,
  fetchText,
  oneshot,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
}) {
  const spec = viewerFor(module.classification.chunkKind);
  switch (spec.family) {
    case 'js':
    case 'style':
      return <CodeModuleDetail module={module} fetchText={fetchText} oneshot={oneshot} />;
    case 'data':
      return <DataModuleDetail module={module} fetchText={fetchText} oneshot={oneshot} />;
    case 'image':
      return <ImageModuleDetail module={module} />;
    case 'font':
      return <FontModuleDetail module={module} />;
    case 'wasm':
      return <WasmModuleDetail module={module} fetchText={fetchText} />;
    case 'sourcemap':
      return <SourcemapStandaloneDetail module={module} fetchText={fetchText} />;
    default:
      return (
        <div className="text-[11px] text-panel-muted">
          No specialised viewer for this kind. Use the URL to inspect manually.
        </div>
      );
  }
}

/* ---------- Code modules: sourcemap-first, LLM-reformat fallback ---------- */

type CodeState =
  | { phase: 'idle' }
  | { phase: 'fetching-map' }
  | { phase: 'has-map'; map: ParsedSourceMap }
  | { phase: 'no-map'; reason: string }
  | { phase: 'fetching-source' }
  | { phase: 'reformatting' }
  | { phase: 'reformatted'; code: string }
  | { phase: 'error'; message: string };

function CodeModuleDetail({
  module,
  fetchText,
  oneshot,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
}) {
  const settings = useStore((s) => s.settings);
  const spec = viewerFor(module.classification.chunkKind);
  const language = spec.reformatLanguage ?? 'javascript';
  const [state, setState] = useState<CodeState>({ phase: 'idle' });

  // On mount, try to fetch + parse the sourcemap. Failure is expected for
  // a lot of modules — we surface a clear reason and offer the LLM-reformat
  // fallback.
  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'fetching-map' });
    fetchAndParseSourceMap(module, fetchText)
      .then((map) => {
        if (!cancelled) setState({ phase: 'has-map', map });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({
          phase: 'no-map',
          reason: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runReformat = async () => {
    setState({ phase: 'fetching-source' });
    let source: string;
    try {
      source = await fetchText(module.url);
    } catch (e) {
      setState({ phase: 'error', message: 'Could not fetch source: ' + (e instanceof Error ? e.message : String(e)) });
      return;
    }
    setState({ phase: 'reformatting' });
    const payload = buildReformatPayload(source, language, settings, {
      url: module.url,
      bytes: module.transferredBytes,
    });
    const res = await oneshot(payload);
    if (!res.ok) {
      setState({ phase: 'error', message: res.message });
      return;
    }
    const code = parseReformatResponse(res.text, language);
    setState({ phase: 'reformatted', code });
  };

  return (
    <div className="rounded border border-panel-border bg-slate-900/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        {spec.label} · {languageLabel(language)}
      </div>

      {state.phase === 'fetching-map' && (
        <div className="text-[11px] text-panel-muted">Fetching sourcemap…</div>
      )}

      {state.phase === 'has-map' && <SourceMapDetail map={state.map} />}

      {(state.phase === 'no-map' ||
        state.phase === 'fetching-source' ||
        state.phase === 'reformatting' ||
        state.phase === 'reformatted' ||
        state.phase === 'error') && (
        <div>
          {state.phase === 'no-map' && (
            <div className="mb-2 text-[11px] text-amber-200/90">
              No sourcemap available for this module ({state.reason}). You can
              still ask the local LLM to beautify the minified source.
            </div>
          )}
          {state.phase === 'error' && (
            <div className="mb-2 text-[11px] text-red-300">{state.message}</div>
          )}
          <button
            type="button"
            disabled={state.phase === 'fetching-source' || state.phase === 'reformatting' || !settings.baseUrl}
            onClick={() => void runReformat()}
            className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
            title={!settings.baseUrl ? 'Configure a local LLM in Settings first.' : ''}
          >
            {state.phase === 'fetching-source'
              ? 'Fetching source…'
              : state.phase === 'reformatting'
                ? 'Asking LLM…'
                : state.phase === 'reformatted'
                  ? '✨ Reformat again'
                  : '✨ Reformat with AI'}
          </button>
          {state.phase === 'reformatted' && (
            <pre className="scrollbar-thin mt-2 max-h-96 overflow-auto rounded border border-panel-border bg-black/40 p-2 font-mono text-[11px] leading-snug text-panel-text">
              <code>{state.code}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Data modules (JSON / manifest) ---------- */

function DataModuleDetail({
  module,
  fetchText,
  oneshot: _oneshot,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchText(module.url)
      .then((text) => {
        if (cancelled) return;
        try {
          setBody(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setBody(text);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="text-[11px] text-red-300">{error}</div>;
  if (body === null) return <div className="text-[11px] text-panel-muted">Fetching…</div>;
  return (
    <pre className="scrollbar-thin max-h-96 overflow-auto rounded border border-panel-border bg-black/40 p-2 font-mono text-[11px] leading-snug text-panel-text">
      <code>{body}</code>
    </pre>
  );
}

/* ---------- Image modules: preview + DOM usage scan ---------- */

function ImageModuleDetail({ module }: { module: LoadedModule }) {
  const [usages, setUsages] = useState<
    Array<{ tag: string; attribute: string; selector: string; text?: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    callFindAssetUsages(module.url).then((u) => {
      if (!cancelled) setUsages(u);
    });
    return () => {
      cancelled = true;
    };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded border border-panel-border bg-slate-900/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        Image preview · {formatBytes(module.transferredBytes)}
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="flex items-center justify-center rounded bg-black/60 p-2">
          <img
            src={module.url}
            alt={module.pathname}
            className="max-h-32 max-w-full object-contain"
            style={{ imageRendering: 'auto' }}
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
            Used on page ({usages?.length ?? '…'})
          </div>
          {usages === null ? (
            <div className="text-[11px] text-panel-muted">Scanning DOM…</div>
          ) : usages.length === 0 ? (
            <div className="text-[11px] text-panel-muted">
              No live DOM references found. The asset may be loaded by JS for a
              modal, dynamically swapped, or used only on a different route.
            </div>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {usages.slice(0, 20).map((u, i) => (
                <li key={i} className="break-words">
                  <span className="font-mono text-panel-text/90">{u.selector}</span>
                  <span className="ml-1 text-panel-muted">[{u.attribute}]</span>
                </li>
              ))}
              {usages.length > 20 && (
                <li className="text-panel-muted">…and {usages.length - 20} more.</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Font modules ---------- */

function FontModuleDetail({ module }: { module: LoadedModule }) {
  const fontFamily = useMemo(() => {
    // Try to extract a font family from the filename. Common patterns:
    //   Inter-Regular.woff2 → Inter Regular
    //   roboto-condensed.woff → roboto condensed
    const last = module.pathname.split('/').pop() ?? '';
    return last.replace(/\.(woff2?|ttf|otf|eot)$/i, '').replace(/[-_]/g, ' ');
  }, [module.pathname]);
  return (
    <div className="rounded border border-panel-border bg-slate-900/40 p-2 text-[11px]">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        Font · {formatBytes(module.transferredBytes)}
      </div>
      <div className="text-panel-text">
        Inferred family: <span className="font-mono">{fontFamily}</span>
      </div>
      <div className="mt-1 text-panel-muted">
        Live @font-face preview not available — Chrome doesn't expose font
        bytes to extension pages. Inspect the URL or use the Elements panel to
        see where it's declared.
      </div>
    </div>
  );
}

/* ---------- WebAssembly modules ---------- */

function WasmModuleDetail({
  module,
  fetchText,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
}) {
  const [magic, setMagic] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // fetchText returns UTF-8 decoded text — for binary wasm we get garbled
    // chars. We only need the first 8 bytes (magic + version) which sit at
    // the start of any wasm module. Read them via charCodeAt of the
    // returned string and trust that the first 8 bytes are 7-bit clean.
    fetchText(module.url)
      .then((text) => {
        if (cancelled) return;
        const m = text.slice(0, 4);
        setMagic(
          Array.from(m)
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join(' '),
        );
        const v =
          text.charCodeAt(4) |
          (text.charCodeAt(5) << 8) |
          (text.charCodeAt(6) << 16) |
          (text.charCodeAt(7) << 24);
        setVersion(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded border border-panel-border bg-slate-900/40 p-2 text-[11px]">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        WebAssembly · {formatBytes(module.transferredBytes)}
      </div>
      {error && <div className="text-red-300">{error}</div>}
      {magic && (
        <div className="font-mono text-panel-text/90">
          magic: {magic} {magic === '00 61 73 6d' ? '(valid wasm)' : '(unexpected)'}
        </div>
      )}
      {version != null && <div className="font-mono text-panel-text/90">version: {version}</div>}
      <div className="mt-1 text-panel-muted">
        Use the wabt toolchain (wasm2wat) to decode the bytecode if you need
        full disassembly.
      </div>
    </div>
  );
}

/* ---------- Sourcemap as a standalone module ---------- */

function SourcemapStandaloneDetail({
  module,
  fetchText,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
}) {
  const [map, setMap] = useState<ParsedSourceMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAndParseSourceMap(module, fetchText)
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="text-[11px] text-red-300">{error}</div>;
  if (!map) return <div className="text-[11px] text-panel-muted">Parsing sourcemap…</div>;
  return <SourceMapDetail map={map} />;
}

function SourceMapDetail({ map }: { map: ParsedSourceMap }) {
  const top = useMemo(() => topLeaves(map.tree, 15), [map]);
  return (
    <div className="mt-2 rounded border border-panel-border bg-slate-900/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        Top sources · {map.sources.length} files · {formatBytes(map.totalBytes)} mapped
      </div>
      <ul className="space-y-0.5">
        {top.map((node) => (
          <li key={node.fullPath} className="flex justify-between gap-2 text-[11px]">
            <span className="break-all font-mono text-panel-text/90">{node.fullPath}</span>
            <span className="shrink-0 font-mono text-panel-muted">{formatBytes(node.bytes)}</span>
          </li>
        ))}
      </ul>
      <TreeView root={map.tree} />
    </div>
  );
}

function TreeView({ root }: { root: SourceFileNode }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true });
  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  const render = (node: SourceFileNode, depth: number) => {
    const isOpen = expanded[node.fullPath] ?? false;
    const hasChildren = !!node.children?.length;
    return (
      <div key={node.fullPath || '/'}>
        <div
          className="flex items-center gap-1 text-[11px] hover:bg-panel-surface/40"
          style={{ paddingLeft: depth * 12 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.fullPath)}
              className="w-3 text-panel-muted"
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-3" />
          )}
          <span className="flex-1 truncate font-mono">{node.name || '/'}</span>
          <span className="font-mono text-panel-muted">{formatBytes(node.bytes)}</span>
        </div>
        {isOpen &&
          node.children?.slice(0, 100).map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return <div className="mt-2 max-h-80 overflow-auto">{render(root, 0)}</div>;
}

function shorten(path: string): string {
  if (path.length <= 60) return path;
  return '…' + path.slice(-60);
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { summarizeModules } from '@/lib/modules/classify';
import { fetchAndParseSourceMap, formatBytes, topLeaves } from '@/lib/modules/sourcemap';
import { viewerFor } from '@/lib/modules/viewers';
import {
  probeSourcemaps,
  summarizeProbe,
  type ProbeProgress,
  type ProbeRecord,
} from '@/lib/modules/sourcemapProbe';
import type { HeadProxy } from '@/lib/modules/fetchProxy';
import {
  buildModuleTree,
  expandModuleWithSourcemap,
  type ModuleTreeNode,
} from '@/lib/modules/moduleTree';
import { ModulesTree } from './modules/ModulesTree';
import { FileDetail } from './modules/FileDetail';
import { buildReformatPayload, parseReformatResponse, languageLabel } from '@/lib/modules/reformat';
import { extractSkeleton, symbolLabel, type Skeleton, type SkeletonSymbol } from '@/lib/modules/skeleton';
import { buildSymbolSummaryPayload } from '@/lib/modules/summarizeSymbol';
import { callFindAssetUsages, callScrollToSelector } from '../hooks/useInspectedEval';
import type { LoadedModule, ParsedSourceMap, SourceFileNode } from '@/lib/modules/types';
import type { OneshotProxy } from '@/lib/lm-studio/oneshotProxy';
import type { StreamingOneshot } from '@/lib/lm-studio/streamingProxy';

interface Props {
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
  streamingOneshot: StreamingOneshot;
  headProbe: HeadProxy;
}

export default function ModulesTab({
  fetchText,
  oneshot,
  streamingOneshot,
  headProbe,
}: Props) {
  const snap = useStore((s) => s.snapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const [tree, setTree] = useState<ModuleTreeNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFileNode, setSelectedFileNode] = useState<ModuleTreeNode | null>(null);
  const expandedModulesRef = useRef(new Set<string>());

  const modules = snap?.modules ?? [];
  const techStack = snap?.techStack;

  const summary = useMemo(() => summarizeModules(modules), [modules]);

  // Sourcemap probe state — Map<moduleId, ProbeRecord>.
  // The probe auto-runs once per snapshot when the tab mounts; subsequent
  // mounts reuse the same record map. We also keep a progress object so
  // the summary card can show "Probing 12/45…" while the pool churns.
  const [probeRecords, setProbeRecords] = useState<Map<string, ProbeRecord>>(new Map());
  const [probeProgress, setProbeProgress] = useState<ProbeProgress | null>(null);
  const probedSnapshotRef = useRef<string | null>(null);
  const probeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!snap || modules.length === 0) return;
    if (probedSnapshotRef.current === snap.id) return; // already probed this snapshot
    probedSnapshotRef.current = snap.id;
    probeAbortRef.current?.abort();
    const ctrl = new AbortController();
    probeAbortRef.current = ctrl;
    setProbeRecords(new Map());
    setProbeProgress({ done: 0, total: 0, running: 0, declared: 0, found: 0, missing: 0, skipped: 0 });
    void probeSourcemaps(modules, headProbe, {
      concurrency: 4,
      signal: ctrl.signal,
      onProgress: (p) => setProbeProgress(p),
    }).then((recs) => {
      if (ctrl.signal.aborted) return;
      setProbeRecords(new Map(recs));
      setProbeProgress(null);
    });
    return () => {
      ctrl.abort();
    };
  }, [snap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const probeStats = useMemo(
    () => summarizeProbe(probeRecords, modules.length),
    [probeRecords, modules.length],
  );

  // Build the deployed-modules tree once per snapshot. Subsequent
  // sourcemap expansions modify it in-place via setTree(expand(...)).
  useEffect(() => {
    if (modules.length === 0) {
      setTree(null);
      expandedModulesRef.current.clear();
      return;
    }
    setTree(buildModuleTree(modules));
    expandedModulesRef.current.clear();
  }, [snap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-fetch the sourcemap for the module node the user just opened in
  // the tree, then graft its sources subtree under that node. Skipped if
  // we've already expanded it or the probe said the map is missing.
  const handleExpandModule = async (node: ModuleTreeNode) => {
    if (!node.module) return;
    if (expandedModulesRef.current.has(node.id)) return;
    expandedModulesRef.current.add(node.id);
    const probe = probeRecords.get(node.module.id);
    if (probe?.status === 'missing' || probe?.status === 'error') return;
    try {
      const map = await fetchAndParseSourceMap(node.module, fetchText);
      setTree((prev) =>
        prev ? expandModuleWithSourcemap(prev, node.id, map) : prev,
      );
    } catch {
      // Quietly leave the node unexpanded — the user can still see the
      // deployed module entry. The flat-table view also surfaces the
      // failure via the Code module detail's "no sourcemap" banner.
    }
  };

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
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-panel-muted">Sourcemaps:</span>
          {probeProgress ? (
            <span className="text-panel-muted">
              probing {probeProgress.done}/{probeProgress.total} ·{' '}
              {probeProgress.found + probeProgress.declared} found,{' '}
              {probeProgress.missing} missing
            </span>
          ) : (
            <>
              {probeStats.declared > 0 && (
                <span
                  className="rounded border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200"
                  title="Page sent a SourceMap response header for these modules — sourcemap location declared by the build."
                >
                  ✓ {probeStats.declared} declared
                </span>
              )}
              {probeStats.found > 0 && (
                <span
                  className="rounded border border-sky-500/50 bg-sky-500/10 px-1.5 py-0.5 text-sky-200"
                  title="Probed <url>.map sibling and got 2xx — the sourcemap is hosted alongside the asset."
                >
                  ✓ {probeStats.found} found
                </span>
              )}
              {probeStats.missing > 0 && (
                <span
                  className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-amber-200"
                  title="Probe returned 404 — no sibling .map file. The build did not publish sourcemaps for these modules."
                >
                  ✗ {probeStats.missing} missing
                </span>
              )}
              {probeStats.skipped > 0 && (
                <span
                  className="rounded border border-panel-border bg-panel-bg/40 px-1.5 py-0.5 text-panel-muted"
                  title="Module kind doesn't have sourcemaps (images, fonts, wasm, etc.)."
                >
                  — {probeStats.skipped} N/A
                </span>
              )}
              <span className="ml-1 text-panel-muted">
                ({probeStats.available} of {modules.length - probeStats.skipped} JS/CSS available)
              </span>
            </>
          )}
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
          <div className="flex rounded border border-panel-border bg-panel-bg text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              className={
                'px-2 py-1 ' +
                (viewMode === 'tree'
                  ? 'bg-panel-accent/30 text-white'
                  : 'text-panel-muted hover:text-white')
              }
              title="Hierarchical view (Chrome DevTools Sources style) — surfaces sourcemap-resolved files"
            >
              Tree
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat')}
              className={
                'px-2 py-1 ' +
                (viewMode === 'flat'
                  ? 'bg-panel-accent/30 text-white'
                  : 'text-panel-muted hover:text-white')
              }
              title="Flat sortable table of every deployed module"
            >
              Flat
            </button>
          </div>
          {viewMode === 'flat' && (
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
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              viewMode === 'tree' ? 'Filter files / folders / origins…' : 'Filter by URL or library…'
            }
            className="flex-1 rounded border border-panel-border bg-panel-bg px-2 py-1 text-[11px] text-panel-text"
          />
        </div>
      </div>

      {viewMode === 'tree' && tree && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,32%)_1fr]">
          <div className="min-h-0 overflow-auto border-r border-panel-border bg-panel-bg/30">
            <ModulesTree
              root={tree}
              selectedId={selectedNodeId}
              onSelect={(node) => {
                setSelectedNodeId(node.id);
                if (node.type === 'source-file') setSelectedFileNode(node);
              }}
              onExpandModule={(node) => void handleExpandModule(node)}
              statusForUrl={(url) => {
                const rec = probeRecords.get(url);
                if (!rec) return null;
                return <SourceMapBadge record={rec} kindLabel="" />;
              }}
              filter={query}
            />
          </div>
          <div className="min-h-0 overflow-hidden">
            {selectedFileNode ? (
              <FileDetail
                node={selectedFileNode}
                streamingOneshot={streamingOneshot}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-panel-muted">
                Select a source file on the left to view its content and run
                an AI analysis (Audit / Improve / Explain). Expand a deployed
                module 📦 to fetch its sourcemap and surface the original
                files.
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'flat' && (
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
                    <td className="px-2 py-1 text-[10px]">
                      <SourceMapBadge record={probeRecords.get(m.id)} kindLabel={spec.label} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={m.id + ':detail'} className="border-b border-panel-border/40 bg-panel-surface/20">
                      <td colSpan={5} className="px-2 py-2">
                        <ModuleDetail
                          module={m}
                          fetchText={fetchText}
                          oneshot={oneshot}
                          streamingOneshot={streamingOneshot}
                          probeRecord={probeRecords.get(m.id)}
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
      )}
    </div>
  );
}

/* ---------- Per-kind detail dispatcher ---------- */

function ModuleDetail({
  module,
  fetchText,
  oneshot,
  streamingOneshot,
  probeRecord,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
  streamingOneshot: StreamingOneshot;
  probeRecord: ProbeRecord | undefined;
}) {
  const spec = viewerFor(module.classification.chunkKind);
  switch (spec.family) {
    case 'js':
    case 'style':
      return (
        <CodeModuleDetail
          module={module}
          fetchText={fetchText}
          oneshot={oneshot}
          streamingOneshot={streamingOneshot}
          probeRecord={probeRecord}
        />
      );
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

/* ---------- Code modules: sourcemap-first, skeleton + symbol-summarize fallback ---------- */

/**
 * The code-module detail goes through three phases:
 *
 *   1. Try the sourcemap. If a .map is present, show the existing
 *      hierarchical source tree.
 *   2. Otherwise (the common case for production minified bundles), fetch
 *      the raw source ONCE and build a regex/heuristic skeleton —
 *      webpack modules, imports, exports, top-level fns/classes. This is
 *      instant and gives the user a navigable outline.
 *   3. Per symbol, the user can ask the LLM to summarise just that range
 *      — a small, focused, streaming call. Far faster and more useful
 *      than "reformat 1MB of minified JS" which takes minutes and yields
 *      something nobody can read.
 *
 *   For users who DO want a full beautify (smaller modules, a quick
 *   download), a separate "Beautify whole file" button streams the LLM
 *   output into a code viewer with download support.
 */

type CodeState =
  | { phase: 'fetching-map' }
  | { phase: 'has-map'; map: ParsedSourceMap }
  | { phase: 'no-map'; reason: string }
  | { phase: 'mapping'; progress: string }
  | { phase: 'mapped'; source: string; skeleton: Skeleton }
  | { phase: 'error'; message: string };

function CodeModuleDetail({
  module,
  fetchText,
  oneshot,
  streamingOneshot,
  probeRecord,
}: {
  module: LoadedModule;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
  streamingOneshot: StreamingOneshot;
  probeRecord: ProbeRecord | undefined;
}) {
  const settings = useStore((s) => s.settings);
  const spec = viewerFor(module.classification.chunkKind);
  const language = spec.reformatLanguage ?? 'javascript';
  const family = (spec.family === 'js' ? 'js' : spec.family === 'style' ? 'style' : 'other') as
    | 'js'
    | 'style'
    | 'other';
  const [state, setState] = useState<CodeState>({ phase: 'fetching-map' });
  const [beautify, setBeautify] = useState<BeautifyState>({ phase: 'idle' });

  useEffect(() => {
    let cancelled = false;
    // Short-circuit when the probe already determined the sourcemap is
    // missing — skip the slow fetch + sourceMappingURL parse and jump
    // straight to the "Map module" UX. Same for declared/found which
    // are positive signals: we still need to fetch, but at least we know
    // it'll succeed.
    if (probeRecord?.status === 'missing') {
      setState({
        phase: 'no-map',
        reason: `HEAD probe returned ${probeRecord.httpStatus ?? '4xx'} for ${probeRecord.mapUrl ?? '.map sibling'}`,
      });
      return;
    }
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
  }, [module.id, probeRecord?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const runMapModule = async () => {
    setState({ phase: 'mapping', progress: 'Fetching source…' });
    let source: string;
    try {
      source = await fetchText(module.url);
    } catch (e) {
      setState({
        phase: 'error',
        message: 'Could not fetch source: ' + (e instanceof Error ? e.message : String(e)),
      });
      return;
    }
    setState({ phase: 'mapping', progress: 'Extracting skeleton…' });
    // Defer so React can paint the "Extracting…" state before we block
    // on the regex pass (which can take ~200ms on a 1MB minified file).
    await new Promise((r) => setTimeout(r, 0));
    const skeleton = extractSkeleton(source, family);
    if (!skeleton) {
      setState({
        phase: 'error',
        message: 'No skeleton extractor for this kind.',
      });
      return;
    }
    setState({ phase: 'mapped', source, skeleton });
  };

  return (
    <div className="rounded border border-panel-border bg-slate-900/40 p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-panel-muted">
          {spec.label} · {languageLabel(language)}
        </div>
        {state.phase === 'no-map' || state.phase === 'mapped' ? (
          <BeautifyButton
            module={module}
            language={language}
            beautify={beautify}
            setBeautify={setBeautify}
            fetchText={fetchText}
            oneshot={oneshot}
            streamingOneshot={streamingOneshot}
            sourcePrefetched={state.phase === 'mapped' ? state.source : null}
          />
        ) : null}
      </div>

      {state.phase === 'fetching-map' && (
        <div className="text-[11px] text-panel-muted">Fetching sourcemap…</div>
      )}

      {state.phase === 'has-map' && <SourceMapDetail map={state.map} />}

      {state.phase === 'no-map' && (
        <div>
          <div className="mb-2 text-[11px] text-amber-200/90">
            No sourcemap available ({state.reason}). Map the module to get a
            navigable skeleton — then summarise individual symbols on demand.
          </div>
          <button
            type="button"
            onClick={() => void runMapModule()}
            className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20"
          >
            🗺 Map module
          </button>
        </div>
      )}

      {state.phase === 'mapping' && (
        <div className="text-[11px] text-panel-muted">{state.progress}</div>
      )}

      {state.phase === 'error' && (
        <div className="text-[11px] text-red-300">{state.message}</div>
      )}

      {state.phase === 'mapped' && (
        <SkeletonView
          module={module}
          source={state.source}
          skeleton={state.skeleton}
          streamingOneshot={streamingOneshot}
        />
      )}

      <BeautifyPanel state={beautify} />
    </div>
  );
}

/* ---------- Skeleton view: navigable outline + per-symbol summarize ---------- */

function SkeletonView({
  module,
  source,
  skeleton,
  streamingOneshot,
}: {
  module: LoadedModule;
  source: string;
  skeleton: Skeleton;
  streamingOneshot: StreamingOneshot;
}) {
  const settings = useStore((s) => s.settings);
  const [filter, setFilter] = useState('');
  const [summaries, setSummaries] = useState<Record<number, SymbolSummary>>({});
  const groups = useMemo(() => {
    const out = new Map<SkeletonSymbol['kind'], SkeletonSymbol[]>();
    for (const s of skeleton.symbols) {
      const list = out.get(s.kind) ?? [];
      list.push(s);
      out.set(s.kind, list);
    }
    return Array.from(out.entries());
  }, [skeleton]);

  const isMinified = useMemo(() => isProbablyMinified(source), [source]);

  const runSummary = (idx: number, symbol: SkeletonSymbol) => {
    const payload = buildSymbolSummaryPayload(symbol, source, settings, {
      moduleUrl: module.url,
      isMinified,
    });
    setSummaries((prev) => ({ ...prev, [idx]: { state: 'streaming', text: '' } }));
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setSummaries((prev) => ({ ...prev, [idx]: { state: 'streaming', text: acc } }));
    });
    handle.result
      .then((full) => {
        setSummaries((prev) => ({ ...prev, [idx]: { state: 'done', text: full } }));
      })
      .catch((e) => {
        setSummaries((prev) => ({
          ...prev,
          [idx]: { state: 'error', text: acc, error: e instanceof Error ? e.message : String(e) },
        }));
      });
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-panel-muted">
        <span>{skeleton.symbols.length} symbols extracted</span>
        {skeleton.language === 'javascript' && skeleton.isWebpackBundle && (
          <span className="rounded bg-violet-500/20 px-1 text-violet-200">
            webpack ({skeleton.moduleCount} modules)
          </span>
        )}
        {skeleton.language === 'javascript' && skeleton.isVite && (
          <span className="rounded bg-emerald-500/20 px-1 text-emerald-200">vite</span>
        )}
        {isMinified && (
          <span className="rounded bg-slate-700/40 px-1 text-panel-muted">minified</span>
        )}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter symbols…"
          className="ml-auto rounded border border-panel-border bg-panel-bg px-2 py-0.5 text-[11px] normal-case text-panel-text"
        />
      </div>

      <div className="max-h-[420px] overflow-auto">
        {groups.map(([kind, syms]) => {
          const visible = syms.filter((s) =>
            !filter ? true : s.name.toLowerCase().includes(filter.toLowerCase()),
          );
          if (visible.length === 0) return null;
          return (
            <div key={kind} className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
                {kind} ({visible.length})
              </div>
              <ul className="space-y-0.5">
                {visible.slice(0, 80).map((s) => {
                  const idx = skeleton.symbols.indexOf(s);
                  const sum = summaries[idx];
                  return (
                    <li
                      key={idx}
                      className="rounded border border-panel-border/30 bg-panel-bg/30 p-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="break-all font-mono">{symbolLabel(s)}</span>
                        <span className="shrink-0 font-mono text-[10px] text-panel-muted">
                          {formatBytes(s.end - s.start)}
                        </span>
                      </div>
                      {s.preview && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-panel-muted">
                          {s.preview}
                        </div>
                      )}
                      {sum ? (
                        <div
                          className={
                            'mt-1 rounded border px-1.5 py-1 text-[11px] ' +
                            (sum.state === 'error'
                              ? 'border-red-500/40 bg-red-500/10 text-red-200'
                              : 'border-panel-border bg-black/30 text-panel-text')
                          }
                        >
                          {sum.text || (sum.state === 'streaming' ? '…' : '')}
                          {sum.state === 'streaming' && (
                            <span className="ml-0.5 inline-block animate-pulse">▍</span>
                          )}
                          {sum.state === 'error' && (
                            <div className="mt-1 text-[10px]">{sum.error}</div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => runSummary(idx, s)}
                          disabled={!settings.baseUrl}
                          className="mt-1 text-[10px] text-panel-accent hover:text-sky-300 disabled:text-panel-muted"
                          title={
                            !settings.baseUrl
                              ? 'Configure a local LLM in Settings first.'
                              : ''
                          }
                        >
                          ✨ Summarize symbol
                        </button>
                      )}
                    </li>
                  );
                })}
                {visible.length > 80 && (
                  <li className="text-[11px] text-panel-muted">
                    …and {visible.length - 80} more. Filter to narrow.
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SymbolSummary {
  state: 'streaming' | 'done' | 'error';
  text: string;
  error?: string;
}

function isProbablyMinified(source: string): boolean {
  // Heuristic: average characters per line. Minified files routinely sit
  // above 200 chars/line; readable code is usually under 80.
  const lines = source.split('\n');
  if (lines.length < 5) return source.length > 1000;
  const avg = source.length / lines.length;
  return avg > 200;
}

/* ---------- Beautify whole file (opt-in streaming) ---------- */

type BeautifyState =
  | { phase: 'idle' }
  | { phase: 'streaming'; chars: number; downloadUrl?: string }
  | { phase: 'done'; downloadUrl: string }
  | { phase: 'error'; message: string };

function BeautifyButton({
  module,
  language,
  beautify,
  setBeautify,
  fetchText,
  oneshot,
  streamingOneshot,
  sourcePrefetched,
}: {
  module: LoadedModule;
  language: import('@/lib/modules/reformat').ReformatLanguage;
  beautify: BeautifyState;
  setBeautify: (s: BeautifyState) => void;
  fetchText: (url: string) => Promise<string>;
  oneshot: OneshotProxy;
  streamingOneshot: StreamingOneshot;
  sourcePrefetched: string | null;
}) {
  const settings = useStore((s) => s.settings);
  const busy = beautify.phase === 'streaming';

  const run = async () => {
    setBeautify({ phase: 'streaming', chars: 0 });
    let source = sourcePrefetched;
    if (source === null) {
      try {
        source = await fetchText(module.url);
      } catch (e) {
        setBeautify({
          phase: 'error',
          message: 'Could not fetch source: ' + (e instanceof Error ? e.message : String(e)),
        });
        return;
      }
    }
    const payload = buildReformatPayload(source, language, settings, {
      url: module.url,
      bytes: module.transferredBytes,
    });
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setBeautify({ phase: 'streaming', chars: acc.length });
    });
    try {
      const full = await handle.result;
      const code = parseReformatResponse(full, language);
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      setBeautify({ phase: 'done', downloadUrl: url });
    } catch (e) {
      setBeautify({
        phase: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
    // oneshot import is kept on the props surface so we can swap back if
    // a future, smaller-payload flow needs non-streaming reformat.
    void oneshot;
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy || !settings.baseUrl}
      className="rounded border border-panel-border bg-panel-bg/60 px-2 py-0.5 text-[10px] text-panel-muted hover:text-white disabled:cursor-not-allowed"
      title={
        !settings.baseUrl
          ? 'Configure a local LLM in Settings first.'
          : 'Stream a full beautify of this file. Slow for large bundles — prefer Map module + Summarize symbol.'
      }
    >
      {busy ? `Beautifying… ${formatBytes(beautify.chars)}` : '⤓ Beautify whole file'}
    </button>
  );
}

function BeautifyPanel({ state }: { state: BeautifyState }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'streaming') {
    return (
      <div className="mt-2 rounded border border-panel-border bg-black/30 px-2 py-1 text-[11px] text-panel-muted">
        Streaming beautified output… {formatBytes(state.chars)} received.
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
        Beautify failed: {state.message}
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-between rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
      <span>Beautified output ready.</span>
      <a
        href={state.downloadUrl}
        download="dom-lens-beautified.txt"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] hover:bg-emerald-500/20"
      >
        ⬇ Download
      </a>
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
                  <button
                    type="button"
                    onClick={() =>
                      void callScrollToSelector(u.selector, {
                        label: `${u.tag}[${u.attribute}]`,
                        color: '#0ea5e9',
                      })
                    }
                    className="text-left hover:bg-panel-surface/40"
                    title="Scroll the inspected page to this element and highlight it"
                  >
                    <span className="font-mono text-panel-accent hover:text-sky-300">
                      {u.selector}
                    </span>
                    <span className="ml-1 text-panel-muted">[{u.attribute}]</span>
                  </button>
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

/**
 * Small status pill rendered in the rightmost column of the modules table.
 * Reflects the probe pass result for this module. Two tiers: a colour code
 * (good / pending / bad / neutral) and a 1-word label.
 */
function SourceMapBadge({
  record,
  kindLabel,
}: {
  record: ProbeRecord | undefined;
  kindLabel: string;
}) {
  if (!record) {
    return <span className="text-panel-muted">{kindLabel}</span>;
  }
  const cls = (color: 'good' | 'pending' | 'bad' | 'neutral') => {
    switch (color) {
      case 'good':
        return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200';
      case 'pending':
        return 'border-sky-500/40 bg-sky-500/10 text-sky-200 animate-pulse';
      case 'bad':
        return 'border-amber-500/50 bg-amber-500/10 text-amber-200';
      case 'neutral':
        return 'border-panel-border text-panel-muted';
    }
  };
  switch (record.status) {
    case 'declared':
      return (
        <span
          title={`Page declared sourcemap at ${record.mapUrl ?? '<unknown>'}`}
          className={'rounded border px-1.5 py-0.5 ' + cls('good')}
        >
          ✓ declared
        </span>
      );
    case 'found':
      return (
        <span
          title={`HEAD probe on ${record.mapUrl ?? '.map'} returned ${record.httpStatus}`}
          className={'rounded border px-1.5 py-0.5 ' + cls('good')}
        >
          ✓ found
        </span>
      );
    case 'missing':
      return (
        <span
          title={`HEAD probe returned ${record.httpStatus ?? '4xx'} — no .map sibling`}
          className={'rounded border px-1.5 py-0.5 ' + cls('bad')}
        >
          ✗ missing
        </span>
      );
    case 'probing':
      return (
        <span className={'rounded border px-1.5 py-0.5 ' + cls('pending')}>
          probing…
        </span>
      );
    case 'skipped':
      return <span className="text-panel-muted">{kindLabel}</span>;
    case 'error':
      return (
        <span
          title={record.message ?? 'probe error'}
          className={'rounded border px-1.5 py-0.5 ' + cls('bad')}
        >
          ! error
        </span>
      );
    default:
      return <span className="text-panel-muted">?</span>;
  }
}

function shorten(path: string): string {
  if (path.length <= 60) return path;
  return '…' + path.slice(-60);
}

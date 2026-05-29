import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { summarizeModules } from '@/lib/modules/classify';
import { fetchAndParseSourceMap, formatBytes, topLeaves } from '@/lib/modules/sourcemap';
import type { LoadedModule, ParsedSourceMap, SourceFileNode } from '@/lib/modules/types';

interface Props {
  fetchText: (url: string) => Promise<string>;
}

type LoadingState = 'idle' | 'fetching' | 'done' | 'error';

interface RowState {
  state: LoadingState;
  map?: ParsedSourceMap;
  error?: string;
}

export default function ModulesTab({ fetchText }: Props) {
  const snap = useStore((s) => s.snapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rowMap, setRowMap] = useState<Record<string, RowState>>({});
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

  const fetchSourcemap = async (mod: LoadedModule) => {
    setRowMap((prev) => ({ ...prev, [mod.id]: { state: 'fetching' } }));
    try {
      const map = await fetchAndParseSourceMap(mod, fetchText);
      setRowMap((prev) => ({ ...prev, [mod.id]: { state: 'done', map } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRowMap((prev) => ({ ...prev, [mod.id]: { state: 'error', error: msg } }));
    }
  };

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
              const row = rowMap[m.id] ?? { state: 'idle' as const };
              const lib =
                m.classification.library ??
                m.classification.framework ??
                m.classification.bundler ??
                '';
              return (
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
                      onClick={() => {
                        setOpenId(isOpen ? null : m.id);
                        if (!isOpen && row.state === 'idle') void fetchSourcemap(m);
                      }}
                      className="text-left text-panel-accent hover:text-sky-300"
                    >
                      {shorten(m.pathname)}
                    </button>
                    <div className="text-[10px] text-panel-muted">{m.origin}</div>
                    {isOpen && row.state === 'done' && row.map && (
                      <SourceMapDetail map={row.map} />
                    )}
                    {isOpen && row.state === 'fetching' && (
                      <div className="mt-1 text-[10px] text-panel-muted">Fetching sourcemap…</div>
                    )}
                    {isOpen && row.state === 'error' && (
                      <div className="mt-1 text-[10px] text-red-300">
                        Sourcemap unavailable: {row.error}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">{lib}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {formatBytes(m.transferredBytes)}
                  </td>
                  <td className="px-2 py-1">
                    {row.state === 'done'
                      ? `✓ ${formatBytes(row.map?.totalBytes ?? 0)}`
                      : row.state === 'fetching'
                        ? '…'
                        : row.state === 'error'
                          ? '✗'
                          : (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenId(m.id);
                                  void fetchSourcemap(m);
                                }}
                                className="rounded border border-panel-border px-1.5 py-0.5 text-[10px] text-panel-muted hover:text-white"
                              >
                                Fetch
                              </button>
                            )}
                  </td>
                </tr>
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

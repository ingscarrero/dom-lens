import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { useStore } from '../store';
import type { ComponentNode } from '@/lib/react/fiberToTree';

interface TreeRow {
  id: string;
  name: string;
  kind: string;
  key?: string;
  tag?: string;
  hint?: string;
  childrenCount: number;
  hasBounds: boolean;
  bounds?: { x: number; y: number; w: number; h: number };
  children?: TreeRow[];
}

function toRows(nodes: ComponentNode[], prefix = ''): TreeRow[] {
  return nodes.map((n, i): TreeRow => {
    const id = prefix + '/' + i + ':' + n.id;
    return {
      id,
      name: n.name,
      kind: n.kind,
      key: n.key,
      tag: n.tag,
      hint: n.hint,
      childrenCount: n.childrenCount,
      hasBounds: !!n.bounds,
      bounds: n.bounds,
      children: n.children.length ? toRows(n.children, id) : undefined,
    };
  });
}

// "Significant" = a node worth showing in the tree.
// Pure wrappers (providers, fragments, single-letter anonymous components with
// no bounds and no content hint) are pruned and their children reparent up.
function isSignificant(row: TreeRow): boolean {
  if (!row.hasBounds) return false;
  // Always keep nodes with a real semantic name
  const namedWell = /^[A-Z]/.test(row.name) && row.name.length > 2;
  if (namedWell) return true;
  // Keep anything with a content hint
  if (row.hint) return true;
  // Keep host elements (real DOM)
  if (row.kind === 'host') return true;
  return false;
}

function pruneToSignificant(rows: TreeRow[]): TreeRow[] {
  const out: TreeRow[] = [];
  for (const r of rows) {
    const prunedChildren = r.children ? pruneToSignificant(r.children) : undefined;
    if (isSignificant(r)) {
      out.push({
        ...r,
        children: prunedChildren && prunedChildren.length ? prunedChildren : undefined,
        childrenCount: prunedChildren?.length ?? 0,
      });
    } else if (prunedChildren && prunedChildren.length) {
      out.push(...prunedChildren);
    }
  }
  return out;
}

function findById(rows: TreeRow[], id: string): TreeRow | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children) {
      const sub = findById(r.children, id);
      if (sub) return sub;
    }
  }
  return null;
}

function filterRows(rows: TreeRow[], q: string): TreeRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  const matches = (r: TreeRow) =>
    r.name.toLowerCase().includes(needle) ||
    r.kind.toLowerCase().includes(needle) ||
    (r.tag?.toLowerCase() ?? '').includes(needle) ||
    (r.hint?.toLowerCase() ?? '').includes(needle);
  const out: TreeRow[] = [];
  for (const row of rows) {
    const filteredChildren = row.children ? filterRows(row.children, q) : undefined;
    if (matches(row) || (filteredChildren && filteredChildren.length)) {
      out.push({
        ...row,
        children: filteredChildren && filteredChildren.length ? filteredChildren : undefined,
      });
    }
  }
  return out;
}

function NodeRow({ node, style, dragHandle }: NodeRendererProps<TreeRow>) {
  return (
    <div
      style={style}
      ref={dragHandle}
      className={
        'group flex cursor-pointer items-center gap-1.5 px-1 text-xs ' +
        (node.isSelected ? 'bg-panel-accent/30 text-white' : 'hover:bg-white/5')
      }
      onClick={() => node.toggle()}
    >
      <span className="w-3 shrink-0 text-panel-muted">{node.isLeaf ? '·' : node.isOpen ? '▾' : '▸'}</span>
      <span className="shrink-0 font-medium">{node.data.name}</span>
      {node.data.tag && (
        <span className="shrink-0 rounded bg-emerald-900/40 px-1 text-[10px] text-emerald-300">
          {node.data.tag}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-panel-muted">{node.data.kind}</span>
      {node.data.key && <span className="shrink-0 text-[10px] text-yellow-200">key={node.data.key}</span>}
      {node.data.hint && (
        <span
          className="truncate italic text-[11px] text-panel-text/70"
          title={node.data.hint}
        >
          “{node.data.hint}”
        </span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-panel-muted">
        {node.data.hasBounds ? '📐 ' : ''}
        {node.data.childrenCount}
      </span>
    </div>
  );
}

export default function ComponentsTab() {
  const snap = useStore((s) => s.snapshot);
  const setFocused = useStore((s) => s.setFocused);
  const componentFilter = useStore((s) => s.componentFilter);
  const setComponentFilter = useStore((s) => s.setComponentFilter);
  const significantOnly = useStore((s) => s.significantOnly);
  const setSignificantOnly = useStore((s) => s.setSignificantOnly);
  const subtreeRootId = useStore((s) => s.subtreeRootId);
  const setSubtreeRootId = useStore((s) => s.setSubtreeRootId);
  const [selected, setSelected] = useState<TreeRow | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const treeApiRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.max(100, r.width - 16), height: Math.max(100, r.height - 40) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fullRows = useMemo(() => (snap?.react ? toRows(snap.react.tree) : []), [snap]);

  const subtreeAnchor = subtreeRootId ? findById(fullRows, subtreeRootId) : null;
  const baseRows = subtreeAnchor?.children ?? fullRows;

  const prunedRows = useMemo(
    () => (significantOnly ? pruneToSignificant(baseRows) : baseRows),
    [baseRows, significantOnly],
  );
  const rows = useMemo(() => filterRows(prunedRows, componentFilter.trim()), [prunedRows, componentFilter]);

  // Open all branches when filter is active or "significant only" compressed the tree
  const openByDefault = componentFilter.trim().length > 0 || significantOnly;

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet.
      </div>
    );
  }
  if (!snap.react || fullRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No React fiber roots detected on this page.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-panel-border bg-panel-surface px-2 py-1.5 text-[11px]">
        <input
          type="text"
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          placeholder='Filter by name, tag, kind, or content (e.g. "submit", "section")…'
          className="min-w-[200px] flex-1 rounded border border-panel-border bg-black/30 px-2 py-0.5 text-panel-text focus:border-panel-accent focus:outline-none"
        />
        {componentFilter && (
          <button
            type="button"
            className="text-panel-muted hover:text-white"
            onClick={() => setComponentFilter('')}
          >
            clear
          </button>
        )}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={significantOnly}
            onChange={(e) => setSignificantOnly(e.target.checked)}
          />
          <span>Significant only</span>
        </label>
        <span className="text-panel-muted">
          {rows.length}/{fullRows.length} · {snap.react.rootCount} root(s)
        </span>
      </div>

      {subtreeAnchor && (
        <div className="flex items-center gap-2 border-b border-panel-border bg-panel-surface/60 px-2 py-1 text-[11px]">
          <button
            type="button"
            className="text-panel-accent hover:underline"
            onClick={() => setSubtreeRootId(null)}
          >
            ← Back to full tree
          </button>
          <span className="text-panel-muted">Subtree of</span>
          <span className="font-medium text-white">{subtreeAnchor.name}</span>
          {subtreeAnchor.tag && (
            <span className="rounded bg-emerald-900/40 px-1 text-[10px] text-emerald-300">
              {subtreeAnchor.tag}
            </span>
          )}
          {subtreeAnchor.hint && (
            <span className="truncate italic text-panel-text/70" title={subtreeAnchor.hint}>
              “{subtreeAnchor.hint}”
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="min-w-0 flex-1 p-2">
          <Tree<TreeRow>
            ref={treeApiRef}
            data={rows}
            openByDefault={openByDefault}
            rowHeight={22}
            width={size.width}
            height={size.height}
            indent={14}
            onSelect={(nodes: NodeApi<TreeRow>[]) => {
              const row = nodes[0]?.data ?? null;
              setSelected(row);
              if (row) {
                setFocused({
                  id: row.id,
                  name: row.name,
                  kind: row.kind,
                  tag: row.tag,
                  hint: row.hint,
                  bounds: row.bounds,
                });
              } else {
                setFocused(null);
              }
            }}
          >
            {NodeRow}
          </Tree>
        </div>
        <aside className="scrollbar-thin w-64 shrink-0 overflow-auto border-l border-panel-border bg-panel-surface p-3 text-xs">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Selection</div>
          {selected ? (
            <>
              <dl className="space-y-1">
                <div>
                  <dt className="text-[10px] text-panel-muted">Name</dt>
                  <dd className="font-medium text-white">{selected.name}</dd>
                </div>
                {selected.tag && (
                  <div>
                    <dt className="text-[10px] text-panel-muted">Host element</dt>
                    <dd className="font-mono text-emerald-300">&lt;{selected.tag}&gt;</dd>
                  </div>
                )}
                {selected.hint && (
                  <div>
                    <dt className="text-[10px] text-panel-muted">Content</dt>
                    <dd className="italic text-panel-text/80">“{selected.hint}”</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] text-panel-muted">Kind</dt>
                  <dd>{selected.kind}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Key</dt>
                  <dd>{selected.key ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Direct children</dt>
                  <dd>{selected.childrenCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Bounds (doc coords)</dt>
                  <dd className="font-mono text-[11px]">
                    {selected.bounds
                      ? `${selected.bounds.x},${selected.bounds.y} · ${selected.bounds.w}×${selected.bounds.h}`
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="mt-2 flex flex-col gap-1">
                <button
                  type="button"
                  className="rounded bg-panel-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
                  disabled={!selected.children || selected.children.length === 0}
                  onClick={() => setSubtreeRootId(selected.id)}
                >
                  Focus subtree →
                </button>
                {selected.bounds && (
                  <div className="text-[10px] text-emerald-300">
                    Live overlay shown on the page and on the snapshot.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-panel-muted">Click a node to inspect, highlight, or focus its subtree.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

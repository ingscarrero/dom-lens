import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { useStore } from '../store';
import type { ComponentNode } from '@/lib/react/fiberToTree';

interface TreeRow {
  id: string;
  name: string;
  kind: string;
  key?: string;
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
      childrenCount: n.childrenCount,
      hasBounds: !!n.bounds,
      bounds: n.bounds,
      children: n.children.length ? toRows(n.children, id) : undefined,
    };
  });
}

function filterRows(rows: TreeRow[], q: string): TreeRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  const out: TreeRow[] = [];
  for (const row of rows) {
    const matchesSelf = row.name.toLowerCase().includes(needle) || row.kind.toLowerCase().includes(needle);
    const filteredChildren = row.children ? filterRows(row.children, q) : undefined;
    if (matchesSelf || (filteredChildren && filteredChildren.length)) {
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
        'flex cursor-pointer items-center gap-1 px-1 text-xs ' +
        (node.isSelected ? 'bg-panel-accent/30 text-white' : 'hover:bg-white/5')
      }
      onClick={() => node.toggle()}
    >
      <span className="w-3 text-panel-muted">{node.isLeaf ? '·' : node.isOpen ? '▾' : '▸'}</span>
      <span className="font-medium">{node.data.name}</span>
      <span className="text-[10px] text-panel-muted">{node.data.kind}</span>
      {node.data.key && <span className="text-[10px] text-yellow-200">key={node.data.key}</span>}
      {node.data.hasBounds && <span className="text-[10px] text-emerald-400">📐</span>}
      <span className="ml-auto text-[10px] text-panel-muted">{node.data.childrenCount}</span>
    </div>
  );
}

export default function ComponentsTab() {
  const snap = useStore((s) => s.snapshot);
  const setFocused = useStore((s) => s.setFocused);
  const componentFilter = useStore((s) => s.componentFilter);
  const setComponentFilter = useStore((s) => s.setComponentFilter);
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
  const rows = useMemo(() => filterRows(fullRows, componentFilter.trim()), [fullRows, componentFilter]);

  // Open all matching branches when filter is non-empty
  const openByDefault = componentFilter.trim().length > 0;

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
      <div className="flex items-center gap-2 border-b border-panel-border bg-panel-surface px-2 py-1.5 text-[11px]">
        <input
          type="text"
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          placeholder="Filter by name or kind (e.g. Header, memo)…"
          className="flex-1 rounded border border-panel-border bg-black/30 px-2 py-0.5 text-panel-text focus:border-panel-accent focus:outline-none"
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
        <span className="text-panel-muted">
          {rows.length}/{fullRows.length} shown · {snap.react.rootCount} root(s)
        </span>
      </div>

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
        <aside className="w-64 shrink-0 border-l border-panel-border bg-panel-surface p-3 text-xs">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Selection</div>
          {selected ? (
            <dl className="space-y-1">
              <div>
                <dt className="text-[10px] text-panel-muted">Name</dt>
                <dd className="font-medium text-white">{selected.name}</dd>
              </div>
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
              {selected.bounds && (
                <div className="mt-1 text-[10px] text-emerald-300">
                  Live overlay shown on the page and on the snapshot screenshot.
                </div>
              )}
            </dl>
          ) : (
            <div className="text-panel-muted">Click a node to inspect & highlight.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

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
      children: n.children.length ? toRows(n.children, id) : undefined,
    };
  });
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
      <span className="w-3 text-panel-muted">
        {node.isLeaf ? '·' : node.isOpen ? '▾' : '▸'}
      </span>
      <span className="font-medium">{node.data.name}</span>
      <span className="text-[10px] text-panel-muted">{node.data.kind}</span>
      {node.data.key && <span className="text-[10px] text-yellow-200">key={node.data.key}</span>}
      <span className="ml-auto text-[10px] text-panel-muted">{node.data.childrenCount}</span>
    </div>
  );
}

export default function ComponentsTab() {
  const snap = useStore((s) => s.snapshot);
  const [selected, setSelected] = useState<TreeRow | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });

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

  const rows = useMemo(() => (snap?.react ? toRows(snap.react.tree) : []), [snap]);

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet.
      </div>
    );
  }
  if (!snap.react || rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No React fiber roots detected on this page.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div ref={containerRef} className="min-w-0 flex-1 p-2">
        <div className="mb-2 text-[10px] uppercase text-panel-muted">
          {snap.react.rootCount} root(s) · {rows.length} top-level node(s)
        </div>
        <Tree<TreeRow>
          data={rows}
          openByDefault={false}
          rowHeight={22}
          width={size.width}
          height={size.height}
          indent={14}
          onSelect={(nodes: NodeApi<TreeRow>[]) => setSelected(nodes[0]?.data ?? null)}
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
          </dl>
        ) : (
          <div className="text-panel-muted">Click a node to inspect.</div>
        )}
      </aside>
    </div>
  );
}

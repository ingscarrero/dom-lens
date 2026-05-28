import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store';

export default function FederationTab() {
  const snap = useStore((s) => s.snapshot);

  const { nodes, edges } = useMemo(() => {
    if (!snap?.federation) return { nodes: [], edges: [] } as { nodes: Node[]; edges: Edge[] };
    const fed = snap.federation;
    const ns: Node[] = [
      {
        id: 'host',
        position: { x: 50, y: 200 },
        data: {
          label: (
            <div className="text-center">
              <div className="font-semibold">{fed.host.name}</div>
              <div className="text-[10px] text-gray-200">host · {fed.kind}</div>
              {fed.host.shared.length > 0 && (
                <div className="text-[10px] text-gray-300">
                  shared: {fed.host.shared.slice(0, 3).join(', ')}
                  {fed.host.shared.length > 3 ? ` +${fed.host.shared.length - 3}` : ''}
                </div>
              )}
            </div>
          ),
        },
        style: {
          background: '#0ea5e9',
          color: 'white',
          border: '1px solid #38bdf8',
          width: 200,
          padding: 8,
        },
      },
    ];
    const es: Edge[] = [];
    fed.remotes.forEach((r, i) => {
      const id = `remote-${i}`;
      ns.push({
        id,
        position: { x: 360, y: 60 + i * 100 },
        data: {
          label: (
            <div>
              <div className="font-semibold">{r.name}</div>
              <div className="truncate text-[10px] text-gray-300" title={r.entry}>
                {r.entry}
              </div>
              {r.exposes.length > 0 && (
                <div className="text-[10px] text-gray-300">
                  exposes: {r.exposes.slice(0, 3).join(', ')}
                  {r.exposes.length > 3 ? ` +${r.exposes.length - 3}` : ''}
                </div>
              )}
              <div className="text-[10px]">{r.loaded ? '🟢 loaded' : '⚪ pending'}</div>
            </div>
          ),
        },
        style: {
          background: '#1f2937',
          color: 'white',
          border: r.loaded ? '1px solid #10b981' : '1px solid #6b7280',
          width: 220,
          padding: 6,
        },
      });
      es.push({
        id: `e-host-${id}`,
        source: 'host',
        target: id,
        label: r.exposes[0],
        animated: r.loaded,
        style: { stroke: r.loaded ? '#10b981' : '#6b7280' },
      });
    });
    return { nodes: ns, edges: es };
  }, [snap]);

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet.
      </div>
    );
  }
  if (!snap.federation) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No Module Federation detected on this page.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background gap={16} />
          <Controls />
        </ReactFlow>
      </div>
      <aside className="scrollbar-thin w-72 shrink-0 overflow-auto border-l border-panel-border bg-panel-surface p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase text-panel-muted">Detection</div>
        <div className="mb-1 font-medium text-white">{snap.federation.kind}</div>
        <div className="mb-3 text-panel-muted">{snap.federation.signals.join(', ') || 'no signals'}</div>

        <div className="mb-2 text-[10px] uppercase text-panel-muted">
          Remotes ({snap.federation.remotes.length})
        </div>
        <ul className="space-y-2">
          {snap.federation.remotes.map((r) => (
            <li key={r.name} className="rounded border border-panel-border p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">{r.name}</span>
                <span className={r.loaded ? 'text-emerald-400' : 'text-panel-muted'}>
                  {r.loaded ? 'loaded' : 'pending'}
                </span>
              </div>
              <div className="truncate text-[10px] text-panel-muted" title={r.entry}>
                {r.entry}
              </div>
              {r.exposes.length > 0 && (
                <div className="mt-1 text-[10px]">
                  <span className="text-panel-muted">exposes:</span> {r.exposes.join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

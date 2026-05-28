import { useState } from 'react';
import { useStore } from '../store';

export default function SnapshotTab() {
  const snap = useStore((s) => s.snapshot);
  const [showJson, setShowJson] = useState(false);

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet. Click <span className="mx-1 font-semibold text-panel-text">Capture snapshot</span> to start.
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3 text-xs">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Page</div>
          <div className="truncate font-medium text-white">{snap.title || '(no title)'}</div>
          <div className="truncate text-panel-muted">{snap.url}</div>
        </div>
        <div className="rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Captured</div>
          <div>{new Date(snap.capturedAt).toLocaleString()}</div>
          <div className="text-panel-muted">
            {snap.viewport.width}×{snap.viewport.height} · {snap.dom.charCount.toLocaleString()} md chars ·{' '}
            {snap.network.length} net · {snap.console.length} console
          </div>
        </div>
      </div>

      {snap.screenshot && (
        <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Screenshot (visible viewport)</div>
          <img
            src={snap.screenshot.dataUrl}
            alt="page screenshot"
            className="max-h-64 w-auto rounded border border-panel-border"
          />
        </div>
      )}

      <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] uppercase text-panel-muted">DOM markdown</div>
          <span className="text-[10px] text-panel-muted">{snap.dom.charCount.toLocaleString()} chars</span>
        </div>
        <pre className="scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] leading-snug">
{snap.dom.markdown}
        </pre>
      </div>

      {snap.console.length > 0 && (
        <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Console ({snap.console.length})</div>
          <div className="scrollbar-thin max-h-40 overflow-auto font-mono text-[11px]">
            {snap.console.map((c, i) => (
              <div
                key={i}
                className={
                  'border-b border-panel-border/50 py-0.5 ' +
                  (c.level === 'error'
                    ? 'text-red-300'
                    : c.level === 'warn'
                      ? 'text-yellow-200'
                      : 'text-panel-text')
                }
              >
                <span className="mr-2 text-[10px] uppercase text-panel-muted">{c.level}</span>
                {c.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-panel-border bg-panel-surface p-2">
        <button
          type="button"
          className="text-[11px] text-panel-accent hover:underline"
          onClick={() => setShowJson((v) => !v)}
        >
          {showJson ? '− Hide raw JSON' : '+ Show raw JSON'}
        </button>
        {showJson && (
          <pre className="scrollbar-thin mt-2 max-h-80 overflow-auto whitespace-pre rounded bg-black/30 p-2 font-mono text-[10px]">
{JSON.stringify(snap, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

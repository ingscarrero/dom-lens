import { useMemo, useState } from 'react';
import JsonView from '@uiw/react-json-view';
import { vscodeTheme } from '@uiw/react-json-view/vscode';

interface Props {
  value: unknown;
  /** Maximum height of the container. */
  maxHeight?: number;
  /** Initial collapse depth in tree mode (0 = collapse root). */
  collapsed?: number;
  /** Filter keys whose values should be elided (e.g. base64 dataURLs). */
  elideKeys?: string[];
  className?: string;
}

function elide(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => elide(v, keys));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k) && typeof v === 'string' && v.length > 200) {
        out[k] = `[${v.length.toLocaleString()} chars elided]`;
      } else {
        out[k] = elide(v, keys);
      }
    }
    return out;
  }
  return value;
}

export function JsonViewer({
  value,
  maxHeight = 400,
  collapsed = 1,
  elideKeys,
  className,
}: Props) {
  const [mode, setMode] = useState<'tree' | 'text'>('tree');
  const elided = useMemo(() => {
    if (!elideKeys || elideKeys.length === 0) return value;
    return elide(value, new Set(elideKeys));
  }, [value, elideKeys]);

  const text = useMemo(() => JSON.stringify(elided, null, 2), [elided]);

  return (
    <div className={'rounded border border-panel-border bg-black/30 ' + (className ?? '')}>
      <div className="flex items-center justify-between border-b border-panel-border bg-panel-surface px-2 py-0.5">
        <div className="text-[10px] uppercase text-panel-muted">JSON</div>
        <div className="flex items-center gap-0 text-[11px]">
          <button
            type="button"
            className={
              'rounded-t px-2 py-0.5 ' +
              (mode === 'tree' ? 'bg-black/30 text-white' : 'text-panel-muted hover:text-white')
            }
            onClick={() => setMode('tree')}
          >
            Tree
          </button>
          <button
            type="button"
            className={
              'rounded-t px-2 py-0.5 ' +
              (mode === 'text' ? 'bg-black/30 text-white' : 'text-panel-muted hover:text-white')
            }
            onClick={() => setMode('text')}
          >
            Text
          </button>
        </div>
      </div>
      <div
        className="scrollbar-thin overflow-auto p-2"
        style={{ maxHeight }}
      >
        {mode === 'tree' ? (
          <JsonView
            value={elided as object}
            collapsed={collapsed}
            displayDataTypes={false}
            displayObjectSize={true}
            enableClipboard={true}
            style={{
              ...vscodeTheme,
              backgroundColor: 'transparent',
              fontSize: '11px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          />
        ) : (
          <pre className="whitespace-pre font-mono text-[11px] leading-snug">{text}</pre>
        )}
      </div>
    </div>
  );
}

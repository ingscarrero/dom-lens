import { useEffect, useRef, useState } from 'react';
import { renderMermaid, diagramId } from '@/lib/diagrams/mermaid';

interface Props {
  source: string;
  /** Optional title rendered above the SVG. */
  title?: string;
  /** When true, render only the source — useful for the Write tab of the editor. */
  raw?: boolean;
}

/**
 * Auto-renders a Mermaid diagram. Falls back to a code block + error notice
 * when the source fails to parse. Render is deferred to `useEffect` so the
 * static SSR shell ships first and we don't block paint on Mermaid's worker.
 */
export function MermaidBlock({ source, title, raw }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const id = diagramId(source);

  useEffect(() => {
    if (raw) return;
    let cancelled = false;
    setError(null);
    setSvg(null);
    renderMermaid(source, id)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source, id, raw]);

  if (raw) {
    return (
      <pre className="overflow-x-auto rounded bg-slate-900/60 p-3 text-xs">
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <figure className="my-3 rounded border border-panel-border bg-slate-900/40 p-3">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold text-panel-muted">
          {title}
        </figcaption>
      )}
      {error ? (
        <div className="space-y-2">
          <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
            Mermaid error: {error}
          </div>
          <pre className="overflow-x-auto rounded bg-slate-900/60 p-2 text-[11px]">
            <code>{source}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          ref={containerRef}
          className="overflow-auto"
          // Mermaid emits sanitized SVG (securityLevel: 'strict' in init).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-xs text-panel-muted">Rendering diagram…</div>
      )}
    </figure>
  );
}

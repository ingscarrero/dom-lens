import { useEffect, useMemo, useState } from 'react';
import { normalizeArtifactSource } from '@/lib/artifacts/extractArtifacts';
import { useLlm } from '@/lib/lm-studio/LlmContext';
import { useStore } from '@/entrypoints/panel/store';
import { buildArtifactRefinePayload, extractFenced } from './healPrompts';

interface Props {
  source: string;
  title?: string;
  /** While the parent reply is still streaming we hide the iframe and show
   * a placeholder — re-rendering an incomplete document on every delta
   * causes a flash of broken pages. */
  streaming?: boolean;
}

/**
 * Renders an LLM-emitted HTML artifact inside a sandboxed iframe. Same
 * design pattern as Claude / Cursor / V0's artifact panes:
 *
 *   - `sandbox="allow-scripts"` only. NOT allow-same-origin — the iframe
 *     runs in a null origin and can't read this extension's chrome.*
 *     APIs, storage, or DOM (per MDN's iframe sandbox spec).
 *   - `srcdoc=` to inline the HTML directly, no separate URL. Honoured
 *     by all modern browsers and survives strict CSP.
 *   - A View source / Rendered toggle lets the user inspect the HTML.
 *   - Download button saves the artifact as .html.
 *   - The iframe is vertically resizable; the user can drag the bottom
 *     edge if the artifact needs more room.
 *
 * Security: we trust nothing in `source` — by sandboxing we contain
 * arbitrary JavaScript. The iframe can't navigate the parent, open
 * popups, submit forms, run plugins, or share its origin's storage
 * (sandbox blocks all of those by default; we only re-add allow-scripts).
 */
export function ArtifactBlock({ source: incomingSource, title, streaming }: Props) {
  const [view, setView] = useState<'rendered' | 'source'>('rendered');
  const [height, setHeight] = useState(420);
  /** Locally-refined version of the artifact, kept in component state so
   * the iframe re-renders the new HTML without round-tripping through
   * the parent. Reset whenever the parent passes a different source. */
  const [refined, setRefined] = useState<string | null>(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineHint, setRefineHint] = useState('');
  const [refineState, setRefineState] = useState<
    { phase: 'streaming'; text: string } | { phase: 'error'; message: string } | null
  >(null);
  const llm = useLlm();
  const settings = useStore((s) => s.settings);

  const source = refined ?? incomingSource;
  useEffect(() => {
    setRefined(null);
    setRefineState(null);
    setShowRefine(false);
    setRefineHint('');
  }, [incomingSource]);

  const canRefine = !!llm && !!settings.baseUrl && !!settings.model && !streaming;
  const isRefining = refineState?.phase === 'streaming';

  const runRefine = () => {
    if (!llm) return;
    const payload = buildArtifactRefinePayload(source, refineHint, settings);
    setRefineState({ phase: 'streaming', text: '' });
    let acc = '';
    const handle = llm(payload, (delta) => {
      acc += delta;
      setRefineState({ phase: 'streaming', text: acc });
    });
    handle.result
      .then((full) => {
        const fenced = extractFenced(full, 'html');
        if (!fenced) {
          setRefineState({
            phase: 'error',
            message: 'Model reply did not include a ```html block.',
          });
          return;
        }
        setRefined(fenced);
        setRefineState(null);
        setShowRefine(false);
        setRefineHint('');
      })
      .catch((e) =>
        setRefineState({
          phase: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  };

  const normalized = useMemo(() => normalizeArtifactSource(source), [source]);

  const downloadUrl = useMemo(() => {
    try {
      const blob = new Blob([normalized], { type: 'text/html' });
      return URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  }, [normalized]);

  return (
    <figure className="my-3 rounded border border-panel-border bg-slate-900/40">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-panel-border px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-200">
            Artifact
          </span>
          <span className="font-semibold text-white">{title ?? 'HTML artifact'}</span>
          {streaming && (
            <span className="text-[10px] text-panel-muted">· receiving…</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => setView(view === 'rendered' ? 'source' : 'rendered')}
            className="rounded border border-panel-border px-1.5 py-0.5 text-panel-muted hover:text-white"
          >
            {view === 'rendered' ? '📝 Source' : '👁 Rendered'}
          </button>
          {downloadUrl && !streaming && (
            <a
              href={downloadUrl}
              download="dom-lens-artifact.html"
              className="rounded border border-panel-border px-1.5 py-0.5 text-panel-muted hover:text-white"
            >
              ⬇ HTML
            </a>
          )}
          {downloadUrl && !streaming && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-panel-border px-1.5 py-0.5 text-panel-muted hover:text-white"
            >
              ⤴ Open
            </a>
          )}
          {canRefine && (
            <button
              type="button"
              onClick={() => setShowRefine((v) => !v)}
              disabled={isRefining}
              className={
                'rounded border px-1.5 py-0.5 text-[10px] ' +
                (showRefine
                  ? 'border-panel-accent/60 bg-panel-accent/20 text-white'
                  : 'border-panel-accent/40 bg-panel-accent/10 text-panel-accent hover:bg-panel-accent/20')
              }
              title="Send the current artifact + an optional hint back to the LLM for a refined version"
            >
              {isRefining ? 'Refining…' : refined ? '✨ Refine again' : '✨ Refine'}
            </button>
          )}
        </div>
      </figcaption>
      {showRefine && (
        <div className="border-t border-panel-border bg-black/30 px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
            What should change? (optional — leave blank to fix obvious issues)
          </div>
          <textarea
            className="block w-full rounded border border-panel-border bg-black/40 p-1.5 text-[11px] text-panel-text"
            rows={2}
            placeholder="e.g. add a search input, fix overlapping cards, use a dark green palette"
            value={refineHint}
            onChange={(e) => setRefineHint(e.target.value)}
            disabled={isRefining}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-panel-muted">
              {isRefining
                ? `Streaming… ${refineState?.text.length ?? 0} chars`
                : 'Will preserve the artifact\'s intent and re-apply ARTIFACT_RULES.'}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setShowRefine(false);
                  setRefineHint('');
                }}
                disabled={isRefining}
                className="rounded border border-panel-border px-2 py-0.5 text-[10px] text-panel-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runRefine}
                disabled={isRefining}
                className="rounded bg-panel-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refine
              </button>
            </div>
          </div>
          {refineState?.phase === 'error' && (
            <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
              Refine failed: {refineState.message}
            </div>
          )}
        </div>
      )}

      {streaming ? (
        <div className="px-3 py-6 text-center text-xs text-panel-muted">
          Receiving HTML artifact…
        </div>
      ) : view === 'rendered' ? (
        <div
          className="overflow-hidden bg-slate-950"
          style={{ height: `${height}px`, resize: 'vertical' as const }}
          ref={(el) => {
            // Track height changes from the CSS resize handle. ResizeObserver
            // syncs the React state so other UI (e.g. focus/highlight
            // overlays inside the same row) stay correct.
            if (!el) return;
            const ro = new ResizeObserver((entries) => {
              for (const e of entries) {
                if (Math.abs(e.contentRect.height - height) > 4) {
                  setHeight(Math.round(e.contentRect.height));
                }
              }
            });
            ro.observe(el);
          }}
        >
          <iframe
            // null-origin sandbox: scripts run but no access to parent,
            // no cookies, no localStorage, no popups, no form submits.
            // Per MDN: omitting allow-same-origin keeps the iframe in
            // a unique origin distinct from the parent extension.
            sandbox="allow-scripts"
            srcDoc={normalized}
            title={title ?? 'HTML artifact'}
            className="block h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
        <pre className="scrollbar-thin max-h-96 overflow-auto bg-black/60 p-3 font-mono text-[11px] leading-snug text-panel-text">
          <code>{normalized}</code>
        </pre>
      )}
    </figure>
  );
}

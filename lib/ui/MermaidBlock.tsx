import { useEffect, useRef, useState } from 'react';
import { renderMermaid, diagramId } from '@/lib/diagrams/mermaid';
import { useLlm } from '@/lib/lm-studio/LlmContext';
import { useStore } from '@/entrypoints/panel/store';
import { buildMermaidHealPayload, extractFenced } from './healPrompts';

interface Props {
  source: string;
  /** Optional title rendered above the SVG. */
  title?: string;
  /** When true, render only the source — useful for the Write tab of the editor. */
  raw?: boolean;
  /** Debounce window in ms. Defaults to 400 to avoid re-rendering on every
   * delta during streaming. Set to 0 to render immediately. */
  debounceMs?: number;
  /** When true, the parent reply is still streaming from the LLM and the
   * source may continue to grow. While set, we don't attempt to parse the
   * diagram — partial Mermaid sources always fail to lex and we don't want
   * to scare the user with intermediate "Mermaid error: …" boxes. */
  streaming?: boolean;
}

/**
 * Auto-renders a Mermaid diagram. Designed to be flicker-free while the LLM
 * is streaming partial content:
 *
 * 1. The source is debounced — re-renders don't fire on every keystroke.
 * 2. While a new render is in flight, the previous SVG stays visible. The
 *    new SVG only replaces the old one once it has resolved.
 * 3. Obviously incomplete source (no terminating newline, dangling fence) is
 *    skipped so we don't fail-render mid-token.
 *
 * Falls back to a code block + error message when the final source still
 * doesn't parse.
 */
export function MermaidBlock({ source: incomingSource, title, raw, debounceMs = 400, streaming }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const renderTokenRef = useRef(0);
  /** When the user clicks "Heal with AI" and the LLM returns a fixed
   * diagram, we keep it here as a local override so the block re-renders
   * the healed version instead of the (broken) prop source. Reset when
   * the parent passes a different source. */
  const [healed, setHealed] = useState<string | null>(null);
  /** Heal call state — null when idle, otherwise streaming or error. */
  const [healState, setHealState] = useState<
    { phase: 'streaming'; text: string } | { phase: 'error'; message: string } | null
  >(null);
  const llm = useLlm();
  const settings = useStore((s) => s.settings);

  const source = healed ?? incomingSource;
  useEffect(() => {
    // Parent gave us a brand new diagram — drop any locally-healed copy.
    setHealed(null);
    setHealState(null);
  }, [incomingSource]);

  // Debounce the source so rapid streaming deltas don't trigger a render
  // storm. While the debounce is in flight the previously rendered SVG
  // stays on screen — no flash to empty.
  const [debouncedSource, setDebouncedSource] = useState(source);
  useEffect(() => {
    if (raw) return;
    if (debounceMs <= 0) {
      setDebouncedSource(source);
      return;
    }
    const t = setTimeout(() => setDebouncedSource(source), debounceMs);
    return () => clearTimeout(t);
  }, [source, debounceMs, raw]);

  useEffect(() => {
    if (raw) return;
    // Don't even attempt to parse while the parent reply is streaming.
    // Partial Mermaid sources lex-fail with noisy errors that scare users —
    // wait for streaming to finish before triggering a render.
    if (streaming) {
      if (svg === null) setPending(true);
      return;
    }
    if (!debouncedSource || !looksComplete(debouncedSource)) {
      // Partial / mid-stream source. Keep the previous SVG visible and wait.
      if (svg === null) setPending(true);
      return;
    }
    // Bump the token so any in-flight render that resolves after this one
    // gets discarded — last write wins.
    renderTokenRef.current += 1;
    const myToken = renderTokenRef.current;
    setPending(true);
    setError(null);
    const id = diagramId(debouncedSource);
    renderMermaid(debouncedSource, id)
      .then(({ svg }) => {
        if (myToken !== renderTokenRef.current) return;
        setSvg(svg);
        setPending(false);
      })
      .catch((e: unknown) => {
        if (myToken !== renderTokenRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPending(false);
      });
    // No cleanup needed beyond the token bump — we deliberately don't
    // clear `svg` here so the user keeps seeing the previous diagram while
    // the new one renders.
  }, [debouncedSource, raw, streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const canHeal = !!llm && !!settings.baseUrl && !!settings.model && !!error && !raw;

  const heal = () => {
    if (!llm || !error) return;
    const payload = buildMermaidHealPayload(source, error, settings);
    setHealState({ phase: 'streaming', text: '' });
    let acc = '';
    const handle = llm(payload, (delta) => {
      acc += delta;
      setHealState({ phase: 'streaming', text: acc });
    });
    handle.result
      .then((full) => {
        const fenced = extractFenced(full, 'mermaid');
        if (!fenced) {
          setHealState({
            phase: 'error',
            message: 'Model reply did not include a ```mermaid block.',
          });
          return;
        }
        setHealed(fenced);
        setHealState(null);
      })
      .catch((e) =>
        setHealState({
          phase: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  };

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
        <figcaption className="mb-2 flex items-center justify-between text-xs font-semibold text-panel-muted">
          <span>{title}</span>
          {pending && svg && (
            <span className="text-[10px] font-normal text-panel-muted/70">updating…</span>
          )}
        </figcaption>
      )}
      {error && !svg ? (
        <ErrorBox
          error={error}
          source={source}
          canHeal={canHeal}
          onHeal={heal}
          healState={healState}
        />
      ) : svg ? (
        <div
          className="overflow-auto"
          // Mermaid emits sanitized SVG (securityLevel: 'strict' in init).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-xs text-panel-muted">
          {streaming
            ? 'Receiving diagram tokens…'
            : pending
              ? 'Rendering diagram…'
              : 'Waiting for diagram source…'}
        </div>
      )}
      {error && svg && (
        <div className="mt-2 text-[10px] text-amber-300/80">
          Latest update failed to parse — showing previous render. ({error})
        </div>
      )}
    </figure>
  );
}

function ErrorBox({
  error,
  source,
  canHeal,
  onHeal,
  healState,
}: {
  error: string;
  source: string;
  canHeal: boolean;
  onHeal: () => void;
  healState:
    | { phase: 'streaming'; text: string }
    | { phase: 'error'; message: string }
    | null;
}) {
  const isHealing = healState?.phase === 'streaming';
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
        <div className="min-w-0 flex-1">
          <span className="font-semibold">Mermaid error:</span> {error}
        </div>
        {canHeal && (
          <button
            type="button"
            onClick={onHeal}
            disabled={isHealing}
            className="shrink-0 rounded border border-panel-accent/60 bg-panel-accent/15 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
            title="Send the broken source + parser error back to the LLM for a fix"
          >
            {isHealing ? 'Healing…' : '✨ Heal with AI'}
          </button>
        )}
      </div>
      {healState?.phase === 'error' && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          Heal failed: {healState.message}
        </div>
      )}
      {isHealing && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 px-2 py-1 text-[10px] text-sky-200">
          <div className="mb-0.5 uppercase tracking-wide text-sky-300/80">
            Asking model… {healState.text.length} chars received
          </div>
          <div className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-sky-100/80">
            {healState.text.slice(-300) || '…'}
          </div>
        </div>
      )}
      <pre className="overflow-x-auto rounded bg-slate-900/60 p-2 text-[11px]">
        <code>{source}</code>
      </pre>
    </div>
  );
}

/**
 * Heuristic check for a complete Mermaid source. During streaming the
 * trailing chars often arrive mid-token — re-rendering on every delta
 * causes flicker AND wastes work since the parse will fail. Skip if:
 *
 *   - empty
 *   - unbalanced quotes
 *   - the last non-blank line looks unterminated (ends mid-identifier)
 *
 * These checks are deliberately loose — false positives just delay one
 * render cycle; false negatives merely produce a parse error which we
 * already handle.
 */
function looksComplete(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  // Balanced quote pairs (rough — strings inside Mermaid are usually `"..."`).
  const doubleQuotes = (trimmed.match(/"/g) ?? []).length;
  if (doubleQuotes % 2 !== 0) return false;
  // Last line should look like a complete statement: ends with a paren,
  // bracket, quote, or simple identifier — not a lone open bracket or
  // trailing arrow.
  const lastLine = trimmed.split(/\r?\n/).filter((l) => l.trim()).pop() ?? '';
  if (/(--?>|==>|-->\|?|\(|\[|\{|<-?-)$/.test(lastLine.trim())) return false;
  return true;
}

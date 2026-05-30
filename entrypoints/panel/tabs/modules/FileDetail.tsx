import { useState } from 'react';
import { useStore } from '../../store';
import type { ModuleTreeNode } from '@/lib/modules/moduleTree';
import {
  buildFileAnalysisPayload,
  actionLabel,
  actionHint,
  detectLanguage,
  type FileAction,
} from '@/lib/modules/analyzeFile';
import type { StreamingOneshot } from '@/lib/lm-studio/streamingProxy';
import { MarkdownRenderer } from '@/lib/ui/MarkdownRenderer';
import { formatBytes } from '@/lib/modules/sourcemap';

interface Props {
  node: ModuleTreeNode;
  streamingOneshot: StreamingOneshot;
}

/**
 * Right pane of the Sources-style Modules tab. Shows the original source
 * code for the selected `source-file` node (from the sourcemap's
 * `sourcesContent` array — no extra fetch needed) plus three AI action
 * buttons that stream a focused analysis into the panel below.
 *
 * Actions: Audit (security/correctness/a11y), Improve (refactor
 * opportunities), Explain (purpose/API/inputs/outputs). All powered by
 * the existing streaming-oneshot pipeline so the user sees progress
 * token-by-token.
 */
export function FileDetail({ node, streamingOneshot }: Props) {
  const settings = useStore((s) => s.settings);
  const [active, setActive] = useState<FileAction | null>(null);
  const [result, setResult] = useState<{
    action: FileAction;
    text: string;
    state: 'streaming' | 'done' | 'error';
    error?: string;
  } | null>(null);

  const sourceContent = node.sourceContent ?? null;
  const language = detectLanguage(node.sourcePath ?? node.name);
  const hasSource = typeof sourceContent === 'string' && sourceContent.length > 0;
  const llmConfigured = !!settings.baseUrl && !!settings.model;

  const runAction = (action: FileAction) => {
    if (!sourceContent || !llmConfigured) return;
    setActive(action);
    setResult({ action, text: '', state: 'streaming' });
    const payload = buildFileAnalysisPayload(
      action,
      sourceContent,
      node.sourcePath ?? node.name,
      settings,
    );
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setResult({ action, text: acc, state: 'streaming' });
    });
    handle.result
      .then((full) => {
        setResult({ action, text: full, state: 'done' });
        setActive(null);
      })
      .catch((e) => {
        setResult({
          action,
          text: acc,
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        setActive(null);
      });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px] text-white">
              {node.name}
            </div>
            <div className="truncate text-[10px] text-panel-muted">
              {node.sourcePath ?? node.id}
            </div>
          </div>
          <div className="shrink-0 text-[10px] text-panel-muted">
            {node.bytes != null ? formatBytes(node.bytes) : ''} · {language}
          </div>
        </div>
        {hasSource && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(['audit', 'improve', 'explain'] as FileAction[]).map((a) => (
              <button
                key={a}
                type="button"
                disabled={!llmConfigured || active !== null}
                onClick={() => runAction(a)}
                title={actionHint(a)}
                className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
              >
                {active === a ? '…' : actionLabel(a)}
              </button>
            ))}
            {!llmConfigured && (
              <span className="text-[10px] text-panel-muted">
                Configure a local LLM in Settings to enable.
              </span>
            )}
          </div>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto]">
        <pre
          className="scrollbar-thin m-0 overflow-auto bg-black/30 p-2 font-mono text-[11px] leading-snug text-panel-text"
        >
          <code>
            {hasSource
              ? sourceContent
              : '/* No source content embedded in the sourcemap.\n' +
                ' * The bundler likely used `nosources-source-map` or stripped sourcesContent\n' +
                ' * for this file. Try fetching the deployed bundle instead. */'}
          </code>
        </pre>

        {result && (
          <div
            className={
              'max-h-[40%] overflow-auto border-t p-2 text-[11px] ' +
              (result.state === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-panel-border bg-panel-bg/40 text-panel-text')
            }
          >
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-panel-muted">
              <span>{actionLabel(result.action)} result</span>
              {result.state === 'streaming' && <span>streaming…</span>}
              {result.state === 'done' && <span>done</span>}
            </div>
            {result.text ? (
              <MarkdownRenderer source={result.text} compact />
            ) : (
              <div className="text-panel-muted">
                {result.state === 'streaming' ? 'Asking model…' : ''}
              </div>
            )}
            {result.state === 'error' && result.error && (
              <div className="mt-1 text-[10px]">{result.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
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
import { CodeViewer } from '@/lib/ui/CodeViewer';
import { formatBytes } from '@/lib/modules/sourcemap';
import {
  findMappingForModule,
  resolveGithubFileUrl,
  type GithubMapping,
} from '@/lib/modules/githubMapping';

interface Props {
  node: ModuleTreeNode;
  streamingOneshot: StreamingOneshot;
  /** URL of the deployed module the file lives under. Drives GitHub
   * mapping resolution (we need the bundle URL to match against
   * `urlPattern` — the source path alone is not enough). */
  parentModuleUrl?: string;
  /** Panel-side fetch proxy for grabbing raw.githubusercontent.com
   * content when the user picks the GitHub source mode (or when
   * `sourcesContent` is null and a mapping resolves). */
  fetchText?: (url: string) => Promise<string>;
}

type SourceMode = 'sourcemap' | 'github';

interface GithubFetchState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  text?: string;
  message?: string;
  url?: string;
}

function useGithubLink(
  parentModuleUrl: string | undefined,
  sourcePath: string | undefined,
  mappings: readonly GithubMapping[],
): { webUrl: string; rawUrl: string; mapping: GithubMapping; branch: string } | null {
  if (!parentModuleUrl || !sourcePath) return null;
  const mapping = findMappingForModule(parentModuleUrl, mappings);
  if (!mapping) return null;
  // Pass parentModuleUrl so {version} placeholders in the branch get
  // substituted (e.g. CDN paths like /v1.2.3/main.js → tag v1.2.3).
  const urls = resolveGithubFileUrl(sourcePath, mapping, parentModuleUrl);
  if (!urls) return null;
  return { webUrl: urls.webUrl, rawUrl: urls.rawUrl, mapping, branch: urls.branch };
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
export function FileDetail({
  node,
  streamingOneshot,
  parentModuleUrl,
  fetchText,
}: Props) {
  const settings = useStore((s) => s.settings);
  const githubLink = useGithubLink(parentModuleUrl, node.sourcePath, settings.githubMappings ?? []);

  const localContent = node.sourceContent ?? null;
  const hasLocalSource = typeof localContent === 'string' && localContent.length > 0;
  const canGithub = !!githubLink && !!fetchText;

  // Default to GitHub when (a) the user has a mapping AND (b) there's no
  // embedded sourcesContent. That's the genuine production case
  // (`nosources-source-map` builds); without the auto-default the user
  // would land on a "no content embedded" placeholder.
  const [mode, setMode] = useState<SourceMode>(
    canGithub && !hasLocalSource ? 'github' : 'sourcemap',
  );

  // Reset mode whenever the node changes so a new selection starts in
  // the right default. Same auto-default rule.
  useEffect(() => {
    setMode(canGithub && !hasLocalSource ? 'github' : 'sourcemap');
  }, [node.id, canGithub, hasLocalSource]);

  // Lazy GitHub fetch — cached per request URL.
  const [ghState, setGhState] = useState<GithubFetchState>({ status: 'idle' });

  useEffect(() => {
    if (mode !== 'github') return;
    if (!githubLink || !fetchText) return;
    // Already loaded this URL? skip.
    if (ghState.status === 'ok' && ghState.url === githubLink.rawUrl) return;
    let cancelled = false;
    setGhState({ status: 'loading', url: githubLink.rawUrl });
    fetchText(githubLink.rawUrl)
      .then((text) => {
        if (cancelled) return;
        setGhState({ status: 'ok', text, url: githubLink.rawUrl });
      })
      .catch((e) => {
        if (cancelled) return;
        setGhState({
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
          url: githubLink.rawUrl,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, githubLink?.rawUrl, fetchText]); // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState<FileAction | null>(null);
  const [result, setResult] = useState<{
    action: FileAction;
    text: string;
    state: 'streaming' | 'done' | 'error';
    error?: string;
  } | null>(null);

  // Pick which content to render + run analyses against.
  const activeContent =
    mode === 'github' && ghState.status === 'ok' && ghState.text !== undefined
      ? ghState.text
      : localContent;
  const sourceContent = activeContent;
  const language = detectLanguage(node.sourcePath ?? node.name);
  const hasSource = typeof activeContent === 'string' && activeContent.length > 0;
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
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-panel-muted">
            {node.bytes != null && <span>{formatBytes(node.bytes)}</span>}
            <span>{language}</span>
            {githubLink && (
              <a
                href={githubLink.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`View on GitHub · ${githubLink.mapping.label}`}
                className="rounded border border-panel-accent/40 bg-panel-accent/10 px-1.5 py-0.5 text-[10px] text-panel-accent hover:bg-panel-accent/20"
              >
                🐙 GitHub
              </a>
            )}
          </div>
        </div>
        {canGithub && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-panel-muted">Source:</span>
            <div className="flex rounded border border-panel-border bg-black/30 text-[10px]">
              <button
                type="button"
                onClick={() => setMode('sourcemap')}
                disabled={!hasLocalSource}
                title={
                  hasLocalSource
                    ? 'Render the file from the sourcemap\'s embedded sourcesContent'
                    : 'No content embedded in the sourcemap for this file (likely a nosources-source-map build)'
                }
                className={
                  'px-2 py-0.5 ' +
                  (mode === 'sourcemap'
                    ? 'bg-panel-accent/30 text-white'
                    : 'text-panel-muted hover:text-white disabled:opacity-40')
                }
              >
                📦 Sourcemap
              </button>
              <button
                type="button"
                onClick={() => setMode('github')}
                title={`Fetch from ${githubLink?.rawUrl ?? 'GitHub'}`}
                className={
                  'px-2 py-0.5 ' +
                  (mode === 'github'
                    ? 'bg-panel-accent/30 text-white'
                    : 'text-panel-muted hover:text-white')
                }
              >
                🐙 GitHub
              </button>
            </div>
            {mode === 'github' && ghState.status === 'loading' && (
              <span className="text-[10px] text-panel-muted animate-pulse">
                fetching from raw.githubusercontent.com…
              </span>
            )}
            {mode === 'github' && ghState.status === 'ok' && (
              <span className="text-[10px] text-emerald-300">
                ✓ live from {githubLink?.mapping.label}
              </span>
            )}
            {mode === 'github' && ghState.status === 'error' && (
              <span
                className="text-[10px] text-red-300"
                title={ghState.message}
              >
                ✗ {ghState.message}
              </span>
            )}
          </div>
        )}
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
        <div className="min-h-0 overflow-hidden">
          {hasSource ? (
            <CodeViewer
              code={sourceContent ?? ''}
              language={language}
              filename={
                mode === 'github' && githubLink
                  ? githubLink.webUrl.replace('https://', '')
                  : (node.sourcePath ?? node.name)
              }
            />
          ) : mode === 'github' && ghState.status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-[11px] text-panel-muted">
              Fetching from {githubLink?.rawUrl}…
            </div>
          ) : mode === 'github' && ghState.status === 'error' ? (
            <div className="m-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
              <div className="font-semibold">Could not fetch source from GitHub.</div>
              <div className="mt-1 text-[10px]">{ghState.message}</div>
              <div className="mt-2 text-[10px] text-red-200/70">
                Probed URL: <span className="font-mono">{ghState.url}</span>
              </div>
              {hasLocalSource && (
                <button
                  type="button"
                  onClick={() => setMode('sourcemap')}
                  className="mt-2 rounded border border-panel-border px-2 py-0.5 text-[10px] text-panel-text hover:text-white"
                >
                  Fall back to sourcemap content →
                </button>
              )}
            </div>
          ) : (
            <pre className="m-0 overflow-auto bg-black/30 p-2 font-mono text-[11px] leading-snug text-panel-text">
              <code>
                {'/* No source content embedded in the sourcemap.\n' +
                  ' * The bundler likely used `nosources-source-map` or stripped sourcesContent\n' +
                  ' * for this file.' +
                  (canGithub
                    ? ' Toggle "🐙 GitHub" above to fetch the canonical copy from the repository.'
                    : ' Add a GitHub mapping in Settings to pull from the repo instead.') +
                  ' */'}
              </code>
            </pre>
          )}
        </div>

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

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
import { Tabs, type TabItem } from '@/lib/ui/Tabs';
import { formatBytes } from '@/lib/modules/sourcemap';
import {
  findMappingForModule,
  resolveGithubFileUrl,
  type GithubMapping,
} from '@/lib/modules/githubMapping';
import { buildProposePrPayload, EXPORT_TARGETS, extractPlanTitle } from '@/lib/modules/proposePr';

interface Props {
  node: ModuleTreeNode;
  streamingOneshot: StreamingOneshot;
  parentModuleUrl?: string;
  fetchText?: (url: string) => Promise<string>;
}

type SourceMode = 'sourcemap' | 'github';

interface GithubFetchState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  text?: string;
  message?: string;
  url?: string;
}

type AnalysisKind = FileAction | 'propose';

interface RunState {
  text: string;
  state: 'streaming' | 'done' | 'error';
  error?: string;
}

function useGithubLink(
  parentModuleUrl: string | undefined,
  sourcePath: string | undefined,
  mappings: readonly GithubMapping[],
): { webUrl: string; rawUrl: string; mapping: GithubMapping; branch: string } | null {
  if (!parentModuleUrl || !sourcePath) return null;
  const mapping = findMappingForModule(parentModuleUrl, mappings);
  if (!mapping) return null;
  const urls = resolveGithubFileUrl(sourcePath, mapping, parentModuleUrl);
  if (!urls) return null;
  return { webUrl: urls.webUrl, rawUrl: urls.rawUrl, mapping, branch: urls.branch };
}

/**
 * File detail right pane. Source code + per-action analyses live in
 * tabs so each gets the full vertical pane instead of being squeezed
 * into a strip below the source. Same analysis kind always replaces
 * its previous tab — no duplicates.
 */
export function FileDetail({
  node,
  streamingOneshot,
  parentModuleUrl,
  fetchText,
}: Props) {
  const settings = useStore((s) => s.settings);
  const githubLink = useGithubLink(
    parentModuleUrl,
    node.sourcePath,
    settings.githubMappings ?? [],
  );

  const localContent = node.sourceContent ?? null;
  const hasLocalSource = typeof localContent === 'string' && localContent.length > 0;
  const canGithub = !!githubLink && !!fetchText;

  const [mode, setMode] = useState<SourceMode>(
    canGithub && !hasLocalSource ? 'github' : 'sourcemap',
  );
  const [ghState, setGhState] = useState<GithubFetchState>({ status: 'idle' });
  const [results, setResults] = useState<Partial<Record<AnalysisKind, RunState>>>({});
  const [activeTab, setActiveTab] = useState<string>('source');
  const [proposeIntent, setProposeIntent] = useState('');

  useEffect(() => {
    setMode(canGithub && !hasLocalSource ? 'github' : 'sourcemap');
    setResults({});
    setActiveTab('source');
    setProposeIntent('');
  }, [node.id, canGithub, hasLocalSource]);

  useEffect(() => {
    if (mode !== 'github') return;
    if (!githubLink || !fetchText) return;
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

  const activeContent =
    mode === 'github' && ghState.status === 'ok' && ghState.text !== undefined
      ? ghState.text
      : localContent;
  const language = detectLanguage(node.sourcePath ?? node.name);
  const hasSource = typeof activeContent === 'string' && activeContent.length > 0;
  const llmConfigured = !!settings.baseUrl && !!settings.model;
  const path = node.sourcePath ?? node.name;

  const runAction = (action: FileAction) => {
    if (!activeContent || !llmConfigured) return;
    const payload = buildFileAnalysisPayload(action, activeContent, path, settings);
    setResults((r) => ({ ...r, [action]: { text: '', state: 'streaming' } }));
    setActiveTab(action);
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setResults((r) => ({ ...r, [action]: { text: acc, state: 'streaming' } }));
    });
    handle.result
      .then((full) => setResults((r) => ({ ...r, [action]: { text: full, state: 'done' } })))
      .catch((e) =>
        setResults((r) => ({
          ...r,
          [action]: {
            text: acc,
            state: 'error',
            error: e instanceof Error ? e.message : String(e),
          },
        })),
      );
  };

  const runPropose = () => {
    if (!activeContent || !llmConfigured) return;
    // Seed the context with the latest non-empty analysis result if the
    // user hasn't typed anything explicit.
    const latest = (['improve', 'audit', 'explain'] as FileAction[])
      .map((k) => results[k])
      .find((r) => r && r.state === 'done' && r.text.trim());
    const payload = buildProposePrPayload(
      {
        kind: 'file',
        path,
        language,
        source: activeContent,
        context: latest?.text,
      },
      proposeIntent,
      settings,
    );
    setResults((r) => ({ ...r, propose: { text: '', state: 'streaming' } }));
    setActiveTab('propose');
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setResults((r) => ({ ...r, propose: { text: acc, state: 'streaming' } }));
    });
    handle.result
      .then((full) => setResults((r) => ({ ...r, propose: { text: full, state: 'done' } })))
      .catch((e) =>
        setResults((r) => ({
          ...r,
          propose: {
            text: acc,
            state: 'error',
            error: e instanceof Error ? e.message : String(e),
          },
        })),
      );
  };

  const tabs: TabItem[] = [
    { id: 'source', label: 'Source', icon: '📄' },
    ...analysesAsTabs(results),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px] text-white">{node.name}</div>
            <div className="truncate text-[10px] text-panel-muted">{path}</div>
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
                    ? "Render the file from the sourcemap's embedded sourcesContent"
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
              <span className="text-[10px] text-red-300" title={ghState.message}>
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
                disabled={!llmConfigured || results[a]?.state === 'streaming'}
                onClick={() => runAction(a)}
                title={actionHint(a)}
                className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
              >
                {results[a]?.state === 'streaming' ? '…' : actionLabel(a)}
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

      <div className="min-h-0 flex-1">
        <Tabs
          tabs={tabs}
          activeId={activeTab}
          onSelect={setActiveTab}
          onClose={(id) => {
            if (id === 'source') return;
            setResults((r) => {
              const next = { ...r };
              delete next[id as AnalysisKind];
              return next;
            });
            if (activeTab === id) setActiveTab('source');
          }}
        >
          {activeTab === 'source' ? (
            <SourcePane
              activeContent={activeContent}
              hasSource={hasSource}
              language={language}
              path={path}
              mode={mode}
              ghState={ghState}
              githubLink={githubLink}
              canGithub={canGithub}
              hasLocalSource={hasLocalSource}
              setMode={setMode}
            />
          ) : activeTab === 'propose' ? (
            <ProposePane
              result={results.propose}
              intent={proposeIntent}
              setIntent={setProposeIntent}
              run={runPropose}
              llmConfigured={llmConfigured}
              hasContext={(['improve', 'audit', 'explain'] as FileAction[]).some(
                (k) => results[k]?.state === 'done',
              )}
              mapping={githubLink?.mapping}
            />
          ) : (
            <AnalysisPane
              result={results[activeTab as FileAction]}
              kind={activeTab as FileAction}
              onPropose={(seed) => {
                setProposeIntent(seed);
                runPropose();
              }}
              canPropose={llmConfigured && hasSource}
            />
          )}
        </Tabs>
      </div>
    </div>
  );
}

/* ---------- Panes ---------- */

function SourcePane({
  activeContent,
  hasSource,
  language,
  path,
  mode,
  ghState,
  githubLink,
  canGithub,
  hasLocalSource,
  setMode,
}: {
  activeContent: string | null;
  hasSource: boolean;
  language: string;
  path: string;
  mode: SourceMode;
  ghState: GithubFetchState;
  githubLink: ReturnType<typeof useGithubLink>;
  canGithub: boolean;
  hasLocalSource: boolean;
  setMode(m: SourceMode): void;
}) {
  if (hasSource) {
    return (
      <CodeViewer
        code={activeContent ?? ''}
        language={language}
        filename={
          mode === 'github' && githubLink
            ? githubLink.webUrl.replace('https://', '')
            : path
        }
      />
    );
  }
  if (mode === 'github' && ghState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-panel-muted">
        Fetching from {githubLink?.rawUrl}…
      </div>
    );
  }
  if (mode === 'github' && ghState.status === 'error') {
    return (
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
    );
  }
  return (
    <pre className="m-0 h-full overflow-auto bg-black/30 p-2 font-mono text-[11px] leading-snug text-panel-text">
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
  );
}

function AnalysisPane({
  result,
  kind,
  onPropose,
  canPropose,
}: {
  result: RunState | undefined;
  kind: FileAction;
  onPropose(seed: string): void;
  canPropose: boolean;
}) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-panel-muted">
        No result yet.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3 text-[12px]">
        <MarkdownRenderer
          source={result.text}
          streaming={result.state === 'streaming'}
        />
        {result.state === 'streaming' && (
          <span className="ml-0.5 inline-block animate-pulse">▍</span>
        )}
        {result.state === 'error' && result.error && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
            {result.error}
          </div>
        )}
      </div>
      {result.state === 'done' && (kind === 'audit' || kind === 'improve') && (
        <div className="shrink-0 border-t border-panel-border bg-panel-bg/40 px-3 py-2">
          <button
            type="button"
            disabled={!canPropose}
            onClick={() => onPropose(result.text)}
            className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-1 text-[11px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed"
          >
            🔧 Propose changes from this {kind}
          </button>
        </div>
      )}
    </div>
  );
}

function ProposePane({
  result,
  intent,
  setIntent,
  run,
  llmConfigured,
  hasContext,
  mapping,
}: {
  result: RunState | undefined;
  intent: string;
  setIntent(v: string): void;
  run(): void;
  llmConfigured: boolean;
  hasContext: boolean;
  mapping?: GithubMapping;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-panel-border bg-panel-bg/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
          What should change?
        </div>
        <textarea
          className="block w-full rounded border border-panel-border bg-black/30 p-1.5 text-[11px] text-panel-text"
          rows={3}
          placeholder={
            hasContext
              ? 'Describe the change you want, or leave blank to use the latest Audit/Improve result.'
              : 'Describe the change you want.'
          }
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          disabled={result?.state === 'streaming'}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-panel-muted">
            {result?.state === 'streaming'
              ? 'Drafting plan…'
              : hasContext
                ? 'A previous Audit/Improve will be folded in if you leave this blank.'
                : 'Add an Audit/Improve first for the model to ground in.'}
          </span>
          <button
            type="button"
            onClick={run}
            disabled={!llmConfigured || result?.state === 'streaming'}
            className="rounded bg-panel-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {result ? 'Regenerate plan' : 'Generate plan'}
          </button>
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3 text-[12px]">
        {result?.text ? (
          <MarkdownRenderer
            source={result.text}
            streaming={result.state === 'streaming'}
          />
        ) : (
          <div className="text-[11px] text-panel-muted">
            The plan will stream here once you click <strong>Generate plan</strong>.
          </div>
        )}
        {result?.state === 'streaming' && (
          <span className="ml-0.5 inline-block animate-pulse">▍</span>
        )}
        {result?.state === 'error' && result.error && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
            {result.error}
          </div>
        )}
      </div>
      {result?.state === 'done' && result.text && (
        <ExportBar plan={result.text} mapping={mapping} />
      )}
    </div>
  );
}

function ExportBar({
  plan,
  mapping,
}: {
  plan: string;
  mapping?: GithubMapping;
}) {
  const [status, setStatus] = useState<{ ok: boolean; message?: string } | null>(null);
  const title = extractPlanTitle(plan);

  const run = async (id: string) => {
    const spec = EXPORT_TARGETS.find((t) => t.id === id);
    if (!spec) return;
    const built = spec.build(plan, { mapping, title });
    if (built.kind === 'action') {
      const res = await built.run();
      setStatus(res);
      setTimeout(() => setStatus(null), 2000);
      return;
    }
    if (built.url === 'about:blank') return;
    try {
      window.open(built.url, '_blank', 'noopener,noreferrer');
    } catch {
      /* popup blocked */
    }
  };

  return (
    <div className="shrink-0 border-t border-panel-border bg-panel-bg/40 px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
        Hand off plan to…
      </div>
      <div className="flex flex-wrap gap-1.5">
        {EXPORT_TARGETS.filter((t) => t.id !== 'github-issue' || !!mapping).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void run(t.id)}
            title={t.description}
            className="rounded border border-panel-border bg-panel-bg/60 px-2 py-1 text-[11px] text-panel-text hover:border-panel-accent hover:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>
      {status && (
        <div
          className={
            'mt-1 text-[10px] ' +
            (status.ok ? 'text-emerald-300' : 'text-red-300')
          }
        >
          {status.message || (status.ok ? 'Done.' : 'Failed.')}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

const KIND_META: Record<AnalysisKind, { label: string; icon: string }> = {
  audit: { label: 'Audit', icon: '✨' },
  improve: { label: 'Improve', icon: '💡' },
  explain: { label: 'Explain', icon: '📖' },
  propose: { label: 'PR plan', icon: '🔧' },
};

function analysesAsTabs(results: Partial<Record<AnalysisKind, RunState>>): TabItem[] {
  return (Object.keys(results) as AnalysisKind[]).map((k) => {
    const r = results[k]!;
    const meta = KIND_META[k];
    return {
      id: k,
      label: meta.label,
      icon: meta.icon,
      badge: r.state,
      closable: true,
    };
  });
}

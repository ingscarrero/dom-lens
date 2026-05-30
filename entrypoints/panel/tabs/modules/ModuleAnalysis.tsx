import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import type { LoadedModule, ParsedSourceMap } from '@/lib/modules/types';
import {
  MODULE_ACTIONS,
  actionHint,
  actionLabel,
  buildModuleAnalysisPayload,
  curateFiles,
  type ModuleAction,
} from '@/lib/modules/analyzeModule';
import type { StreamingOneshot } from '@/lib/lm-studio/streamingProxy';
import { MarkdownRenderer } from '@/lib/ui/MarkdownRenderer';
import { formatBytes } from '@/lib/modules/sourcemap';
import {
  findMappingForModule,
  repoHomeUrl,
  resolveBranch,
} from '@/lib/modules/githubMapping';
import { Tabs, type TabItem } from '@/lib/ui/Tabs';
import {
  buildProposePrPayload,
  EXPORT_TARGETS,
  extractPlanTitle,
} from '@/lib/modules/proposePr';
import type { GithubMapping } from '@/lib/storage/settings';

interface Props {
  module: LoadedModule;
  sourcemap: ParsedSourceMap;
  streamingOneshot: StreamingOneshot;
}

type AnalysisKind = ModuleAction | 'propose';

interface RunState {
  text: string;
  state: 'streaming' | 'done' | 'error';
  error?: string;
}

/**
 * Module-level analysis right pane — tabbed.
 *
 * The Summary tab is permanent (stats grid + "Files that will be sent"
 * + "Full file list"). Each module-action run gets a tab; same action
 * always replaces its previous tab so the user never sees duplicates.
 * The Propose tab streams a structured change plan with export targets
 * (Copy / Download / Cursor / Claude Desktop / Claude.ai / GitHub
 * issue).
 */
export function ModuleAnalysis({ module, sourcemap, streamingOneshot }: Props) {
  const settings = useStore((s) => s.settings);
  const [results, setResults] = useState<Partial<Record<AnalysisKind, RunState>>>({});
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [proposeIntent, setProposeIntent] = useState('');

  useEffect(() => {
    setResults({});
    setActiveTab('summary');
    setProposeIntent('');
  }, [module.url, sourcemap]);

  const preview = curateFiles(sourcemap);
  const llmConfigured = !!settings.baseUrl && !!settings.model;
  const authoredCount = sourcemap.sources.filter(
    (s) => !s.includes('node_modules') && !s.startsWith('webpack:///webpack/'),
  ).length;
  const githubMapping = findMappingForModule(module.url, settings.githubMappings ?? []);

  const runAction = (action: ModuleAction) => {
    if (!llmConfigured) return;
    const { payload } = buildModuleAnalysisPayload(action, module, sourcemap, settings);
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
    if (!llmConfigured) return;
    // Seed with the latest done analysis if the user hasn't typed an intent.
    const latest = (['optimization', 'risk', 'ideas', 'architecture'] as ModuleAction[])
      .map((k) => results[k])
      .find((r) => r && r.state === 'done' && r.text.trim());
    const payload = buildProposePrPayload(
      {
        kind: 'module',
        moduleUrl: module.url,
        fileList: preview.fileList,
        bundle: preview.bundle,
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
    { id: 'summary', label: 'Summary', icon: '📊' },
    ...analysesAsTabs(results),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="text-[12px] font-semibold text-white">
          Module analysis ·{' '}
          <span className="font-mono">{module.pathname.split('/').pop()}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-panel-muted">{module.url}</div>
        {githubMapping &&
          (() => {
            const resolved = resolveBranch(githubMapping, module.url);
            return (
              <a
                href={repoHomeUrl(githubMapping, module.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open repository on GitHub · ${githubMapping.owner}/${githubMapping.repo}@${resolved}${githubMapping.basePath ? '/' + githubMapping.basePath : ''}`}
                className="mt-1.5 inline-flex items-center gap-1 rounded border border-panel-accent/40 bg-panel-accent/10 px-2 py-0.5 text-[10px] text-panel-accent hover:bg-panel-accent/20"
              >
                🐙 <span className="font-semibold">{githubMapping.label}</span>
                <span className="text-panel-muted">·</span>
                <span className="font-mono">
                  {githubMapping.owner}/{githubMapping.repo}@{resolved}
                  {githubMapping.basePath ? `/${githubMapping.basePath}` : ''}
                </span>
              </a>
            );
          })()}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {MODULE_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={!llmConfigured || results[a]?.state === 'streaming'}
              onClick={() => runAction(a)}
              title={actionHint(a)}
              className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[11px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
            >
              {results[a]?.state === 'streaming' ? '…' : actionLabel(a)}
            </button>
          ))}
          <button
            type="button"
            disabled={!llmConfigured || results.propose?.state === 'streaming'}
            onClick={() => {
              setActiveTab('propose');
            }}
            title="Open the Propose Changes tab to draft a PR plan for this module"
            className="rounded border border-violet-500/60 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
          >
            🔧 Propose changes
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <Tabs
          tabs={tabs}
          activeId={activeTab}
          onSelect={setActiveTab}
          onClose={(id) => {
            if (id === 'summary') return;
            setResults((r) => {
              const next = { ...r };
              delete next[id as AnalysisKind];
              return next;
            });
            if (activeTab === id) setActiveTab('summary');
          }}
        >
          {activeTab === 'summary' ? (
            <SummaryPane
              module={module}
              sourcemap={sourcemap}
              preview={preview}
              authoredCount={authoredCount}
            />
          ) : activeTab === 'propose' ? (
            <ProposePane
              result={results.propose}
              intent={proposeIntent}
              setIntent={setProposeIntent}
              run={runPropose}
              llmConfigured={llmConfigured}
              hasContext={(
                ['optimization', 'risk', 'ideas', 'architecture'] as ModuleAction[]
              ).some((k) => results[k]?.state === 'done')}
              mapping={githubMapping ?? undefined}
            />
          ) : (
            <AnalysisPane
              result={results[activeTab as ModuleAction]}
              kind={activeTab as ModuleAction}
              onPropose={(seed) => {
                setProposeIntent(seed);
                runPropose();
              }}
              canPropose={llmConfigured}
            />
          )}
        </Tabs>
      </div>
    </div>
  );
}

/* ---------- Panes ---------- */

function SummaryPane({
  module,
  sourcemap,
  preview,
  authoredCount,
}: {
  module: LoadedModule;
  sourcemap: ParsedSourceMap;
  preview: ReturnType<typeof curateFiles>;
  authoredCount: number;
}) {
  void module;
  return (
    <div className="scrollbar-thin h-full overflow-auto p-3 text-[11px]">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
        <Stat label="Total sources" value={`${sourcemap.sources.length}`} />
        <Stat
          label="Authored"
          value={`${authoredCount}`}
          sub={`of ${sourcemap.sources.length}`}
        />
        <Stat label="Mapped bytes" value={formatBytes(sourcemap.totalBytes)} />
        <Stat
          label="With content"
          value={`${sourcemap.sourcesContent.filter((c) => c !== null).length}`}
        />
        <Stat
          label="LLM context"
          value={`${preview.counts.included} files`}
          sub={`${(preview.counts.bytes / 1024).toFixed(1)} KB`}
        />
      </div>

      <details open className="mt-4">
        <summary className="cursor-pointer text-panel-text/90 hover:text-white">
          Files that will be sent ({preview.counts.included})
        </summary>
        <pre className="scrollbar-thin mt-1 max-h-72 overflow-auto rounded border border-panel-border bg-black/30 p-2 font-mono text-[10px]">
          {preview.bundle
            .split('\n')
            .filter((line) => line.startsWith('### '))
            .map((line) => line.replace(/^### /, '- '))
            .join('\n') || '(none)'}
        </pre>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-panel-text/90 hover:text-white">
          Full file list (all {sourcemap.sources.length})
        </summary>
        <pre className="scrollbar-thin mt-1 max-h-72 overflow-auto rounded border border-panel-border bg-black/30 p-2 font-mono text-[10px]">
          {preview.fileList || '(none)'}
        </pre>
      </details>

      <div className="mt-4 text-panel-muted">
        Pick an analysis from the action bar above to add a new tab. Same
        action always replaces its previous tab — never duplicates.
      </div>
    </div>
  );
}

function AnalysisPane({
  result,
  kind,
  onPropose,
  canPropose,
}: {
  result: RunState | undefined;
  kind: ModuleAction;
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
  const supportsPropose = kind === 'risk' || kind === 'optimization' || kind === 'ideas';
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
      {result.state === 'done' && supportsPropose && (
        <div className="shrink-0 border-t border-panel-border bg-panel-bg/40 px-3 py-2">
          <button
            type="button"
            disabled={!canPropose}
            onClick={() => onPropose(result.text)}
            className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-1 text-[11px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed"
          >
            🔧 Propose changes from this {actionLabel(kind).replace(/^[^a-zA-Z]+/, '')}
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
              ? 'Describe the change you want, or leave blank to use the latest Risk/Optimize/Ideas/Architecture result.'
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
                ? 'A previous Risk/Optimize/Ideas/Architecture will be folded in if you leave this blank.'
                : 'Add a Risk/Optimize/Ideas analysis first for the model to ground in.'}
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
            'mt-1 text-[10px] ' + (status.ok ? 'text-emerald-300' : 'text-red-300')
          }
        >
          {status.message || (status.ok ? 'Done.' : 'Failed.')}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-panel-muted">{label}</div>
      <div className="font-mono text-white">
        {value}
        {sub && <span className="ml-1 text-panel-muted">{sub}</span>}
      </div>
    </div>
  );
}

const MODULE_KIND_META: Record<AnalysisKind, { label: string; icon: string }> = {
  architecture: { label: 'Architecture', icon: '🏛' },
  dashboard: { label: 'Dashboard', icon: '🎨' },
  risk: { label: 'Risk', icon: '🛡' },
  optimization: { label: 'Optimize', icon: '⚡' },
  diagram: { label: 'Diagram', icon: '🧪' },
  ideas: { label: 'Ideas', icon: '💭' },
  propose: { label: 'PR plan', icon: '🔧' },
};

function analysesAsTabs(
  results: Partial<Record<AnalysisKind, RunState>>,
): TabItem[] {
  return (Object.keys(results) as AnalysisKind[]).map((k) => {
    const r = results[k]!;
    const meta = MODULE_KIND_META[k];
    return {
      id: k,
      label: meta.label,
      icon: meta.icon,
      badge: r.state,
      closable: true,
    };
  });
}

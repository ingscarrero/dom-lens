import { useState } from 'react';
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

interface Props {
  module: LoadedModule;
  sourcemap: ParsedSourceMap;
  streamingOneshot: StreamingOneshot;
}

interface RunState {
  action: ModuleAction;
  text: string;
  state: 'streaming' | 'done' | 'error';
  error?: string;
}

/**
 * Module-level analysis right pane — opens when the user selects a
 * deployed module 📦 or its Authored sources 📂 root in the tree.
 *
 * Six streaming actions defined in lib/modules/analyzeModule.ts. Each
 * curates a subset of the authored sources (entry-like + smallest,
 * capped at 28 KB) and streams the response through MarkdownRenderer,
 * so any ```mermaid blocks render as live diagrams and any ```html
 * blocks render as sandboxed artifacts via the existing pipeline.
 *
 * Top of the panel: a curation summary so the user knows exactly which
 * files informed the answer.
 */
export function ModuleAnalysis({ module, sourcemap, streamingOneshot }: Props) {
  const settings = useStore((s) => s.settings);
  const [active, setActive] = useState<ModuleAction | null>(null);
  const [run, setRun] = useState<RunState | null>(null);

  // Curated preview (recomputed on render — cheap, no LLM call).
  const preview = curateFiles(sourcemap);
  const llmConfigured = !!settings.baseUrl && !!settings.model;
  const authoredCount = sourcemap.sources.filter(
    (s) => !s.includes('node_modules') && !s.startsWith('webpack:///webpack/'),
  ).length;
  const githubMapping = findMappingForModule(module.url, settings.githubMappings ?? []);

  const runAction = (action: ModuleAction) => {
    if (!llmConfigured) return;
    setActive(action);
    setRun({ action, text: '', state: 'streaming' });
    const { payload } = buildModuleAnalysisPayload(action, module, sourcemap, settings);
    let acc = '';
    const handle = streamingOneshot(payload, (delta) => {
      acc += delta;
      setRun({ action, text: acc, state: 'streaming' });
    });
    handle.result
      .then((full) => {
        setRun({ action, text: full, state: 'done' });
        setActive(null);
      })
      .catch((e) => {
        setRun({
          action,
          text: acc,
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        setActive(null);
      });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="text-[12px] font-semibold text-white">
          Module analysis · <span className="font-mono">{module.pathname.split('/').pop()}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-panel-muted">{module.url}</div>
        {githubMapping && (
          (() => {
            const resolvedBranch = resolveBranch(githubMapping, module.url);
            return (
              <a
                href={repoHomeUrl(githubMapping, module.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open repository on GitHub · ${githubMapping.owner}/${githubMapping.repo}@${resolvedBranch}${githubMapping.basePath ? '/' + githubMapping.basePath : ''}`}
                className="mt-1.5 inline-flex items-center gap-1 rounded border border-panel-accent/40 bg-panel-accent/10 px-2 py-0.5 text-[10px] text-panel-accent hover:bg-panel-accent/20"
              >
                🐙 <span className="font-semibold">{githubMapping.label}</span>
                <span className="text-panel-muted">·</span>
                <span className="font-mono">
                  {githubMapping.owner}/{githubMapping.repo}@{resolvedBranch}
                  {githubMapping.basePath ? `/${githubMapping.basePath}` : ''}
                </span>
              </a>
            );
          })()
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
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
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {MODULE_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={!llmConfigured || active !== null}
              onClick={() => runAction(a)}
              title={actionHint(a)}
              className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[11px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
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
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!run && (
          <div className="space-y-3 text-[11px] text-panel-muted">
            <p>
              Pick an analysis above. The local model receives a curated
              concatenation of the module's authored sources — entry points
              + smallest files first, capped at ~28&nbsp;KB — plus the full
              file list for awareness of what wasn't included.
            </p>
            <details>
              <summary className="cursor-pointer text-panel-text/90 hover:text-white">
                Files that will be sent ({preview.counts.included})
              </summary>
              <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto rounded border border-panel-border bg-black/30 p-2 font-mono text-[10px]">
                {preview.bundle
                  .split('\n')
                  .filter((line) => line.startsWith('### '))
                  .map((line) => line.replace(/^### /, '- '))
                  .join('\n') || '(none)'}
              </pre>
            </details>
            <details>
              <summary className="cursor-pointer text-panel-text/90 hover:text-white">
                Full file list (all {sourcemap.sources.length})
              </summary>
              <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto rounded border border-panel-border bg-black/30 p-2 font-mono text-[10px]">
                {preview.fileList || '(none)'}
              </pre>
            </details>
          </div>
        )}

        {run && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-panel-muted">
              <span>{actionLabel(run.action)} result</span>
              {run.state === 'streaming' && <span>streaming…</span>}
              {run.state === 'done' && <span>done</span>}
              {run.state === 'error' && <span className="text-red-300">error</span>}
            </div>
            {run.text ? (
              <MarkdownRenderer source={run.text} compact />
            ) : (
              <div className="text-[11px] text-panel-muted">
                {run.state === 'streaming' ? 'Asking model…' : ''}
              </div>
            )}
            {run.state === 'error' && run.error && (
              <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
                {run.error}
              </div>
            )}
          </div>
        )}
      </div>
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

import { useState } from 'react';
import { useStore } from '../store';
import {
  saveSettings,
  DEFAULT_SETTINGS,
  type GithubMapping,
} from '@/lib/storage/settings';
import { parseRepoSpec } from '@/lib/modules/githubMapping';

interface Props {
  onTestConnection(baseUrl: string, apiKey?: string): void;
}

export default function SettingsTab({ onTestConnection }: Props) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const testConnection = useStore((s) => s.testConnection);
  const setTestConnection = useStore((s) => s.setTestConnection);

  const [local, setLocal] = useState(settings);

  const save = async (next: typeof local) => {
    setLocal(next);
    setSettings(next);
    await saveSettings(next);
  };

  const field =
    'block w-full rounded border border-panel-border bg-black/30 p-1.5 text-xs text-panel-text focus:border-panel-accent focus:outline-none';

  return (
    <div className="scrollbar-thin h-full overflow-auto p-4 text-xs">
      <section className="mb-6 max-w-xl space-y-3">
        <h3 className="text-sm font-semibold">Local AI endpoint</h3>
        <label className="block">
          <span className="text-panel-muted">Base URL</span>
          <input
            className={field}
            value={local.baseUrl}
            onChange={(e) => save({ ...local, baseUrl: e.target.value })}
            placeholder="http://localhost:1234/v1"
          />
          <span className="text-[10px] text-panel-muted">
            LM Studio default: http://localhost:1234/v1 · Ollama: http://localhost:11434/v1
          </span>
        </label>
        <label className="block">
          <span className="text-panel-muted">Model</span>
          <input
            className={field}
            value={local.model}
            onChange={(e) => save({ ...local, model: e.target.value })}
            placeholder="e.g. qwen2.5-coder-7b-instruct"
          />
        </label>
        <label className="block">
          <span className="text-panel-muted">API key (optional)</span>
          <input
            type="password"
            className={field}
            value={local.apiKey ?? ''}
            onChange={(e) => save({ ...local, apiKey: e.target.value })}
            placeholder="leave empty for local servers"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-panel-accent px-3 py-1 text-xs font-medium text-white hover:bg-sky-400"
            onClick={() => {
              setTestConnection({ status: 'pending' });
              onTestConnection(local.baseUrl, local.apiKey || undefined);
            }}
          >
            Test connection
          </button>
          {testConnection.status === 'pending' && (
            <span className="text-panel-muted">contacting endpoint…</span>
          )}
          {testConnection.status === 'ok' && (
            <span className="text-emerald-300">
              OK — {testConnection.models?.length ?? 0} model(s):{' '}
              {testConnection.models?.slice(0, 3).join(', ')}
              {(testConnection.models?.length ?? 0) > 3 ? '…' : ''}
            </span>
          )}
          {testConnection.status === 'error' && (
            <span className="text-red-300">{testConnection.message}</span>
          )}
        </div>
      </section>

      <section className="mb-6 max-w-xl space-y-2">
        <h3 className="text-sm font-semibold">Screenshot capture</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={local.fullPageScreenshot}
            onChange={(e) => save({ ...local, fullPageScreenshot: e.target.checked })}
          />
          <span>
            Capture full page (scroll-and-stitch). Disable for visible-viewport only — faster.
          </span>
        </label>
        <label className="block">
          <span className="text-panel-muted">Max tiles for scroll-and-stitch</span>
          <input
            type="number"
            min={1}
            max={60}
            className={field}
            value={local.fullPageMaxTiles}
            onChange={(e) =>
              save({ ...local, fullPageMaxTiles: Math.max(1, parseInt(e.target.value || '1', 10)) })
            }
          />
          <span className="text-[10px] text-panel-muted">
            Pages requiring more tiles fall back to a viewport screenshot. Chrome enforces a
            captureVisibleTab quota (~2 calls/sec); high tile counts will be slow.
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={local.sendSlicedTiles}
            onChange={(e) => save({ ...local, sendSlicedTiles: e.target.checked })}
          />
          <span>
            When tiles have been sliced, send them as ordered tiles instead of the full image.
          </span>
        </label>
        <label className="block">
          <span className="text-panel-muted">Default slice count (1–16)</span>
          <input
            type="number"
            min={1}
            max={16}
            className={field}
            value={local.defaultSliceCount}
            onChange={(e) =>
              save({ ...local, defaultSliceCount: Math.max(1, Math.min(16, parseInt(e.target.value || '1', 10))) })
            }
          />
        </label>
      </section>

      <section className="mb-6 max-w-xl space-y-2">
        <h3 className="text-sm font-semibold">Snapshot composition</h3>
        {(
          [
            ['includeMarkdown', 'Include DOM markdown'],
            ['includeScreenshot', 'Include screenshot (multimodal models only)'],
            ['includeReactTree', 'Include React component-tree summary'],
            ['includeFederation', 'Include Module Federation summary'],
            ['includeConsole', 'Include console errors/warnings'],
            ['includeNetwork', 'Include network entries'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={local[key]}
              onChange={(e) => save({ ...local, [key]: e.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}

        <label className="block">
          <span className="text-panel-muted">Max DOM markdown chars (truncate before sending)</span>
          <input
            type="number"
            min={1000}
            max={200000}
            step={1000}
            className={field}
            value={local.maxMarkdownChars}
            onChange={(e) =>
              save({ ...local, maxMarkdownChars: Math.max(1000, parseInt(e.target.value || '0', 10)) })
            }
          />
        </label>
      </section>

      <section className="mb-6 max-w-xl space-y-2">
        <h3 className="text-sm font-semibold">GitHub source mappings</h3>
        <p className="text-[11px] text-panel-muted">
          Map deployed-module URL patterns to GitHub repositories. The
          Modules tab uses these to surface "View on GitHub" links on
          source files and a repo card in the module-analysis panel.
        </p>
        <GithubMappingsEditor
          mappings={local.githubMappings ?? []}
          onChange={(next) => save({ ...local, githubMappings: next })}
        />
      </section>

      <section className="max-w-xl space-y-2">
        <h3 className="text-sm font-semibold">System prompt</h3>
        <textarea
          className={field + ' min-h-[120px]'}
          value={local.systemPrompt}
          onChange={(e) => save({ ...local, systemPrompt: e.target.value })}
        />
        <button
          type="button"
          className="text-[11px] text-panel-accent hover:underline"
          onClick={() => save({ ...local, systemPrompt: DEFAULT_SETTINGS.systemPrompt })}
        >
          Reset to default
        </button>
      </section>
    </div>
  );
}

function GithubMappingsEditor({
  mappings,
  onChange,
}: {
  mappings: GithubMapping[];
  onChange(next: GithubMapping[]): void;
}) {
  const [draft, setDraft] = useState<Partial<GithubMapping> & { repoInput?: string }>({
    branch: 'main',
  });
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    'block w-full rounded border border-panel-border bg-black/30 p-1 text-[11px] text-panel-text focus:border-panel-accent focus:outline-none';

  const add = () => {
    const label = draft.label?.trim();
    const urlPattern = draft.urlPattern?.trim();
    const parsed = parseRepoSpec(draft.repoInput?.trim() ?? '');
    if (!label) return setError('Label is required.');
    if (!urlPattern) return setError('URL pattern is required.');
    if (!parsed) return setError('Repository is required (owner/repo or full GitHub URL).');
    const next: GithubMapping = {
      id: 'gh-' + Date.now().toString(36),
      label,
      urlPattern,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: (draft.branch?.trim() || parsed.branch || 'main') || 'main',
      basePath: (draft.basePath?.trim() || parsed.basePath || undefined) ?? undefined,
    };
    onChange([...mappings, next]);
    setDraft({ branch: 'main' });
    setError(null);
  };

  const remove = (id: string) => {
    onChange(mappings.filter((m) => m.id !== id));
  };

  return (
    <div className="space-y-2">
      {mappings.length === 0 ? (
        <div className="rounded border border-dashed border-panel-border p-2 text-[11px] text-panel-muted">
          No mappings yet. Add one below.
        </div>
      ) : (
        <ul className="space-y-1">
          {mappings.map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between gap-2 rounded border border-panel-border bg-panel-bg/40 p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-white">{m.label}</div>
                <div className="text-[10px] text-panel-muted">
                  matches <span className="font-mono">{m.urlPattern}</span>
                </div>
                <div className="text-[10px] text-panel-muted">
                  →{' '}
                  <span className="font-mono">
                    {m.owner}/{m.repo}@{m.branch}
                    {m.basePath ? `/${m.basePath}` : ''}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(m.id)}
                title="Delete mapping"
                className="rounded border border-panel-border px-1.5 text-[10px] text-panel-muted hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded border border-panel-border bg-black/20 p-2 text-[11px]">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
          Add mapping
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-panel-muted">Label</span>
            <input
              className={inputCls}
              value={draft.label ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="MF demo host"
            />
          </label>
          <label className="block">
            <span className="text-panel-muted">URL pattern (substring)</span>
            <input
              className={inputCls}
              value={draft.urlPattern ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, urlPattern: e.target.value }))}
              placeholder="localhost:3001"
            />
          </label>
          <label className="col-span-2 block">
            <span className="text-panel-muted">Repository</span>
            <input
              className={inputCls}
              value={draft.repoInput ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, repoInput: e.target.value }))}
              placeholder="owner/repo  ·  https://github.com/owner/repo/tree/branch/sub"
            />
          </label>
          <label className="block">
            <span className="text-panel-muted">Branch</span>
            <input
              className={inputCls}
              value={draft.branch ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, branch: e.target.value }))}
              placeholder="main"
            />
          </label>
          <label className="block">
            <span className="text-panel-muted">Base path (optional)</span>
            <input
              className={inputCls}
              value={draft.basePath ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, basePath: e.target.value }))}
              placeholder="host"
            />
          </label>
        </div>
        {error && <div className="mt-2 text-[10px] text-red-300">{error}</div>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={add}
            className="rounded bg-panel-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400"
          >
            Add mapping
          </button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useStore, type Tab } from '../store';
import { extractMermaidBlocks } from '@/lib/diagrams/extractMermaid';
import { extractArtifacts } from '@/lib/artifacts/extractArtifacts';
import { MermaidBlock } from '@/lib/ui/MermaidBlock';
import { ArtifactBlock } from '@/lib/ui/ArtifactBlock';
import { MarkdownEditor } from '@/lib/ui/MarkdownEditor';
import { summarizeModules } from '@/lib/modules/classify';
import { formatBytes } from '@/lib/modules/sourcemap';
import { PROMPT_PRESETS, type PromptPreset } from './prompts';
import { saveSettings, type CustomPrompt } from '@/lib/storage/settings';

interface Props {
  /** Called when the user clicks an empty-state preset CTA. Sets the Analyze
   * tab input and switches to it. */
  onApplyPreset(preset: PromptPreset): void;
  setTab(t: Tab): void;
}

/**
 * The "Insights" tab is the analysis dashboard:
 *
 *   1. **Architecture summary** — tech stack chips, module bytes by kind,
 *      federation host/remote counts. Useful immediately after a capture.
 *   2. **Generated diagrams** — every ```mermaid block extracted from chat
 *      replies, grouped by which reply they came from.
 *   3. **Scratchpad** — a Mermaid editor for iterating on a diagram by hand.
 *   4. **Empty-state CTAs** — one-click preset buttons that jump the user
 *      to Analyze with the preset pre-filled.
 *
 * The point is that the tab is useful before any LLM call and gets richer
 * as the conversation progresses — it's a collected-artifacts view, not
 * a "you must analyze first" view.
 */
export default function InsightsTab({ onApplyPreset, setTab }: Props) {
  const snap = useStore((s) => s.snapshot);
  const chat = useStore((s) => s.chat);
  const [scratch, setScratch] = useState('');

  const moduleSummary = useMemo(
    () => (snap ? summarizeModules(snap.modules) : null),
    [snap],
  );

  const diagrams = useMemo(() => {
    const out: Array<{
      turnId: string;
      replyNumber: number;
      blocks: ReturnType<typeof extractMermaidBlocks>;
    }> = [];
    let replyN = 0;
    chat.forEach((turn) => {
      if (turn.role !== 'assistant') return;
      replyN += 1;
      const blocks = extractMermaidBlocks(turn.content);
      if (blocks.length === 0) return;
      out.push({ turnId: turn.id, replyNumber: replyN, blocks });
    });
    return out;
  }, [chat]);

  const totalDiagrams = diagrams.reduce((n, t) => n + t.blocks.length, 0);

  const artifacts = useMemo(() => {
    const out: Array<{
      turnId: string;
      replyNumber: number;
      blocks: ReturnType<typeof extractArtifacts>;
    }> = [];
    let replyN = 0;
    chat.forEach((turn) => {
      if (turn.role !== 'assistant') return;
      replyN += 1;
      const blocks = extractArtifacts(turn.content);
      if (blocks.length === 0) return;
      out.push({ turnId: turn.id, replyNumber: replyN, blocks });
    });
    return out;
  }, [chat]);
  const totalArtifacts = artifacts.reduce((n, t) => n + t.blocks.length, 0);

  if (!snap) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-xs text-panel-muted">
        <div className="text-center">
          No snapshot yet. Capture one to see the architecture summary, then
          run an Analyze preset to generate diagrams.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* === Architecture summary === */}
      <section className="border-b border-panel-border bg-panel-surface/40 px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-panel-muted">
          Architecture
        </h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <TechStackCard />
          <ModulesCard
            summary={moduleSummary}
            modulesCount={snap.modules?.length ?? 0}
            onOpenTab={() => setTab('modules')}
          />
          <FederationCard onOpenTab={() => setTab('federation')} />
        </div>
      </section>

      {/* === Run a preset === always-visible gallery, not just empty state */}
      <section className="border-b border-panel-border bg-panel-surface/30 px-4 py-3">
        <PresetGallery onApplyPreset={onApplyPreset} />
      </section>

      {/* === Generated diagrams === */}
      <section className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-panel-muted">
            Generated diagrams ({totalDiagrams})
          </h3>
          {totalDiagrams > 0 && (
            <button
              type="button"
              onClick={() => setTab('analyze')}
              className="text-[11px] text-panel-accent hover:text-sky-300"
            >
              Open chat →
            </button>
          )}
        </div>

        {totalDiagrams === 0 ? (
          <div className="rounded border border-dashed border-panel-border bg-panel-bg/20 p-3 text-[11px] text-panel-muted">
            No diagrams yet. Pick a preset above to ask the LLM for one — any
            reply containing a <code>```mermaid</code> block renders here
            automatically.
          </div>
        ) : (
          diagrams.map((turn) => (
            <div key={turn.turnId} className="mb-4">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-panel-muted">
                <span>Reply #{turn.replyNumber}</span>
                <span>
                  {turn.blocks.length} diagram{turn.blocks.length === 1 ? '' : 's'}
                </span>
              </div>
              {turn.blocks.map((b) => (
                <MermaidBlock
                  key={`${turn.turnId}-${b.index}`}
                  source={b.source}
                  title={b.title}
                />
              ))}
            </div>
          ))
        )}
      </section>

      {/* === Generated artifacts === */}
      <section className="border-t border-panel-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-panel-muted">
            Generated artifacts ({totalArtifacts})
          </h3>
          {totalArtifacts > 0 && (
            <button
              type="button"
              onClick={() => setTab('analyze')}
              className="text-[11px] text-panel-accent hover:text-sky-300"
            >
              Open chat →
            </button>
          )}
        </div>

        {totalArtifacts === 0 ? (
          <div className="rounded border border-dashed border-panel-border bg-panel-bg/20 p-3 text-[11px] text-panel-muted">
            No artifacts yet. Ask the LLM for a <code>```html</code> visualisation
            (try the <strong>Visual dashboard</strong> preset) — sandboxed iframes
            render right here.
          </div>
        ) : (
          artifacts.map((turn) => (
            <div key={turn.turnId} className="mb-4">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-panel-muted">
                <span>Reply #{turn.replyNumber}</span>
                <span>
                  {turn.blocks.length} artifact{turn.blocks.length === 1 ? '' : 's'}
                </span>
              </div>
              {turn.blocks.map((b) => (
                <ArtifactBlock
                  key={`${turn.turnId}-${b.index}`}
                  source={b.source}
                  title={b.title}
                />
              ))}
            </div>
          ))
        )}
      </section>

      {/* === Scratchpad === */}
      <section className="border-t border-panel-border bg-panel-surface/30 px-4 py-3">
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-panel-muted hover:text-white">
            Scratchpad
          </summary>
          <div className="mt-2 text-[11px] text-panel-muted">
            Paste any Mermaid source to preview live. Useful for editing a
            diagram before sending it back to the LLM.
          </div>
          <div className="mt-2">
            <MarkdownEditor
              value={scratch}
              onChange={setScratch}
              placeholder={'```mermaid\nflowchart TD\n  Host --> RemoteA\n  Host --> RemoteB\n```'}
              rows={6}
            />
          </div>
        </details>
      </section>
    </div>
  );
}

/* ---------- summary cards ---------- */

function TechStackCard() {
  const snap = useStore((s) => s.snapshot);
  const stack = snap?.techStack;
  if (!stack || stack.matches.length === 0) {
    return (
      <Card title="Tech stack" subtitle="No fingerprints matched">
        <div className="text-[11px] text-panel-muted">
          Try a richer page — the detector probes ~50 library globals + URL patterns.
        </div>
      </Card>
    );
  }
  const high = stack.matches.filter((m) => m.confidence === 'high');
  const mid = stack.matches.filter((m) => m.confidence === 'medium');
  return (
    <Card
      title="Tech stack"
      subtitle={`${stack.matches.length} match${stack.matches.length === 1 ? '' : 'es'} · ${high.length} high-confidence`}
    >
      <div className="flex flex-wrap gap-1">
        {[...high, ...mid].slice(0, 14).map((m) => (
          <span
            key={m.id}
            title={m.evidence.join('\n')}
            className={
              'rounded border px-1.5 py-0.5 text-[10px] ' +
              (m.confidence === 'high'
                ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200')
            }
          >
            {m.name}
            {m.version ? ` ${m.version}` : ''}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ModulesCard({
  summary,
  modulesCount,
  onOpenTab,
}: {
  summary: ReturnType<typeof summarizeModules> | null;
  modulesCount: number;
  onOpenTab(): void;
}) {
  if (!summary || modulesCount === 0) {
    return (
      <Card title="Modules" subtitle="No assets indexed">
        <div className="text-[11px] text-panel-muted">
          Reload the page with DevTools open, or re-capture to inventory
          performance entries.
        </div>
      </Card>
    );
  }
  const kinds = Object.entries(summary.byKind).sort(
    (a, b) => (b[1]?.bytes ?? 0) - (a[1]?.bytes ?? 0),
  );
  const max = Math.max(1, ...kinds.map(([, v]) => v!.bytes));
  return (
    <Card
      title="Modules"
      subtitle={`${summary.total} assets · ${formatBytes(summary.totalBytes)}`}
      onTitleClick={onOpenTab}
    >
      <ul className="space-y-1">
        {kinds.slice(0, 5).map(([kind, v]) => (
          <li key={kind} className="text-[11px]">
            <div className="flex justify-between text-panel-text/90">
              <span>
                {kind} · {v!.count}
              </span>
              <span className="font-mono text-panel-muted">{formatBytes(v!.bytes)}</span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-panel-accent/60"
                style={{ width: `${(v!.bytes / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FederationCard({ onOpenTab }: { onOpenTab(): void }) {
  const snap = useStore((s) => s.snapshot);
  const fed = snap?.federation;
  if (!fed) {
    return (
      <Card title="Federation" subtitle="Not detected">
        <div className="text-[11px] text-panel-muted">
          No Module Federation, Native Federation, or import-map remotes found.
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Federation"
      subtitle={`${fed.kind} · ${fed.remotes.length} remote${fed.remotes.length === 1 ? '' : 's'}`}
      onTitleClick={onOpenTab}
    >
      <div className="text-[11px] text-panel-text/90">
        <div className="mb-1">
          <span className="text-panel-muted">Host:</span> {fed.host.name}
        </div>
        {fed.remotes.slice(0, 5).map((r) => (
          <div key={r.name} className="flex justify-between gap-2">
            <span className="truncate">{r.name}</span>
            <span className={r.loaded ? 'text-emerald-300' : 'text-panel-muted'}>
              {r.loaded ? 'loaded' : 'pending'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
  onTitleClick,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onTitleClick?: () => void;
}) {
  return (
    <div className="rounded border border-panel-border bg-panel-bg/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="text-left text-[12px] font-semibold text-white hover:text-panel-accent"
          >
            {title} →
          </button>
        ) : (
          <span className="text-[12px] font-semibold text-white">{title}</span>
        )}
        {subtitle && <span className="text-[10px] text-panel-muted">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Always-visible gallery of preset buttons. Built-ins on top, user-defined
 * prompts below with delete affordances. An "Add custom prompt" form is
 * surfaced via a collapsible <details> so it doesn't compete for space.
 */
function PresetGallery({
  onApplyPreset,
}: {
  onApplyPreset(preset: PromptPreset): void;
}) {
  const settings = useStore((s) => s.settings);
  const customPrompts = settings.customPrompts ?? [];
  const [showForm, setShowForm] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const persistCustomPrompts = async (next: CustomPrompt[]) => {
    await saveSettings({ ...settings, customPrompts: next });
    // The settings subscription in App.tsx will refresh the store.
  };

  const addCustom = async () => {
    const label = draftLabel.trim();
    const prompt = draftPrompt.trim();
    if (!label) return setError('Name is required.');
    if (!prompt) return setError('Prompt body is required.');
    const id = 'custom-' + Date.now().toString(36);
    const next: CustomPrompt[] = [
      ...customPrompts,
      { id, label, description: draftDescription.trim() || undefined, prompt },
    ];
    await persistCustomPrompts(next);
    setDraftLabel('');
    setDraftDescription('');
    setDraftPrompt('');
    setError(null);
    setShowForm(false);
  };

  const deleteCustom = async (id: string) => {
    await persistCustomPrompts(customPrompts.filter((p) => p.id !== id));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-panel-muted">
          Run a preset
        </h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-[11px] text-panel-accent hover:text-sky-300"
        >
          {showForm ? 'Cancel' : '+ Add custom prompt'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PROMPT_PRESETS.map((p) => (
          <PresetButton key={p.id} preset={p} onApply={onApplyPreset} />
        ))}
      </div>

      {customPrompts.length > 0 && (
        <>
          <h4 className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-panel-muted">
            Your custom prompts ({customPrompts.length})
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {customPrompts.map((p) => (
              <PresetButton
                key={p.id}
                preset={{ id: p.id, label: p.label, description: p.description ?? '', prompt: p.prompt }}
                onApply={onApplyPreset}
                onDelete={() => void deleteCustom(p.id)}
              />
            ))}
          </div>
        </>
      )}

      {showForm && (
        <div className="mt-3 rounded border border-panel-border bg-panel-bg/40 p-3">
          <div className="mb-2 text-[11px] font-semibold text-white">Add custom prompt</div>
          <div className="space-y-2 text-[11px]">
            <label className="block">
              <span className="text-panel-muted">Name</span>
              <input
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="e.g. Accessibility audit"
                className="mt-0.5 w-full rounded border border-panel-border bg-panel-bg px-2 py-1 text-[12px] text-panel-text"
              />
            </label>
            <label className="block">
              <span className="text-panel-muted">Description (optional)</span>
              <input
                type="text"
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="Short hint shown on the button"
                className="mt-0.5 w-full rounded border border-panel-border bg-panel-bg px-2 py-1 text-[12px] text-panel-text"
              />
            </label>
            <label className="block">
              <span className="text-panel-muted">Prompt</span>
              <textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                placeholder="What should the LLM do? Markdown supported."
                rows={6}
                className="mt-0.5 w-full rounded border border-panel-border bg-panel-bg p-2 font-mono text-[11px] text-panel-text"
              />
            </label>
            {error && <div className="text-[11px] text-red-300">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="rounded border border-panel-border px-2 py-1 text-[11px] text-panel-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void addCustom()}
                className="rounded bg-panel-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400"
              >
                Save prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PresetButton({
  preset,
  onApply,
  onDelete,
}: {
  preset: PromptPreset;
  onApply(p: PromptPreset): void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative rounded border border-panel-border bg-panel-bg/60 hover:border-panel-accent">
      <button
        type="button"
        onClick={() => onApply(preset)}
        className="block w-full p-2 text-left"
      >
        <div className="text-[11px] font-semibold text-white">{preset.label}</div>
        {preset.description && (
          <div className="mt-0.5 text-[10px] text-panel-muted">{preset.description}</div>
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete this custom prompt"
          className="absolute right-1 top-1 hidden rounded px-1 text-[10px] text-panel-muted hover:text-red-300 group-hover:block"
        >
          ✕
        </button>
      )}
    </div>
  );
}

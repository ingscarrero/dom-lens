import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { extractMermaidBlocks } from '@/lib/diagrams/extractMermaid';
import { MermaidBlock } from '@/lib/ui/MermaidBlock';
import { MarkdownEditor } from '@/lib/ui/MarkdownEditor';

/**
 * Aggregates every ```mermaid block emitted across the chat transcript plus
 * an optional "scratchpad" where the user can paste/sketch a diagram for
 * quick iteration. Keeping diagrams in a dedicated tab makes architecture
 * reviews easier — the user doesn't have to scroll the chat to compare.
 */
export default function DiagramsTab() {
  const chat = useStore((s) => s.chat);
  const [scratch, setScratch] = useState('');

  const diagrams = useMemo(() => {
    const out: Array<{
      turnId: string;
      turnIndex: number;
      blocks: ReturnType<typeof extractMermaidBlocks>;
    }> = [];
    chat.forEach((turn, i) => {
      if (turn.role !== 'assistant') return;
      const blocks = extractMermaidBlocks(turn.content);
      if (blocks.length === 0) return;
      out.push({ turnId: turn.id, turnIndex: i, blocks });
    });
    return out;
  }, [chat]);

  const total = diagrams.reduce((n, t) => n + t.blocks.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-panel-border bg-panel-surface px-3 py-2 text-[11px] text-panel-muted">
        {total} diagram{total === 1 ? '' : 's'} extracted from the chat transcript.{' '}
        Mermaid syntax — flowcharts, sequence, class, ERD, state, etc.
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {total === 0 && (
          <div className="rounded border border-dashed border-panel-border p-4 text-xs text-panel-muted">
            No diagrams yet. Use the <strong>Analyze</strong> tab and ask the LLM to
            <em> &ldquo;diagram the architecture as mermaid&rdquo;</em> — assistant
            replies with <code>```mermaid</code> blocks will auto-render here.
          </div>
        )}

        {diagrams.map((turn) => (
          <section key={turn.turnId} className="mb-6">
            <h3 className="mb-2 text-[12px] font-semibold text-white">
              Reply #{Math.floor(turn.turnIndex / 2) + 1}
            </h3>
            {turn.blocks.map((b) => (
              <MermaidBlock
                key={`${turn.turnId}-${b.index}`}
                source={b.source}
                title={b.title}
              />
            ))}
          </section>
        ))}

        <section className="mt-6">
          <h3 className="mb-2 text-[12px] font-semibold text-white">Scratchpad</h3>
          <div className="mb-2 text-[11px] text-panel-muted">
            Paste any Mermaid source to preview. Useful for iterating on an LLM-suggested
            diagram before sending it back.
          </div>
          <MarkdownEditor
            value={scratch}
            onChange={setScratch}
            placeholder={'```mermaid\nflowchart TD\n  Host --> RemoteA\n  Host --> RemoteB\n```'}
            rows={8}
          />
        </section>
      </div>
    </div>
  );
}

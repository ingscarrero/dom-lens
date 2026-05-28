import { useState } from 'react';
import { useStore } from '../store';
import type { LmChatPayload, ChatMessage } from '@/lib/bridge/protocol';
import { buildSnapshotPrompt } from '@/lib/lm-studio/client';
import type { Snapshot } from '@/lib/snapshot/types';

interface Props {
  onSend(payload: LmChatPayload, requestId: string): void;
  onCancel(): void;
}

function summarizeReact(snap: Snapshot): string | undefined {
  if (!snap.react) return undefined;
  const total = countTree(snap.react.tree);
  const named = topNames(snap.react.tree);
  return `${snap.react.rootCount} root(s), ${total} non-host components.
Most common: ${named.join(', ')}`;
}

function summarizeFederation(snap: Snapshot): string | undefined {
  if (!snap.federation) return undefined;
  const f = snap.federation;
  const remoteLines = f.remotes.map(
    (r) =>
      `- ${r.name} (${r.loaded ? 'loaded' : 'pending'}) — ${r.entry} — exposes: ${
        r.exposes.join(', ') || '(none)'
      }`,
  );
  return `Kind: ${f.kind}
Host: ${f.host.name}
Shared: ${f.host.shared.join(', ') || '(none)'}
Remotes:
${remoteLines.join('\n')}`;
}

function summarizeConsole(snap: Snapshot): string | undefined {
  const errs = snap.console.filter((c) => c.level === 'error' || c.level === 'warn');
  if (errs.length === 0) return undefined;
  return errs
    .slice(0, 20)
    .map((c) => `[${c.level}] ${c.message}`)
    .join('\n');
}

function countTree(nodes: Array<{ name: string; kind: string; children: any[] }>): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind !== 'host' && node.kind !== 'text') n++;
    n += countTree(node.children);
  }
  return n;
}
function topNames(
  nodes: Array<{ name: string; kind: string; children: any[] }>,
  bag: Map<string, number> = new Map(),
): string[] {
  for (const node of nodes) {
    if (node.kind !== 'host' && node.kind !== 'text') {
      bag.set(node.name, (bag.get(node.name) ?? 0) + 1);
    }
    topNames(node.children, bag);
  }
  return [...bag.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n, c]) => `${n}×${c}`);
}

export default function AnalyzeTab({ onSend, onCancel }: Props) {
  const snap = useStore((s) => s.snapshot);
  const settings = useStore((s) => s.settings);
  const chat = useStore((s) => s.chat);
  const startChat = useStore((s) => s.startChat);
  const resetChat = useStore((s) => s.resetChat);
  const chatRequestId = useStore((s) => s.chatRequestId);
  const [input, setInput] = useState('Summarize this page: what does it do, what are the main components, and what is its architecture?');

  const send = () => {
    if (!snap || !input.trim() || chatRequestId) return;

    const userMsg = buildSnapshotPrompt(
      input.trim(),
      settings.includeMarkdown ? snap.dom.markdown : undefined,
      settings.includeScreenshot ? snap.screenshot?.dataUrl : undefined,
      {
        reactSummary: settings.includeReactTree ? summarizeReact(snap) : undefined,
        federationSummary: settings.includeFederation ? summarizeFederation(snap) : undefined,
        consoleSummary: settings.includeConsole ? summarizeConsole(snap) : undefined,
      },
    );

    const turnId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const visibleText =
      typeof userMsg.content === 'string'
        ? input.trim()
        : input.trim() + ' (+ snapshot' + (settings.includeScreenshot && snap.screenshot ? ' + image)' : ')');

    startChat({ id: turnId, role: 'user', content: visibleText });
    setInput('');

    const messages: ChatMessage[] = [
      { role: 'system', content: settings.systemPrompt },
      userMsg,
    ];

    onSend(
      {
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey || undefined,
        model: settings.model,
        messages,
      },
      requestId,
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-panel-border bg-panel-surface px-3 py-1.5 text-[11px]">
        <div className="text-panel-muted">
          {snap ? `Snapshot ready · ${snap.dom.charCount.toLocaleString()} md chars` : 'No snapshot — capture one first'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-panel-muted hover:text-white"
            onClick={resetChat}
            disabled={chat.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-3 overflow-auto p-3 text-xs">
        {chat.length === 0 && (
          <div className="text-panel-muted">
            Ask anything about the captured snapshot. Your message + the page DOM (and screenshot, if
            enabled) are sent to <span className="font-mono">{settings.baseUrl}</span>.
          </div>
        )}
        {chat.map((t) => (
          <div
            key={t.id}
            className={
              'rounded border p-2 ' +
              (t.role === 'user'
                ? 'border-panel-border bg-panel-surface'
                : 'border-panel-accent/30 bg-panel-accent/10')
            }
          >
            <div className="mb-1 text-[10px] uppercase text-panel-muted">
              {t.role} {t.streaming && '· streaming'}
            </div>
            <div className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
              {t.content}
              {t.streaming && <span className="ml-0.5 animate-pulse">▍</span>}
            </div>
            {t.error && <div className="mt-1 text-red-300">{t.error}</div>}
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-panel-border bg-panel-surface p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={snap ? 'Ask about the snapshot…' : 'Capture a snapshot first.'}
          rows={3}
          className="scrollbar-thin flex-1 resize-none rounded border border-panel-border bg-black/30 p-2 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="rounded bg-panel-accent px-3 py-1 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={!snap || !input.trim() || !!chatRequestId}
            onClick={send}
          >
            Send
          </button>
          <button
            type="button"
            className="rounded border border-panel-border px-3 py-1 text-xs text-panel-muted hover:text-white disabled:opacity-50"
            disabled={!chatRequestId}
            onClick={onCancel}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}

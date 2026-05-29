import { useRef, useState, useCallback, type KeyboardEvent } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  value: string;
  onChange(value: string): void;
  onSubmit?(): void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /**
   * If provided, label of the submit shortcut shown in the footer hint
   * (e.g. "⌘+Enter"). Purely informational.
   */
  submitHint?: string;
}

type Mode = 'write' | 'preview';

interface InsertSpec {
  before: string;
  after?: string;
  /** Placeholder text inserted when the selection is empty. */
  placeholder?: string;
  /** If true, inserts on a fresh line. */
  block?: boolean;
}

const SPECS: Record<string, InsertSpec> = {
  bold: { before: '**', after: '**', placeholder: 'bold' },
  italic: { before: '_', after: '_', placeholder: 'italic' },
  inlineCode: { before: '`', after: '`', placeholder: 'code' },
  link: { before: '[', after: '](https://)', placeholder: 'label' },
  list: { before: '- ', placeholder: 'item', block: true },
  numberedList: { before: '1. ', placeholder: 'item', block: true },
  quote: { before: '> ', placeholder: 'quote', block: true },
  codeBlock: { before: '```\n', after: '\n```', placeholder: 'code', block: true },
  heading: { before: '## ', placeholder: 'heading', block: true },
};

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 4,
  disabled,
  submitHint = '⌘+Enter',
}: Props) {
  const [mode, setMode] = useState<Mode>('write');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const insert = useCallback(
    (specKey: keyof typeof SPECS) => {
      const ta = ref.current;
      if (!ta) return;
      const spec = SPECS[specKey];
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end);
      const text = selected || spec.placeholder || '';
      let prefix = value.slice(0, start);
      const suffix = value.slice(end);
      if (spec.block) {
        // Ensure we're on a fresh line
        if (prefix.length > 0 && !prefix.endsWith('\n')) prefix += '\n';
      }
      const insertion = spec.before + text + (spec.after ?? '');
      const next = prefix + insertion + suffix;
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        const selStart = prefix.length + spec.before.length;
        const selEnd = selStart + text.length;
        ta.setSelectionRange(selStart, selEnd);
      });
    },
    [value, onChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (!meta) return;
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      insert('bold');
    } else if (key === 'i') {
      e.preventDefault();
      insert('italic');
    } else if (key === 'e') {
      e.preventDefault();
      insert('inlineCode');
    } else if (key === 'k') {
      e.preventDefault();
      insert('link');
    }
  };

  const btn =
    'rounded px-1.5 py-0.5 text-[11px] text-panel-text hover:bg-white/10 disabled:opacity-50';
  const tab = (active: boolean) =>
    'px-2 py-0.5 text-[11px] rounded-t ' +
    (active ? 'bg-black/30 text-white' : 'text-panel-muted hover:text-white');

  return (
    <div className="flex w-full flex-col rounded border border-panel-border bg-black/30">
      <div className="flex items-center justify-between border-b border-panel-border bg-panel-surface px-1.5 py-1">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => insert('bold')} title="Bold ⌘+B">
            <b>B</b>
          </button>
          <button type="button" className={btn} onClick={() => insert('italic')} title="Italic ⌘+I">
            <i>I</i>
          </button>
          <button type="button" className={btn} onClick={() => insert('inlineCode')} title="Code ⌘+E">
            {'</>'}
          </button>
          <button type="button" className={btn} onClick={() => insert('link')} title="Link ⌘+K">
            🔗
          </button>
          <span className="mx-1 h-3 w-px bg-panel-border" />
          <button type="button" className={btn} onClick={() => insert('heading')} title="Heading">
            H
          </button>
          <button type="button" className={btn} onClick={() => insert('list')} title="Bulleted list">
            •—
          </button>
          <button type="button" className={btn} onClick={() => insert('numberedList')} title="Numbered list">
            1.
          </button>
          <button type="button" className={btn} onClick={() => insert('quote')} title="Quote">
            ❝
          </button>
          <button type="button" className={btn} onClick={() => insert('codeBlock')} title="Code block">
            { }
          </button>
        </div>
        <div className="flex items-center gap-0">
          <button type="button" className={tab(mode === 'write')} onClick={() => setMode('write')}>
            Write
          </button>
          <button
            type="button"
            className={tab(mode === 'preview')}
            onClick={() => setMode('preview')}
            disabled={!value.trim()}
          >
            Preview
          </button>
        </div>
      </div>
      {mode === 'write' ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className="scrollbar-thin block w-full resize-y bg-transparent px-2 py-1.5 font-mono text-[12px] text-panel-text focus:outline-none disabled:opacity-50"
        />
      ) : (
        <div className="scrollbar-thin min-h-[80px] max-h-[400px] overflow-auto px-2 py-1.5">
          {value.trim() ? (
            <MarkdownRenderer source={value} />
          ) : (
            <span className="text-panel-muted text-[11px]">Nothing to preview.</span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-panel-border bg-panel-surface/40 px-2 py-0.5 text-[10px] text-panel-muted">
        <span>Markdown supported · {submitHint} to send</span>
        <span>{value.length} chars</span>
      </div>
    </div>
  );
}

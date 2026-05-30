import { useMemo, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

interface Props {
  code: string;
  /** Prism language token (js/ts/jsx/tsx/css/html/json/svg/markdown/yaml/sh/python/go/rust/text). */
  language?: string;
  /** Optional path/URL shown in the toolbar. */
  filename?: string;
  /** Maximum CSS height of the code area. The default fills the parent. */
  maxHeight?: string;
  /** When true, the toolbar (line-count, language, copy) is hidden. */
  bare?: boolean;
}

/**
 * Pure-JS syntax-highlighted code viewer for the Modules tab's file
 * detail view and any future "view source" surfaces.
 *
 * Uses prism-react-renderer:
 *   - Pure regex grammar — no `new Function`, no `eval`. Safe under the
 *     extension page's strict CSP that bit us with source-map-js in
 *     v0.3.12.
 *   - ~30 KB minified. Used by Docusaurus, MDX, code.juejin.cn, etc.
 *   - React tokens via render prop, easy to layer line numbers and
 *     copy controls.
 *
 * Features:
 *   - Syntax highlighting for the languages bundled by prism-react-renderer
 *     out of the box (JS/TS/JSX/TSX/CSS/HTML/JSON/SVG/markdown/yaml/shell/
 *     python/go/rust). Falls back to "no highlighting" for unknown
 *     languages — still readable.
 *   - Line numbers in a separate gutter column.
 *   - Word-wrap toggle: ↩ button. Off by default so long lines stay
 *     horizontally scrollable (matches editor convention).
 *   - Copy button using `navigator.clipboard.writeText`.
 *   - Sticky toolbar with language label + filename when supplied.
 */
export function CodeViewer({ code, language, filename, maxHeight, bare }: Props) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const lang = (language ?? 'text').toLowerCase();
  const lineCount = useMemo(() => (code ? code.split('\n').length : 0), [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard write blocked — ignore */
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {!bare && (
        <div className="flex shrink-0 items-center justify-between border-b border-panel-border bg-panel-bg/40 px-2 py-1 text-[10px]">
          <div className="flex items-center gap-2 text-panel-muted">
            {filename && <span className="truncate font-mono">{filename}</span>}
            <span className="rounded bg-slate-700/40 px-1 uppercase">{lang}</span>
            <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWrap((v) => !v)}
              title={wrap ? 'Disable word wrap' : 'Wrap long lines'}
              className={
                'rounded border border-panel-border px-1.5 py-0.5 hover:text-white ' +
                (wrap ? 'bg-panel-accent/20 text-white' : 'text-panel-muted')
              }
            >
              ↩ wrap
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy to clipboard"
              className="rounded border border-panel-border px-1.5 py-0.5 text-panel-muted hover:text-white"
            >
              {copied ? '✓ copied' : '⧉ copy'}
            </button>
          </div>
        </div>
      )}
      <div
        className="scrollbar-thin min-h-0 flex-1 overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <Highlight code={code ?? ''} language={lang} theme={themes.vsDark}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={
                'm-0 min-w-full px-2 py-1.5 font-mono text-[11px] leading-snug ' +
                (wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre') +
                ' ' +
                (className ?? '')
              }
              style={{ ...style, background: 'transparent' }}
            >
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line });
                return (
                  <div key={i} {...lineProps} className={(lineProps.className ?? '') + ' flex'}>
                    <span className="mr-2 w-8 shrink-0 select-none text-right text-panel-muted/60">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      {line.map((token, j) => (
                        <span key={j} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}

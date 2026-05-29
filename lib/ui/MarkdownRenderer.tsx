import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  source: string;
  className?: string;
  compact?: boolean;
}

/**
 * Dark-panel-themed markdown renderer.
 * Safe by default — raw HTML in the source is NOT rendered.
 */
function MarkdownRendererImpl({ source, className, compact }: Props) {
  return (
    <div
      className={
        'markdown-body text-[12px] leading-relaxed ' +
        (compact ? 'space-y-1 ' : 'space-y-2 ') +
        (className ?? '')
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mt-2 mb-1 text-base font-bold text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-2 mb-1 text-sm font-bold text-white">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 mb-0.5 text-[13px] font-semibold text-white">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-1 text-[12px] font-semibold text-white">{children}</h4>,
          p: ({ children }) => <p>{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-panel-accent underline underline-offset-2 hover:text-sky-300"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-panel-accent/60 bg-panel-surface/40 px-2 py-1 text-panel-text/80">
              {children}
            </blockquote>
          ),
          // react-markdown v10 removed the `inline` flag on the `code` component.
          // Block code has a `language-xxx` className (set by the markdown parser
          // for fenced blocks). Inline backtick code has no className. The block
          // <pre> wrapping is handled by the separate `pre` override below.
          code: ({ className, children, ...rest }: any) => {
            const isBlock = /language-/.test(className || '');
            if (isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[11px] text-amber-200">
                {children}
              </code>
            );
          },
          pre: ({ children, ...rest }: any) => {
            // Try to surface the language label (from the inner <code className="language-xxx">)
            let lang: string | undefined;
            const node: any = (rest as any).node;
            try {
              const codeNode = node?.children?.find((c: any) => c.tagName === 'code');
              const cls: string = codeNode?.properties?.className?.[0] ?? '';
              const m = /language-(\w+)/.exec(cls);
              if (m) lang = m[1];
            } catch {
              /* ignore */
            }
            return (
              <pre className="scrollbar-thin my-1 max-w-full overflow-auto rounded border border-panel-border bg-black/50 p-2 font-mono text-[11px] leading-snug">
                {lang && (
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
                    {lang}
                  </div>
                )}
                {children}
              </pre>
            );
          },
          table: ({ children }) => (
            <div className="scrollbar-thin overflow-auto">
              <table className="my-1 border-collapse text-[11px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-panel-surface">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-panel-border px-2 py-1 text-left font-semibold text-white">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-panel-border px-2 py-1 align-top">{children}</td>
          ),
          hr: () => <hr className="my-2 border-panel-border" />,
          img: ({ src, alt }) => (
            <img src={src ?? undefined} alt={alt} className="my-1 max-h-64 rounded border border-panel-border" />
          ),
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="text-panel-muted line-through">{children}</del>,
          input: ({ checked, disabled, type }: any) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={!!checked}
                  disabled={disabled}
                  readOnly
                  className="mr-1 align-middle"
                />
              );
            }
            return null;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererImpl);

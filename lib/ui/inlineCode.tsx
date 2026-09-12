import type { ReactNode } from 'react';

/**
 * Render a one-line description that uses markdown-style backticks for
 * inline code (as produced by `describeInputs()`), e.g.
 * `Selected component: \`Button\``.
 *
 * Segments become React text nodes and `<code>` elements, so
 * page-derived values (tag names, ids, class names, component names)
 * are escaped by React instead of being concatenated into an HTML
 * string and injected with `dangerouslySetInnerHTML`.
 */
export function renderInlineCode(text: string, codeClassName?: string): ReactNode[] {
  return text
    .split(/`([^`]*)`/g)
    .map((part, i): ReactNode =>
      i % 2 === 1 ? (
        <code key={i} className={codeClassName}>
          {part}
        </code>
      ) : (
        part
      ),
    )
    .filter((node) => node !== '');
}

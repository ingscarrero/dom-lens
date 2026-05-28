import TurndownService from 'turndown';

export interface SerializedDom {
  html: string;
  markdown: string;
  charCount: number;
}

let cachedService: TurndownService | null = null;

function getService(): TurndownService {
  if (cachedService) return cachedService;
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    linkStyle: 'inlined',
  });
  td.remove(['script', 'style', 'noscript', 'iframe', 'meta', 'link'] as any);
  td.addRule('dropSvg', { filter: 'svg' as any, replacement: () => '' });
  td.addRule('keepDataTestId', {
    filter: (node) => {
      const el = node as HTMLElement;
      return (
        el.nodeType === 1 &&
        (el.hasAttribute('data-testid') ||
          el.hasAttribute('data-test-id') ||
          el.hasAttribute('aria-label')) &&
        !['SCRIPT', 'STYLE'].includes(el.tagName)
      );
    },
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const id =
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test-id') ||
        el.getAttribute('aria-label') ||
        '';
      if (!id) return content;
      return `[${id}]{${content}}`;
    },
  });
  cachedService = td;
  return td;
}

function cloneForSerialization(): HTMLElement {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const sel of ['script', 'style', 'noscript', 'svg', 'iframe', 'link', 'meta']) {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  }
  return clone;
}

export function serializeDom(maxMarkdownChars = 50000): SerializedDom {
  const html = document.documentElement.outerHTML;
  let markdown = '';
  try {
    const clean = cloneForSerialization();
    markdown = getService().turndown(clean.outerHTML);
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    markdown = `<!-- markdown serialization failed: ${(e as Error).message} -->\n` + html;
  }
  if (markdown.length > maxMarkdownChars) {
    markdown =
      markdown.slice(0, maxMarkdownChars) +
      `\n\n<!-- truncated at ${maxMarkdownChars} chars (full length ${markdown.length}) -->`;
  }
  return { html, markdown, charCount: markdown.length };
}

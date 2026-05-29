/**
 * HTML artifacts — the LLM emits a self-contained HTML document inside a
 * ```html fenced block, we render it in a sandboxed iframe via `srcdoc`.
 *
 * Same shape as our Mermaid extraction (lib/diagrams/extractMermaid.ts) so
 * the Insights "Generated …" sections feel consistent.
 *
 * Design notes:
 *   - We accept any ```html fence as an artifact. Optionally the LLM can
 *     prefix a comment line `<!-- title: My dashboard -->` at the top to
 *     name it; we extract that as the title.
 *   - Inline ```html blocks shorter than 80 chars are NOT treated as
 *     artifacts (they're probably HTML snippets pasted as examples, not
 *     intended to render). The threshold is heuristic and configurable.
 */

export interface ArtifactBlock {
  source: string;
  index: number;
  title?: string;
}

const FENCE_RE = /```html\s*\n([\s\S]*?)```/g;
const TITLE_RE = /<!--\s*title:\s*(.+?)\s*-->/i;

/** Minimum HTML payload to consider it an artifact. Below this we assume
 * it's a code-example snippet, not a renderable artifact. */
const MIN_BODY_CHARS = 80;

export function extractArtifacts(markdown: string): ArtifactBlock[] {
  const blocks: ArtifactBlock[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = FENCE_RE.exec(markdown)) != null) {
    const src = m[1].trim();
    if (src.length < MIN_BODY_CHARS) continue;
    // Accept either a full HTML document or a body fragment. Heuristic:
    // an artifact has at least one tag.
    if (!/<[a-zA-Z]/.test(src)) continue;
    const titleMatch = src.match(TITLE_RE);
    const title = titleMatch ? titleMatch[1].trim() : findPrecedingHeading(markdown.slice(0, m.index));
    blocks.push({ source: src, index: idx++, title });
  }
  return blocks;
}

/**
 * Heuristic: pick the most recent markdown heading immediately before the
 * artifact block. Lets the user title artifacts naturally with `### Foo`
 * above the fence.
 */
function findPrecedingHeading(before: string): string | undefined {
  const tail = before.slice(-500);
  const lines = tail.split(/\n/).reverse();
  for (const line of lines) {
    const trim = line.trim();
    if (!trim) continue;
    const h = trim.match(/^#{1,6}\s+(.+)$/);
    if (h) return h[1].trim();
    if (trim.length > 2) return undefined;
  }
  return undefined;
}

/**
 * Wraps a raw artifact source in a minimal HTML document if it isn't already
 * one. Lets the LLM emit just a body fragment when convenient.
 */
export function normalizeArtifactSource(source: string): string {
  const trimmed = source.trim();
  if (/^\s*<!doctype/i.test(trimmed) || /^\s*<html\b/i.test(trimmed)) {
    return trimmed;
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>DOM Lens artifact</title>',
    '<style>',
    'html,body{margin:0;padding:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.45;}',
    'body{padding:12px;}',
    '*{box-sizing:border-box;}',
    'a{color:#0ea5e9;}',
    '</style>',
    '</head>',
    '<body>',
    trimmed,
    '</body>',
    '</html>',
  ].join('\n');
}

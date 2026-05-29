/**
 * Pull all ```mermaid fenced blocks out of a markdown string. Used by the
 * Diagrams tab to surface chart artifacts emitted by the LLM separately from
 * the chat transcript.
 */
export interface MermaidBlock {
  source: string;
  /** Index of the block in document order — used as a fallback heading. */
  index: number;
  /** Optional title parsed from a preceding `### Title` line, if any. */
  title?: string;
}

const FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g;

export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = FENCE_RE.exec(markdown)) != null) {
    const src = m[1].trim();
    if (!src) continue;
    const before = markdown.slice(0, m.index);
    const title = findPrecedingHeading(before);
    blocks.push({ source: src, index: idx++, title });
  }
  return blocks;
}

function findPrecedingHeading(before: string): string | undefined {
  // Look back through the last ~500 chars for a markdown heading.
  const window = before.slice(-500);
  const lines = window.split(/\n/).reverse();
  for (const line of lines) {
    const trim = line.trim();
    if (!trim) continue;
    const h = trim.match(/^#{1,6}\s+(.+)$/);
    if (h) return h[1].trim();
    // Stop searching once we hit non-heading content (paragraph).
    if (trim.length > 2) return undefined;
  }
  return undefined;
}

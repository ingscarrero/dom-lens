/**
 * Per-page session memory.
 *
 * Lets the user accumulate insights across AI analyses on the same page
 * and fold them back into later prompts. The canonical workflow:
 *
 *   1. Run an Aesthetics & Branding analysis on the whole-page root.
 *   2. Save the result to memory.
 *   3. Pick a smaller region (a card, a hero, a CTA).
 *   4. Run a Layout & Composition analysis with the memory included.
 *   5. The model now has the page-level design principles available
 *      and can ground the smaller analysis in them.
 *   6. Eventually ask "suggest 3 alternative layouts that fit this
 *      page's principles" — memory makes the constraint explicit.
 *
 * Memory is in-memory only — no `chrome.storage` write — and keyed by
 * page (origin + pathname). When the user captures a snapshot of a
 * different page, the previous page's memory stays but is invisible
 * (we read by current pageKey). Reset on snapshot change of the same
 * page is deliberate: the user usually wants a fresh slate when they
 * recapture.
 *
 * Budget knobs (constants below) keep prompt sizes bounded:
 *   - MAX_ENTRY_BYTES — single entry hard ceiling. Long analyses get
 *     truncated when saved.
 *   - MAX_TOTAL_BYTES — total memory budget per page. Oldest entries
 *     drop when a new entry would push the total over.
 */

const MAX_ENTRY_BYTES = 6 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024;

export interface MemoryEntry {
  id: string;
  /** Short human label shown in chips and the memory list. */
  label: string;
  /** Source action / preset id, used for icon + grouping. */
  sourceId?: string;
  /** Source preset icon (one glyph). */
  icon?: string;
  /** Optional component name + kind the analysis was scoped to. */
  componentName?: string;
  componentKind?: string;
  /** The text the model emitted (markdown). Truncated to MAX_ENTRY_BYTES. */
  text: string;
  /** When the entry was saved. */
  timestamp: number;
}

/**
 * Stable per-page key. Strips query + hash so different routes on the
 * same SPA share memory only if they're on the same pathname.
 */
export function pageKey(url: string | undefined | null): string {
  if (!url) return '__unknown__';
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/**
 * Insert a new entry at the head (most recent first). Truncates the
 * entry's text to MAX_ENTRY_BYTES and drops oldest entries until the
 * total fits under MAX_TOTAL_BYTES.
 */
export function addMemoryEntry(
  prev: MemoryEntry[] = [],
  entry: Omit<MemoryEntry, 'id' | 'timestamp'>,
): MemoryEntry[] {
  let text = entry.text.trim();
  if (text.length > MAX_ENTRY_BYTES) {
    text = text.slice(0, MAX_ENTRY_BYTES).trimEnd() + '\n\n…(truncated to fit memory budget)';
  }
  const next: MemoryEntry = {
    ...entry,
    text,
    id: 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
  };
  // Drop oldest entries to fit the budget.
  const out = [next, ...prev];
  let total = totalBytes(out);
  while (total > MAX_TOTAL_BYTES && out.length > 1) {
    const dropped = out.pop()!;
    total -= dropped.text.length;
  }
  return out;
}

export function removeMemoryEntry(prev: MemoryEntry[], id: string): MemoryEntry[] {
  return prev.filter((e) => e.id !== id);
}

export function totalBytes(entries: MemoryEntry[]): number {
  let n = 0;
  for (const e of entries) n += e.text.length;
  return n;
}

/**
 * Render a memory bundle as a markdown block ready to be folded into a
 * user message. Each entry gets a heading with its label + source so
 * the model can disambiguate.
 */
export function formatMemoryForPrompt(entries: readonly MemoryEntry[]): string {
  if (!entries.length) return '';
  const out: string[] = [
    '## Memory from prior analyses on this page',
    'The user has already collected these insights about this page. Treat them as background context. Reference them by their headings when relevant; do not just re-state them.',
    '',
  ];
  for (const e of entries) {
    const heading = e.componentName
      ? `### ${e.label} — ${e.componentName}${e.componentKind ? ` (${e.componentKind})` : ''}`
      : `### ${e.label}`;
    out.push(heading);
    out.push(e.text.trim());
    out.push('');
  }
  return out.join('\n');
}

/**
 * Quick stats for the toolbar.
 */
export interface MemoryStats {
  count: number;
  bytes: number;
  /** Total budget (MAX_TOTAL_BYTES), exposed so UI can render a meter. */
  budget: number;
}

export function memoryStats(entries: MemoryEntry[]): MemoryStats {
  return {
    count: entries.length,
    bytes: totalBytes(entries),
    budget: MAX_TOTAL_BYTES,
  };
}

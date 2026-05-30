import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';
import type { SkeletonSymbol } from './skeleton';

const SYMBOL_SYSTEM = `You are a concise senior engineer explaining a single piece of code to another engineer. Given a code fragment, answer in 3-5 short bullets:
- What it does (one line).
- Inputs it consumes (params, requires, globals).
- Outputs / side effects.
- Libraries or APIs it appears to use.
- One sentence on why it might exist in this module.

Do NOT reformat the code or quote it back. Plain text, no markdown headings.`;

/**
 * Build a chat payload that asks the LLM to explain a single skeleton
 * symbol. Trims the slice to a reasonable size (16 KB) so even a 1 MB
 * minified module produces a fast, focused round-trip.
 */
export function buildSymbolSummaryPayload(
  symbol: SkeletonSymbol,
  source: string,
  settings: Settings,
  context: { moduleUrl: string; isMinified?: boolean },
): LmChatPayload {
  const MAX_BYTES = 16 * 1024;
  let slice = source.slice(symbol.start, symbol.end);
  if (slice.length > MAX_BYTES) {
    slice = slice.slice(0, MAX_BYTES) + '\n/* …truncated to first ' + MAX_BYTES + ' bytes for summarization… */';
  }

  const userText = [
    `Module: ${context.moduleUrl}`,
    context.isMinified ? 'Note: source is minified; do NOT reformat — just explain semantics.' : '',
    `Symbol kind: ${symbol.kind}`,
    `Symbol name: ${symbol.name}`,
    `Byte range: ${symbol.start}–${symbol.end} (${symbol.end - symbol.start} bytes)`,
    '',
    'Code:',
    '```',
    slice,
    '```',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYMBOL_SYSTEM },
      { role: 'user', content: userText },
    ],
  };
}

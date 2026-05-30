import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';

/**
 * LLM-driven source reformatting for modules that don't have a sourcemap
 * (or whose sourcemap couldn't be fetched). We send the raw minified
 * source plus a language hint and ask the model to return a readable,
 * indented version inside a single fenced code block.
 *
 * This is a "best-effort beautifier", not a true demangler — variable
 * names will still be minified for JS — but it's enough to make a vendor
 * chunk skimmable and to spot which APIs / strings / library hints live
 * inside it.
 *
 * Languages we support are mapped from the module's chunk kind. See
 * `lib/modules/viewers.ts`.
 */

export type ReformatLanguage =
  | 'javascript'
  | 'typescript'
  | 'css'
  | 'html'
  | 'json'
  | 'svg'
  | 'wasm-wat';

interface LanguageSpec {
  /** Display label shown in the UI. */
  label: string;
  /** Fence tag we ask the model to use (and that we expect to receive). */
  fence: string;
  /** Lines added to the system prompt to steer the model. */
  guidance: string;
}

const SPECS: Record<ReformatLanguage, LanguageSpec> = {
  javascript: {
    label: 'JavaScript',
    fence: 'js',
    guidance:
      'Reformat as readable JavaScript. Preserve all logic and identifiers; only add whitespace, line breaks, and consistent indentation. Add a short comment block at the top summarising what the module appears to do (1-3 sentences). Do not invent identifiers or refactor.',
  },
  typescript: {
    label: 'TypeScript',
    fence: 'ts',
    guidance:
      'Reformat as readable TypeScript. Preserve all logic, identifiers, and explicit types. Add a short comment block at the top summarising what the module appears to do.',
  },
  css: {
    label: 'CSS',
    fence: 'css',
    guidance:
      'Reformat as readable CSS. One declaration per line, four-space indent inside rules, a blank line between unrelated rule sets. Preserve all selectors and declarations verbatim. Do not merge or split selectors.',
  },
  html: {
    label: 'HTML',
    fence: 'html',
    guidance:
      'Reformat as readable HTML. One tag per line where reasonable, two-space indent for nesting. Preserve all attributes and text. Do not change semantics or self-close tags that were not self-closing.',
  },
  json: {
    label: 'JSON',
    fence: 'json',
    guidance:
      'Reformat as pretty-printed JSON, two-space indent. Preserve key order and all values exactly.',
  },
  svg: {
    label: 'SVG',
    fence: 'svg',
    guidance:
      'Reformat as readable SVG. One element per line, two-space indent. Preserve all attributes.',
  },
  'wasm-wat': {
    label: 'WAT (WebAssembly text)',
    fence: 'wat',
    guidance:
      'You only have a binary WASM module. Do NOT attempt to decode it — explain in 3-5 bullet points what is present (sections, imports, exports, function counts) based on the magic-byte prefix and known WASM format.',
  },
};

const SYSTEM = `You are a precise code beautifier. The user gives you a minified or compressed source file. Return ONLY the reformatted code in a single fenced block — no commentary outside the fence, no apologies, no usage hints. Preserve semantics exactly; never refactor, rename, or remove code.`;

/**
 * Build the chat payload for a reformat request. The settings object is
 * used for baseUrl + model + apiKey only (the chat history is empty —
 * this is a one-shot call).
 */
export function buildReformatPayload(
  source: string,
  language: ReformatLanguage,
  settings: Settings,
  meta?: { url?: string; bytes?: number },
): LmChatPayload {
  const spec = SPECS[language];
  const truncated = source.length > 200_000;
  const body = truncated ? source.slice(0, 200_000) : source;
  const header: string[] = [];
  if (meta?.url) header.push(`Source URL: ${meta.url}`);
  if (meta?.bytes) header.push(`Original size: ${meta.bytes} bytes`);
  if (truncated)
    header.push(
      `NOTE: source truncated to first 200,000 chars (full file is ${source.length} chars).`,
    );

  const userText = [
    ...header,
    '',
    spec.guidance,
    '',
    `Return the result inside a single \`\`\`${spec.fence} fenced block.`,
    '',
    `\`\`\`${spec.fence}`,
    body,
    `\`\`\``,
  ].join('\n');

  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userText },
    ],
  };
}

/**
 * Pull the formatted code out of the LLM reply. Accepts either:
 *   - a single fenced block matching the requested fence tag,
 *   - any fenced block (we fall back),
 *   - bare text (we return as-is).
 */
export function parseReformatResponse(text: string, language: ReformatLanguage): string {
  const spec = SPECS[language];
  // Try the requested fence first
  const exact = new RegExp('```' + spec.fence + '\\s*\\n([\\s\\S]*?)```', 'i');
  const m1 = text.match(exact);
  if (m1) return m1[1].trimEnd();
  // Any fence
  const any = text.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  if (any) return any[1].trimEnd();
  // Bare
  return text.trim();
}

export function languageLabel(language: ReformatLanguage): string {
  return SPECS[language].label;
}

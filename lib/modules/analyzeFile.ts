import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';

/**
 * Per-file LLM analysis prompts surfaced in the Modules tab's file
 * viewer. Three actions, all streaming, all returning markdown so the
 * panel can render them with our existing MarkdownRenderer.
 */

export type FileAction = 'audit' | 'improve' | 'explain';

const MAX_BYTES = 24 * 1024; // 24 KB — enough for most authored files

interface ActionSpec {
  label: string;
  hint: string;
  system: string;
  user(opts: { path: string; language: string; sourceSlice: string; truncated: boolean }): string;
}

const SPECS: Record<FileAction, ActionSpec> = {
  audit: {
    label: '✨ Audit',
    hint: 'Security, common bugs, accessibility — prioritized findings.',
    system: `You are a precise senior engineer reviewing one file for risk. Output a short markdown report grouped into:

### Security
### Correctness bugs
### Accessibility (only if the file renders UI)
### Other risks

Each item:
- One line. Cite line numbers when you can.
- Severity in [brackets]: [critical] / [high] / [medium] / [low].
- A one-sentence fix or "needs investigation" — never speculate beyond the file.

If a section is empty, skip it entirely. No preamble, no closing summary, no "I hope this helps".`,
    user: ({ path, language, sourceSlice, truncated }) =>
      [
        `Audit this ${language} file for security, correctness, accessibility, and operational risks.`,
        `Path: ${path}`,
        truncated ? 'NOTE: source truncated to the first 24 KB.' : '',
        '',
        '```' + language,
        sourceSlice,
        '```',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  improve: {
    label: '💡 Improve',
    hint: 'Refactor opportunities — extract, simplify, rename. No rewrites.',
    system: `You are a precise senior engineer suggesting concrete refactors for one file. Output a short markdown list of opportunities. Each item:

- One line. Cite the lines you'd touch.
- Effort in [brackets]: [trivial] / [small] / [medium] / [large].
- Why it matters (perf, readability, testability, etc.).

Do NOT rewrite the file. Do NOT suggest more than 8 items — pick the highest-leverage. Skip changes that only re-name something with no functional benefit. If the file is already clean, say so in one line.`,
    user: ({ path, language, sourceSlice, truncated }) =>
      [
        `Review this ${language} file and list concrete refactor opportunities.`,
        `Path: ${path}`,
        truncated ? 'NOTE: source truncated to the first 24 KB.' : '',
        '',
        '```' + language,
        sourceSlice,
        '```',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  explain: {
    label: '📖 Explain',
    hint: 'What this file does, in 5 bullets.',
    system: `You are a precise senior engineer explaining one file to a new teammate. Output exactly 4-6 markdown bullets:

- **Purpose** (one sentence).
- **Public API** (exports / default export — names only, not signatures).
- **Inputs** (imports it pulls in, env it reads).
- **Outputs / side effects** (what it returns / modifies / persists).
- **Notable patterns** (any framework idioms — hooks, decorators, observers, etc.).
- **Risks** (only if there are concrete ones — security, performance, complexity).

Bold the leading label. No preamble. No closing summary.`,
    user: ({ path, language, sourceSlice, truncated }) =>
      [
        `Explain this ${language} file.`,
        `Path: ${path}`,
        truncated ? 'NOTE: source truncated to the first 24 KB.' : '',
        '',
        '```' + language,
        sourceSlice,
        '```',
      ]
        .filter(Boolean)
        .join('\n'),
  },
};

/**
 * Best-effort language guess from a source path. Used as the fenced-code
 * language tag so the model knows what dialect it's reading.
 */
export function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (/\.tsx?$/.test(lower)) return /\.tsx$/.test(lower) ? 'tsx' : 'ts';
  if (/\.jsx$/.test(lower)) return 'jsx';
  if (/\.m?[cj]s$/.test(lower)) return 'js';
  if (/\.s?css$/.test(lower)) return 'css';
  if (/\.less$/.test(lower)) return 'less';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.html?$/.test(lower)) return 'html';
  if (/\.svelte$/.test(lower)) return 'svelte';
  if (/\.vue$/.test(lower)) return 'vue';
  if (/\.svg$/.test(lower)) return 'svg';
  if (/\.md$/.test(lower)) return 'markdown';
  if (/\.py$/.test(lower)) return 'python';
  if (/\.go$/.test(lower)) return 'go';
  if (/\.rs$/.test(lower)) return 'rust';
  return 'text';
}

export function actionLabel(a: FileAction): string {
  return SPECS[a].label;
}

export function actionHint(a: FileAction): string {
  return SPECS[a].hint;
}

/**
 * Build the chat payload for an action against a single source file.
 * Truncates to the 24 KB ceiling so we don't blow past the model's
 * context window on a large vendor bundle's authored sources.
 */
export function buildFileAnalysisPayload(
  action: FileAction,
  source: string,
  path: string,
  settings: Settings,
): LmChatPayload {
  const spec = SPECS[action];
  const language = detectLanguage(path);
  const truncated = source.length > MAX_BYTES;
  const sourceSlice = truncated ? source.slice(0, MAX_BYTES) : source;
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: action === 'audit' ? 0 : 0.2,
    messages: [
      { role: 'system', content: spec.system },
      { role: 'user', content: spec.user({ path, language, sourceSlice, truncated }) },
    ],
  };
}

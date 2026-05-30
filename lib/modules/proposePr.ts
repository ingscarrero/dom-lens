import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings, GithubMapping } from '@/lib/storage/settings';

/**
 * "Propose changes" / "Open a PR" flow.
 *
 * Generates a structured markdown change plan that's directly handoffable
 * to an AI coding agent (Cursor / Claude Code / Claude Desktop / Claude
 * web), to a GitHub issue, or to a human reviewer. The plan is the
 * deliverable — we deliberately do NOT try to apply changes from the
 * browser. Why:
 *
 *   1. Pushing to a Git repo from a Chrome extension would need a PAT
 *      stored in chrome.storage. That's a real security surface (a
 *      compromised panel could push arbitrary commits). Plans are
 *      inert text.
 *   2. The AI agents the user is going to hand the plan to are already
 *      the right tool for edits. The browser's job is to gather the
 *      context (deployed module URL + sourcemap + GitHub mapping) and
 *      structure the brief.
 *   3. Plans grow naturally — the same plan can be reviewed by a
 *      human, pasted into Cursor, opened as a GitHub issue, or
 *      attached to a discussion. Pushing locks you into one workflow.
 *
 * Deeplink targets we support (validated via web research, current
 * for the 2026 versions of these tools):
 *
 *   - Cursor:           `cursor://anysphere.cursor-deeplink/prompt?text=…`
 *   - Claude Desktop:   `claude://claude.ai/new?q=…`
 *   - Claude.ai (web):  `https://claude.ai/new?q=…`
 *   - GitHub new issue: `https://github.com/<owner>/<repo>/issues/new?title=…&body=…`
 *
 * Each target has a length ceiling (Claude truncates around 14 KB,
 * Cursor handles larger but URLs over ~30 KB choke on Chrome's
 * dispatch). We cap the encoded payload at 8 KB for safety and add a
 * "(plan truncated — see clipboard for full version)" footer when it
 * exceeds that. The full plan is always copyable.
 */

export type ProposeScope = 'file' | 'module';

interface FileScope {
  kind: 'file';
  path: string;
  language: string;
  source: string;
  /** Optional latest analysis result to seed the plan with. */
  context?: string;
}

interface ModuleScope {
  kind: 'module';
  moduleUrl: string;
  /** Comma-joined list of authored file paths, for the model's awareness. */
  fileList: string;
  /** Curated bundle of representative file contents. */
  bundle: string;
  /** Optional latest analysis result to seed the plan with. */
  context?: string;
}

export type Scope = FileScope | ModuleScope;

const SYSTEM = `You are proposing a concrete change to a web app's source code. The change will be implemented by an AI coding agent (Cursor, Claude Code, or similar) or by a human reading the plan.

Output ONLY a markdown change plan with this exact structure:

# <One-line title — start with a verb>

## Rationale
2-4 sentences on why this change matters. Cite the symptom or the goal.

## Files to change
- path/to/file.tsx (modify) — one-line reason
- path/to/new-file.tsx (create) — one-line reason

## Changes

### path/to/file.tsx
Bullet list of specific edits. Cite line numbers when you can. For non-trivial diffs include a diff block:

\`\`\`diff
- old code
+ new code
\`\`\`

(Repeat the \`### path\` heading for each file.)

## Acceptance criteria
- Concrete check 1
- Concrete check 2

## Open questions
- Only include this section if there's something the human genuinely needs to decide. Otherwise omit it.

## Implement-this prompt
A single paragraph (3-5 sentences) that an AI coding agent could paste into its chat box to start the work. Mention the files, the desired outcome, and any constraints. End the paragraph with "Confirm before pushing changes."

No preamble, no closing summary, no apologies. Just the markdown above.`;

/**
 * Build the chat payload for the propose-changes LLM call.
 */
export function buildProposePrPayload(
  scope: Scope,
  userIntent: string,
  settings: Settings,
): LmChatPayload {
  const userBlock =
    scope.kind === 'file' ? formatFileScope(scope, userIntent) : formatModuleScope(scope, userIntent);
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userBlock },
    ],
  };
}

function formatFileScope(scope: FileScope, userIntent: string): string {
  const MAX = 24 * 1024;
  const slice = scope.source.length > MAX ? scope.source.slice(0, MAX) : scope.source;
  const truncated = scope.source.length > MAX;
  return [
    `Goal (what the user wants):`,
    userIntent.trim() || '(no explicit user intent — infer from context below)',
    '',
    scope.context && `Context from previous analysis:\n${scope.context.trim()}\n`,
    `File: ${scope.path}`,
    truncated ? `(source truncated to first 24 KB)` : '',
    '',
    '```' + scope.language,
    slice,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatModuleScope(scope: ModuleScope, userIntent: string): string {
  return [
    `Goal (what the user wants):`,
    userIntent.trim() || '(no explicit user intent — infer from context below)',
    '',
    scope.context && `Context from previous analysis:\n${scope.context.trim()}\n`,
    `Module URL: ${scope.moduleUrl}`,
    '',
    '## File list',
    scope.fileList,
    '',
    '## Representative file contents',
    scope.bundle,
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---------- Export targets ---------- */

const CAP = 8 * 1024;

function safePayload(plan: string, prefix?: string): string {
  let body = prefix ? `${prefix}\n\n${plan}` : plan;
  if (body.length <= CAP) return body;
  body = body.slice(0, CAP) + '\n\n(plan truncated — paste the full version from your clipboard)';
  return body;
}

export interface ExportTarget {
  id: string;
  label: string;
  description: string;
  /** Build a target — either a URL to open OR a synchronous side-effect
   * (like clipboard write). When `kind === 'url'`, the panel opens it
   * in a new tab. When `kind === 'action'`, it runs the action and the
   * caller surfaces the result. */
  build(plan: string, opts?: { mapping?: GithubMapping; title?: string }):
    | { kind: 'url'; url: string }
    | { kind: 'action'; run: () => Promise<{ ok: boolean; message?: string }> };
}

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: 'clipboard',
    label: '📋 Copy plan',
    description: 'Copy the full plan to the clipboard for paste anywhere.',
    build: (plan) => ({
      kind: 'action',
      run: async () => {
        try {
          await navigator.clipboard.writeText(plan);
          return { ok: true, message: 'Copied to clipboard' };
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'clipboard write blocked',
          };
        }
      },
    }),
  },
  {
    id: 'download',
    label: '⬇ Download .md',
    description: 'Save the plan as a markdown file.',
    build: (plan, { title } = {}) => ({
      kind: 'action',
      run: async () => {
        try {
          const blob = new Blob([plan], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (title || 'dom-lens-plan').replace(/[^a-z0-9_-]+/gi, '-') + '.md';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return { ok: true };
        } catch (e) {
          return {
            ok: false,
            message: e instanceof Error ? e.message : 'download blocked',
          };
        }
      },
    }),
  },
  {
    id: 'cursor',
    label: '🤖 Open in Cursor',
    description: 'Pre-fill a Cursor chat with this plan. Cursor must be installed.',
    build: (plan) => ({
      kind: 'url',
      url: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(safePayload(plan, 'Please implement this plan:'))}`,
    }),
  },
  {
    id: 'claude-desktop',
    label: '🟣 Claude Desktop',
    description: 'Open a Claude Desktop chat pre-filled with the plan.',
    build: (plan) => ({
      kind: 'url',
      url: `claude://claude.ai/new?q=${encodeURIComponent(safePayload(plan, 'Please implement this plan:'))}`,
    }),
  },
  {
    id: 'claude-web',
    label: '🌐 Claude.ai',
    description: 'Open a new Claude.ai chat pre-filled with the plan.',
    build: (plan) => ({
      kind: 'url',
      url: `https://claude.ai/new?q=${encodeURIComponent(safePayload(plan, 'Please implement this plan:'))}`,
    }),
  },
  {
    id: 'github-issue',
    label: '🐙 GitHub issue',
    description: 'Open a new issue in the mapped repo with this plan as the body.',
    build: (plan, { mapping, title } = {}) => {
      if (!mapping) {
        // Target unavailable — caller hides it. Return a no-op URL.
        return { kind: 'url', url: 'about:blank' };
      }
      const body = safePayload(plan);
      const issueTitle = (title || 'Proposed change from DOM Lens').slice(0, 120);
      const url =
        `https://github.com/${encodeURIComponent(mapping.owner)}/${encodeURIComponent(mapping.repo)}/issues/new` +
        `?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;
      return { kind: 'url', url };
    },
  },
];

/**
 * Extract the first markdown heading from a plan to use as a title.
 * Falls back to the first 60 chars when there's no H1.
 */
export function extractPlanTitle(plan: string): string {
  const m = plan.match(/^\s*#\s+(.+?)\s*$/m);
  if (m) return m[1].trim().slice(0, 120);
  return plan.trim().slice(0, 60).replace(/\s+/g, ' ') || 'Untitled plan';
}

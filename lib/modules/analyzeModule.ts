import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';
import type { LoadedModule, ParsedSourceMap } from './types';
import { MERMAID_RULES, ARTIFACT_RULES } from '@/lib/llm/rules';

/**
 * Module-level analysis prompts. Operate on the parsed sourcemap (the
 * Authored sources tree, with embedded `sourcesContent`) for a single
 * deployed bundle. Six actions, each tuned for a specific output shape:
 *
 *   - architecture  — markdown overview + Mermaid dependency flowchart
 *   - dashboard     — HTML artifact (renders in our sandboxed iframe)
 *   - risk          — prioritized risk audit
 *   - optimization  — refactor + perf opportunities
 *   - diagram       — single Mermaid diagram (sequence / class / flowchart)
 *   - ideas         — experimentation + future-work suggestions
 *
 * All six stream their output via the existing streamingOneshot proxy so
 * the user sees progress token-by-token in the right pane.
 *
 * File curation strategy:
 *   The user's local model has a finite context (Qwen2.5 14B → ~32K,
 *   Llama 3.2 11B → ~128K, etc.). We can't send a 10 MB bundle's worth
 *   of sources verbatim. Strategy:
 *
 *     1. Drop sources without embedded `sourcesContent` (nosources maps).
 *     2. Drop `node_modules` paths — they're not the user's code.
 *     3. Prefer "entry-like" filenames (index, main, App, bootstrap).
 *     4. Fill the remaining budget with files in ascending size order
 *        so we get breadth over depth.
 *
 *   The default budget is 28 KB of file contents — generous enough to
 *   fit ~20-50 authored files on a typical webapp, tight enough to
 *   survive a small-context model.
 */

export type ModuleAction =
  | 'architecture'
  | 'dashboard'
  | 'risk'
  | 'optimization'
  | 'diagram'
  | 'ideas';

interface ActionSpec {
  label: string;
  hint: string;
  system: string;
  user(opts: { module: LoadedModule; fileList: string; bundle: string; counts: { total: number; included: number; bytes: number } }): string;
  /** Extra trailing rules block (mermaid or artifact). */
  rules?: string;
  /** When true the prompt explicitly asks for a Mermaid diagram. */
  wantsMermaid?: boolean;
  /** When true the prompt explicitly asks for an HTML artifact. */
  wantsArtifact?: boolean;
}

const SHARED_PREAMBLE = `You are a senior frontend engineer analyzing a single JavaScript module from a deployed web app. The module's authored sources have been resolved via sourcemap.

You receive: the module's URL, a complete file list with sizes, and a CURATED concatenation of the actual file contents (entry points + smallest files, capped at ~28 KB). Treat the list as ground-truth — those files exist. Treat the concatenation as a representative sample — there may be more code you didn't see.`;

const SPECS: Record<ModuleAction, ActionSpec> = {
  architecture: {
    label: '🏛 Architecture',
    hint: 'Layered overview + Mermaid dependency flowchart.',
    system: `${SHARED_PREAMBLE}

Output a markdown architecture overview structured as:

### Purpose
One paragraph: what does this module do? What part of the app does it implement?

### Entry points
Bullets: which files boot the module.

### Layers
Bullets: data / state / UI / IO / utility — only the layers that exist. Cite filenames.

### Key external dependencies
Bullets: libraries imported, framework idioms used.

### Dependency graph
A single \`\`\`mermaid flowchart TD diagramming the major files and their imports. Limit to 15-20 nodes — collapse leaf-only utility files into a "utils" supernode if needed.

No "conclusion" or "summary" section.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
    rules: MERMAID_RULES,
    wantsMermaid: true,
  },
  dashboard: {
    label: '🎨 Visual dashboard',
    hint: 'Self-contained HTML artifact visualising the module.',
    system: `${SHARED_PREAMBLE}

Build a self-contained HTML artifact that visualises this module. Layout suggestions (use whichever fit the module):

1. Header: module name, byte size, entry points.
2. File treemap (inline SVG, rect area ∝ size).
3. Dependency table (file → imports).
4. Top external libraries used.
5. Notable patterns (hooks, decorators, fetch, etc.).

Dark theme, dense, monospace numbers. No external resources.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
    rules: ARTIFACT_RULES,
    wantsArtifact: true,
  },
  risk: {
    label: '🛡 Risk audit',
    hint: 'Security / correctness / supply-chain risks.',
    system: `${SHARED_PREAMBLE}

Output a markdown risk audit grouped into:

### Security
### Correctness
### Supply chain
### Performance / size
### Accessibility (only if the module renders UI)

Each item:
- one line, cite filenames,
- severity in [brackets]: [critical] / [high] / [medium] / [low],
- one-sentence fix.

Skip empty sections. No preamble.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
  },
  optimization: {
    label: '⚡ Optimize',
    hint: 'Bundle-size and runtime-perf opportunities.',
    system: `${SHARED_PREAMBLE}

List concrete optimization opportunities for this module. For each:

- one line, cite files,
- effort in [brackets]: [trivial] / [small] / [medium] / [large],
- expected impact (size / runtime / TTI).

Cap at 10 items, ordered by leverage (effort/impact ratio). Cover bundle size (dead code, code-split candidates, big deps), runtime (memoization, virtualization, unnecessary effects), and ergonomics (unused exports, dead state). If everything looks clean, say so in one line.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
  },
  diagram: {
    label: '🧪 Diagram',
    hint: 'Single Mermaid diagram of the module.',
    system: `${SHARED_PREAMBLE}

Pick the single Mermaid diagram type that best illustrates THIS module and emit exactly ONE \`\`\`mermaid block. Options (pick one):

- flowchart TD/LR — file/module dependency graph
- sequenceDiagram — user interaction → component → store → API
- classDiagram — exported classes + their methods
- stateDiagram-v2 — state-machine module
- erDiagram — if module deals with data shapes

Brief 2-3 sentence intro before the fence explaining the choice. Nothing after the fence.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
    rules: MERMAID_RULES,
    wantsMermaid: true,
  },
  ideas: {
    label: '💭 Ideas',
    hint: 'Experimentation + future-work prompts.',
    system: `${SHARED_PREAMBLE}

Suggest 5-8 concrete experimentation / future-work ideas for this module. Each:

- one line, **bold** the headline,
- cite which files would change,
- effort in [brackets]: [hour] / [day] / [week].

Cover: new features, A/B experiments, alternative approaches worth piloting, refactors that would unlock something, instrumentation that would teach us about real usage. No vague "use AI more" suggestions.`,
    user: ({ module, fileList, bundle, counts }) => buildUserBody({ module, fileList, bundle, counts }),
  },
};

function buildUserBody({
  module,
  fileList,
  bundle,
  counts,
}: {
  module: LoadedModule;
  fileList: string;
  bundle: string;
  counts: { total: number; included: number; bytes: number };
}): string {
  return [
    `Module URL: ${module.url}`,
    `Authored sources: ${counts.total} files (${counts.included} included verbatim below, ${(counts.bytes / 1024).toFixed(1)} KB).`,
    '',
    '## File list (all authored sources)',
    fileList,
    '',
    '## Included file contents',
    bundle,
  ].join('\n');
}

/**
 * Curate which files to send. Returns the concatenated bundle text plus a
 * complete file list (for the LLM's awareness of files it didn't get to
 * read verbatim).
 */
export function curateFiles(
  sourcemap: ParsedSourceMap,
  budgetBytes = 28 * 1024,
): { bundle: string; fileList: string; counts: { total: number; included: number; bytes: number } } {
  type Candidate = {
    path: string;
    bytes: number;
    content: string;
    entryScore: number;
    isAuthored: boolean;
  };

  const candidates: Candidate[] = [];
  for (let i = 0; i < sourcemap.sources.length; i++) {
    const path = sourcemap.sources[i];
    const content = sourcemap.sourcesContent[i];
    const isAuthored = isAuthoredPath(path);
    candidates.push({
      path,
      bytes: sourcemap.sizes[i] ?? 0,
      content: typeof content === 'string' ? content : '',
      entryScore: entryScoreFor(path),
      isAuthored,
    });
  }

  // File list always includes every source, grouped + sized — gives the
  // model awareness even of files it doesn't get to read.
  const fileList = candidates
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .map((c) => `- ${c.path} — ${formatBytesShort(c.bytes)}${!c.isAuthored ? ' (vendor)' : ''}`)
    .join('\n');

  // Candidates for inclusion: authored only, with content, smaller first
  // but entry-like files float to the top.
  const usable = candidates
    .filter((c) => c.isAuthored && c.content.length > 0)
    .sort((a, b) => {
      if (a.entryScore !== b.entryScore) return b.entryScore - a.entryScore;
      return a.content.length - b.content.length;
    });

  const parts: string[] = [];
  let used = 0;
  let included = 0;
  for (const c of usable) {
    const headerCost = c.path.length + 16;
    const total = c.content.length + headerCost;
    if (used + total > budgetBytes && included > 0) break;
    parts.push(`### ${c.path}\n\n\`\`\`\n${c.content}\n\`\`\``);
    used += total;
    included += 1;
  }

  return {
    bundle: parts.join('\n\n'),
    fileList,
    counts: { total: candidates.length, included, bytes: used },
  };
}

function isAuthoredPath(path: string): boolean {
  if (path.includes('node_modules')) return false;
  if (path.startsWith('webpack-internal://')) return false;
  if (path.startsWith('webpack:///webpack/')) return false;
  return true;
}

function entryScoreFor(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (/\/(index|main|app|bootstrap|entry|root)\.(t|j)sx?$/.test(lower)) score += 10;
  if (/\/index\.(t|j)sx?$/.test(lower)) score += 2;
  if (/\/app\./.test(lower)) score += 5;
  if (/\/router\./.test(lower)) score += 3;
  if (/\/store\./.test(lower)) score += 2;
  return score;
}

function formatBytesShort(n: number): string {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / (1024 * 1024)).toFixed(1) + 'MB';
}

export function actionLabel(a: ModuleAction): string {
  return SPECS[a].label;
}

export function actionHint(a: ModuleAction): string {
  return SPECS[a].hint;
}

export const MODULE_ACTIONS: ModuleAction[] = [
  'architecture',
  'dashboard',
  'risk',
  'optimization',
  'diagram',
  'ideas',
];

export function buildModuleAnalysisPayload(
  action: ModuleAction,
  module: LoadedModule,
  sourcemap: ParsedSourceMap,
  settings: Settings,
): { payload: LmChatPayload; counts: { total: number; included: number; bytes: number } } {
  const spec = SPECS[action];
  const { bundle, fileList, counts } = curateFiles(sourcemap);
  const userText = spec.user({ module, fileList, bundle, counts });
  const finalUser = spec.rules ? `${userText}\n\n${spec.rules}` : userText;
  return {
    payload: {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      temperature: action === 'risk' || action === 'architecture' ? 0.1 : 0.3,
      messages: [
        { role: 'system', content: spec.system },
        { role: 'user', content: finalUser },
      ],
    },
    counts,
  };
}

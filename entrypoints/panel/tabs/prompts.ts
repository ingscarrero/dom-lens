/**
 * Reusable prompt presets for the Analyze tab. These templates nudge the LLM
 * toward architecture-flavoured answers and ask for Mermaid diagrams so they
 * auto-render in the Insights tab.
 *
 * Mermaid has a notoriously strict parser. LLMs frequently emit unicode
 * (smart quotes, em-dashes, emoji), arbitrary punctuation in node IDs, or
 * cross-diagram-type syntax — all of which produce "Lexer error" and
 * "Expecting EOF" failures. The `MERMAID_RULES` block below is appended to
 * every preset to constrain output to a known-good subset.
 *
 * Sources researched while building this:
 *   - mermaid-js/mermaid#46 (lexical errors for non-[A-Za-z0-9_])
 *   - mermaid-js/mermaid#18 (label text restrictions)
 *   - GenAIScript "Mermaids Unbroken" — best practices for LLM-emitted mermaid
 */
export interface PromptPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

/**
 * Strict syntax rules appended to every preset. Distilled from the most
 * common LLM-mermaid failure modes we've seen in the wild.
 */
// The MERMAID_RULES and ARTIFACT_RULES blocks live in lib/llm/rules.ts so
// non-tab code (Modules-tab module-level analysis prompts, future
// analyzer flows, etc.) can reuse the exact same constraints without
// duplication.
import { MERMAID_RULES, ARTIFACT_RULES } from '@/lib/llm/rules';
export { MERMAID_RULES, ARTIFACT_RULES };

function withRules(prompt: string): string {
  return prompt.trimEnd() + '\n\n' + MERMAID_RULES;
}

// ARTIFACT_RULES moved to lib/llm/rules.ts (see import above).

function withArtifactRules(prompt: string): string {
  return prompt.trimEnd() + '\n\n' + ARTIFACT_RULES;
}

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'overview',
    label: 'Page overview',
    description: 'High-level summary: what the page does, main UI areas, tech stack.',
    prompt:
      'Summarize this page: what does it do, what are the main UI areas, and what stack/framework does it use? Keep it concise (≤200 words). No diagram needed unless it genuinely helps.',
  },
  {
    id: 'component-architecture',
    label: 'Component architecture',
    description:
      'React component tree analysis + a `flowchart` diagram of the major component graph.',
    prompt: withRules(`Analyze the React component architecture of this page.

1. Identify the top 5-10 most important components.
2. Explain how data flows between them (props, state, context, queries).
3. Render the component graph as a Mermaid \`flowchart TD\`. Use one node per component. Edges indicate parent-renders-child or data flow.

Use original component names when known, or best-guess labels for minified ones. Avoid restating raw markdown.`),
  },
  {
    id: 'module-federation',
    label: 'Module Federation map',
    description: 'Host/remote topology + sequence diagram of how remotes load.',
    prompt: withRules(`This appears to be (or could be) a Module Federation / micro-frontend setup. Based on the federation graph, network entries (remoteEntry / chunks), and detected fingerprints:

1. Identify the host and each remote.
2. List shared dependencies.
3. Render a Mermaid \`flowchart LR\` showing host -> remotes, and a separate Mermaid \`sequenceDiagram\` showing the load order observed in the network entries (host requesting remoteEntry, remote returning chunks).
4. Flag any suspicious patterns (duplicate libs across remotes, missing shared scope, etc.).`),
  },
  {
    id: 'bundle-breakdown',
    label: 'Bundle breakdown',
    description: 'JS chunk classification + a `pie` chart of bytes by chunk kind.',
    prompt: withRules(`Look at the loaded JS modules from the network entries.

1. Group them by chunk kind (main / vendor / runtime / chunk / remoteEntry / css / image / font / wasm).
2. Identify the top 5 heaviest chunks and what each likely contains.
3. Render a Mermaid \`pie\` chart of bytes per chunk kind. Use rounded KB integers as the numeric values.
4. Suggest 2-3 concrete optimisations (code-split candidate, vendor dedupe, lazy-load opportunity).`),
  },
  {
    id: 'data-flow',
    label: 'Data flow & state',
    description: 'Identify state management + draw a sequence diagram of a critical interaction.',
    prompt: withRules(`Inspect the detected state libraries (Redux, Zustand, Apollo, TanStack Query, etc.) and the React component tree.

1. Summarise where state lives (global stores, react-query caches, context, local state).
2. Pick the most prominent user interaction visible on the page.
3. Render a Mermaid \`sequenceDiagram\` showing: User -> Component -> Store/API -> Network -> re-render. Declare each participant on its own line first.`),
  },
  {
    id: 'visual-dashboard',
    label: 'Visual dashboard',
    description: 'Self-contained HTML artifact summarising the snapshot — renders in a sandboxed iframe.',
    prompt: withArtifactRules(`Build an interactive visual dashboard summarising this page snapshot.

Layout (top to bottom):
1. **Header**: page title + URL + capture timestamp.
2. **Tech stack badges**: each detected library/framework as a chip with confidence indicator.
3. **Modules card**: total assets + bytes, with a horizontal bar chart showing bytes per chunk kind (main / vendor / runtime / chunk / css / image / font).
4. **Federation card** (only if present): host + remotes table with loaded badges.
5. **Console card**: top error/warning groups with counts.

Keep it dense, scannable, monospace numbers, dark theme. Use inline SVG for the chart — no Chart.js. The dashboard is read-only; clicks should toggle expand/collapse of sections only.`),
  },
  {
    id: 'risk-review',
    label: 'Risk review',
    description: 'Console errors + outdated/known-vulnerable libs + analytics surface.',
    prompt: withRules(`Do a quick risk review:

1. Group console errors/warnings by likely root cause.
2. Flag any detected library version that is significantly behind current (mention the major.minor only — no need for CVE-grade analysis).
3. List analytics / tracking scripts present and what data they appear to collect (only from the network URLs visible).
4. Render a Mermaid \`flowchart TD\` clustering the issues by category. Use a single root node \`risks["Risks"]\` with one child per category, and one leaf per concrete finding. Example shape:
   \`\`\`mermaid
   flowchart TD
     risks["Risks"]
     risks --> console["Console"]
     console --> e1["TypeError in foo.js"]
     risks --> libs["Outdated libs"]
     libs --> l1["React 16.8 (current 18.x)"]
   \`\`\`
   Keep total to 15-20 nodes. ONE statement per line.`),
  },
];

export function getPreset(id: string): PromptPreset | undefined {
  return PROMPT_PRESETS.find((p) => p.id === id);
}

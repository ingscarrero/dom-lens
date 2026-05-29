/**
 * Reusable prompt presets for the Analyze tab. These are short, domain-focused
 * templates that nudge the LLM toward architecture-flavoured answers and ask
 * for Mermaid diagrams so they auto-render in the Diagrams tab.
 *
 * Keep prompts compact — the snapshot itself supplies the bulk of the context.
 */
export interface PromptPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'overview',
    label: 'Page overview',
    description: 'High-level summary: what the page does, main UI areas, tech stack.',
    prompt:
      'Summarize this page: what does it do, what are the main UI areas, and what stack/framework does it use? Keep it concise (≤200 words).',
  },
  {
    id: 'component-architecture',
    label: 'Component architecture',
    description:
      'React component tree analysis + a `flowchart` diagram of the major component graph.',
    prompt: `Analyze the React component architecture of this page.

1. Identify the top 5–10 most important components.
2. Explain how data flows between them (props, state, context, queries).
3. Render the component graph as a Mermaid flowchart:

\`\`\`mermaid
flowchart TD
  // major components + arrows
\`\`\`

Use original component names (or best-guess labels for minified ones). Avoid restating raw markdown.`,
  },
  {
    id: 'module-federation',
    label: 'Module Federation map',
    description: 'Host/remote topology + sequence diagram of how remotes load.',
    prompt: `This appears to be (or could be) a Module Federation / micro-frontend setup. Based on the federation graph, network entries (remoteEntry / chunks), and detected fingerprints:

1. Identify the host and each remote.
2. List shared dependencies.
3. Render a Mermaid \`graph LR\` showing host → remotes, and a Mermaid \`sequenceDiagram\` showing the load order observed in the network entries.
4. Flag any suspicious patterns (duplicate libs across remotes, missing shared scope, etc.).`,
  },
  {
    id: 'bundle-breakdown',
    label: 'Bundle breakdown',
    description: 'JS chunk classification + a `pie` chart of bytes by chunk kind.',
    prompt: `Look at the loaded JS modules from the network entries.

1. Group them by chunk kind (main / vendor / runtime / chunk / remoteEntry / css / image / font / wasm).
2. Identify the top 5 heaviest chunks and what each likely contains.
3. Render a Mermaid \`pie\` chart of bytes per chunk kind.
4. Suggest 2–3 concrete optimisations (code-split candidate, vendor dedupe, lazy-load opportunity).`,
  },
  {
    id: 'data-flow',
    label: 'Data flow & state',
    description: 'Identify state management + draw a sequence diagram of a critical interaction.',
    prompt: `Inspect the detected state libraries (Redux, Zustand, Apollo, TanStack Query, etc.) and the React component tree.

1. Summarize where state lives (global stores, react-query caches, context, local state).
2. Pick the most prominent user interaction visible on the page.
3. Render a Mermaid \`sequenceDiagram\` showing: User → Component → Store/API → Network → re-render.`,
  },
  {
    id: 'risk-review',
    label: 'Risk review',
    description: 'Console errors + outdated/known-vulnerable libs + analytics surface.',
    prompt: `Do a quick risk review:

1. Group console errors/warnings by likely root cause.
2. Flag any detected library version that is significantly behind current (mention the major.minor only — no need for CVE-grade analysis).
3. List analytics / tracking scripts present and what data they appear to collect (only from the network URLs visible).
4. Render a Mermaid \`mindmap\` clustering the issues by category.`,
  },
];

export function getPreset(id: string): PromptPreset | undefined {
  return PROMPT_PRESETS.find((p) => p.id === id);
}

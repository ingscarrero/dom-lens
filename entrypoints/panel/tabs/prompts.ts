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
export const MERMAID_RULES = `**Mermaid output rules — follow strictly, every diagram fails the parser otherwise:**
- Use exactly one of these diagram types per block: \`flowchart TD\`, \`flowchart LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`erDiagram\`, \`stateDiagram-v2\`, \`pie\`, \`mindmap\`, \`gantt\`. Do NOT mix syntaxes.
- **One statement per line.** Never put two node definitions on the same line. Either connect them with an explicit edge or split onto separate lines. Examples:
  - WRONG: \`A[Home] B[About] C[Contact]\` — parser sees this as one node followed by garbage.
  - WRONG: \`B -- Filter Links | C[Learn] D[Reference]\` — multiple unconnected nodes after an edge.
  - RIGHT: \`A[Home] --> B[About]\` then on the next line \`B --> C[Contact]\`.
  - RIGHT: each \`subgraph\`, \`end\`, node, and edge on its own line.
- ASCII only. No emoji, no smart quotes (use \`"\` not \`"\` or \`"\`), no em-dashes (use \`-\` or \`->\`), no \`\\u\` escapes, no accented letters.
- Node IDs must match \`[A-Za-z_][A-Za-z0-9_]*\`. Lowercase preferred. No spaces, no dots, no slashes, no parentheses in IDs.
- Labels with spaces or punctuation MUST be wrapped: \`A[User form]\`, \`B("Submit handler")\`, \`C{"Decision?"}\`. Inside the brackets quote with regular double quotes. Do NOT put a pipe \`|\` inside a label unless it is an edge-label between \`-- |label|\` markers.
- Edge labels in flowcharts use one of these exact forms — never improvise:
  - \`A -- label --> B\` (label between two pairs of dashes, before \`-->\`)
  - \`A -->|label| B\` (label inside pipes, immediately after \`-->\`)
  - Do NOT write \`A -- label| B\` or \`A | label --> B\`.
- No styling directives. Do NOT emit \`%%{init}%%\`, \`classDef\`, \`style\`, \`linkStyle\`, \`click\`, or theme blocks — the panel already themes Mermaid.
- For \`pie\`: each row is \`"Label" : number\` (quoted label, space, colon, space, number). No trailing comma.
- For \`sequenceDiagram\`: participants declared first (\`participant User\`), then \`User->>Server: message\` lines.
- Wrap the diagram in a \`\`\`mermaid fenced code block. Nothing else inside the fence — no extra prose, no extra newlines at the top.
- If a diagram would need >50 nodes, summarise to the 10-15 most important ones instead — overly large diagrams parse slowly and read poorly.`;

function withRules(prompt: string): string {
  return prompt.trimEnd() + '\n\n' + MERMAID_RULES;
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
    id: 'risk-review',
    label: 'Risk review',
    description: 'Console errors + outdated/known-vulnerable libs + analytics surface.',
    prompt: withRules(`Do a quick risk review:

1. Group console errors/warnings by likely root cause.
2. Flag any detected library version that is significantly behind current (mention the major.minor only — no need for CVE-grade analysis).
3. List analytics / tracking scripts present and what data they appear to collect (only from the network URLs visible).
4. Render a Mermaid \`mindmap\` clustering the issues by category. Root node is \`root((Risks))\`.`),
  },
];

export function getPreset(id: string): PromptPreset | undefined {
  return PROMPT_PRESETS.find((p) => p.id === id);
}

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
- Use exactly ONE of these diagram types per block: \`flowchart TD\`, \`flowchart LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`erDiagram\`, \`stateDiagram-v2\`, \`pie\`. Do NOT use \`mindmap\`, \`gantt\`, \`journey\`, \`gitgraph\`, \`requirementDiagram\`, \`C4Context\`, \`timeline\`, \`block-beta\`, \`packet-beta\`, \`architecture-beta\`, \`sankey-beta\`, \`xychart-beta\`, \`quadrantChart\`, \`radar-beta\`, \`treemap\` — these have brittle grammars that LLMs reliably break.
- For ANY hierarchical / tree-like / clustering view, use \`flowchart TD\` with a single root node and edges going down. Do NOT reach for mindmap.
- **One statement per line — no exceptions.** Never put two node definitions on the same line. The parser will report \`Expecting 'SPACELINE', 'NL', 'EOF', got 'NODE_ID'\` or similar. Examples:
  - WRONG: \`A[Home] B[About] C[Contact]\` — second node is "garbage" to the parser.
  - WRONG: \`"Library version (warnings/errors likely)" LibraryVersion\` — quoted string immediately followed by an unquoted identifier.
  - WRONG: \`B -- Filter Links | C[Learn] D[Reference]\` — multiple unconnected nodes after an edge.
  - RIGHT: \`A[Home] --> B[About]\` then on the next line \`B --> C[Contact]\`.
  - RIGHT: each \`subgraph\`, \`end\`, node, and edge on its own line, terminated by a newline.
- ASCII only. No emoji, no smart quotes (use \`"\` not \`"\` or \`"\`), no em-dashes (use \`-\` or \`->\`), no \`\\u\` escapes, no accented letters, no parentheses inside double-quoted strings unless escaped \`\\(\`.
- Node IDs must match \`[A-Za-z_][A-Za-z0-9_]*\`. Lowercase preferred. No spaces, no dots, no slashes, no parentheses in IDs.
- Labels with spaces or punctuation MUST be wrapped in brackets — never bare. Forms: \`A[User form]\`, \`B("Submit handler")\`, \`C{"Decision?"}\`. Inside the brackets, double-quote any label containing \`(\`, \`)\`, \`/\`, \`:\`, \`,\`, \`;\`, or \`-\` so the lexer treats it as a single string.
- Do NOT put a pipe \`|\` inside a label unless it is an edge-label between \`-- |label|\` markers.
- Edge labels in flowcharts use one of these exact forms — never improvise:
  - \`A -- label --> B\` (label between two pairs of dashes, before \`-->\`)
  - \`A -->|label| B\` (label inside pipes, immediately after \`-->\`)
  - Do NOT write \`A -- label| B\` or \`A | label --> B\` or \`A --> label B\`.
- No styling directives. Do NOT emit \`%%{init}%%\`, \`classDef\`, \`style\`, \`linkStyle\`, \`click\`, or theme blocks — the panel already themes Mermaid.
- For \`pie\`: each row is \`"Label" : number\` (quoted label, space, colon, space, number). No trailing comma.
- For \`sequenceDiagram\`: participants declared first (\`participant User\`), then \`User->>Server: message\` lines.
- Wrap the diagram in a \`\`\`mermaid fenced code block. Nothing else inside the fence — no extra prose, no extra newlines at the top.
- If a diagram would need >40 nodes, summarise to the 10-15 most important ones instead — overly large diagrams parse slowly and read poorly.`;

function withRules(prompt: string): string {
  return prompt.trimEnd() + '\n\n' + MERMAID_RULES;
}

/**
 * Sandbox-safe HTML artifact rules. The artifact renders in a sandboxed
 * iframe with `sandbox="allow-scripts"` only — no `allow-same-origin`,
 * no `allow-forms`, no `allow-popups`, no `allow-storage-access-by-user-activation`.
 *
 * Anything the LLM emits has to survive that environment, so the rules
 * focus on self-containment and avoiding APIs the sandbox blocks.
 */
export const ARTIFACT_RULES = `**HTML artifact output rules — required so the iframe renders correctly:**
- Wrap the artifact in a single \`\`\`html fenced block. Nothing else inside the fence.
- Output a complete HTML document starting with \`<!doctype html>\` or \`<html>\`. If you emit a fragment, that's OK — the renderer wraps it — but a full document gives you full control over <head>.
- **Self-contained.** Inline all CSS in a \`<style>\` tag and all JS in a \`<script>\` tag. NO external <link>, <script src>, <img src> to remote URLs, fonts, or CDNs. The sandbox blocks remote loads.
- No \`localStorage\`, \`sessionStorage\`, \`indexedDB\`, cookies, or \`fetch\`. The sandbox is null-origin so storage throws and fetch fails. Use in-memory JS objects.
- No \`window.parent\`, \`window.top\`, \`postMessage\`. The sandbox isolates the iframe — those handles target nothing useful.
- No forms that submit (\`<form action=…>\`). Forms are blocked by the sandbox. Use \`<input>\`+JS instead.
- No external fonts — use \`font-family: ui-sans-serif, system-ui, -apple-system, sans-serif\` and \`ui-monospace, monospace\`.
- **Dark theme**: background \`#0f172a\` or similar, text \`#e2e8f0\`, accents \`#0ea5e9\`. The panel host is dark — light artifacts hurt eyes.
- Responsive layout that works between 600px and 1200px wide. Don't hard-code huge pixel widths.
- Plain vanilla JS, plain CSS. No React/Vue/jQuery/etc — we don't bundle them and you can't CDN them in.
- For charts, hand-roll with \`<canvas>\` or inline SVG. No Chart.js / D3 / Plotly without bundling — which you can't do in one fence.
- Keep the artifact under 30 KB. If it would be larger, simplify the design.
- Optional: include a \`<!-- title: My dashboard -->\` HTML comment near the top — the panel uses it as the artifact's name in the Insights gallery.`;

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

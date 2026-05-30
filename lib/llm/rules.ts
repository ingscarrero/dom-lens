/**
 * Shared output-shape rules for LLM prompts that ask for Mermaid diagrams
 * or self-contained HTML artifacts. Lived in entrypoints/panel/tabs/prompts.ts
 * originally; pulled into `lib/` so non-tab code paths (the Modules tab's
 * module-level analysis prompts, future analyzer flows, etc.) can reuse
 * the exact same constraints without duplicating them.
 *
 * Both strings are appended verbatim to a user prompt that asks for the
 * relevant output shape. The Mermaid rules call out the SPACELINE/NL
 * parse failure mode that LLMs reliably trip into, and the HTML artifact
 * rules cover what survives our `sandbox="allow-scripts"` iframe.
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

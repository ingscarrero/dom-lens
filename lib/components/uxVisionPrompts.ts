import type { LmChatPayload, ContentPart } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';
import { MERMAID_RULES, ARTIFACT_RULES } from '@/lib/llm/rules';

/**
 * UX-vision prompts for the Components tab.
 *
 * Each preset analyses an image of a selected fiber's bounding rect from
 * the perspective of a senior UX professional. The image is the only
 * grounded signal we ship to the model — we do NOT send the raw fiber
 * tree because most of these analyses are about what the user SEES, not
 * what the code says. (The component name + role show up as context
 * only.)
 *
 * Custom prompts (id `custom-...`) fold the user's free-form question
 * into the same image+role pattern.
 *
 * The system prompts steer toward markdown output with clear section
 * headings so MarkdownRenderer makes them scannable. When the analysis
 * would benefit from a diagram (e.g. design trends, market research),
 * the model is instructed to emit a fenced ```mermaid block and the
 * existing MermaidBlock auto-renders it. Same for ```html artifacts.
 */

export interface UxPreset {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** Lead-in section of the system prompt — the rest is shared. */
  system: string;
  /** Whether the prompt invites mermaid output. */
  wantsMermaid?: boolean;
  /** Whether the prompt invites HTML artifacts. */
  wantsArtifact?: boolean;
}

const ROLE = `You are a senior UX professional with 15+ years of experience across brand, product, and research. You analyse UI captures with the eye of a designer who can spot brand decisions, layout patterns, hierarchy, and craft — but who also knows the business context: what does the team building this likely care about, who's the audience, and what comparable products do in the same space. You are observant, specific, and never vague.`;

const COMMON_RULES = `Output rules:
- Markdown only. Section headings starting with \`###\`. No preamble like "Here is the analysis".
- Be specific. Cite what you see in the image — element types, colours, copy, spacing. Never say "the design".
- Lead each finding with the most important thing first (the headline insight, not the methodology).
- Where useful, end a section with one concrete next-step bullet.
- ASCII only in any code/diagram blocks. No smart quotes, no em-dashes.`;

export const UX_PRESETS: UxPreset[] = [
  {
    id: 'ux-audit',
    label: 'UX audit',
    icon: '🔍',
    hint: 'Comprehensive UX professional review — hierarchy, flow, friction, polish.',
    system: `${ROLE}

You are doing a comprehensive UX audit on the captured region. Output these sections (skip any that don't apply):

### Visual hierarchy
What draws the eye first, second, third? Is that ordering intentional?

### Information architecture
What is this region trying to communicate? Does the grouping support that?

### Interaction affordances
What looks clickable? What looks decorative? Any ambiguity?

### Polish & craft
Alignment, typography, spacing, colour consistency.

### Friction & risks
Anything that would frustrate a real user.

${COMMON_RULES}`,
  },
  {
    id: 'aesthetics',
    label: 'Aesthetics & branding',
    icon: '🎨',
    hint: 'Colour palette, typography, brand voice, visual style.',
    system: `${ROLE}

Analyse the aesthetic decisions in the captured region. Output:

### Brand voice
What does this design "feel like" — luxe, playful, technical, soft, brutal, corporate? Cite the cues.

### Colour
Identify the dominant palette (named approximations, e.g. "ink navy", "sand"). Note any colour roles (primary, accent, alert).

### Typography
Typeface families (best guess), weight/scale ratios, line-height, tracking. What does the type choice signal?

### Materials & texture
Flat vs depth, gradients, glassmorphism, grain, shadow language.

### Reference points
Three real-world products / brands this evokes (be specific — "Linear", "Stripe Atlas", "Apple Music", not "modern SaaS").

${COMMON_RULES}`,
  },
  {
    id: 'layout',
    label: 'Layout & composition',
    icon: '📐',
    hint: 'Grid, rhythm, alignment, hierarchy.',
    system: `${ROLE}

Analyse the layout decisions in the captured region. Output:

### Grid & structure
Implied column/row grid, gutters, breakpoints.

### Visual rhythm
Vertical spacing scale (is there one?), repeated element widths/heights.

### Balance & weight
Where weight sits, how negative space is used.

### Alignment
Edge alignment, text alignment, baseline grid hits/misses.

### Composition risks
Crowding, orphans, awkward optical centres.

${COMMON_RULES}`,
  },
  {
    id: 'usability',
    label: 'Usability',
    icon: '🎯',
    hint: 'Affordances, learnability, task flow, cognitive load.',
    system: `${ROLE}

You are evaluating usability from a Nielsen-style heuristic lens. Output:

### Primary task
What is the user most likely trying to do here? Is the path obvious?

### Affordances
What signals interactivity, what doesn't, where's the ambiguity?

### Cognitive load
Information density vs scannability.

### Error states & recovery
What does the design suggest will happen on edge cases? (You're inferring, that's fine.)

### Top 3 friction points
Cite the specific element + the friction.

${COMMON_RULES}`,
  },
  {
    id: 'a11y',
    label: 'Accessibility',
    icon: '♿',
    hint: 'WCAG-style concerns visible from the design.',
    system: `${ROLE}

You are doing an accessibility audit from what's visible in the capture. You CAN'T verify ARIA, focus order, or keyboard nav from a static image — call out what's visible and flag what would need code/runtime checks.

### Colour contrast
Pairs you'd test, severity rough estimate.

### Type size & legibility
Anything that feels small for body text or supporting copy.

### Target sizes
Click/tap targets that look <44×44 px.

### Visual focus indicators (if present)
Anything that's clearly there for keyboard users? Anything missing?

### Iconography clarity
Icons-only controls that probably need a label.

### What we can't tell from the image
ARIA labels, focus order, keyboard nav, screen reader text — explicit list of "needs code check".

${COMMON_RULES}`,
  },
  {
    id: 'engagement',
    label: 'Engagement',
    icon: '💖',
    hint: 'Attention, micro-interactions, emotional pull.',
    system: `${ROLE}

Analyse the design's engagement levers. Output:

### Attention anchors
The single element your eye returns to. Why.

### Emotional tone
What feeling does this evoke in the first 5 seconds?

### Micro-moments
Where the design suggests delight or surprise (hover hints, animation cues, visual easter eggs).

### Persuasion patterns
Any social proof, scarcity, anchoring, progress meters visible?

### Risks
Anything that would feel manipulative or "dark-pattern-y" on closer review.

${COMMON_RULES}`,
  },
  {
    id: 'wow',
    label: 'Wow factor',
    icon: '✨',
    hint: 'Is there a moment that makes the user say "oh wow"?',
    system: `${ROLE}

Find — or honestly note the absence of — a "wow moment" in the capture. Output:

### The wow moment
The one element or detail that distinguishes this from a competent-but-forgettable design. If there is none, say so plainly and don't invent one.

### Why it lands (or doesn't)
What craft decision creates the effect.

### Risk
Will the wow moment age well, or feel dated in 12 months?

### Cheap wins
Two or three things this design could add to gain wow without risking the rest.

${COMMON_RULES}`,
  },
  {
    id: 'trends',
    label: 'Design trends',
    icon: '🔭',
    hint: "Where this sits in 2026 design conversations — current, dated, ahead.",
    system: `${ROLE}

Locate this capture on the current design landscape. Output:

### Current vs dated
Specific elements that feel of-the-moment vs ones that read circa-2018/-2022.

### Adjacent trends visible
e.g. brutalist editorial, soft skeuomorphism, glass UI, terminal-revival, AI-native chat surface, dense data canvases.

### Maturity
Is this design a confident take on its trend, or copying surface cues?

### Mermaid: trend positioning
A simple Mermaid \`flowchart LR\` placing this design among 4-6 named comparable trends. Use real movement names.

${COMMON_RULES}

${MERMAID_RULES}`,
    wantsMermaid: true,
  },
  {
    id: 'market',
    label: 'Market & tech research',
    icon: '📊',
    hint: 'Comparable products, technologies likely used, competitor lens.',
    system: `${ROLE}

You are doing market + technology research from the capture. Output:

### Comparable products
3-5 real products this resembles. Name them.

### Likely tech stack signals
Anything in the visible UI that hints at a specific framework, design system, or component library (Tailwind-style spacing, Material density, Radix primitives, Linear-style command bar, etc.).

### Differentiators
What's NOT like the comparables — for better or worse.

### Market position guess
Premium / mass-market / niche / experimental.

${COMMON_RULES}`,
  },
];

/**
 * DOM context attached to a UX-vision request. Captured by
 * `inspectAtBounds` in the MAIN world: the live element at the bounds
 * centre + a subset of computed styles + CSS rules whose selectors
 * match it. Including this in the prompt is the difference between
 * "describe what you see" and "tell me how this is actually built".
 */
export interface UxDomContext {
  element: {
    tag: string;
    id: string | null;
    classes: string[];
    attributes: Record<string, string>;
    outerHTML: string;
    text: string;
    isExact: boolean;
  };
  computed: Record<string, string>;
  cssRules: string[];
  sheetsBlocked: number;
}

/**
 * Build the chat payload for a UX-vision call. Accepts either a preset
 * id or a free-form `customPrompt` (custom prompts use a generic
 * UX-pro system message + the user's question).
 *
 * When `domContext` is supplied (from the MAIN-world inspector), the
 * user message includes a `## DOM context` block with the element's
 * tag/attributes, outer HTML, the key computed styles, and the
 * matching CSS rules. That's the difference between "describe what
 * you see" and "tell me how this is built" — the model can cite
 * specific class names, font stacks, palette tokens, etc.
 */
export function buildUxVisionPayload(
  args: {
    imageDataUrl: string;
    componentName?: string;
    componentKind?: string;
    componentPath?: string;
    boundsLabel?: string;
    domContext?: UxDomContext | null;
  },
  preset: UxPreset | { id: string; customPrompt: string },
  settings: Settings,
): LmChatPayload {
  const isCustom = 'customPrompt' in preset;
  const system = isCustom
    ? `${ROLE}\n\nThe user has a specific question about the captured UI region. Answer it directly, citing what you see in the image AND in the supplied DOM context when relevant. Output markdown with section headings where useful.\n\n${COMMON_RULES}`
    : preset.system;

  const contextLines: string[] = [];
  if (args.componentName) contextLines.push(`Component: ${args.componentName}`);
  if (args.componentKind) contextLines.push(`Kind: ${args.componentKind}`);
  if (args.componentPath) contextLines.push(`Path in fiber tree: ${args.componentPath}`);
  if (args.boundsLabel) contextLines.push(`Visible region: ${args.boundsLabel}`);

  const sections: string[] = [];
  if (isCustom) {
    sections.push(`Question: ${preset.customPrompt.trim()}`);
  } else {
    sections.push(`Analyse the attached image of the captured region.`);
  }
  if (contextLines.length) {
    sections.push('## Context\n' + contextLines.join('\n'));
  }
  if (args.domContext) {
    sections.push(formatDomContext(args.domContext));
  }

  const parts: ContentPart[] = [
    { type: 'text', text: sections.join('\n\n') },
    { type: 'image_url', image_url: { url: args.imageDataUrl } },
  ];

  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: parts },
    ],
  };
}

function formatDomContext(ctx: UxDomContext): string {
  const el = ctx.element;
  const out: string[] = ['## DOM context'];

  // Element identity
  const identity: string[] = [`tag: <${el.tag}>`];
  if (el.id) identity.push(`id: #${el.id}`);
  if (el.classes.length)
    identity.push(`classes: ${el.classes.slice(0, 8).map((c) => '.' + c).join(' ')}`);
  if (Object.keys(el.attributes).length) {
    const attrs = Object.entries(el.attributes)
      .slice(0, 8)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    identity.push(`attributes: ${attrs}`);
  }
  out.push(identity.join('\n'));
  if (!el.isExact) {
    out.push(
      'Note: the element matched at the bounds centre was a leaf; we walked up to the smallest ancestor whose rect covers ≥60% of the requested region.',
    );
  }
  if (el.text) {
    out.push(`text: "${el.text}"`);
  }

  // Outer HTML
  out.push('### outerHTML\n```html\n' + el.outerHTML + '\n```');

  // Computed styles
  if (Object.keys(ctx.computed).length) {
    const lines = Object.entries(ctx.computed)
      .map(([k, v]) => `${k}: ${v};`)
      .join('\n');
    out.push('### computed styles (key)\n```css\n' + lines + '\n```');
  }

  // CSS rules
  if (ctx.cssRules.length) {
    out.push(
      '### matching CSS rules (first ' + ctx.cssRules.length + ')\n```css\n' +
        ctx.cssRules.join('\n\n') +
        '\n```',
    );
  } else if (ctx.sheetsBlocked > 0) {
    out.push(
      `### matching CSS rules\nNo accessible rules — ${ctx.sheetsBlocked} stylesheet(s) blocked by cross-origin policy.`,
    );
  }

  return out.join('\n\n');
}

/**
 * Build a high-level summary of what was attached to the request, used
 * by the analysis-tab UI to show the user "what we sent". Returns
 * markdown bullets.
 */
export function describeInputs(args: {
  imageBytes?: number;
  imageDims?: { w: number; h: number };
  domContext?: UxDomContext | null;
  componentName?: string;
  componentKind?: string;
  boundsLabel?: string;
}): string[] {
  const out: string[] = [];
  if (args.componentName) {
    out.push(
      `Selected component: \`${args.componentName}\`${args.componentKind ? ` (${args.componentKind})` : ''}`,
    );
  }
  if (args.boundsLabel) out.push(`Visible region: ${args.boundsLabel}`);
  if (args.imageBytes != null) {
    const dims =
      args.imageDims && args.imageDims.w
        ? ` (${args.imageDims.w}×${args.imageDims.h} px)`
        : '';
    out.push(`Cropped PNG screenshot${dims} — ~${Math.round(args.imageBytes / 1024)} KB`);
  }
  if (args.domContext) {
    const el = args.domContext.element;
    out.push(
      `Live DOM element: \`<${el.tag}${el.id ? ' id="' + el.id + '"' : ''}${el.classes.length ? ' class="' + el.classes.slice(0, 3).join(' ') + (el.classes.length > 3 ? ' …' : '') + '"' : ''}>\``,
    );
    out.push(`Outer HTML (~${args.domContext.element.outerHTML.length} chars)`);
    const styleCount = Object.keys(args.domContext.computed).length;
    if (styleCount > 0) out.push(`${styleCount} key computed styles`);
    if (args.domContext.cssRules.length > 0) {
      out.push(
        `${args.domContext.cssRules.length} matching CSS rule${args.domContext.cssRules.length === 1 ? '' : 's'}`,
      );
    }
    if (args.domContext.sheetsBlocked > 0) {
      out.push(
        `(${args.domContext.sheetsBlocked} stylesheet${args.domContext.sheetsBlocked === 1 ? '' : 's'} blocked by CORS — not included)`,
      );
    }
  }
  return out;
}

/**
 * Derive a stable id for a custom prompt so re-running the same custom
 * question replaces its previous tab. Different wording → different id
 * → new tab.
 */
export function customPromptId(prompt: string): string {
  const trimmed = prompt.trim().slice(0, 60);
  // Compact non-alphanumerics to dashes so the id is human-readable in
  // tab close handlers / debug logs.
  return 'custom-' + trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Short label for a custom-prompt tab. Just the first ~30 chars,
 * trimmed at a word boundary when possible.
 */
export function customPromptLabel(prompt: string): string {
  const max = 28;
  let s = prompt.trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const lastSpace = s.lastIndexOf(' ');
  if (lastSpace > max - 12) s = s.slice(0, lastSpace);
  return s + '…';
}

// re-exported so callers can include the artifact rules if a custom
// prompt asks for one. Not used by default.
export { ARTIFACT_RULES };

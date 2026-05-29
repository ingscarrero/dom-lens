import mermaid from 'mermaid';

let initialized = false;

/**
 * Initialise Mermaid once with the panel's dark theme palette so diagrams
 * blend with the surrounding UI. Subsequent calls are no-ops.
 */
export function ensureMermaidInit(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#0f172a',
      primaryColor: '#0ea5e9',
      primaryTextColor: '#e2e8f0',
      primaryBorderColor: '#334155',
      lineColor: '#64748b',
      secondaryColor: '#1e293b',
      tertiaryColor: '#0f172a',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    },
    fontSize: 12,
    flowchart: { htmlLabels: true, curve: 'basis' },
  });
  initialized = true;
}

/**
 * Render a Mermaid source string into an SVG string. Errors are thrown for the
 * caller to surface — the component layer catches and renders a fallback.
 */
export async function renderMermaid(
  source: string,
  id: string,
): Promise<{ svg: string; bindFunctions?: (el: Element) => void }> {
  ensureMermaidInit();
  // Mermaid's parse pass gives clearer error messages than render.
  await mermaid.parse(source);
  const result = await mermaid.render(id, source);
  return { svg: result.svg, bindFunctions: result.bindFunctions };
}

/**
 * Lightweight signature for caching/cache-busting. Mermaid IDs must be unique
 * per diagram on the page; we derive a stable suffix from the source so the
 * same diagram doesn't get re-rendered to a new node id needlessly.
 */
export function diagramId(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return `mermaid-${Math.abs(hash).toString(36)}`;
}

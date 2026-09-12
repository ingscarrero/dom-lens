import { isLoopbackHostname } from '@/lib/net/urlPolicy';

export interface CustomPrompt {
  id: string;
  label: string;
  description?: string;
  prompt: string;
}

export interface GithubMapping {
  id: string;
  label: string;
  urlPattern: string;
  owner: string;
  repo: string;
  /** Supports `{version}` placeholder when `versionCapture` is set. */
  branch: string;
  basePath?: string;
  /** Optional regex (as a string) matched against the deployed module
   * URL; capture group 1 fills `{version}` in `branch`. */
  versionCapture?: string;
}

export interface Settings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  includeScreenshot: boolean;
  includeMarkdown: boolean;
  includeReactTree: boolean;
  includeFederation: boolean;
  includeNetwork: boolean;
  includeConsole: boolean;
  maxMarkdownChars: number;
  systemPrompt: string;
  /** Capture entire page via scroll-and-stitch (vs visible viewport only) */
  fullPageScreenshot: boolean;
  /** Max number of viewport tiles to capture during scroll-and-stitch */
  fullPageMaxTiles: number;
  /** Default number of slices to cut a stitched image into */
  defaultSliceCount: number;
  /** Send sliced tiles instead of full image to multimodal models */
  sendSlicedTiles: boolean;
  /** User-defined prompts that appear in the Insights gallery alongside
   * the built-in PROMPT_PRESETS. */
  customPrompts: CustomPrompt[];
  /** URL-pattern → GitHub repo mappings used by the Modules tab to
   * surface "View on GitHub" links and link the module-analysis panel
   * to a canonical source repo. See `lib/modules/githubMapping.ts`. */
  githubMappings: GithubMapping[];
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model',
  apiKey: '',
  includeScreenshot: true,
  includeMarkdown: true,
  includeReactTree: true,
  includeFederation: true,
  includeNetwork: false,
  includeConsole: true,
  maxMarkdownChars: 20000,
  fullPageScreenshot: true,
  fullPageMaxTiles: 20,
  defaultSliceCount: 4,
  sendSlicedTiles: true,
  customPrompts: [],
  githubMappings: [],
  systemPrompt:
    'You are a senior frontend engineer reviewing a web page snapshot. ' +
    'You receive a semantic markdown representation of the page DOM, ' +
    'an optional screenshot, and (when present) the React component tree and ' +
    'Module Federation topology. ' +
    'Answer the user concisely. When asked about architecture, infer the design ' +
    'from component names, federation remotes, and exposed modules. ' +
    'When emitting Mermaid diagrams, use ASCII only — no emoji, no smart quotes, ' +
    'no em-dashes. Node IDs are [A-Za-z_][A-Za-z0-9_]*. Wrap labels with spaces ' +
    'in brackets. Stick to one diagram type per fenced block. Do not emit theme ' +
    'or style directives.',
};

const KEY = 'dom-lens.settings';

/**
 * Warn when the AI endpoint is reached over plain HTTP on a non-loopback
 * host: the `Authorization: Bearer <apiKey>` header (and every page
 * snapshot) would cross the network unencrypted. Loopback endpoints
 * (LM Studio / Ollama on localhost) never leave the machine, so they
 * are exempt. Returns null when there is nothing to warn about or the
 * URL does not parse (the connection test reports that separately).
 */
export function insecureTransportWarning(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || isLoopbackHostname(url.hostname)) return null;
  return (
    `${url.host} is reached over plain HTTP. The API key and every snapshot ` +
    'sent to it travel unencrypted — use https:// for any endpoint that is not on this machine.'
  );
}

export async function loadSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(res[KEY] ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area === 'local' && changes[KEY]?.newValue) {
      cb({ ...DEFAULT_SETTINGS, ...changes[KEY].newValue });
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

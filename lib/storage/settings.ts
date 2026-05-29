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

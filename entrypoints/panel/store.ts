import { create } from 'zustand';
import type { Snapshot, HarEntry } from '@/lib/snapshot/types';
import type { Settings } from '@/lib/storage/settings';
import type { Tile } from '@/lib/snapshot/slicer';
import type { RawTile } from '@/lib/snapshot/fullPage';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

export type Tab =
  | 'snapshot'
  | 'components'
  | 'federation'
  | 'modules'
  | 'insights'
  | 'analyze'
  | 'settings';

export interface FocusedComponent {
  id: string;
  name: string;
  kind: string;
  tag?: string;
  hint?: string;
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface CaptureProgress {
  step: number;
  total: number;
  phase: 'metrics' | 'tiles' | 'stitching' | 'finalizing';
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
}

interface State {
  tab: Tab;
  snapshot: Snapshot | null;
  capturing: boolean;
  captureProgress: CaptureProgress | null;
  captureError: string | null;
  network: HarEntry[];
  settings: Settings;
  chat: ChatTurn[];
  chatRequestId: string | null;
  testConnection: { status: 'idle' | 'pending' | 'ok' | 'error'; message?: string; models?: string[] };
  focused: FocusedComponent | null;
  tiles: Tile[];
  componentFilter: string;
  significantOnly: boolean;
  subtreeRootId: string | null;
  /** One-shot prompt to seed the Analyze input. Used by Insights' preset CTAs
   * — the consumer reads it once on mount and clears it via `setPendingPrompt(null)`. */
  pendingPrompt: string | null;
  /** Raw viewport tiles from the most recent capture. Kept around for the
   * AI-enhanced restitch flow. Cleared when a new capture starts. */
  rawTiles: RawTile[];
  /** State of the AI-enhanced restitch round-trip. */
  enhanceStatus: 'idle' | 'asking' | 'restitching' | 'done' | 'error';
  enhanceError: string | null;
  enhanceMessage: string | null;
}

interface Actions {
  setTab(t: Tab): void;
  setCapturing(v: boolean): void;
  setCaptureProgress(p: CaptureProgress | null): void;
  setSnapshot(s: Snapshot): void;
  setCaptureError(e: string | null): void;
  pushNetwork(e: HarEntry): void;
  clearNetwork(): void;
  setSettings(s: Settings): void;
  startChat(turn: ChatTurn): void;
  appendChatDelta(text: string): void;
  endChat(error?: string): void;
  resetChat(): void;
  setTestConnection(v: State['testConnection']): void;
  setChatRequestId(id: string | null): void;
  setFocused(f: FocusedComponent | null): void;
  setTiles(ts: Tile[]): void;
  setComponentFilter(s: string): void;
  setSignificantOnly(v: boolean): void;
  setSubtreeRootId(id: string | null): void;
  setPendingPrompt(p: string | null): void;
  setRawTiles(t: RawTile[]): void;
  setEnhanceStatus(
    s: { status: 'idle' | 'asking' | 'restitching' | 'done' | 'error'; message?: string | null; error?: string | null },
  ): void;
  /** Replace just the screenshot on the current snapshot (used after restitch). */
  setSnapshotScreenshot(sc: Snapshot['screenshot']): void;
}

export const useStore = create<State & Actions>((set) => ({
  tab: 'snapshot',
  snapshot: null,
  capturing: false,
  captureProgress: null,
  captureError: null,
  network: [],
  settings: DEFAULT_SETTINGS,
  chat: [],
  chatRequestId: null,
  testConnection: { status: 'idle' },
  focused: null,
  tiles: [],
  componentFilter: '',
  significantOnly: true,
  subtreeRootId: null,
  pendingPrompt: null,
  rawTiles: [],
  enhanceStatus: 'idle',
  enhanceError: null,
  enhanceMessage: null,
  setTab: (t) => set({ tab: t }),
  setCapturing: (v) =>
    set({ capturing: v, captureError: v ? null : undefined, captureProgress: v ? null : null }),
  setCaptureProgress: (p) => set({ captureProgress: p }),
  // Preserve captureError when finalizing — screenshot failures should remain
  // visible after the rest of the snapshot lands. setCapturing(true) clears it
  // at the start of the next capture.
  setSnapshot: (s) =>
    set((state) => ({
      snapshot: s,
      capturing: false,
      captureProgress: null,
      tiles: [],
      focused: null,
      subtreeRootId: null,
      captureError: state.captureError,
    })),
  setCaptureError: (e) => set({ captureError: e, capturing: false, captureProgress: null }),
  pushNetwork: (e) =>
    set((s) => {
      const next = [...s.network, e];
      if (next.length > 500) next.splice(0, next.length - 500);
      return { network: next };
    }),
  clearNetwork: () => set({ network: [] }),
  setSettings: (s) => set({ settings: s }),
  startChat: (turn) =>
    set((s) => ({
      chat: [...s.chat, turn, { id: turn.id + ':r', role: 'assistant', content: '', streaming: true }],
    })),
  appendChatDelta: (text) =>
    set((s) => {
      const next = s.chat.slice();
      const last = next[next.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, content: last.content + text };
      }
      return { chat: next };
    }),
  endChat: (error) =>
    set((s) => {
      const next = s.chat.slice();
      const last = next[next.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false, error };
      }
      return { chat: next, chatRequestId: null };
    }),
  resetChat: () => set({ chat: [], chatRequestId: null }),
  setTestConnection: (v) => set({ testConnection: v }),
  setChatRequestId: (id) => set({ chatRequestId: id }),
  setFocused: (f) => set({ focused: f }),
  setTiles: (ts) => set({ tiles: ts }),
  setComponentFilter: (s) => set({ componentFilter: s }),
  setSignificantOnly: (v) => set({ significantOnly: v }),
  setSubtreeRootId: (id) => set({ subtreeRootId: id }),
  setPendingPrompt: (p) => set({ pendingPrompt: p }),
  setRawTiles: (t) => set({ rawTiles: t }),
  setEnhanceStatus: ({ status, message, error }) =>
    set({
      enhanceStatus: status,
      enhanceMessage: message ?? null,
      enhanceError: error ?? null,
    }),
  setSnapshotScreenshot: (sc) =>
    set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, screenshot: sc } } : {})),
}));

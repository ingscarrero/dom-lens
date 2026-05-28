import { create } from 'zustand';
import type { Snapshot, HarEntry } from '@/lib/snapshot/types';
import type { Settings } from '@/lib/storage/settings';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

export type Tab = 'snapshot' | 'components' | 'federation' | 'analyze' | 'settings';

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
  captureError: string | null;
  network: HarEntry[];
  settings: Settings;
  chat: ChatTurn[];
  chatRequestId: string | null;
  testConnection: { status: 'idle' | 'pending' | 'ok' | 'error'; message?: string; models?: string[] };
}

interface Actions {
  setTab(t: Tab): void;
  setCapturing(v: boolean): void;
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
}

export const useStore = create<State & Actions>((set) => ({
  tab: 'snapshot',
  snapshot: null,
  capturing: false,
  captureError: null,
  network: [],
  settings: DEFAULT_SETTINGS,
  chat: [],
  chatRequestId: null,
  testConnection: { status: 'idle' },
  setTab: (t) => set({ tab: t }),
  setCapturing: (v) => set({ capturing: v, captureError: v ? null : undefined }),
  setSnapshot: (s) => set({ snapshot: s, capturing: false, captureError: null }),
  setCaptureError: (e) => set({ captureError: e, capturing: false }),
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
}));

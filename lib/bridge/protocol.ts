import type { PartialSnapshot, Snapshot, HarEntry } from '../snapshot/types';

export const CHANNEL = 'dom-lens';

export type PanelToBg =
  | { type: 'panel.hello'; tabId: number }
  | { type: 'capture.finalize'; tabId: number; partial: PartialSnapshot; network: HarEntry[] }
  | { type: 'lm.chat.start'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.chat.cancel'; requestId: string }
  | { type: 'lm.test'; baseUrl: string; apiKey?: string };

export type BgToPanel =
  | { type: 'capture.result'; snapshot: Snapshot }
  | { type: 'capture.error'; message: string }
  | { type: 'lm.chat.delta'; requestId: string; text: string }
  | { type: 'lm.chat.done'; requestId: string }
  | { type: 'lm.chat.error'; requestId: string; message: string }
  | { type: 'lm.test.result'; ok: boolean; models?: string[]; message?: string };

export interface LmChatPayload {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

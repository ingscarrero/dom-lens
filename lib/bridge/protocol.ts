export const CHANNEL = 'dom-lens';

export type PanelToBg =
  | { type: 'panel.hello'; tabId: number }
  | { type: 'capture.tile'; requestId: string; tabId: number }
  | { type: 'lm.chat.start'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.chat.cancel'; requestId: string }
  | { type: 'lm.test'; baseUrl: string; apiKey?: string }
  | { type: 'net.fetch'; requestId: string; url: string; maxBytes?: number }
  | { type: 'lm.oneshot'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.stream'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.stream.cancel'; requestId: string };

export type BgToPanel =
  | { type: 'capture.tile.result'; requestId: string; ok: true; dataUrl: string }
  | { type: 'capture.tile.result'; requestId: string; ok: false; message: string }
  | { type: 'lm.chat.delta'; requestId: string; text: string }
  | { type: 'lm.chat.done'; requestId: string }
  | { type: 'lm.chat.error'; requestId: string; message: string }
  | { type: 'lm.test.result'; ok: boolean; models?: string[]; message?: string }
  | { type: 'net.fetch.result'; requestId: string; ok: true; text: string; status: number; contentType?: string }
  | { type: 'net.fetch.result'; requestId: string; ok: false; message: string }
  | { type: 'lm.oneshot.result'; requestId: string; ok: true; text: string }
  | { type: 'lm.oneshot.result'; requestId: string; ok: false; message: string }
  /** Streaming variant of lm.oneshot — same chat round-trip but the SW
   * forwards every delta to the panel so the user sees token-by-token
   * progress (used by ModulesTab's "Summarize symbol" + "Beautify"
   * flows). The panel routes on requestId. */
  | { type: 'lm.stream.delta'; requestId: string; text: string }
  | { type: 'lm.stream.done'; requestId: string; fullText: string }
  | { type: 'lm.stream.error'; requestId: string; message: string };

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

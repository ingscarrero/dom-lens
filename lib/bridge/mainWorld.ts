export const MAIN_CHANNEL = 'dom-lens:main';

export interface MainRequest {
  source: typeof MAIN_CHANNEL;
  direction: 'request';
  id: string;
  op: 'console.drain' | 'noop';
}

export interface MainResponse {
  source: typeof MAIN_CHANNEL;
  direction: 'response';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

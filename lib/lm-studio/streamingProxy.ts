import type { LmChatPayload, PanelToBg } from '@/lib/bridge/protocol';

/**
 * Panel-side helper for streaming non-chat LLM round-trips. Each delta is
 * forwarded by the SW; we expose them to the caller via an `onDelta`
 * callback. The promise resolves with the accumulated full text (or an
 * error message) when the SW reports done.
 *
 * This is the right primitive for "Summarize this symbol" or "Beautify
 * this module" flows — the user sees the model thinking instead of
 * staring at a spinner for 30+ seconds while the LLM emits a 1MB file.
 *
 * The panel wires this via App.tsx, similar to the existing oneshot /
 * fetch proxies. App keeps a Map<requestId, StreamHandlers> and routes
 * `lm.stream.delta` / `lm.stream.done` / `lm.stream.error` to the right
 * entry.
 */

export interface StreamHandlers {
  onDelta(text: string): void;
  onDone(fullText: string): void;
  onError(message: string): void;
}

export interface StreamingProxyDeps {
  post(msg: PanelToBg): void;
  registerHandlers(requestId: string, handlers: StreamHandlers): void;
  unregisterHandlers(requestId: string): void;
}

export interface StreamHandle {
  readonly requestId: string;
  cancel(): void;
  /** Resolves with the full accumulated text on success, rejects on error. */
  readonly result: Promise<string>;
}

export type StreamingOneshot = (
  payload: LmChatPayload,
  onDelta: (text: string) => void,
) => StreamHandle;

export function createStreamingProxy(deps: StreamingProxyDeps): StreamingOneshot {
  return (payload, onDelta) => {
    const requestId = crypto.randomUUID();
    let cancelled = false;
    const result = new Promise<string>((resolve, reject) => {
      deps.registerHandlers(requestId, {
        onDelta,
        onDone: (full) => {
          deps.unregisterHandlers(requestId);
          resolve(full);
        },
        onError: (msg) => {
          deps.unregisterHandlers(requestId);
          reject(new Error(msg));
        },
      });
    });
    deps.post({ type: 'lm.stream', requestId, payload });
    return {
      requestId,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        deps.post({ type: 'lm.stream.cancel', requestId });
      },
      result,
    };
  };
}

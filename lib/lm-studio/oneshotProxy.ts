import type { LmChatPayload, PanelToBg } from '@/lib/bridge/protocol';

/**
 * Panel-side helper for non-streaming LLM round-trips. Mirrors the
 * fetchProxy / tile-capture patterns: we post `lm.oneshot` to the
 * background SW with a requestId, the SW accumulates the streamed
 * response and replies once with the full text on `lm.oneshot.result`.
 *
 * Used by:
 *   - The Snapshot tab's "Enhance with AI" flow (enhanceFlow.ts).
 *   - The Modules tab's "Reformat with AI" buttons.
 *   - Anything else that needs a one-shot LLM call without polluting
 *     the Analyze chat transcript.
 */
export interface OneshotProxyDeps {
  post(msg: PanelToBg): void;
  awaitResult(
    requestId: string,
  ): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
}

export type OneshotProxy = (
  payload: LmChatPayload,
) => Promise<{ ok: true; text: string } | { ok: false; message: string }>;

export function createOneshotProxy(deps: OneshotProxyDeps): OneshotProxy {
  return async (payload: LmChatPayload) => {
    const requestId = crypto.randomUUID();
    const pending = deps.awaitResult(requestId);
    deps.post({ type: 'lm.oneshot', requestId, payload });
    return pending;
  };
}

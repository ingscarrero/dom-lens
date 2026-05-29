import type { BgToPanel, PanelToBg } from '@/lib/bridge/protocol';

/**
 * Panel-side helper that posts `net.fetch` to the background SW and resolves
 * with the response text. The SW has `<all_urls>` host_permissions, which is
 * critical for fetching sourcemaps hosted on CDNs that don't send permissive
 * CORS headers to the panel's `chrome-extension://` origin.
 */
export interface FetchProxyDeps {
  post(msg: PanelToBg): void;
  /**
   * Register a one-shot listener for the `net.fetch.result` matching the
   * given requestId. Mirrors the tile-capture awaiter pattern used in
   * captureFlow.
   */
  awaitResult(
    requestId: string,
  ): Promise<
    | { ok: true; text: string; status: number; contentType?: string }
    | { ok: false; message: string }
  >;
}

export function createFetchProxy(deps: FetchProxyDeps): (url: string) => Promise<string> {
  return async (url: string) => {
    const requestId = crypto.randomUUID();
    const pending = deps.awaitResult(requestId);
    deps.post({ type: 'net.fetch', requestId, url });
    const res = await pending;
    if (!res.ok) throw new Error(res.message);
    return res.text;
  };
}

/**
 * Type-guard helper for the panel message handler.
 */
export function isNetFetchResult(
  msg: BgToPanel,
): msg is Extract<BgToPanel, { type: 'net.fetch.result' }> {
  return msg.type === 'net.fetch.result';
}

import type { LmChatPayload, PanelToBg } from '@/lib/bridge/protocol';
import {
  buildEnhanceStitchPayload,
  parseEnhanceResponse,
  restitchWithAdjustments,
} from '@/lib/snapshot/enhanceStitch';
import { useStore } from './store';

/**
 * Orchestrates the AI-enhanced re-stitch round-trip.
 *
 * Inputs: the panel-side store (raw tiles + current snapshot + settings),
 * a port `post` for sending the LM request, and an awaiter that resolves
 * when the matching `lm.oneshot.result` arrives.
 *
 * Side effects: drives `enhanceStatus` through asking → restitching → done /
 * error, and replaces the current snapshot screenshot on success.
 */
export interface EnhanceFlowDeps {
  post(msg: PanelToBg): void;
  awaitOneshot(
    requestId: string,
  ): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
}

export async function runEnhanceStitch(deps: EnhanceFlowDeps): Promise<void> {
  const state = useStore.getState();
  const tiles = state.rawTiles;
  const snap = state.snapshot;
  const settings = state.settings;

  if (!snap || !snap.screenshot) {
    state.setEnhanceStatus({ status: 'error', error: 'No snapshot to enhance.' });
    return;
  }
  if (tiles.length === 0) {
    state.setEnhanceStatus({
      status: 'error',
      error: 'No raw tiles available — capture again.',
    });
    return;
  }
  if (tiles.length === 1) {
    state.setEnhanceStatus({
      status: 'error',
      error: 'Only one tile captured. Nothing to re-stitch.',
    });
    return;
  }
  if (!settings.baseUrl || !settings.model) {
    state.setEnhanceStatus({
      status: 'error',
      error: 'Configure a local model in Settings first.',
    });
    return;
  }

  state.setEnhanceStatus({
    status: 'asking',
    message: `Asking ${settings.model} to analyze ${tiles.length} tiles…`,
  });

  const payload: LmChatPayload = buildEnhanceStitchPayload(tiles, settings);
  const requestId = crypto.randomUUID();
  const waiter = deps.awaitOneshot(requestId);
  deps.post({ type: 'lm.oneshot', requestId, payload });

  let res: Awaited<ReturnType<EnhanceFlowDeps['awaitOneshot']>>;
  try {
    res = await waiter;
  } catch (e) {
    state.setEnhanceStatus({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!res.ok) {
    state.setEnhanceStatus({ status: 'error', error: res.message });
    return;
  }

  const adjustments = parseEnhanceResponse(res.text);
  if (!adjustments) {
    state.setEnhanceStatus({
      status: 'error',
      error:
        'Could not parse the LLM response as the expected JSON. Try a different/larger model.',
    });
    return;
  }

  state.setEnhanceStatus({
    status: 'restitching',
    message: 'Re-stitching with AI-supplied offsets…',
  });

  const stitched = await restitchWithAdjustments(tiles, adjustments, snap.screenshot);
  if (!stitched.ok) {
    state.setEnhanceStatus({ status: 'error', error: stitched.reason });
    return;
  }

  state.setSnapshotScreenshot(stitched.screenshot);
  const summary = adjustments
    .filter((a) => a.trimTop > 0)
    .map((a) => `tile ${a.index}: −${a.trimTop}px`)
    .join(', ');
  state.setEnhanceStatus({
    status: 'done',
    message: summary
      ? `Re-stitched. Adjustments applied: ${summary}`
      : 'Re-stitched. No trims were needed.',
  });
}

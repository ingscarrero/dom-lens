export interface EvalError {
  isError: true;
  description: string;
  isException?: boolean;
  value?: unknown;
}

export interface EvalOk<T> {
  isError: false;
  value: T;
}

export type EvalResult<T> = EvalOk<T> | EvalError;

export function inspectedEval<T = unknown>(expression: string): Promise<EvalResult<T>> {
  return new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval(expression, (result, exception) => {
        if (exception) {
          resolve({
            isError: true,
            description:
              (exception as any).description ??
              (exception as any).value ??
              JSON.stringify(exception),
            isException: (exception as any).isException,
          });
        } else {
          resolve({ isError: false, value: result as T });
        }
      });
    } catch (e) {
      resolve({ isError: true, description: (e as Error).message });
    }
  });
}

function parseJsonResult<T>(res: EvalResult<string>): { ok: true; value: T } | { ok: false; reason: string } {
  if (res.isError) return { ok: false, reason: res.description };
  if (typeof res.value !== 'string') return { ok: false, reason: 'unexpected non-string eval result' };
  try {
    const parsed = JSON.parse(res.value);
    if (parsed && parsed.__no_api) {
      return {
        ok: false,
        reason:
          'DOM Lens main-world script not present on this page. Reload the page after installing the extension.',
      };
    }
    if (parsed && parsed.__error) return { ok: false, reason: parsed.__error };
    return { ok: true, value: parsed as T };
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
}

export async function callDomLensCapture(maxMarkdownChars: number): Promise<
  | { ok: true; partial: import('@/lib/snapshot/types').PartialSnapshot }
  | { ok: false; reason: string }
> {
  const expr = `(function(){
    if (!window.__dom_lens__) return JSON.stringify({ __no_api: true });
    try { return JSON.stringify(window.__dom_lens__.capture({ maxMarkdownChars: ${maxMarkdownChars} })); }
    catch (e) { return JSON.stringify({ __error: (e && e.message) || String(e) }); }
  })()`;
  const res = await inspectedEval<string>(expr);
  const parsed = parseJsonResult<import('@/lib/snapshot/types').PartialSnapshot>(res);
  if (!parsed.ok) return parsed;
  return { ok: true, partial: parsed.value };
}

export async function callScrollMetrics(): Promise<
  | { ok: true; metrics: import('@/lib/snapshot/types').PageMetrics }
  | { ok: false; reason: string }
> {
  const expr = `(function(){
    if (!window.__dom_lens__) return JSON.stringify({ __no_api: true });
    if (typeof window.__dom_lens__.scrollMetrics !== 'function') {
      return JSON.stringify({ __error: 'Stale DOM Lens content script (version ' + (window.__dom_lens__.version || '<unknown>') + '). Reload this tab after the extension was updated.' });
    }
    try { return JSON.stringify(window.__dom_lens__.scrollMetrics()); }
    catch (e) { return JSON.stringify({ __error: (e && e.message) || String(e) }); }
  })()`;
  const res = await inspectedEval<string>(expr);
  const parsed = parseJsonResult<import('@/lib/snapshot/types').PageMetrics>(res);
  if (!parsed.ok) return parsed;
  return { ok: true, metrics: parsed.value };
}

export async function callScrollTo(x: number, y: number): Promise<void> {
  await inspectedEval<string>(
    `(function(){ try { window.__dom_lens__ && window.__dom_lens__.scrollTo(${x}, ${y}); } catch(e) {} return 'ok'; })()`,
  );
}

export async function callHighlight(rect: {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  color?: string;
}): Promise<void> {
  const safeLabel = JSON.stringify(rect.label ?? '');
  const safeColor = JSON.stringify(rect.color ?? '#0ea5e9');
  await inspectedEval<string>(
    `(function(){ try { window.__dom_lens__ && window.__dom_lens__.highlight({x:${rect.x},y:${rect.y},w:${rect.w},h:${rect.h},label:${safeLabel},color:${safeColor}}); } catch(e) {} return 'ok'; })()`,
  );
}

export async function callClearHighlight(): Promise<void> {
  await inspectedEval<string>(
    `(function(){ try { window.__dom_lens__ && window.__dom_lens__.clearHighlight(); } catch(e) {} return 'ok'; })()`,
  );
}

export async function callBeginFullPageCapture(): Promise<{ ok: boolean; hiddenCount: number }> {
  const res = await inspectedEval<string>(
    `(function(){ try { return JSON.stringify(window.__dom_lens__ ? window.__dom_lens__.beginFullPageCapture() : { ok: false, hiddenCount: 0 }); } catch(e) { return JSON.stringify({ ok: false, hiddenCount: 0 }); } })()`,
  );
  if (res.isError || typeof res.value !== 'string') return { ok: false, hiddenCount: 0 };
  try {
    const v = JSON.parse(res.value);
    return { ok: !!v?.ok, hiddenCount: Number(v?.hiddenCount) || 0 };
  } catch {
    return { ok: false, hiddenCount: 0 };
  }
}

export async function callEndFullPageCapture(): Promise<void> {
  await inspectedEval<string>(
    `(function(){ try { window.__dom_lens__ && window.__dom_lens__.endFullPageCapture(); } catch(e) {} return 'ok'; })()`,
  );
}

/**
 * Drives the main-world priming pass: kick off, then poll for completion.
 * Split because chrome.devtools.inspectedWindow.eval doesn't await Promises,
 * so the main world keeps state in `primeState` that we poll over the wire.
 */
export async function callPrimeLazyLoad(
  delayMs = 180,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; finalHeight: number; finalWidth: number } | null> {
  // Kick off
  const startExpr = `(function(){
    try {
      if (!window.__dom_lens__ || typeof window.__dom_lens__.startPrimeLazyLoad !== 'function') {
        return JSON.stringify({ ok: false, reason: 'api-missing' });
      }
      return JSON.stringify(window.__dom_lens__.startPrimeLazyLoad({ delayMs: ${Number(delayMs) || 180} }));
    } catch (e) {
      return JSON.stringify({ ok: false, reason: (e && e.message) || String(e) });
    }
  })()`;
  const startRes = await inspectedEval<string>(startExpr);
  if (startRes.isError || typeof startRes.value !== 'string') return null;
  try {
    const v = JSON.parse(startRes.value);
    if (!v?.ok) return null;
  } catch {
    return null;
  }

  // Poll
  const pollExpr = `(function(){
    try {
      return JSON.stringify(window.__dom_lens__ ? window.__dom_lens__.getPrimeLazyLoadStatus() : null);
    } catch (e) { return 'null'; }
  })()`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const r = await inspectedEval<string>(pollExpr);
    if (r.isError || typeof r.value !== 'string') continue;
    try {
      const s = JSON.parse(r.value);
      if (!s) continue;
      if (s.status === 'done') {
        return {
          ok: true,
          finalHeight: Number(s.finalHeight) || 0,
          finalWidth: Number(s.finalWidth) || 0,
        };
      }
      if (s.status === 'error') return null;
    } catch {
      /* keep polling */
    }
  }
  return null; // timed out
}

export async function callGetScrollPosition(): Promise<{ x: number; y: number } | null> {
  const res = await inspectedEval<string>(
    `(function(){ try { return JSON.stringify(window.__dom_lens__ ? window.__dom_lens__.getScrollPosition() : null); } catch(e) { return 'null'; } })()`,
  );
  if (res.isError || typeof res.value !== 'string') return null;
  try {
    const v = JSON.parse(res.value);
    if (!v) return null;
    return { x: Number(v.scrollX) || 0, y: Number(v.scrollY) || 0 };
  } catch {
    return null;
  }
}

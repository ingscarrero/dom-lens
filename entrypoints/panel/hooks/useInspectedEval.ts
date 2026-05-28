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
  if (res.isError) return { ok: false, reason: res.description };
  if (typeof res.value !== 'string') return { ok: false, reason: 'unexpected non-string eval result' };
  try {
    const parsed = JSON.parse(res.value);
    if (parsed && parsed.__no_api) {
      return {
        ok: false,
        reason: 'DOM Lens main-world script not present on this page. Reload the page after installing the extension.',
      };
    }
    if (parsed && parsed.__error) {
      return { ok: false, reason: parsed.__error };
    }
    return { ok: true, partial: parsed };
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
}

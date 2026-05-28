import { defineContentScript } from 'wxt/utils/define-content-script';
import { installDevtoolsHookShim } from '@/lib/react/walkFiber';
import { createConsoleBuffer, readPageMetrics, runCapture } from '@/lib/snapshot/capture';
import type { PageMetrics, PartialSnapshot, ConsoleEntry } from '@/lib/snapshot/types';

declare global {
  interface Window {
    __dom_lens__?: DomLensApi;
  }
}

interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  color?: string;
}

interface DomLensApi {
  version: string;
  capture(opts?: { maxMarkdownChars?: number }): PartialSnapshot;
  ping(): { ok: true; t: number };
  scrollMetrics(): PageMetrics;
  scrollTo(x: number, y: number): { ok: true; scrollX: number; scrollY: number };
  highlight(rect: HighlightRect): { ok: true };
  clearHighlight(): { ok: true };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: false,
  main() {
    installDevtoolsHookShim();

    const consoleBuffer = createConsoleBuffer(500);
    const original: Partial<Record<keyof Console, (...a: any[]) => void>> = {};
    const levels: Array<ConsoleEntry['level']> = ['error', 'warn', 'log', 'info', 'debug'];
    for (const level of levels) {
      const orig = (console as any)[level] as (...a: any[]) => void;
      original[level] = orig;
      (console as any)[level] = function (...args: any[]) {
        try {
          const message = args
            .map((a) => {
              if (a instanceof Error) return a.stack || a.message;
              if (typeof a === 'string') return a;
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(' ');
          consoleBuffer.push({
            level,
            message: message.slice(0, 4000),
            timestamp: Date.now(),
            stack: args.find((a) => a instanceof Error)?.stack,
          });
        } catch {
          /* swallow */
        }
        return orig.apply(this, args as any);
      };
    }

    window.addEventListener('error', (ev) => {
      consoleBuffer.push({
        level: 'error',
        message: ev.message,
        timestamp: Date.now(),
        stack: ev.error?.stack,
      });
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      consoleBuffer.push({
        level: 'error',
        message: `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
        timestamp: Date.now(),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });

    const HIGHLIGHT_ID = '__dom_lens_highlight__';

    function ensureHighlightEl(): HTMLDivElement {
      let el = document.getElementById(HIGHLIGHT_ID) as HTMLDivElement | null;
      if (el) return el;
      el = document.createElement('div');
      el.id = HIGHLIGHT_ID;
      el.style.cssText = [
        'position:absolute',
        'pointer-events:none',
        'z-index:2147483647',
        'box-sizing:border-box',
        'border:2px solid #0ea5e9',
        'background:rgba(14,165,233,0.18)',
        'border-radius:2px',
        'transition:left .08s ease,top .08s ease,width .08s ease,height .08s ease',
        'font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'color:#fff',
        'display:none',
      ].join(';');
      const label = document.createElement('span');
      label.id = HIGHLIGHT_ID + '_label';
      label.style.cssText = [
        'position:absolute',
        'top:-18px',
        'left:0',
        'padding:1px 4px',
        'background:#0ea5e9',
        'border-radius:2px',
        'white-space:nowrap',
        'max-width:300px',
        'overflow:hidden',
        'text-overflow:ellipsis',
      ].join(';');
      el.appendChild(label);
      document.documentElement.appendChild(el);
      return el;
    }

    const api: DomLensApi = {
      version: '0.2.0',
      capture(opts) {
        return runCapture(consoleBuffer, {
          maxMarkdownChars: opts?.maxMarkdownChars ?? 20000,
        });
      },
      ping() {
        return { ok: true, t: Date.now() };
      },
      scrollMetrics() {
        return readPageMetrics();
      },
      scrollTo(x, y) {
        try {
          window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
        } catch {
          window.scrollTo(x, y);
        }
        return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
      },
      highlight(rect) {
        const el = ensureHighlightEl();
        el.style.left = rect.x + 'px';
        el.style.top = rect.y + 'px';
        el.style.width = rect.w + 'px';
        el.style.height = rect.h + 'px';
        el.style.display = 'block';
        if (rect.color) {
          el.style.borderColor = rect.color;
          el.style.background = rect.color + '30';
          const labelEl = document.getElementById(HIGHLIGHT_ID + '_label');
          if (labelEl) labelEl.style.background = rect.color;
        }
        const labelEl = document.getElementById(HIGHLIGHT_ID + '_label');
        if (labelEl) labelEl.textContent = rect.label ?? '';
        return { ok: true };
      },
      clearHighlight() {
        const el = document.getElementById(HIGHLIGHT_ID);
        if (el) el.style.display = 'none';
        return { ok: true };
      },
    };

    // Replace any older instance so an extension reload doesn't strand the
    // page with a stale (e.g. v0.1.0) main-world API.
    try {
      Object.defineProperty(window, '__dom_lens__', {
        value: api,
        configurable: true,
        writable: true,
      });
    } catch {
      (window as any).__dom_lens__ = api;
    }
  },
});

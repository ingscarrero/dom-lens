import { defineContentScript } from 'wxt/utils/define-content-script';
import { installDevtoolsHookShim } from '@/lib/react/walkFiber';
import { createConsoleBuffer, runCapture } from '@/lib/snapshot/capture';
import type { PartialSnapshot, ConsoleEntry } from '@/lib/snapshot/types';

declare global {
  interface Window {
    __dom_lens__?: DomLensApi;
  }
}

interface DomLensApi {
  version: string;
  capture(opts?: { maxMarkdownChars?: number }): PartialSnapshot;
  ping(): { ok: true; t: number };
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

    const api: DomLensApi = {
      version: '0.1.0',
      capture(opts) {
        return runCapture(consoleBuffer, {
          maxMarkdownChars: opts?.maxMarkdownChars ?? 20000,
        });
      },
      ping() {
        return { ok: true, t: Date.now() };
      },
    };

    Object.defineProperty(window, '__dom_lens__', {
      value: api,
      configurable: true,
      writable: false,
    });
  },
});

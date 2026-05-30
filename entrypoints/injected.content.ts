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
  /** Hide every position: fixed / sticky element so they don't get
   * recaptured on each tile during scroll-and-stitch. Returns the count. */
  beginFullPageCapture(): { ok: true; hiddenCount: number };
  /** Restore the elements hidden by beginFullPageCapture. Idempotent. */
  endFullPageCapture(): { ok: true; restoredCount: number };
  /** Read the actual scroll position right now — used to verify a
   * scrollTo() landed where we asked. */
  getScrollPosition(): { scrollX: number; scrollY: number };
  /** Kick off the async lazy-load priming pass. Returns immediately —
   * use getPrimeLazyLoadStatus() to poll for completion. The async path
   * is split because chrome.devtools.inspectedWindow.eval does not await
   * Promises, so the panel needs a poll-friendly synchronous API. */
  startPrimeLazyLoad(opts?: { delayMs?: number }): { ok: true };
  /** Returns the current state of the priming pass started by
   * startPrimeLazyLoad. Polled from the panel side. */
  getPrimeLazyLoadStatus():
    | { status: 'idle' | 'running' }
    | { status: 'done'; finalHeight: number; finalWidth: number; startY: number }
    | { status: 'error'; message: string };
  /** Walk the DOM looking for elements that reference the given asset URL —
   * <img src>, <link href>, <source srcset>, inline style background-image,
   * and computed-style background-image. Used by the Modules tab to show
   * "where is this image used on the page?". */
  findAssetUsages(url: string): {
    ok: true;
    usages: Array<{
      tag: string;
      attribute: string;
      selector: string;
      text?: string;
    }>;
  };
  /** Scroll the matching element into view + paint the existing highlight
   * overlay around it. Returns the element's viewport-relative rect when
   * matched. The caller hands us a CSS selector that came from
   * findAssetUsages — we re-resolve so cross-tab selector edits don't
   * stick. */
  scrollToSelector(selector: string, opts?: { label?: string; color?: string }):
    | { ok: true; rect: { x: number; y: number; w: number; h: number } }
    | { ok: false; reason: string };
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

    // Stores the per-element style overrides applied by beginFullPageCapture
    // so endFullPageCapture can restore exact previous values. The map is
    // keyed by the element itself; we use a WeakSet alongside to dedupe.
    interface HiddenRecord {
      el: HTMLElement;
      origVisibility: string;
      origPriority: string;
    }
    let hiddenSticky: HiddenRecord[] = [];

    type PrimeState =
      | { status: 'idle' | 'running' }
      | { status: 'done'; finalHeight: number; finalWidth: number; startY: number }
      | { status: 'error'; message: string };
    let primeState: PrimeState = { status: 'idle' };

    /**
     * Builds a set of candidate substrings that should "match" a usage of
     * the asset URL. We accept absolute, relative, and just-filename forms
     * because the network records the absolute URL but inline references
     * (link href, src) often use the relative path.
     */
    function buildMatchers(url: string): string[] {
      const out = new Set<string>();
      try {
        const u = new URL(url);
        out.add(u.href);
        out.add(u.pathname);
        const last = u.pathname.split('/').filter(Boolean).pop();
        if (last) out.add(last);
      } catch {
        out.add(url);
      }
      return Array.from(out).filter((s) => s.length >= 4);
    }

    function anyMatch(text: string, matchers: string[]): boolean {
      for (const m of matchers) if (text.includes(m)) return true;
      return false;
    }

    /**
     * Best-effort CSS selector for an element: id wins; otherwise
     * tag + nth-of-type up to 4 levels deep. Truncated to a sane length
     * for the UI.
     */
    function selectorFor(el: Element, maxDepth = 4): string {
      if (el.id) return '#' + cssEscape(el.id);
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < maxDepth) {
        const tag = cur.tagName;
        let part = tag.toLowerCase();
        const cls = (cur as HTMLElement).className;
        if (typeof cls === 'string' && cls.trim()) {
          part += '.' + cls.trim().split(/\s+/).slice(0, 2).map(cssEscape).join('.');
        }
        const parentEl: Element | null = cur.parentElement;
        if (parentEl) {
          const sibs: Element[] = [];
          for (let i = 0; i < parentEl.children.length; i++) {
            const child = parentEl.children[i];
            if (child.tagName === tag) sibs.push(child);
          }
          if (sibs.length > 1) {
            part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
          }
        }
        parts.unshift(part);
        cur = parentEl;
        depth += 1;
      }
      const s = parts.join(' > ');
      return s.length > 120 ? '…' + s.slice(-120) : s;
    }

    function cssEscape(s: string): string {
      try {
        // Native CSS.escape exists in all modern browsers.
        return (window as any).CSS?.escape?.(s) ?? s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      } catch {
        return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      }
    }

    // Capture-mode CSS overrides: force scroll-behavior to auto so our
    // scrollTo()s land instantly even on pages that use `scroll-behavior:
    // smooth` (which makes window.scrollTo({behavior:'instant'}) honour
    // the css unless the spec strict path is taken — inconsistent across
    // browsers). Removed when capture ends.
    const SCROLL_FIX_STYLE_ID = '__dom_lens_scroll_fix__';
    let savedHash: string | null = null;
    let savedScrollRestoration: ScrollRestoration | null = null;

    function installScrollFix(): void {
      if (document.getElementById(SCROLL_FIX_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = SCROLL_FIX_STYLE_ID;
      style.textContent = [
        'html, body, *, *::before, *::after {',
        '  scroll-behavior: auto !important;',
        '  scroll-snap-type: none !important;',
        '}',
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
      // Clear URL hash anchors so the browser doesn't jump back to an
      // anchor each time we scrollTo(0, 0). #mainContent and similar are
      // a common scroll-to-top defeater.
      try {
        if (window.location.hash) {
          savedHash = window.location.hash;
          history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          );
        }
      } catch {
        /* SecurityError on some sandboxed pages — fall through */
      }
      // Stop the browser from restoring an old scroll position mid-capture.
      try {
        if ('scrollRestoration' in history) {
          savedScrollRestoration = history.scrollRestoration;
          history.scrollRestoration = 'manual';
        }
      } catch {
        /* ignore */
      }
    }

    function uninstallScrollFix(): void {
      const style = document.getElementById(SCROLL_FIX_STYLE_ID);
      if (style) style.remove();
      try {
        if (savedHash) {
          history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search + savedHash,
          );
          savedHash = null;
        }
        if (savedScrollRestoration && 'scrollRestoration' in history) {
          history.scrollRestoration = savedScrollRestoration;
          savedScrollRestoration = null;
        }
      } catch {
        /* ignore */
      }
    }

    /**
     * Reliable scrollTo that tries multiple targets in order. Pages
     * sometimes:
     *   - override window.scrollTo (some SPAs/jQuery plugins);
     *   - set body { overflow: hidden } and scroll documentElement;
     *   - put the scrolling content under a custom element such that
     *     scrollingElement is the real scroller.
     */
    function reliableScrollTo(x: number, y: number): void {
      try {
        window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
      } catch {
        try {
          window.scrollTo(x, y);
        } catch {
          /* fall through */
        }
      }
      try {
        const de = document.documentElement;
        if (de) {
          de.scrollLeft = x;
          de.scrollTop = y;
        }
      } catch {
        /* ignore */
      }
      try {
        const se = document.scrollingElement as HTMLElement | null;
        if (se && se !== document.documentElement) {
          se.scrollLeft = x;
          se.scrollTop = y;
        }
      } catch {
        /* ignore */
      }
    }

    function currentDocHeight(): number {
      return Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
        document.documentElement.offsetHeight,
        document.body?.offsetHeight ?? 0,
        window.innerHeight,
      );
    }

    function snapshotAndHideFixedAndSticky(): number {
      // Collect every element whose computed position is fixed or sticky.
      // This is the classic duplication source for scroll-and-stitch
      // screenshotters: a fixed header stays in the viewport for every
      // tile, so the stitched output shows it repeated at viewport-height
      // intervals. The standard fix is to hide them while capturing all
      // tiles except the very first.
      const all = document.body.getElementsByTagName('*');
      const hits: HTMLElement[] = [];
      for (let i = 0; i < all.length; i++) {
        const el = all[i] as HTMLElement;
        try {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'sticky') {
            // Skip our own highlight overlay
            if (el.id === HIGHLIGHT_ID) continue;
            hits.push(el);
          }
        } catch {
          /* ignore — cross-origin frame contents etc */
        }
      }
      hiddenSticky = hits.map((el) => {
        const rec: HiddenRecord = {
          el,
          origVisibility: el.style.visibility,
          origPriority: el.style.getPropertyPriority('visibility'),
        };
        el.style.setProperty('visibility', 'hidden', 'important');
        return rec;
      });
      return hiddenSticky.length;
    }

    function restoreHiddenFixedAndSticky(): number {
      const n = hiddenSticky.length;
      for (const rec of hiddenSticky) {
        try {
          if (rec.origVisibility) {
            rec.el.style.setProperty(
              'visibility',
              rec.origVisibility,
              rec.origPriority || '',
            );
          } else {
            rec.el.style.removeProperty('visibility');
          }
        } catch {
          /* ignore */
        }
      }
      hiddenSticky = [];
      return n;
    }

    const api: DomLensApi = {
      version: '0.3.14',
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
        reliableScrollTo(x, y);
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
      beginFullPageCapture() {
        installScrollFix();
        return { ok: true, hiddenCount: snapshotAndHideFixedAndSticky() };
      },
      endFullPageCapture() {
        const n = restoreHiddenFixedAndSticky();
        uninstallScrollFix();
        return { ok: true, restoredCount: n };
      },
      getScrollPosition() {
        return { scrollX: window.scrollX, scrollY: window.scrollY };
      },
      startPrimeLazyLoad(opts) {
        // Kick off the async priming pass and store the resulting state
        // on a module-scoped variable. The panel polls
        // getPrimeLazyLoadStatus() because chrome.devtools.inspectedWindow.eval
        // doesn't await Promises.
        if (primeState.status === 'running') return { ok: true };
        primeState = { status: 'running' };
        const startY = window.scrollY;
        const delayMs = Math.max(40, opts?.delayMs ?? 180);

        (async () => {
          try {
            // Force loading="lazy" images & iframes to eager so they start
            // fetching even before our scroll passes them. Lazy is a perf
            // hint, not semantic state — no need to restore.
            try {
              const imgs = document.querySelectorAll(
                'img[loading="lazy"], iframe[loading="lazy"]',
              );
              for (let i = 0; i < imgs.length; i++) {
                (imgs[i] as HTMLImageElement | HTMLIFrameElement).setAttribute(
                  'loading',
                  'eager',
                );
              }
            } catch {
              /* ignore */
            }

            installScrollFix();

            const stepPx = Math.max(80, Math.floor(window.innerHeight * 0.8));
            let y = 0;
            let lastHeight = currentDocHeight();
            let safety = 0;
            while (y < lastHeight && safety < 200) {
              reliableScrollTo(0, y);
              await new Promise((r) => setTimeout(r, delayMs));
              const h = currentDocHeight();
              if (h > lastHeight) lastHeight = h;
              y += stepPx;
              safety += 1;
            }
            reliableScrollTo(0, lastHeight);
            await new Promise((r) => setTimeout(r, delayMs));
            lastHeight = Math.max(lastHeight, currentDocHeight());

            // Wait for any in-flight images to decode before declaring
            // the prime done. This catches images that started loading
            // but haven't laid out yet (which would extend scrollHeight
            // further once they do).
            try {
              const allImgs = Array.from(document.images);
              const pending = allImgs.filter((img) => !img.complete);
              if (pending.length > 0) {
                await Promise.race([
                  Promise.all(
                    pending.map(
                      (img) =>
                        new Promise<void>((res) => {
                          img.addEventListener('load', () => res(), { once: true });
                          img.addEventListener('error', () => res(), { once: true });
                        }),
                    ),
                  ),
                  new Promise((res) => setTimeout(res, 2000)),
                ]);
                lastHeight = Math.max(lastHeight, currentDocHeight());
              }
            } catch {
              /* ignore */
            }

            // Return to top so the real capture pass starts clean.
            reliableScrollTo(0, 0);
            await new Promise((r) => setTimeout(r, 80));

            primeState = {
              status: 'done',
              finalHeight: lastHeight,
              finalWidth: Math.max(
                document.documentElement.scrollWidth,
                document.body?.scrollWidth ?? 0,
                window.innerWidth,
              ),
              startY,
            };
          } catch (e) {
            primeState = {
              status: 'error',
              message: e instanceof Error ? e.message : String(e),
            };
          }
        })();

        return { ok: true };
      },
      getPrimeLazyLoadStatus() {
        return primeState;
      },
      scrollToSelector(selector, opts) {
        let el: Element | null = null;
        try {
          el = document.querySelector(selector);
        } catch {
          return { ok: false, reason: 'invalid selector' };
        }
        if (!el) return { ok: false, reason: 'no element matches selector' };
        try {
          (el as HTMLElement).scrollIntoView({
            block: 'center',
            inline: 'center',
            behavior: 'instant' as ScrollBehavior,
          });
        } catch {
          try {
            (el as HTMLElement).scrollIntoView();
          } catch {
            /* ignore */
          }
        }
        const r = (el as HTMLElement).getBoundingClientRect();
        const docX = r.left + window.scrollX;
        const docY = r.top + window.scrollY;
        // Reuse the existing highlight overlay machinery — it positions in
        // document coordinates so the rect persists across small scrolls.
        const el2 = ensureHighlightEl();
        el2.style.left = docX + 'px';
        el2.style.top = docY + 'px';
        el2.style.width = r.width + 'px';
        el2.style.height = r.height + 'px';
        el2.style.display = 'block';
        if (opts?.color) {
          el2.style.borderColor = opts.color;
          el2.style.background = opts.color + '30';
        }
        const labelEl = document.getElementById(HIGHLIGHT_ID + '_label');
        if (labelEl) labelEl.textContent = opts?.label ?? '';
        return {
          ok: true,
          rect: { x: docX, y: docY, w: r.width, h: r.height },
        };
      },
      findAssetUsages(url) {
        // Trims protocol/host so a relative match still wins. We compare on
        // the absolute URL plus the pathname + filename — covers the common
        // case where the same asset appears in network as
        // https://cdn.example/x/y/z.png and inline as /x/y/z.png or just
        // z.png.
        const usages: Array<{
          tag: string;
          attribute: string;
          selector: string;
          text?: string;
        }> = [];
        const matches = buildMatchers(url);
        const seen = new Set<Element>();

        const push = (
          el: Element,
          attribute: string,
          text?: string,
        ) => {
          if (seen.has(el)) {
            // Allow multiple distinct attributes per element.
          } else {
            seen.add(el);
          }
          usages.push({
            tag: el.tagName.toLowerCase(),
            attribute,
            selector: selectorFor(el),
            text: text?.slice(0, 80),
          });
        };

        try {
          // <img src> / <iframe src> / <source src/srcset> / <video src/poster>
          const tagged = document.querySelectorAll(
            'img[src], img[srcset], iframe[src], source[src], source[srcset], video[src], video[poster], audio[src], embed[src]',
          );
          for (let i = 0; i < tagged.length; i++) {
            const el = tagged[i];
            const attrs = ['src', 'srcset', 'poster'];
            for (const a of attrs) {
              const v = el.getAttribute(a);
              if (v && anyMatch(v, matches)) push(el, a);
            }
          }
          // <link href>
          const links = document.querySelectorAll('link[href]');
          for (let i = 0; i < links.length; i++) {
            const el = links[i];
            const v = el.getAttribute('href');
            if (v && anyMatch(v, matches)) push(el, 'href');
          }
          // Inline style background-image
          const styled = document.querySelectorAll('[style*="background"]');
          for (let i = 0; i < styled.length; i++) {
            const el = styled[i];
            const s = el.getAttribute('style') || '';
            if (anyMatch(s, matches)) push(el, 'style[background-image]', s);
          }
          // Computed style background-image for the first 200 candidates
          // (full scan is too slow on big pages — limit to elements that
          // visually have a background).
          if (usages.length < 20) {
            const all = document.body.getElementsByTagName('*');
            const limit = Math.min(all.length, 800);
            let probes = 0;
            for (let i = 0; i < limit && probes < 200; i++) {
              const el = all[i] as HTMLElement;
              try {
                const cs = getComputedStyle(el);
                const bg = cs.backgroundImage;
                if (bg && bg !== 'none') {
                  probes += 1;
                  if (anyMatch(bg, matches)) {
                    push(el, 'computed background-image', bg);
                  }
                }
              } catch {
                /* cross-origin frames etc */
              }
            }
          }
        } catch {
          /* swallow — partial results are still useful */
        }

        return { ok: true, usages };
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

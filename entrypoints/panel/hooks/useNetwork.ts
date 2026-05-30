import { useEffect } from 'react';
import { useStore } from '../store';
import type { HarEntry } from '@/lib/snapshot/types';

export function useNetwork(): void {
  const push = useStore((s) => s.pushNetwork);
  useEffect(() => {
    const handler = (req: chrome.devtools.network.Request) => {
      const r = req as any;
      // HAR `response.headers` is `[{name, value}]`. Scan once for the
      // sourcemap header variants — standard `SourceMap` and legacy
      // `X-SourceMap` (still emitted by older CRA / Webpack configs).
      let sourceMapHeader: string | undefined;
      const headers = r.response?.headers;
      if (Array.isArray(headers)) {
        for (const h of headers) {
          const name = String(h?.name ?? '').toLowerCase();
          if (name === 'sourcemap' || name === 'x-sourcemap') {
            const v = String(h.value ?? '').trim();
            if (v) {
              sourceMapHeader = v;
              break;
            }
          }
        }
      }
      const entry: HarEntry = {
        url: r.request?.url ?? '',
        method: r.request?.method ?? 'GET',
        status: r.response?.status ?? 0,
        resourceType: r._resourceType,
        startedDateTime: r.startedDateTime,
        timeMs: typeof r.time === 'number' ? Math.round(r.time) : undefined,
        responseSize: r.response?.bodySize ?? r.response?._transferSize,
        mimeType: r.response?.content?.mimeType,
        sourceMapHeader,
      };
      push(entry);
    };
    chrome.devtools.network.onRequestFinished.addListener(handler);
    return () => chrome.devtools.network.onRequestFinished.removeListener(handler);
  }, [push]);
}

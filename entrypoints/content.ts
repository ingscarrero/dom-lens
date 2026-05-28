import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    // Isolated-world placeholder. The MAIN-world script (entrypoints/injected.content.ts)
    // does the actual work. We keep this here so we can grow a bridge later
    // (e.g. for postMessage relaying) without changing the manifest.
  },
});

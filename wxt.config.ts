import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  manifest: {
    name: 'DOM Lens',
    description:
      'Capture DOM snapshots, walk React fiber trees, map Module Federation, and analyze with a local AI.',
    permissions: [
      'storage',
      // chrome.scripting.executeScript: inject the MAIN-world inspector and
      // clean up the highlight overlay when DevTools disconnects.
      'scripting',
      // chrome.tabs.get(...).url / windowId: resolve the inspected tab for
      // captureVisibleTab and for the net-proxy same-host exemption.
      'tabs',
    ],
    host_permissions: ['<all_urls>'],
    devtools_page: 'devtools.html',
    web_accessible_resources: [
      {
        resources: ['/injected.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
  vite: () => ({
    plugins: [react()],
  }),
});

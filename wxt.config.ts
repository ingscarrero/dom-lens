import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  manifest: {
    name: 'DOM Lens',
    description:
      'Capture DOM snapshots, walk React fiber trees, map Module Federation, and analyze with a local AI.',
    permissions: ['storage', 'scripting', 'activeTab', 'tabs'],
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

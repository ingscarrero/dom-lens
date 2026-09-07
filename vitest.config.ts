import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests cover the pure, framework-agnostic logic under `lib/`.
 * The React panel, the background service worker and the MAIN-world
 * injected script depend on `chrome.*` / DevTools APIs and are
 * exercised manually (see docs/runbooks/mf-demo.md).
 *
 * Coverage thresholds sit ~3 points below the measured baseline so a
 * regression fails CI while small refactors still pass. Raise them as
 * coverage grows — never lower them to make a red build green.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Default to node; DOM-dependent suites opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'lib/concurrency/pool.ts',
        'lib/federation/detect.ts',
        'lib/federation/graph.ts',
        'lib/modules/classify.ts',
        'lib/modules/fingerprints.ts',
        'lib/modules/githubMapping.ts',
        'lib/modules/sourcemap.ts',
        'lib/react/fiberToTree.ts',
        'lib/react/walkFiber.ts',
        'lib/snapshot/serializeDom.ts',
        'lib/snapshot/slicer.ts',
      ],
      // Measured baseline (2026-09-07): lines 97.1 / branches 88.7 /
      // functions 98.8 / statements 94.8.
      thresholds: {
        lines: 94,
        branches: 85,
        functions: 95,
        statements: 91,
      },
    },
  },
});

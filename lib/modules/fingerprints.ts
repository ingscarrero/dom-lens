import type { FingerprintCategory, ConfidenceLevel } from './types';

/**
 * A fingerprint describes how to detect one piece of the tech stack.
 * Detection runs in MAIN world (so it can read `window.*`) plus the panel
 * cross-references URL patterns against the loaded script list.
 */
export interface FingerprintSpec {
  id: string;
  name: string;
  category: FingerprintCategory;
  /** Window globals to probe; first match wins. */
  globals?: string[];
  /** Dot-path on the matched global where the version lives. */
  versionPath?: string;
  /** Regex patterns applied to script URLs as additional/sole evidence. */
  urlPatterns?: RegExp[];
  /** Selectors to check (e.g. <script src="..."> patterns surfaced as data-* attributes). */
  domSelectors?: string[];
}

export const FINGERPRINTS: FingerprintSpec[] = [
  // Frameworks
  {
    id: 'react',
    name: 'React',
    category: 'framework',
    globals: ['React'],
    versionPath: 'version',
    urlPatterns: [/\breact[@\-/]\d/i, /react\.(production|development)/i, /react-dom[@\-/]/i],
  },
  {
    id: 'preact',
    name: 'Preact',
    category: 'framework',
    globals: ['preact'],
    urlPatterns: [/\bpreact[@\-/]/i],
  },
  {
    id: 'vue',
    name: 'Vue',
    category: 'framework',
    globals: ['Vue'],
    versionPath: 'version',
    urlPatterns: [/\bvue[@\-/]\d/i, /vue\.global/i, /vue\.runtime/i],
  },
  {
    id: 'angular',
    name: 'Angular',
    category: 'framework',
    globals: ['ng', 'angular'],
    urlPatterns: [/@angular\//i, /\bangular[@\-/]/i, /\bzone\.js/i],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    category: 'framework',
    urlPatterns: [/\bsvelte[@\-/]/i, /svelte\/internal/i],
  },
  {
    id: 'solid',
    name: 'Solid',
    category: 'framework',
    globals: ['_$HY'],
    urlPatterns: [/\bsolid-js[@\-/]/i],
  },
  {
    id: 'lit',
    name: 'Lit',
    category: 'framework',
    urlPatterns: [/\blit[@\-/]\d/i, /lit-element/i, /lit-html/i],
  },
  {
    id: 'qwik',
    name: 'Qwik',
    category: 'framework',
    globals: ['qwikevents'],
    urlPatterns: [/\bqwik[@\-/]/i],
  },

  // Meta-frameworks
  {
    id: 'next',
    name: 'Next.js',
    category: 'framework',
    globals: ['__NEXT_DATA__', 'next'],
    versionPath: 'version',
    urlPatterns: [/_next\//, /\/_next\/static\//],
  },
  {
    id: 'remix',
    name: 'Remix',
    category: 'framework',
    globals: ['__remixContext'],
    urlPatterns: [/\/build\/_shared\/chunk-/i, /remix-run/i],
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    category: 'framework',
    globals: ['__NUXT__', '$nuxt'],
    urlPatterns: [/_nuxt\//, /\/__nuxt\//],
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    category: 'framework',
    globals: ['___gatsby'],
    urlPatterns: [/page-data/i, /webpack-runtime/i, /gatsby/i],
  },
  {
    id: 'astro',
    name: 'Astro',
    category: 'framework',
    globals: ['Astro'],
    urlPatterns: [/\bastro[@\-/]/i, /astro-island/i],
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    category: 'framework',
    urlPatterns: [/\/_app\/immutable\//, /@sveltejs\/kit/i],
  },

  // Bundlers / runtimes
  {
    id: 'webpack5',
    name: 'Webpack 5',
    category: 'bundler',
    globals: ['__webpack_require__', '__webpack_share_scopes__', '__webpack_modules__'],
    urlPatterns: [/runtime~/, /webpackJsonp/i, /chunk-[a-f0-9]+\.js/i],
  },
  {
    id: 'vite',
    name: 'Vite',
    category: 'bundler',
    globals: ['__vite_plugin_react_preamble_installed__', '__vite__'],
    urlPatterns: [/\/@vite\//, /\/@id\//, /\/node_modules\/\.vite\//],
  },
  {
    id: 'rollup',
    name: 'Rollup',
    category: 'bundler',
    urlPatterns: [/\b__esModule\b/, /assets\/index-[A-Za-z0-9]+\.js/],
  },
  {
    id: 'esbuild',
    name: 'esbuild',
    category: 'bundler',
    urlPatterns: [/\/esbuild\//i],
  },
  {
    id: 'turbopack',
    name: 'Turbopack',
    category: 'bundler',
    urlPatterns: [/\/_next\/static\/chunks\/.*_app-pages-browser/i],
  },
  {
    id: 'parcel',
    name: 'Parcel',
    category: 'bundler',
    urlPatterns: [/parcelRequire/i, /\bparcel[@\-/]/i],
  },
  {
    id: 'mf',
    name: 'Module Federation',
    category: 'bundler',
    globals: ['__webpack_share_scopes__', '__federation__', '__FEDERATION__'],
    urlPatterns: [/remoteEntry/i, /mf-manifest/i],
  },

  // State management
  {
    id: 'redux',
    name: 'Redux',
    category: 'stateLib',
    globals: ['__REDUX_DEVTOOLS_EXTENSION__'],
    urlPatterns: [/\bredux[@\-/]/i, /redux-toolkit/i, /@reduxjs\/toolkit/i],
  },
  {
    id: 'mobx',
    name: 'MobX',
    category: 'stateLib',
    globals: ['__mobxGlobals'],
    urlPatterns: [/\bmobx[@\-/]/i],
  },
  {
    id: 'zustand',
    name: 'Zustand',
    category: 'stateLib',
    urlPatterns: [/\bzustand[@\-/]/i],
  },
  {
    id: 'jotai',
    name: 'Jotai',
    category: 'stateLib',
    urlPatterns: [/\bjotai[@\-/]/i],
  },
  {
    id: 'recoil',
    name: 'Recoil',
    category: 'stateLib',
    urlPatterns: [/\brecoil[@\-/]/i],
  },
  {
    id: 'xstate',
    name: 'XState',
    category: 'stateLib',
    urlPatterns: [/\bxstate[@\-/]/i, /@xstate\//i],
  },
  {
    id: 'react-query',
    name: 'TanStack Query',
    category: 'stateLib',
    urlPatterns: [/react-query/i, /@tanstack\/react-query/i],
  },
  {
    id: 'swr',
    name: 'SWR',
    category: 'stateLib',
    urlPatterns: [/\bswr[@\-/]/i],
  },
  {
    id: 'apollo',
    name: 'Apollo Client',
    category: 'stateLib',
    globals: ['__APOLLO_CLIENT__'],
    urlPatterns: [/@apollo\//i, /apollo-client/i],
  },

  // Routers
  {
    id: 'react-router',
    name: 'React Router',
    category: 'router',
    urlPatterns: [/react-router/i, /@remix-run\/router/i],
  },
  {
    id: 'tanstack-router',
    name: 'TanStack Router',
    category: 'router',
    urlPatterns: [/@tanstack\/react-router/i],
  },

  // UI libraries
  {
    id: 'mui',
    name: 'Material-UI',
    category: 'ui',
    urlPatterns: [/@mui\//i, /material-ui/i],
  },
  {
    id: 'antd',
    name: 'Ant Design',
    category: 'ui',
    urlPatterns: [/\bantd[@\-/]/i, /@ant-design\//i],
  },
  {
    id: 'chakra',
    name: 'Chakra UI',
    category: 'ui',
    urlPatterns: [/@chakra-ui\//i],
  },
  {
    id: 'radix',
    name: 'Radix UI',
    category: 'ui',
    urlPatterns: [/@radix-ui\//i],
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    category: 'ui',
    urlPatterns: [/tailwind/i],
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap',
    category: 'ui',
    globals: ['bootstrap'],
    urlPatterns: [/\bbootstrap[@\-/]/i],
  },

  // Utilities
  {
    id: 'lodash',
    name: 'Lodash',
    category: 'utility',
    globals: ['_'],
    versionPath: 'VERSION',
    urlPatterns: [/\blodash[@\-/]/i],
  },
  {
    id: 'moment',
    name: 'Moment',
    category: 'utility',
    globals: ['moment'],
    urlPatterns: [/\bmoment[@\-/]/i],
  },
  {
    id: 'dayjs',
    name: 'Day.js',
    category: 'utility',
    globals: ['dayjs'],
    urlPatterns: [/\bdayjs[@\-/]/i],
  },
  {
    id: 'date-fns',
    name: 'date-fns',
    category: 'utility',
    urlPatterns: [/\bdate-fns[@\-/]/i],
  },
  {
    id: 'rxjs',
    name: 'RxJS',
    category: 'utility',
    globals: ['Rx'],
    urlPatterns: [/\brxjs[@\-/]/i],
  },
  {
    id: 'axios',
    name: 'Axios',
    category: 'utility',
    globals: ['axios'],
    urlPatterns: [/\baxios[@\-/]/i],
  },
  {
    id: 'three',
    name: 'three.js',
    category: 'utility',
    globals: ['THREE'],
    versionPath: 'REVISION',
    urlPatterns: [/\bthree[@\-/]/i],
  },
  {
    id: 'd3',
    name: 'D3',
    category: 'utility',
    globals: ['d3'],
    versionPath: 'version',
    urlPatterns: [/\bd3[@\-/]/i, /\bd3\.min/i],
  },

  // Analytics — useful context for risk analysis
  {
    id: 'gtag',
    name: 'Google Tag Manager / GA',
    category: 'analytics',
    globals: ['dataLayer', 'google_tag_manager', 'gtag'],
    urlPatterns: [/googletagmanager\.com/i, /google-analytics\.com/i, /gtag\/js/i],
  },
  {
    id: 'segment',
    name: 'Segment',
    category: 'analytics',
    globals: ['analytics'],
    urlPatterns: [/segment\.com\/analytics\.js/i, /\banalytics\.min\.js/i],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    globals: ['mixpanel'],
    urlPatterns: [/mixpanel/i],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'analytics',
    globals: ['Sentry', '__SENTRY__'],
    urlPatterns: [/sentry\.io/i, /@sentry\//i, /\bsentry[@\-/]/i],
  },
];

export function readVersionAt(globalRef: any, path?: string): string | undefined {
  if (!path) return undefined;
  try {
    let cur: any = globalRef;
    for (const segment of path.split('.')) {
      if (cur == null) return undefined;
      cur = cur[segment];
    }
    if (typeof cur === 'string' || typeof cur === 'number') return String(cur);
  } catch {
    /* ignore */
  }
  return undefined;
}

export function confidenceFromEvidence(
  globalHit: boolean,
  urlHits: number,
  versionFound: boolean,
): ConfidenceLevel {
  if (globalHit && versionFound) return 'high';
  if (globalHit) return 'high';
  if (urlHits >= 2) return 'medium';
  if (urlHits === 1) return 'low';
  return 'low';
}

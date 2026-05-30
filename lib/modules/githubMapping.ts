/**
 * GitHub repo mapping for module sources.
 *
 * A user-configurable rule that says "when a deployed module URL
 * matches PATTERN, its sourcemap-derived files live at this GitHub
 * repo". The Modules tab then surfaces a "View on GitHub" link in
 * the FileDetail toolbar and a repo card in the ModuleAnalysis
 * panel, so the user can jump from the deployed bundle to the
 * canonical source on GitHub in one click.
 *
 * Why this matters:
 *   - Production builds frequently strip `sourcesContent`
 *     (`nosources-source-map`), leaving the sourcemap useful for
 *     stack-trace symbolication but not for source disclosure. The
 *     repo holds the actual code.
 *   - Even with `sourcesContent`, the on-GitHub version is the
 *     canonical, navigable, blame-able copy — better for reading,
 *     opening issues, copying snippets, etc.
 *
 * The matching strategy is intentionally trivial: substring match on
 * the module's full URL. Users want "any module from localhost:3001"
 * to map to one repo and "any module from cdn.example.com/v2/" to
 * map to another — substring covers both without forcing them to
 * learn regex.
 */

export interface GithubMapping {
  /** Stable id used as the storage key + React list key. */
  id: string;
  /** Display label for the Settings list and the FileDetail badge. */
  label: string;
  /** Substring matched against the deployed module's URL. First mapping
   * whose pattern is a substring of the URL wins. */
  urlPattern: string;
  /** GitHub user or org. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Branch / tag / commit. Anything the GitHub URL accepts. Supports
   * a `{version}` placeholder that gets substituted when `versionCapture`
   * matches the module URL — e.g. `v{version}` + capture `/v([0-9.]+)/`
   * → `v1.2.3` for CDN URLs like `cdn.example.com/v1.2.3/main.js`. */
  branch: string;
  /** Optional prefix to prepend to the file path inside the repo. Useful
   * for monorepos where the deployed bundle was built from a subdir
   * (e.g. `host` for our `examples/mf-demo/host`). */
  basePath?: string;
  /** Optional regex (as a string) applied to the deployed module URL.
   * Capture group 1 fills `{version}` in the branch template. When set
   * but the regex doesn't match or fails to compile, we fall back to
   * the literal branch with `{version}` left as-is — the URL will be
   * obviously broken, which surfaces the misconfiguration. */
  versionCapture?: string;
}

/**
 * First-match-wins lookup. Substring match on `moduleUrl`.
 */
export function findMappingForModule(
  moduleUrl: string,
  mappings: readonly GithubMapping[],
): GithubMapping | null {
  if (!moduleUrl) return null;
  for (const m of mappings) {
    if (m.urlPattern && moduleUrl.includes(m.urlPattern)) return m;
  }
  return null;
}

/**
 * Strip the bundler-specific virtual prefix from a sourcemap `sources`
 * entry so we can append it to a GitHub URL. Handles all common
 * webpack 5 / vite / rollup / esbuild emission formats:
 *
 *   - `webpack:///./src/App.jsx`             → `src/App.jsx`  (triple-slash, leading ./)
 *   - `webpack:///src/App.jsx`               → `src/App.jsx`  (triple-slash, no ./)
 *   - `webpack://mf-host/src/App.jsx`        → `src/App.jsx`  (double-slash, namespace = output.uniqueName)
 *   - `webpack://mf-host/./src/App.jsx`      → `src/App.jsx`  (namespace + leading ./)
 *   - `webpack-internal:///./node_modules/…` → null (filtered)
 *   - `vite:///src/App.tsx`                  → `src/App.tsx`
 *   - `vite://my-app/src/App.tsx`            → `src/App.tsx`
 *   - `../src/foo.js`                        → `src/foo.js`
 *   - `node_modules/x`                       → null (skip — not in the user's repo)
 *
 * Why the namespace handling matters: webpack 5's *default*
 * `devtoolModuleFilenameTemplate` is `webpack://[namespace]/[resource]`
 * where `[namespace]` is `output.uniqueName` (defaults to
 * `package.json#name`). So most real-world bundles emit
 * `webpack://mf-host/...`, not the triple-slash variant. Earlier
 * versions of this normaliser only handled the triple-slash case and
 * silently mangled the namespace into the path.
 *
 * Returns `null` if the path is clearly NOT something we can locate in
 * a single source repo (cross-origin markers, node_modules entries,
 * webpack runtime helpers).
 */
export function normalizeSourcePathForGithub(raw: string): string | null {
  if (!raw) return null;
  let s = raw;

  // Strip bundler scheme + optional namespace. Order matters: try the
  // triple-slash form FIRST (no namespace) so we don't accidentally
  // gobble the first path segment as if it were the namespace.
  const schemes = ['webpack-internal', 'webpack', 'vite', 'rollup'];
  for (const scheme of schemes) {
    const tripleRe = new RegExp(`^${scheme}:\\/{3,}`);
    if (tripleRe.test(s)) {
      s = s.replace(tripleRe, '');
      break;
    }
    const namespacedRe = new RegExp(`^${scheme}:\\/\\/[^\\/]+\\/`);
    if (namespacedRe.test(s)) {
      s = s.replace(namespacedRe, '');
      break;
    }
  }

  // Cross-origin marker `(host)/...`
  s = s.replace(/^\(([^)]+)\)\//, '');
  // Leading "./" and "../"
  s = s.replace(/^(\.\.\/)+/, '');
  s = s.replace(/^\.\//, '');
  // Windows-style backslashes
  s = s.replace(/\\/g, '/');
  // Strip query/fragment
  s = s.replace(/[?#].*$/, '');
  // Collapse double slashes — safe now that the scheme is gone, so we
  // won't mangle `://` into `:/` like the previous version did.
  s = s.replace(/\/{2,}/g, '/');

  if (!s) return null;
  if (s.includes('node_modules/')) return null;
  if (s.startsWith('webpack/')) return null; // webpack runtime helpers
  return s;
}

/**
 * Resolves the effective branch for a mapping, substituting `{version}`
 * placeholders from the result of `versionCapture` applied to the
 * deployed module's URL. Returns the literal branch (with `{version}`
 * unfilled if the regex doesn't match) — the broken URL is intentionally
 * loud so users notice the misconfiguration.
 */
export function resolveBranch(mapping: GithubMapping, moduleUrl?: string): string {
  const template = mapping.branch || 'main';
  if (!template.includes('{version}')) return template;
  if (!moduleUrl || !mapping.versionCapture) return template;
  try {
    const re = new RegExp(mapping.versionCapture);
    const match = moduleUrl.match(re);
    if (match && match[1]) {
      return template.replace(/\{version\}/g, match[1]);
    }
  } catch {
    /* invalid regex — fall through */
  }
  return template;
}

/**
 * Resolve a sourcemap path to GitHub URLs (both `raw.githubusercontent.com`
 * for fetching and `github.com/blob` for the human-readable file view).
 *
 * `moduleUrl` is optional — when supplied AND the mapping has a
 * `versionCapture` regex AND the branch contains `{version}`, the
 * captured group fills the placeholder. This lets a single mapping
 * track many tagged deployments (CDN URLs like
 * `cdn.example.com/v1.2.3/main.js` → tag `v1.2.3` on GitHub).
 *
 * Returns `null` when the path can't be mapped (cross-origin marker,
 * node_modules, etc.).
 */
export function resolveGithubFileUrl(
  sourcePath: string,
  mapping: GithubMapping,
  moduleUrl?: string,
): { rawUrl: string; webUrl: string; pathInRepo: string; branch: string } | null {
  const normalized = normalizeSourcePathForGithub(sourcePath);
  if (!normalized) return null;
  const segments: string[] = [];
  if (mapping.basePath) {
    segments.push(...mapping.basePath.split('/').filter(Boolean));
  }
  segments.push(...normalized.split('/').filter(Boolean));
  const pathInRepo = segments.join('/');
  const owner = encodeURIComponent(mapping.owner);
  const repo = encodeURIComponent(mapping.repo);
  const branchRaw = resolveBranch(mapping, moduleUrl);
  const branch = encodeURIComponent(branchRaw);
  return {
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathInRepo}`,
    webUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${pathInRepo}`,
    pathInRepo,
    branch: branchRaw,
  };
}

/**
 * Build the canonical repo home URL — used by the ModuleAnalysis "GitHub
 * repository" card. When `moduleUrl` resolves a non-default branch,
 * we point at /tree/<branch> so the user lands on the right ref.
 */
export function repoHomeUrl(mapping: GithubMapping, moduleUrl?: string): string {
  const owner = encodeURIComponent(mapping.owner);
  const repo = encodeURIComponent(mapping.repo);
  const branchRaw = resolveBranch(mapping, moduleUrl);
  if (!branchRaw || branchRaw === 'main' || branchRaw === 'master') {
    return `https://github.com/${owner}/${repo}`;
  }
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branchRaw)}`;
}

/**
 * Convenience parser for "owner/repo" or a full GitHub URL — used by the
 * Settings form so users don't have to type owner and repo separately.
 * Handles:
 *   - `owner/repo`
 *   - `https://github.com/owner/repo`
 *   - `https://github.com/owner/repo/tree/branch`
 *   - `https://github.com/owner/repo/tree/branch/sub/path`
 *   - `git@github.com:owner/repo.git`
 *
 * Returns null for unparseable input.
 */
export function parseRepoSpec(input: string): {
  owner: string;
  repo: string;
  branch?: string;
  basePath?: string;
} | null {
  if (!input) return null;
  const trimmed = input.trim();

  // git@github.com:owner/repo.git
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^.]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // owner/repo (no slashes beyond the first)
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    return { owner, repo };
  }

  // Full URL
  try {
    const u = new URL(trimmed);
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repoRaw] = parts;
    const repo = repoRaw.replace(/\.git$/i, '');
    // /tree/<branch>/<...>
    if (parts[2] === 'tree' && parts[3]) {
      const branch = parts[3];
      const basePath = parts.slice(4).join('/') || undefined;
      return { owner, repo, branch, basePath };
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

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
  /** Branch (or tag, or commit SHA — anything the GitHub URL accepts). */
  branch: string;
  /** Optional prefix to prepend to the file path inside the repo. Useful
   * for monorepos where the deployed bundle was built from a subdir
   * (e.g. `host` for our `examples/mf-demo/host`). */
  basePath?: string;
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
 * entry so we can append it to a GitHub URL. Handles:
 *   - `webpack:///./src/App.jsx` → `src/App.jsx`
 *   - `webpack:///src/App.jsx`   → `src/App.jsx`
 *   - `vite:///./src/App.tsx`    → `src/App.tsx`
 *   - `../src/foo.js`            → `src/foo.js`
 *   - `node_modules/x`           → null (skip — not in the user's repo)
 *
 * Returns `null` if the path is clearly NOT something we can locate in
 * a single source repo (cross-origin markers, node_modules entries).
 */
export function normalizeSourcePathForGithub(raw: string): string | null {
  if (!raw) return null;
  let s = raw;

  const prefixes = [
    'webpack-internal:///',
    'webpack:///',
    'vite:///',
    'rollup:///',
  ];
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  // Cross-origin marker `(host)/...`
  s = s.replace(/^\(([^)]+)\)\//, '');
  // Leading "./" and "../"
  s = s.replace(/^(\.\.\/)+/, '');
  s = s.replace(/^\.\//, '');
  s = s.replace(/\\/g, '/');
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/{2,}/g, '/');

  if (!s) return null;
  // Filter out paths that obviously don't live in the user's repo.
  if (s.includes('node_modules/')) return null;
  if (s.startsWith('webpack/')) return null; // webpack runtime helpers
  return s;
}

/**
 * Resolve a sourcemap path to GitHub URLs (both `raw.githubusercontent.com`
 * for fetching and `github.com/blob` for the human-readable file view).
 *
 * Returns `null` when the path can't be mapped (cross-origin marker,
 * node_modules, etc.).
 */
export function resolveGithubFileUrl(
  sourcePath: string,
  mapping: GithubMapping,
): { rawUrl: string; webUrl: string; pathInRepo: string } | null {
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
  const branch = encodeURIComponent(mapping.branch || 'main');
  return {
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathInRepo}`,
    webUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${pathInRepo}`,
    pathInRepo,
  };
}

/**
 * Build the canonical repo home URL — used by the ModuleAnalysis "GitHub
 * repository" card.
 */
export function repoHomeUrl(mapping: GithubMapping): string {
  const owner = encodeURIComponent(mapping.owner);
  const repo = encodeURIComponent(mapping.repo);
  return `https://github.com/${owner}/${repo}`;
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

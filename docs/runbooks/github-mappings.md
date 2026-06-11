# Runbook: GitHub Source Mappings

GitHub source mappings let you connect deployed JS bundles to their source code on GitHub. Once configured, clicking a sourcemapped file in the Modules tab shows a "View on GitHub" badge and lets you toggle between the embedded sourcemap content and the live GitHub source.

This is most valuable in two situations:
1. **Production builds with `nosources-source-map`** — the `.map` file maps positions but doesn't embed source. GitHub is the only way to see the actual code.
2. **Any build** — the GitHub version is canonical, blame-able, and linkable. Better for code review than the embedded copy.

---

## How mappings work

Each mapping rule has a **URL pattern** (a substring). When DOM Lens resolves a source file in the Modules tab, it checks whether the module's URL contains the pattern. The first matching rule wins.

```
Module URL:  http://localhost:3001/static/js/main.abc123.js
Pattern:     localhost:3001
Match:       ✓ → use MF Host mapping
```

The file path inside the repo is derived from the sourcemap `sources` array. The path is normalised (strips webpack/vite scheme prefixes) and optionally prepended with `basePath`.

```
sources entry:  webpack://mf-host/src/App.jsx
normalised:     src/App.jsx
basePath:       host
final path:     host/src/App.jsx
GitHub URL:     https://raw.githubusercontent.com/ingscarrero/dom-lens-mf-host/main/host/src/App.jsx
```

---

## Setting up a mapping

1. Open DOM Lens → **Settings** → scroll to **GitHub Mappings**
2. Click **Add mapping**
3. Fill in the fields:

| Field | Description | Example |
|---|---|---|
| **Label** | Display name shown in FileDetail badge | `MF Host` |
| **URL Pattern** | Substring matched against the module URL | `localhost:3001` |
| **Owner** | GitHub user or organization | `ingscarrero` |
| **Repo** | Repository name | `dom-lens-mf-host` |
| **Branch** | Branch, tag, or commit SHA | `main` |
| **Base Path** (optional) | Prepended to the source file path | `host` |
| **Version Capture** (optional) | Regex; capture group 1 fills `{version}` in Branch | `\/v([0-9.]+)\/` |

4. Click **Save**

---

## Branch templating with `{version}`

Useful for CDN-deployed bundles where the version is encoded in the URL.

**Example scenario**: you deploy to `cdn.example.com/v1.4.2/main.js` and tag GitHub releases as `v1.4.2`.

**Configuration:**
- Branch: `v{version}`
- Version Capture: `\/v([0-9.]+)\/`

**At runtime:**
1. Module URL: `https://cdn.example.com/v1.4.2/main.js`
2. Regex `\/v([0-9.]+)\/` matches → capture group 1 = `1.4.2`
3. Branch: `v{version}` → `v1.4.2`
4. GitHub URL: `https://raw.githubusercontent.com/your-org/your-repo/v1.4.2/src/App.tsx`

If the regex doesn't match or is invalid, `{version}` is left as a literal string — the resulting URL will be obviously broken, which surfaces the misconfiguration.

---

## Common configurations

### Localhost dev server

```
URL Pattern:      localhost:3001
Owner:            your-github-username
Repo:             your-frontend-repo
Branch:           main
Base Path:        (empty for monorepo root; or e.g. packages/app for monorepos)
```

### CDN with version in URL

```
URL Pattern:      cdn.example.com/app/
Owner:            your-org
Repo:             frontend
Branch:           v{version}
Version Capture:  \/([0-9]+\.[0-9]+\.[0-9]+)\/
```

### Staging environment (branch per deploy)

```
URL Pattern:      staging.example.com
Owner:            your-org
Repo:             frontend
Branch:           main
```

### Multiple apps on the same domain (by path prefix)

Make separate rules for each prefix — first-match-wins, so put more specific patterns first:

```
Rule 1: URL Pattern = example.com/dashboard/  → repo: dashboard-app
Rule 2: URL Pattern = example.com/            → repo: main-app
```

---

## Webpack path normalisation

Webpack 5 emits sources with one of these scheme formats in the sourcemap:

| Format | Example |
|---|---|
| Triple-slash (legacy) | `webpack:///src/App.jsx` |
| Namespaced (default Webpack 5) | `webpack://mf-host/src/App.jsx` |

DOM Lens normalises both to the bare path (`src/App.jsx`) before applying `basePath` and constructing the GitHub URL. If you see a 404 on the GitHub link, check the raw URL — the path segment after the repo/branch should be a valid repo-relative file path.

---

## Troubleshooting

### No "View on GitHub" badge appears

- Check the mapping URL pattern: does the module URL contain the pattern as a substring?
- Open **Settings** and confirm the mapping is saved (the list should show it).
- The module must have a successfully parsed sourcemap (`✓` badge). A `–` or `!` badge means no sources to map to GitHub paths.

### Badge appears but link gives 404

Step through the URL manually:
1. `raw.githubusercontent.com/<owner>/<repo>/<branch>/<basePath>/<normalised-path>`
2. Is `<owner>/<repo>` correct? (check GitHub for the exact repo name)
3. Is `<branch>` correct? Does that branch/tag exist in the repo?
4. Is `<basePath>` correct? The combined `<basePath>/<normalised-path>` should be a valid path inside the repo
5. Is the repo **public**? `raw.githubusercontent.com` requires public repos for unauthenticated access

### Source shown from GitHub looks different from what's running

The deployed bundle may be built from a different commit than what's on the branch tip. Use a specific commit SHA or tag in the Branch field rather than a branch name.

### `{version}` not being substituted

- The `Version Capture` regex must have at least one capture group: `([0-9.]+)` not `[0-9.]+`
- Test the regex in your browser console: `'https://cdn.example.com/v1.4.2/main.js'.match(/\/v([0-9.]+)\//)` → should return an array where `[1]` is `1.4.2`
- The module URL (not the source file path) is what gets tested against `Version Capture`

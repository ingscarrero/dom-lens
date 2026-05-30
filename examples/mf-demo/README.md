# DOM Lens — Module Federation demo

A tiny Webpack 5 Module Federation host + remote pair you can run locally to
validate DOM Lens's **Federation** detection. Two apps in a pnpm workspace:

| App | Port | Role |
|---|---|---|
| `host` | 3001 | Loads `Widget` and `Counter` from the remote via `ModuleFederationPlugin`. |
| `remote` | 3002 | Exposes `./Widget` and `./Counter` through `remoteEntry.js`. Also serves a standalone preview at `/`. |

## Run it

```bash
cd examples/mf-demo
pnpm install      # first time only
pnpm dev          # starts both servers concurrently
```

Then open:
- **Host (consumes the remote):** http://localhost:3001
- **Remote (standalone preview):** http://localhost:3002

Stop with `Ctrl+C` — `concurrently --kill-others-on-fail` shuts both down.

### GitHub source mappings

DOM Lens v0.3.14+ can link deployed modules to their source on GitHub.
For this demo the source has been pushed to two public repos that mirror
`host/` and `remote/`:

- **Host** → [`ingscarrero/dom-lens-mf-host`](https://github.com/ingscarrero/dom-lens-mf-host)
- **Remote** → [`ingscarrero/dom-lens-mf-remote`](https://github.com/ingscarrero/dom-lens-mf-remote)

To wire them up: open the DOM Lens panel → **Settings** → **GitHub
source mappings** → add these two entries:

| Label | URL pattern | Repository | Branch |
|---|---|---|---|
| MF demo host | `localhost:3001` | `ingscarrero/dom-lens-mf-host` | `main` |
| MF demo remote | `localhost:3002` | `ingscarrero/dom-lens-mf-remote` | `main` |

Then capture `http://localhost:3001`, expand `main.js` in the Modules
tab, click any authored source file. The toolbar will show a
**🐙 GitHub** link pointing at the canonical source on github.com.
The ModuleAnalysis pane (when a module 📦 is selected) shows a repo
card with the matched mapping label.

### Sourcemap toggle

Both webpack configs default to `devtool: 'source-map'`, so the demo
emits real `.map` siblings for every chunk and adds the
`//# sourceMappingURL=…` trailer comment. This means DOM Lens's
Modules-tab probe pass should show ✓ green badges for all the JS
modules.

To test the **opposite** case (no sourcemaps — the "production
build that didn't publish maps" scenario), restart with the env
var set:

```bash
SOURCEMAPS=0 pnpm dev
```

The Modules tab will then show ✗ missing for every JS module, the
detail view falls back to the `🗺 Map module` skeleton extractor,
and per-symbol `✨ Summarize symbol` becomes the navigation path.

## Validate with DOM Lens

1. Make sure the DOM Lens extension is loaded (see top-level [README](../../README.md)).
2. Open http://localhost:3001 in Chrome → **Cmd+Opt+I** → **DOM Lens** tab.
3. Click **Capture snapshot**.
4. Open the **Federation** tab. You should see:
   - **Kind:** `webpack5`
   - **Host** node labelled with the page title (`MF Host (3001)`)
   - **Remote** node `remote_app` pointing at `http://localhost:3002/remoteEntry.js`
   - **Exposes:** `./Widget`, `./Counter`
   - **Signals:** `webpack_share_scopes`, `webpack_require.S`, `webpack_containers(1)`

In the **Components** tab the remote's `Widget` and `Counter` should appear as
real components in the tree (with proper names — they're not minified in the
dev build), and selecting them should overlay them on the page.

## What this exercises in DOM Lens

The demo intentionally hits every Webpack 5 MF signal `lib/federation/detect.ts` looks at:

- `window.__webpack_share_scopes__.default` — set by the shared-modules runtime
- `window.__webpack_require__.S` — share-scope state
- Container globals (`window.remote_app`) with `.get` and `.init` methods
- `<script src=".../remoteEntry.js">` injected at runtime when the host first
  resolves the remote

## File layout

```
mf-demo/
├── package.json           # workspace root, concurrently script
├── pnpm-workspace.yaml
├── host/
│   ├── package.json
│   ├── webpack.config.js  # ModuleFederationPlugin: remotes: {remote_app: '...'}
│   ├── public/index.html
│   └── src/
│       ├── index.js       # async bootstrap (required by MF)
│       ├── bootstrap.jsx
│       └── App.jsx        # React.lazy(import('remote_app/Widget'))
└── remote/
    ├── package.json
    ├── webpack.config.js  # ModuleFederationPlugin: exposes: {./Widget, ./Counter}
    ├── public/index.html
    └── src/
        ├── index.js
        ├── bootstrap.jsx  # standalone preview at /
        ├── Widget.jsx     # exposed
        └── Counter.jsx    # exposed
```

## Customizing the test

- **Add another remote** to validate multi-remote detection: scaffold a
  second remote on port 3003 and add it to `host/webpack.config.js`
  under `remotes`.
- **Swap to Vite + plugin-federation** to test our `vite-plugin-federation`
  signal — replace `webpack.config.js` with a `vite.config.js` and
  `@originjs/vite-plugin-federation`.
- **Add Native Federation** via `@softarc/native-federation-runtime` to
  exercise the `__FEDERATION__` global path.

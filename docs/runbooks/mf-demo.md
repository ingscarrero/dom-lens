# Runbook: Module Federation Demo

The `examples/mf-demo/` directory contains a Webpack 5 Module Federation host + remote pair. It exists specifically to test DOM Lens's Modules tab features: sourcemap probing, tree view, GitHub source links, and the three sourcemap modes.

---

## Architecture

```
localhost:3001  ←  host app (mf-demo/host)
  ModuleFederationPlugin
    remotes: { remote: "remote@http://localhost:3002/remoteEntry.js" }

localhost:3002  ←  remote app (mf-demo/remote)
  ModuleFederationPlugin
    exposes: { "./Widget": "./src/Widget.jsx" }
```

The host imports `Widget` from the remote at runtime. Both apps are React 18.

---

## GitHub repos

The demo source is mirrored to two public GitHub repos:

| Repo | URL |
|---|---|
| host | https://github.com/ingscarrero/dom-lens-mf-host |
| remote | https://github.com/ingscarrero/dom-lens-mf-remote |

These are the targets for the GitHub source mapping configuration.

---

## Prerequisites

```bash
cd examples/mf-demo
cd host && npm install && cd ..
cd remote && npm install && cd ..
```

---

## Starting the servers

### Normal (with sourcemaps + `sourcesContent`)

```bash
# Terminal 1
cd examples/mf-demo/host
npm start

# Terminal 2
cd examples/mf-demo/remote
npm start
```

- Host: http://localhost:3001
- Remote: http://localhost:3002

In the Modules tab, source files will show the embedded source via **📦 Sourcemap** mode.

### Nosources mode (production-like)

```bash
NOSOURCES=1 npm start   # in both host and remote terminals
```

Webpack emits `nosources-source-map` — the `.map` file exists and maps positions, but `sourcesContent` is null (no source disclosure). In the Modules tab, files switch to **🐙 GitHub** mode automatically because `sourcesContent` is absent. The GitHub mapping must be configured for this to show source.

### No sourcemaps at all

```bash
SOURCEMAPS=0 npm start
```

Webpack emits no `.map` files. The sourcemap probe shows **– missing** for all modules. This simulates a minified production build with no debugging info.

---

## Configuring DOM Lens for the demo

### 1. Add GitHub source mappings

Open DOM Lens → **Settings** → **GitHub Mappings** → add two rules:

**Host mapping:**
| Field | Value |
|---|---|
| Label | MF Host |
| URL Pattern | `localhost:3001` |
| Owner | `ingscarrero` |
| Repo | `dom-lens-mf-host` |
| Branch | `main` |
| Base Path | `host` |

**Remote mapping:**
| Field | Value |
|---|---|
| Label | MF Remote |
| URL Pattern | `localhost:3002` |
| Owner | `ingscarrero` |
| Repo | `dom-lens-mf-remote` |
| Branch | `main` |
| Base Path | `remote` |

### 2. Capture a snapshot

1. Open Chrome → http://localhost:3001
2. Open DevTools → DOM Lens tab
3. Click **Capture snapshot**

### 3. Explore the Modules tab

- Expand the tree under `localhost:3001` — see host bundle files + their sourcemapped sources
- Expand under `localhost:3002` — see remote bundle files
- Click any source file (e.g. `src/App.jsx`) to open it in the CodeViewer
- Source mode toggle (📦 / 🐙) — switch between embedded source and GitHub fetch
- Click **View on GitHub** badge → opens `raw.githubusercontent.com` in a new tab

### 4. Module-level analysis

- Click a bundle (e.g. `main.js`) → ModuleAnalysis pane appears on the right
- Click **Architecture** → streams an architecture overview
- Click **Risk** → audit for security issues
- After a Risk analysis, click **Propose PR** → generates a change plan, offers export targets

### 5. File-level analysis

- Click a source file (e.g. `src/Widget.jsx`) → FileDetail opens
- Click **Audit** → streams a code audit
- Click **Improve** → streams a refactoring plan
- Click **Explain** → streams a plain-English walkthrough

### 6. Federation tab

- Switch to the **Federation** tab
- See the host ↔ remote graph with the `Widget` expose
- Sidebar shows remote entry URL and loaded status

---

## Sourcemap mode quick-reference

| Env vars | Webpack devtool | sourcesContent | DOM Lens behaviour |
|---|---|---|---|
| (none) | `source-map` | ✓ present | 📦 Sourcemap (default), 🐙 GitHub available |
| `NOSOURCES=1` | `nosources-source-map` | ✗ absent | Auto-defaults to 🐙 GitHub; 📦 shows placeholder |
| `SOURCEMAPS=0` | `false` | ✗ no map | Badge shows **– missing**; no source view |

---

## Troubleshooting demo

### `localhost:3001` not responding

Servers may have been killed. Check:
```bash
lsof -i :3001
lsof -i :3002
```

If not listening, restart the servers in separate terminals (see above).

### Module tree shows no sources

The sourcemap probe may have failed. In the Modules tab, look for **! error** badges. Hover or click for details. Common causes:
- Webpack dev server CORS blocked the `.map` fetch — check `Access-Control-Allow-Origin: *` is in `devServer.headers` (it is in the demo config by default).
- The server hasn't fully started — wait a few seconds and re-open the Modules tab.

### GitHub source link gives 404

The sourcemap path may not match the repo layout. Check:
1. The file path in the URL: `https://raw.githubusercontent.com/ingscarrero/dom-lens-mf-host/main/host/src/App.jsx`
2. `basePath` in the mapping should match the subdir in the repo (`host` or `remote`)
3. The repo must be public (raw.githubusercontent.com requires public repos for unauthenticated access)

### Source shown is minified even in sourcemap mode

You're in `SOURCEMAPS=0` mode. Restart with `NOSOURCES=1` (or no env vars) for source content.

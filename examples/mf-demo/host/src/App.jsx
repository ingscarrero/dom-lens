import React, { Suspense } from 'react';

// Remote modules are imported by name as defined in webpack.config.js
const RemoteWidget = React.lazy(() => import('remote_app/Widget'));
const RemoteCounter = React.lazy(() => import('remote_app/Counter'));

export default function App() {
  return (
    <main>
      <h1>
        Host app
        <span className="badge" aria-label="port indicator">port 3001</span>
      </h1>
      <p>
        This page is served by the <strong>host</strong>. The two cards below
        are loaded at runtime from the <strong>remote</strong> at
        <code> http://localhost:3002 </code>
        via Webpack 5 Module Federation.
      </p>

      <section className="card" aria-label="Local content">
        <h2>Local section (rendered by the host)</h2>
        <p>This component lives in the host bundle.</p>
      </section>

      <section className="card" aria-label="Remote widget">
        <h2>Remote widget</h2>
        <Suspense fallback={<p>Loading remote widget…</p>}>
          <RemoteWidget />
        </Suspense>
      </section>

      <section className="card" aria-label="Remote counter">
        <h2>Remote counter</h2>
        <Suspense fallback={<p>Loading remote counter…</p>}>
          <RemoteCounter initial={5} />
        </Suspense>
      </section>

      <footer>
        DOM Lens MF demo — Webpack 5 + ModuleFederationPlugin
      </footer>
    </main>
  );
}

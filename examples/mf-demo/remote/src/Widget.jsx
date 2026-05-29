import React from 'react';

export default function Widget() {
  return (
    <article aria-label="Remote widget content">
      <h3>I&rsquo;m a remote widget</h3>
      <p>
        Bundled into <code>remoteEntry.js</code> and served from{' '}
        <code>http://localhost:3002</code>. The host loaded me on demand.
      </p>
      <ul>
        <li>React: shared singleton</li>
        <li>Lifecycle: lazy / Suspense</li>
        <li>Exposed name: <code>./Widget</code></li>
      </ul>
    </article>
  );
}

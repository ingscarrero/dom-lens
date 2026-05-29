import React from 'react';
import { createRoot } from 'react-dom/client';
import Widget from './Widget';
import Counter from './Counter';

// When you visit the remote directly at http://localhost:3002 you get
// this standalone preview of the exposed components.
function Standalone() {
  return (
    <main>
      <h1>Remote app (standalone preview)</h1>
      <p>
        These components are <em>exposed</em> via Module Federation as{' '}
        <code>remote_app/Widget</code> and <code>remote_app/Counter</code>.
        The host at <code>http://localhost:3001</code> consumes them.
      </p>
      <section className="card"><Widget /></section>
      <section className="card"><Counter initial={3} /></section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Standalone />);

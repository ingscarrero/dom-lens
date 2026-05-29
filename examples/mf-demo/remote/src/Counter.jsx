import React, { useState } from 'react';

export default function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);
  return (
    <article aria-label="Counter widget">
      <h3>Remote counter</h3>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        aria-label="Increment counter"
        style={{
          padding: '6px 12px',
          background: '#fb923c',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Count: {count}
      </button>
    </article>
  );
}

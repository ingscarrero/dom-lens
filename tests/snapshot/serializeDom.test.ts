// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { serializeDom } from '@/lib/snapshot/serializeDom';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('serializeDom', () => {
  it('returns raw HTML plus a markdown rendering with scripts/styles stripped', () => {
    document.head.innerHTML = '<style>.x{color:red}</style><meta name="x" content="y">';
    document.body.innerHTML = `
      <h1>Title</h1>
      <p>Hello <strong>world</strong></p>
      <script>window.secret = 1;</script>
      <svg><circle r="1"/></svg>
      <iframe src="about:blank"></iframe>
      <ul><li>one</li><li>two</li></ul>
    `;
    const out = serializeDom();
    expect(out.html).toContain('<script>window.secret = 1;</script>');
    expect(out.markdown).toContain('# Title');
    expect(out.markdown).toContain('Hello **world**');
    expect(out.markdown).toMatch(/^-\s+one$/m);
    expect(out.markdown).not.toContain('secret');
    expect(out.markdown).not.toContain('circle');
    expect(out.markdown).not.toContain('color:red');
    expect(out.charCount).toBe(out.markdown.length);
    expect(out.markdown).not.toMatch(/\n{3,}/);
  });

  it('annotates elements carrying data-testid / aria-label so the LLM can reference them', () => {
    document.body.innerHTML =
      '<button data-testid="submit-btn">Go</button><nav aria-label="Main">Links</nav><span data-test-id="alt">Alt</span>';
    const { markdown } = serializeDom();
    expect(markdown).toContain('[submit-btn]{Go}');
    expect(markdown).toContain('[Main]{Links}');
    expect(markdown).toContain('[alt]{Alt}');
  });

  it('truncates markdown past the cap and records the original length', () => {
    document.body.innerHTML = `<p>${'word '.repeat(500)}</p>`;
    const out = serializeDom(100);
    expect(out.markdown.startsWith('word word')).toBe(true);
    expect(out.markdown).toMatch(/<!-- truncated at 100 chars \(full length \d+\) -->$/);
    expect(out.charCount).toBeGreaterThan(100);
  });

  it('reuses the cached turndown service across calls', () => {
    document.body.innerHTML = '<p>a</p>';
    const first = serializeDom();
    document.body.innerHTML = '<p>b</p>';
    const second = serializeDom();
    expect(first.markdown).toBe('a');
    expect(second.markdown).toBe('b');
  });
});

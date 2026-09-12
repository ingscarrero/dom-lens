import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderInlineCode } from '@/lib/ui/inlineCode';
import { describeInputs, type UxDomContext } from '@/lib/components/uxVisionPrompts';

/** Mirrors the "Context sent to model" list in ComponentsTab. */
function InputsList({ inputs }: { inputs: string[] }) {
  return (
    <ul>
      {inputs.map((b, i) => (
        <li key={i}>
          <span>{renderInlineCode(b, 'code-chip')}</span>
        </li>
      ))}
    </ul>
  );
}

function domContext(el: Partial<UxDomContext['element']>): UxDomContext {
  return {
    element: {
      tag: 'div',
      id: null,
      classes: [],
      attributes: {},
      outerHTML: '<div></div>',
      text: '',
      isExact: true,
      ...el,
    },
    computed: {},
    cssRules: [],
    sheetsBlocked: 0,
  };
}

describe('renderInlineCode', () => {
  it('maps backtick segments to <code> and leaves plain text as text nodes', () => {
    const html = renderToStaticMarkup(<span>{renderInlineCode('a `b` c `d`', 'chip')}</span>);
    expect(html).toBe('<span>a <code class="chip">b</code> c <code class="chip">d</code></span>');
  });

  it('passes text without backticks through unchanged', () => {
    expect(renderToStaticMarkup(<span>{renderInlineCode('plain')}</span>)).toBe(
      '<span>plain</span>',
    );
  });

  it('escapes markup inside and outside code segments', () => {
    const html = renderToStaticMarkup(
      <span>{renderInlineCode('<b>x</b> `<i>y</i>`')}</span>,
    );
    expect(html).toBe('<span>&lt;b&gt;x&lt;/b&gt; <code>&lt;i&gt;y&lt;/i&gt;</code></span>');
  });
});

describe('ComponentsTab inputs panel', () => {
  it('does not inject markup from a hostile element id', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const inputs = describeInputs({
      domContext: domContext({ tag: 'div', id: payload, classes: ['"><svg onload=alert(2)>'] }),
      componentName: '<script>alert(3)</script>',
      componentKind: 'function',
    });
    const html = renderToStaticMarkup(<InputsList inputs={inputs} />);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
    // The code chips are still rendered around the escaped values.
    expect(html).toContain('<code class="code-chip">&lt;div id=&quot;&lt;img src=x onerror=alert(1)&gt;&quot;');
    expect(html).toContain('<code class="code-chip">&lt;script&gt;alert(3)&lt;/script&gt;</code>');
  });

  it('renders the page-derived tag/id/class inside a single <code> chip', () => {
    const inputs = describeInputs({
      domContext: domContext({ tag: 'button', id: 'cta', classes: ['btn', 'primary'] }),
    });
    const html = renderToStaticMarkup(<InputsList inputs={inputs} />);
    expect(html).toContain(
      '<code class="code-chip">&lt;button id=&quot;cta&quot; class=&quot;btn primary&quot;&gt;</code>',
    );
  });
});

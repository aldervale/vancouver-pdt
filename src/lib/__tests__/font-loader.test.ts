import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('static/font-loader.js', 'utf8');
const template = readFileSync('src/app.html', 'utf8');
const load = () => new Function(source)();

afterEach(() => { document.head.innerHTML = ''; });

describe('CSP-compatible optional font loader', () => {
  it('keeps fonts non-blocking with an external script and a no-JS fallback', () => {
    expect(template).toContain('media="print" data-optional-fonts');
    expect(template).toContain('<script src="%sveltekit.assets%/font-loader.js" defer></script>');
    expect(template).toContain('<noscript><link href="https://fonts.googleapis.com/');
    expect(template).not.toMatch(/\son\w+\s*=/i);
  });

  it('activates a stylesheet after its load event', () => {
    document.head.innerHTML = '<link rel="stylesheet" media="print" data-optional-fonts>';
    const link = document.querySelector('link')!;
    load();
    expect(link.media).toBe('print');
    link.dispatchEvent(new Event('load'));
    expect(link.media).toBe('all');
  });

  it('activates a stylesheet already loaded from cache', () => {
    document.head.innerHTML = '<link rel="stylesheet" media="print" data-optional-fonts>';
    const link = document.querySelector('link')!;
    Object.defineProperty(link, 'sheet', { value: {} });
    load();
    expect(link.media).toBe('all');
  });

  it('leaves failed or stalled optional fonts non-blocking', () => {
    document.head.innerHTML = '<link rel="stylesheet" media="print" data-optional-fonts>';
    load();
    const link = document.querySelector('link')!;
    link.dispatchEvent(new Event('error'));
    expect(link.media).toBe('print');
  });

  it('safely tolerates the optional link being absent', () => {
    expect(load).not.toThrow();
  });
});

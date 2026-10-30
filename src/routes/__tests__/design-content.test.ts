import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import Page from '../+page.svelte';
import { generateDailyData, isDstActive, fmtTime } from '$lib/utils';

vi.mock('driver.js', () => ({ driver: () => ({ drive: vi.fn(), destroy: vi.fn(), isActive: () => false }) }));
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const datasets = [generateDailyData(() => -7), generateDailyData(d => isDstActive(d) ? -7 : -8), generateDailyData(() => -8)];
const total = (data: typeof datasets[number], wake: number, sleep: number) =>
  Math.round(data.reduce((sum, day) => sum + Math.max(0, Math.min(day.sunset, sleep) - Math.max(day.sunrise, wake)), 0)).toLocaleString('en-CA');

describe('Design batch content', () => {
  it('announces modeled sunlight from the active dataset and updates for both sliders and scenario', async () => {
    const { container } = render(Page);
    const takeaway = container.querySelector('.daylight-takeaway')!;
    expect(takeaway).toHaveAttribute('aria-live', 'polite');
    expect(takeaway).toHaveAttribute('aria-atomic', 'true');
    expect(takeaway).toHaveTextContent(`${total(datasets[0], 7, 23)} hours`);
    const sliders = container.querySelectorAll('input[type="range"]');
    await fireEvent.input(sliders[0], { target: { value: '9' } });
    expect(takeaway).toHaveTextContent('9 AM');
    expect(takeaway).toHaveTextContent(`${total(datasets[0], 9, 23)} hours`);
    await fireEvent.input(sliders[1], { target: { value: '19' } });
    expect(takeaway).toHaveTextContent('7 PM');
    expect(takeaway).toHaveTextContent(`${total(datasets[0], 9, 19)} hours`);
    const modes = container.querySelectorAll('.mode-toggle button');
    await fireEvent.click(modes[2]);
    expect(takeaway).toHaveTextContent('permanent PST');
    expect(takeaway).toHaveTextContent(`${total(datasets[2], 9, 19)} hours`);
    await fireEvent.click(modes[1]);
    expect(takeaway).toHaveTextContent('old system');
    expect(takeaway).toHaveTextContent(`${total(datasets[1], 9, 19)} hours`);
  });

  it('compares the same values as the panels with semantic headers and calendar-day caveat', () => {
    const { container } = render(Page);
    const table = container.querySelector('.scenario-comparison table')!;
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(3);
    const rows = table.querySelectorAll('tbody tr');
    datasets.forEach((data, i) => {
      expect(rows[0].querySelectorAll('td')[i]).toHaveTextContent(String(data.filter(d => d.sunrise > 8.5).length));
      expect(rows[1].querySelectorAll('td')[i]).toHaveTextContent(String(data.filter(d => d.sunset > 17).length));
      expect(rows[2].querySelectorAll('td')[i]).toHaveTextContent(fmtTime(Math.max(...data.map(d => d.sunrise))));
    });
    expect(container.querySelector('#comparison-note')).toHaveTextContent('not actual school days or commutes');
    expect(container.querySelector('.comparison-scroll')).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.comparison-scroll')).toHaveAttribute('aria-describedby', 'comparison-note comparison-scroll-hint');
    expect(container.querySelector('#comparison-scroll-hint')).toHaveTextContent('Swipe to compare all three systems');
  });

  it('keeps sources in the HTML, uses native disclosures, and opens references from in-page links', async () => {
    const { container } = render(Page);
    const sources = container.querySelector('details.references-section')!;
    expect(sources).not.toHaveAttribute('open');
    expect(sources.querySelector('summary')).toHaveTextContent('Sources');
    expect(sources.querySelectorAll('a').length).toBe(28);
    expect(container.querySelectorAll('.faq-section details summary')).toHaveLength(3);
    expect(container.querySelector('.faq-section')).toHaveTextContent('not medical advice');
    const methodology = Array.from(container.querySelectorAll('a')).find(a => a.textContent === 'Data & methodology')!;
    expect(methodology.href).toContain('README.md#data--methodology');
    await fireEvent.click(container.querySelector('.mode-toggle button:nth-child(2)')!);
    await fireEvent.click(container.querySelector('a[href="#ref-sleep"]')!);
    expect(sources).toHaveAttribute('open');
    expect(container.querySelector('#ref-sleep')).toBeTruthy();
  });
});

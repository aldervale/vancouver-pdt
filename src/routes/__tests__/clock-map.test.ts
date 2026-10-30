import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Page from '../+page.svelte';
import { clockLabel, clockRegions, offsetLabel, regionChanges } from '$lib/clock-regions';

vi.mock('driver.js', () => ({ driver: () => ({ drive: vi.fn(), destroy: vi.fn(), isActive: () => false }) }));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.stubGlobal('localStorage', { getItem: () => '1', setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Regional clock map', () => {
  it('sits between the policy note and the scenario caveat and records the October 28 check', () => {
    const { container } = render(Page);
    const policy = container.querySelector('.policy-update')!;
    const clocks = container.querySelector('#regional-clocks')!;
    const note = container.querySelector('.scenario-note')!;
    expect(container.querySelector('.eyebrow')).toHaveTextContent('Policy checked October 28, 2026');
    expect(policy.nextElementSibling).toBe(clocks);
    expect(clocks.nextElementSibling).toBe(note);
    expect(policy).toHaveTextContent('before-and-after clock map');
    const mapLinks = [...policy.querySelectorAll('a[href="#regional-clocks"]')].map((link) => link.textContent);
    expect(mapLinks).toEqual(['before-and-after clock map', 'Seattle']);
  });

  it('renders a text alternative and the same before/after rows without needing the toggle', () => {
    const { container } = render(Page);
    const section = container.querySelector('#regional-clocks')!;
    const svg = section.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.querySelector('desc')?.textContent).toMatch(/Striped places are the ones that fall back/);
    expect(section.querySelector('#clock-oct31')).toBeChecked();
    expect(section.querySelector('#clock-nov1')).not.toBeChecked();

    const table = section.querySelector('table')!;
    expect(table.querySelector('caption')).toHaveTextContent('10:00 AM in Vancouver');
    expect(table.querySelector('caption')).toHaveTextContent('after the 2 AM switch');
    for (const region of clockRegions) {
      const row = table.querySelector(`tr[data-region="${region.id}"]`)!;
      expect(row).toBeTruthy();
      expect(row).toHaveTextContent(region.name);
      expect(row).toHaveTextContent(clockLabel(region.oct31));
      expect(row).toHaveTextContent(offsetLabel(region.oct31));
      expect(row).toHaveTextContent(clockLabel(region.nov1));
      expect(row).toHaveTextContent(offsetLabel(region.nov1));
      expect(row).toHaveTextContent(regionChanges(region) ? 'Falls back' : 'No change');
    }
    expect(table.querySelectorAll('tbody tr[data-region]')).toHaveLength(clockRegions.length);
  });
});

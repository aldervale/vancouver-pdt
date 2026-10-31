import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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
  it('keeps a compact trigger above the footer instead of a map between the policy note and the controls', () => {
    const { container } = render(Page);
    const policy = container.querySelector('.policy-update')!;
    const clocks = container.querySelector('#regional-clocks')!;
    const controls = container.querySelector('.controls-row')!;
    const footer = container.querySelector('footer')!;
    const dialog = container.querySelector('#regional-clocks-dialog') as HTMLDialogElement;
    const trigger = clocks.querySelector('button')!;
    expect(container.querySelector('.eyebrow')).toBeNull();
    expect(policy.nextElementSibling).toBe(controls);
    expect(clocks.nextElementSibling).toBe(footer);
    expect(dialog.open).toBe(false);
    expect(dialog.style.display).toBe('none');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('command', 'show-modal');
    expect(trigger).toHaveAttribute('commandfor', 'regional-clocks-dialog');
    expect(trigger.textContent).toContain('See the map: what time it is across the West on Oct 31 vs Nov 1');
    expect(trigger.textContent).toContain('See the map: Oct 31 vs Nov 1');
    expect(trigger).toHaveAccessibleName(/See the map/);
    expect(policy).toHaveTextContent('an hour ahead of Seattle');
    const mapLinks = [...policy.querySelectorAll('a[href="#regional-clocks"]')].map((link) => link.textContent);
    expect(mapLinks).toEqual(['an hour ahead of Seattle']);
  });

  it('opens the map dialog from the trigger and from the policy links', async () => {
    const { container } = render(Page);
    const dialog = container.querySelector('#regional-clocks-dialog') as HTMLDialogElement;
    const trigger = container.querySelector('#regional-clocks button')!;
    await fireEvent.click(trigger);
    expect(dialog.open).toBe(true);
    dialog.open = false;
    const link = container.querySelector('.policy-update a[href="#regional-clocks"]')!;
    await fireEvent.click(link);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('table')).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby')).toBe('regional-clocks-title');
    expect(dialog.querySelector('.dialog-close')).toHaveAttribute('aria-label', 'Close map');
  });

  it('renders a text alternative and the same before/after rows without needing the toggle', () => {
    const { container } = render(Page);
    const section = container.querySelector('#regional-clocks')!;
    const svg = section.querySelector('svg[role="img"]')!;
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


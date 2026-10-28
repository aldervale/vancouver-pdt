import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Page from '../+page.svelte';

// Use the real Driver.js, with deterministic layout/frames. These tests exercise
// lifecycle races; real-browser layout and keyboard defaults remain E2E coverage.
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') || getComputedStyle(this).display === 'none' ? [] : [new DOMRect(0, 0, 100, 100)]) as unknown as DOMRectList;
  });
  localStorage.setItem('vdt_tour_done', '1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function nextFrame() {
  const pending = frames.splice(0);
  await act(() => pending.forEach(callback => callback(performance.now())));
}

function pressTab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  return event;
}

describe('real Driver tour focus lifecycle', () => {
  it.each(['Skip tour', 'Close tour', 'Escape'])('cleans up an immediate %s dismissal before the first frame', async dismissal => {
    render(Page);
    const replay = screen.getByRole('button', { name: 'Take a quick tour' });
    // Repeated starts catch listeners left over from an interrupted first start.
    for (let attempt = 0; attempt < 2; attempt++) {
      replay.focus();
      await fireEvent.click(replay);
      expect(screen.getByRole('dialog', { name: 'Your schedule' })).toBeInTheDocument();
      expect(frames.length).toBeGreaterThan(0);
      if (dismissal === 'Escape') await fireEvent.keyUp(window, { key: 'Escape' });
      else await fireEvent.click(screen.getByRole('button', { name: dismissal }));
      await act();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(replay).toHaveFocus();
      const outside = screen.getByRole('button', { name: 'Earlier wake time' });
      outside.focus();
      expect(outside).toHaveFocus();
      expect(pressTab().defaultPrevented).toBe(false);
      await nextFrame();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });

  it('replaces the trap on every step, wraps both ways, and releases it on Done', async () => {
    render(Page);
    const replay = screen.getByRole('button', { name: 'Take a quick tour' });
    replay.focus();
    await fireEvent.click(replay);
    for (const title of ['Your schedule', 'Three scenarios', 'Your daylight', 'Your daily life']) {
      await nextFrame();
      const dialog = screen.getByRole('dialog', { name: title });
      const close = within(dialog).getByRole('button', { name: 'Close tour' });
      const next = within(dialog).getByRole('button', { name: title === 'Your daily life' ? 'Done' : 'Next' });
      expect(close).toHaveFocus();
      pressTab(true);
      expect(next).toHaveFocus();
      pressTab();
      expect(close).toHaveFocus();
      for (let count = 0; count < 8; count++) {
        pressTab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
      if (title === 'Three scenarios') {
        await fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
        await nextFrame();
        const first = screen.getByRole('dialog', { name: 'Your schedule' });
        const firstNext = within(first).getByRole('button', { name: 'Next' });
        pressTab(true);
        expect(firstNext).toHaveFocus();
        pressTab();
        expect(within(first).getByRole('button', { name: 'Close tour' })).toHaveFocus();
        await fireEvent.click(firstNext);
        await nextFrame();
        const second = screen.getByRole('dialog', { name: title });
        pressTab(true);
        const secondNext = within(second).getByRole('button', { name: 'Next' });
        expect(secondNext).toHaveFocus();
        await fireEvent.click(secondNext);
      } else {
        await fireEvent.click(next);
      }
    }
    await act();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(replay).toHaveFocus();
    expect(pressTab().defaultPrevented).toBe(false);
  });

  it('unmounts safely before Driver has established its first active step', async () => {
    const { unmount } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    unmount();
    await act();
    expect(document.querySelector('.driver-popover')).toBeNull();
    expect(pressTab().defaultPrevented).toBe(false);
    await nextFrame();
    expect(document.querySelector('.driver-popover')).toBeNull();
  });
});

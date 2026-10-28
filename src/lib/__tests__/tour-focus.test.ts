import { afterEach, describe, expect, it, vi } from 'vitest';
import { trapTourFocus } from '../tour-focus';

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup() {
  document.body.innerHTML = `<button id="outside">Page control</button><div id="popover">
    <button id="close">Close</button><button hidden>Hidden</button>
    <button disabled>Disabled</button><button style="visibility:hidden">Invisible</button>
    <button tabindex="-1">Not tabbable</button><div inert><button>Inert</button></div>
    <button id="skip">Skip</button><button id="next">Next</button></div>`;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const popover = document.querySelector<HTMLElement>('#popover')!;
  release = trapTourFocus(popover);
  return popover;
}

function tab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return document.activeElement?.id;
}

describe('tour focus trap', () => {
  it('focuses inside a modal popover and cycles only available controls in both directions', () => {
    const popover = setup();
    expect(popover.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.id).toBe('close');
    expect(tab(true)).toBe('next');
    expect(tab()).toBe('close');
    expect(tab()).toBe('skip');
    expect(tab()).toBe('next');
    expect(tab(true)).toBe('skip');
    expect(tab(true)).toBe('close');
  });

  it('prevents Driver from moving focus a second time but leaves Escape and arrows alone', () => {
    setup();
    const driverHandler = vi.fn();
    window.addEventListener('keydown', driverHandler);
    try {
      tab();
      expect(driverHandler).not.toHaveBeenCalled();
      for (const key of ['Escape', 'ArrowRight', 'ArrowLeft']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        document.activeElement!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(driverHandler).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener('keydown', driverHandler);
    }
  });

  it('redirects outside focus only until cleanup', () => {
    setup();
    const outside = document.querySelector<HTMLElement>('#outside')!;
    outside.focus();
    expect(document.activeElement?.id).toBe('close');
    release?.();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    outside.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('falls back to the popover if all controls disappear', () => {
    const popover = setup();
    popover.replaceChildren();
    expect(tab()).toBe('popover');
    expect(tab(true)).toBe('popover');
  });

  it('ignores controls hidden by layout and recalculates controls after changes', () => {
    setup();
    const skip = document.querySelector<HTMLElement>('#skip')!;
    skip.getClientRects = () => [] as unknown as DOMRectList;
    expect(tab()).toBe('next');
    skip.getClientRects = () => [{}] as unknown as DOMRectList;
    expect(tab(true)).toBe('skip');
  });
});

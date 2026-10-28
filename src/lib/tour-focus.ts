/** Keep Driver's keyboard loop in the popover, not its highlighted page controls. */
export function trapTourFocus(popover: HTMLElement): () => void {
  const controls = () => Array.from(popover.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex]'
  )).filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible'
  );

  const focusFirst = () => (controls()[0] ?? popover).focus({ preventScroll: true });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    // Driver's default handler also includes the highlighted element's controls.
    // Handle every Tab in capture phase so it cannot move focus a second time.
    event.preventDefault();
    event.stopPropagation();
    const available = controls();
    const index = available.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (index > 0 ? index - 1 : available.length - 1)
      : (index + 1) % available.length;
    (available[next] ?? popover).focus({ preventScroll: true });
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!popover.contains(event.target as Node)) focusFirst();
  };

  popover.tabIndex = -1;
  popover.setAttribute('aria-modal', 'true');
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn);
  focusFirst();

  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn);
  };
}

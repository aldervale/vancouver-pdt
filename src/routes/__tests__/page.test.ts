import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/svelte';
import type { Config, Driver, PopoverDOM } from 'driver.js';
import Page from '../+page.svelte';

const mockDriver = vi.hoisted(() => {
  const instance = { drive: vi.fn(), destroy: vi.fn(), isActive: vi.fn(() => false) };
  return { instance, create: vi.fn(() => instance) };
});
vi.mock('driver.js', () => ({ driver: mockDriver.create }));

const drawnText: { text: string; font: string; color: string }[] = [];

// Mock canvas context
const mockContext = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  fillText: vi.fn((text: string): void => {
    drawnText.push({ text, font: mockContext.font, color: mockContext.fillStyle });
  }),
  strokeText: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  createLinearGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  roundRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  drawnText.length = 0;
  mockDriver.instance.isActive.mockReturnValue(false);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {},
  }));
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => '1'),
    setItem: vi.fn(),
  });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Page renders', () => {
  it('renders without error', () => {
    const { container } = render(Page);
    expect(container).toBeTruthy();
  });

  it('renders the main title', () => {
    const { container } = render(Page);
    const h1 = container.querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1!.textContent).toContain('No More Clock Changes');
  });

  it('does not show the policy-check line above the title', () => {
    const { container } = render(Page);
    expect(container.querySelector('.eyebrow')).toBeNull();
    expect(container.querySelector('header')?.textContent).not.toMatch(/Policy checked/i);
  });
});

describe('Mode toggle buttons', () => {
  it('renders all three mode buttons', () => {
    const { container } = render(Page);
    const modeToggle = container.querySelector('.mode-toggle')!;
    const buttons = modeToggle.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe('Pacific Time (PCT)');
    expect(buttons[1].textContent).toBe('Old system (clock changes)');
    expect(buttons[2].textContent).toBe('Permanent PST');
  });

  it('Pacific Time (PCT) button is active by default', () => {
    const { container } = render(Page);
    const pdtBtn = container.querySelector('.mode-toggle button.mode-pdt')!;
    expect(pdtBtn.classList.contains('active')).toBe(true);
  });
});

describe('Wake/bedtime controls', () => {
  it('renders wake slider with default 7 AM', () => {
    render(Page);
    const wakeSlider = screen.getByLabelText('Wake up') as HTMLInputElement;
    expect(wakeSlider).toBeInTheDocument();
    expect(wakeSlider.value).toBe('7');
  });

  it('renders bedtime slider with default 11 PM (23)', () => {
    render(Page);
    const sleepSlider = screen.getByLabelText('Bedtime') as HTMLInputElement;
    expect(sleepSlider).toBeInTheDocument();
    expect(sleepSlider.value).toBe('23');
  });

  it('displays stepper values for wake and sleep', () => {
    const { container } = render(Page);
    const steppers = container.querySelectorAll('.stepper-value');
    const texts = Array.from(steppers).map(s => s.textContent);
    expect(texts).toContain('7 AM');
    expect(texts).toContain('11 PM');
  });
});

describe('Panel toggle buttons', () => {
  it('renders all four panel buttons', () => {
    const { container } = render(Page);
    const grid = container.querySelector('.context-toggle-grid')!;
    const buttons = grid.querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    const labels = Array.from(buttons).map(b => b.textContent!.trim());
    expect(labels.some(l => l.includes('I like sports'))).toBe(true);
    expect(labels.some(l => l.includes('I have a kid'))).toBe(true);
    expect(labels.some(l => l.includes('I work a 9-to-5'))).toBe(true);
    expect(labels.some(l => l.includes('I trade stocks'))).toBe(true);
  });

  it('clicking sports button opens the sports panel', async () => {
    const { container } = render(Page);
    const grid = container.querySelector('.context-toggle-grid')!;
    const sportsBtn = grid.querySelectorAll('button')[0];
    await fireEvent.click(sportsBtn);
    const panels = container.querySelectorAll('.sports-panel');
    expect(panels[0].classList.contains('open')).toBe(true);
  });

  it('clicking sports button again closes the panel', async () => {
    const { container } = render(Page);
    const grid = container.querySelector('.context-toggle-grid')!;
    const sportsBtn = grid.querySelectorAll('button')[0];
    await fireEvent.click(sportsBtn);
    await fireEvent.click(sportsBtn);
    const panels = container.querySelectorAll('.sports-panel');
    expect(panels[0].classList.contains('open')).toBe(false);
  });
});

describe('Insight cards', () => {
  it('renders pro and con insight cards', () => {
    const { container } = render(Page);
    expect(container.querySelector('.insight-card.pro')).toBeTruthy();
    expect(container.querySelector('.insight-card.con')).toBeTruthy();
  });

  it('shows PCT-specific insight text by default', () => {
    const { container } = render(Page);
    const proLabel = container.querySelector('.insight-card.pro .insight-label');
    const conLabel = container.querySelector('.insight-card.con .insight-label');
    expect(proLabel!.textContent).toBe('Evening win');
    expect(conLabel!.textContent).toBe('Morning trade-off');
  });
});

describe('References and footer', () => {
  it('renders references section', () => {
    const { container } = render(Page);
    const title = container.querySelector('.references-title');
    expect(title).toBeTruthy();
    expect(title!.textContent).toContain('Sources');
  });

  it('renders reference links', () => {
    const { container } = render(Page);
    const links = container.querySelectorAll('.references-list a');
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders footer credit with SunCalc link', () => {
    const { container } = render(Page);
    const credit = container.querySelector('.footer-credit');
    expect(credit).toBeTruthy();
    expect(credit!.textContent).toContain('SunCalc');
    const link = credit!.querySelector('a');
    expect(link!.getAttribute('href')).toBe('https://github.com/mourner/suncalc');
  });
});


describe('Accessible controls and disclosure panels', () => {
  it('names the sports and market scenario toggle groups for their context', async () => {
    render(Page);
    expect(screen.getByRole('group', { name: 'Compare time systems' })).toBeInTheDocument();
    for (const [persona, group] of [
      ['I like sports', 'Compare time systems for game times'],
      ['I trade stocks', 'Compare time systems for market opening'],
    ]) {
      await fireEvent.click(screen.getByRole('button', { name: new RegExp(persona) }));
      expect(screen.getByRole('group', { name: group })).toHaveAccessibleName(group);
    }
  });

  it.each(['I have a kid', 'I work a 9-to-5'])('%s gives each scenario card a concise name and metric description', async persona => {
    const { container } = render(Page);
    const toggle = screen.getByRole('button', { name: new RegExp(persona) });
    await fireEvent.click(toggle);
    const panel = container.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`)!;
    const cards = Array.from(panel.querySelectorAll('.mode-switchable'));
    const names = ['Pacific Time (PCT) (UTC−7)', 'Old system (UTC−8 winter)', 'Permanent PST (UTC−8)'];
    expect(cards).toHaveLength(3);
    for (const [index, card] of cards.entries()) {
      expect(card).toHaveAccessibleName(names[index]);
      const count = card.querySelector('.context-big-number')!.textContent;
      const metric = card.querySelector('.context-big-label')!.textContent;
      expect(card).toHaveAccessibleDescription(`${count} ${metric}`);
      await fireEvent.keyDown(card, { key: 'Enter' });
      expect(card).toHaveAttribute('aria-pressed', 'true');
      await fireEvent.keyDown(card, { key: ' ' });
      expect(card).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('preserves the four distinct stepper button names and actions', async () => {
    render(Page);
    const wake = screen.getByLabelText('Wake up') as HTMLInputElement;
    const sleep = screen.getByLabelText('Bedtime') as HTMLInputElement;
    await fireEvent.click(screen.getByRole('button', { name: 'Later wake time' }));
    expect(wake.value).toBe('8');
    await fireEvent.click(screen.getByRole('button', { name: 'Earlier wake time' }));
    expect(wake.value).toBe('7');
    await fireEvent.click(screen.getByRole('button', { name: 'Earlier bedtime' }));
    expect(sleep.value).toBe('22');
    await fireEvent.click(screen.getByRole('button', { name: 'Later bedtime' }));
    expect(sleep.value).toBe('23');
  });

  it.each(['I like sports', 'I have a kid', 'I work a 9-to-5', 'I trade stocks'])(
    '%s identifies its panel and exposes the current state', async name => {
      const { container } = render(Page);
      const toggle = screen.getByRole('button', { name: new RegExp(name) });
      const panelId = toggle.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = container.querySelector(`[id="${panelId}"]`)!;
      expect(panel).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(panel).toHaveProperty('inert', true);

      await fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(panel).toHaveAttribute('aria-hidden', 'false');
      expect(panel).toHaveProperty('inert', false);
      await fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(panel).toHaveProperty('inert', true);
    }
  );

  it('gives every disclosure a distinct panel target and closes the previous panel', async () => {
    const { container } = render(Page);
    const toggles = Array.from(container.querySelectorAll('.context-toggle-grid button'));
    const ids = toggles.map(toggle => toggle.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(4);
    await fireEvent.click(toggles[0]);
    await fireEvent.click(toggles[1]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector(`[id="${ids[0]}"]`)).toHaveProperty('inert', true);
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector(`[id="${ids[1]}"]`)).toHaveProperty('inert', false);
  });
});

describe('Honest comparison labels', () => {
  it('labels the permanent UTC−7 scenario as PCT without changing its internal mode id', () => {
    const { container } = render(Page);
    const selectedMode = container.querySelector('.mode-toggle .mode-pdt');
    expect(selectedMode).toHaveAccessibleName('Pacific Time (PCT)');
    expect(selectedMode).toHaveAttribute('aria-pressed', 'true');
    const pills = container.querySelectorAll('.mode-pill.pdt-pill');
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) expect(pill).toHaveTextContent(/^PCT$/);
    expect(container.querySelector('.chart-subtitle')).toHaveTextContent('UTC−7');
  });

  it('uses Old system consistently outside the descriptive main toggle', async () => {
    const { container } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Old system (clock changes)' }));
    expect(container.querySelector('.chart-subtitle')).toHaveTextContent('Old system');
    expect(container.querySelector('.stat-label')).toHaveTextContent(/old system/i);
    expect(container).not.toHaveTextContent(/old DST/i);
  });

  it.each(['I have a kid', 'I work a 9-to-5'])(
    '%s labels its annual counts as calendar-day thresholds', async name => {
      const { container } = render(Page);
      const toggle = screen.getByRole('button', { name: new RegExp(name) });
      await fireEvent.click(toggle);
      const panel = container.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`)!;
      const labels = panel.querySelectorAll('.context-big-label');
      expect(labels).toHaveLength(3);
      for (const label of labels) expect(label).toHaveTextContent(/calendar (days|dates)/i);
      expect(panel).toHaveTextContent(/weekends/i);
      expect(panel).toHaveTextContent(/holidays/i);
      expect(panel).not.toHaveTextContent(/days of dark morning commutes|days\/year you leave work|days commuting home in the dark/i);
    }
  );

  it('credits both the astronomy library and this project', () => {
    const { container } = render(Page);
    const footer = container.querySelector('footer')!;
    expect(footer.querySelector('a[href="https://github.com/mourner/suncalc"]')).toHaveTextContent('SunCalc');
    const project = footer.querySelector('a[href*="github.com/"][href$="/vancouver-pdt"]');
    expect(project).toBeInTheDocument();
    expect(project?.textContent?.trim()).toBeTruthy();
    const methodology = screen.getByRole('link', { name: 'Data & methodology' });
    expect(methodology).toHaveAttribute('href', 'https://github.com/aldervale/vancouver-pdt/blob/c95707ca05e70df11800536572a05a76d77577a3/README.md#data--methodology');
    expect(methodology).toHaveAttribute('rel', 'noopener');
  });
});

describe('Current Pacific Time policy and model scope', () => {
  it('clearly states the adopted PCT policy rather than a future adoption', () => {
    const { container } = render(Page);
    const subtitle = container.querySelector('.subtitle');
    expect(subtitle).toHaveTextContent('Pacific time (PCT, UTC−7)');
    expect(subtitle).toHaveTextContent('last time on March 8, 2026');
    expect(subtitle).toHaveTextContent('will not fall back on November 1');
    expect(subtitle).not.toHaveTextContent(/is adopting|what.s coming/i);
  });

  it('presents the September policy update, regional exceptions and official U.S. assumptions', () => {
    render(Page);
    const policy = screen.getByRole('region', { name: 'What to know about Pacific Time' });
    expect(policy).toHaveTextContent('September 17');
    expect(policy).toHaveTextContent(/mountain-time arrangements differ/i);
    expect(policy).toHaveTextContent('one hour ahead of Seattle after the November 1 fall-back');
    expect(policy).toHaveTextContent('aligned during U.S. daylight time');
    expect(policy).toHaveTextContent('not an established health advantage over permanent standard time');
    const sources = [
      ['September 17 provincial announcement', 'https://news.gov.bc.ca/releases/2026CITZ0009-001073'],
      ['regional guidance', 'https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time'],
      ['current U.S. clock rules', 'https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst'],
    ];
    for (const [name, href] of sources) {
      const link = screen.getByRole('link', { name });
      expect(policy.contains(link)).toBe(true);
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('keeps the full-year history caveat in the notes, not above the chart', () => {
    const { container } = render(Page);
    expect(container.querySelector('.scenario-note')).toBeNull();
    expect(container.textContent).not.toContain('These full-year');
    const policy = container.querySelector('.policy-update')!;
    const clocks = container.querySelector('#regional-clocks')!;
    const controls = container.querySelector('.controls-row')!;
    expect(policy.nextElementSibling).toBe(clocks);
    expect(clocks.nextElementSibling).toBe(controls);
    const dataNote = [...container.querySelectorAll('details')].find((details) => details.textContent?.includes('What data is this?'));
    expect(dataNote).toHaveTextContent('full-year clock-system comparisons');
    expect(dataNote).toHaveTextContent("not Vancouver's actual 2026 clock history");
    const credit = container.querySelector('.footer-credit')!;
    expect(credit).toHaveTextContent('Vancouver used PST until the March 8 clock change, including January and February');
    expect(credit).toHaveTextContent('not an IANA time-zone identifier');
  });

  it('updates the accessible chart label with the selected comparison', async () => {
    render(Page);
    const chart = screen.getByRole('img', { name: /Vancouver sunrise and sunset comparison/i });
    for (const [name, label] of [
      ['Pacific Time (PCT)', 'Pacific Time (PCT)'],
      ['Old system (clock changes)', 'old system'],
      ['Permanent PST', 'permanent PST'],
    ]) {
      await fireEvent.click(screen.getByRole('button', { name }));
      expect(chart).toHaveAccessibleName(`Vancouver sunrise and sunset comparison under ${label}; summary values below`);
    }
  });

  it('keeps sports illustrative and market comparisons independent of today', async () => {
    const { container } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: /I like sports/ }));
    const sports = container.querySelector('#panel-sports');
    expect(sports).toHaveTextContent('Illustrative winter times');
    expect(sports).toHaveTextContent('not a fixture calendar');
    await fireEvent.click(screen.getByRole('button', { name: /I trade stocks/ }));
    const stocks = container.querySelector('#panel-stocks');
    expect(stocks).toHaveTextContent('current U.S. seasonal clock rules');
    expect(stocks).toHaveTextContent('same as seasonal PDT');
    expect(stocks).not.toHaveTextContent(/\b(today|now)\b/i);
  });
});

function latestTourConfig(): Config {
  return (mockDriver.create.mock.calls as unknown as [Config][]).at(-1)![0];
}

function simulateTourDestroyed(config = latestTourConfig()) {
  config.onDestroyed?.(undefined, {}, { config, state: {}, driver: mockDriver.instance as unknown as Driver });
}

describe('Guided tour lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('starts once for a first visit and leaves the page undimmed', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    render(Page);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockDriver.create).toHaveBeenCalledTimes(1);
    expect(mockDriver.instance.drive).toHaveBeenCalledTimes(1);
    expect(latestTourConfig()).toMatchObject({ overlayOpacity: 0, showProgress: true });
    expect(latestTourConfig().steps).toHaveLength(4);
    expect(localStorage.getItem).toHaveBeenCalledWith('vdt_tour_done');
  });

  it('honors the legacy completed flag and exposes a manual replay', async () => {
    render(Page);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockDriver.create).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    expect(mockDriver.instance.drive).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit Skip tour control that destroys the active tour', async () => {
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    const config = latestTourConfig();
    const wrapper = document.createElement('div');
    const footer = document.createElement('div');
    const closeButton = document.createElement('button');
    const previousButton = document.createElement('button');
    const activeTour = { ...mockDriver.instance, isFirstStep: () => true } as unknown as Driver;
    config.onPopoverRender?.({ wrapper, footer, closeButton, previousButton } as unknown as PopoverDOM, {
      config, state: {}, driver: activeTour,
    });
    const skip = footer.querySelector('button')!;
    expect(skip).toHaveTextContent('Skip tour');
    expect(skip).toHaveAttribute('type', 'button');
    expect(closeButton).toHaveAccessibleName('Close tour');
    expect(previousButton.hidden).toBe(true);
    await fireEvent.click(skip);
    expect(mockDriver.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('manual replay cancels the pending automatic start and does not duplicate an active tour', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    render(Page);
    const replay = screen.getByRole('button', { name: 'Take a quick tour' });
    await fireEvent.click(replay);
    mockDriver.instance.isActive.mockReturnValue(true);
    await fireEvent.click(replay);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockDriver.create).toHaveBeenCalledTimes(1);
    expect(mockDriver.instance.drive).toHaveBeenCalledTimes(1);
  });

  it('respects reduced-motion preferences when starting the tour', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    expect(latestTourConfig().animate).toBe(false);
  });

  it('stores dismissal with the existing key', async () => {
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    simulateTourDestroyed();
    expect(localStorage.setItem).toHaveBeenCalledWith('vdt_tour_done', '1');
  });

  it('remains usable when storage reads and writes throw', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('Storage denied'); });
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Storage full'); });
    expect(() => render(Page)).not.toThrow();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockDriver.create).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    expect(mockDriver.instance.drive).toHaveBeenCalled();
    expect(() => simulateTourDestroyed()).not.toThrow();
    await fireEvent.click(screen.getByRole('button', { name: 'Later wake time' }));
    expect(screen.getByLabelText('Wake up')).toHaveValue('8');
  });

  it('remains usable when access to the localStorage object itself is denied', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied', 'SecurityError'); },
    });
    try {
      expect(() => render(Page)).not.toThrow();
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
      expect(mockDriver.instance.drive).toHaveBeenCalled();
      expect(() => simulateTourDestroyed()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('cancels delayed onboarding when the page unmounts', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    const { unmount } = render(Page);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockDriver.create).not.toHaveBeenCalled();
  });

  it('removes the exact resize listener and destroys an active tour on unmount', async () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    mockDriver.instance.isActive.mockReturnValue(true);
    const resizeListener = addListener.mock.calls.find(([type]) => type === 'resize')?.[1];
    expect(resizeListener).toBeDefined();
    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', resizeListener);
    expect(mockDriver.instance.destroy).toHaveBeenCalled();
    addListener.mockRestore();
    removeListener.mockRestore();
  });
});


describe('Evidence and chart readability', () => {
  it('links each health claim to an identifiable source and keeps the claim qualified', async () => {
    const { container } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Old system (clock changes)' }));
    const insight = container.querySelector('.insight-card.con')!;
    expect(insight).toHaveTextContent(/observational studies/i);
    expect(insight).toHaveTextContent(/Heart-attack findings vary/i);
    expect(insight).toHaveTextContent(/permanent standard time/i);
    const links = insight.querySelectorAll<HTMLAnchorElement>('a[href^="#ref-"]');
    expect(links).toHaveLength(4);
    for (const link of links) {
      const reference = container.querySelector(link.getAttribute('href')!);
      expect(reference).toBeInTheDocument();
      expect(reference?.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
    }
    expect(container.querySelector('a[href*="currentbiology.com"]')).not.toBeInTheDocument();
    expect(container.querySelector('.ref-pro')).not.toBeInTheDocument();
  });

  it('cites school-specific schedules without presenting 8:30 as a universal start time', async () => {
    const { container } = render(Page);
    await fireEvent.click(screen.getByRole('button', { name: /I have a kid/ }));
    const school = container.querySelector('#panel-school')!;
    expect(school).toHaveTextContent(/illustrative|threshold/i);
    expect(school).toHaveTextContent(/times vary|schedules.*vary/i);
    for (const link of school.querySelectorAll<HTMLAnchorElement>('a[href^="#ref-"]')) {
      const reference = container.querySelector(link.getAttribute('href')!);
      expect(reference?.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^https:\/\/www\.vsb\.bc\.ca\//));
    }
    expect(school.querySelectorAll('a[href^="#ref-school-"]')).toHaveLength(2);
    expect(school).not.toHaveTextContent('elementary schools start at 8:45 AM');
  });

  it.each(['Pacific Time (PCT)', 'Old system (clock changes)', 'Permanent PST'])(
    '%s draws readable labels rather than tiny low-opacity axis text', async name => {
      render(Page);
      await act();
      drawnText.length = 0;
      // Resizing invokes the same chart drawing path in every mode.
      await fireEvent.click(screen.getByRole('button', { name }));
      await fireEvent(window, new Event('resize'));
      expect(drawnText.length).toBeGreaterThan(20);
      for (const label of drawnText) {
        const fontSize = Number(label.font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
        expect(fontSize, `${label.text}: ${label.font}`).toBeGreaterThanOrEqual(12);
      }
      for (const text of ['5 AM', 'NOON', '12 AM', 'Jan', 'WAKE 7 AM', 'SLEEP 11 PM']) {
        const label = drawnText.find(label => label.text === text);
        expect(label, text).toBeDefined();
        expect(contrastRatio(label!.color, '#0d1117'), text).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});

function contrastRatio(foreground: string, background: string) {
  function luminance(hex: string) {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}


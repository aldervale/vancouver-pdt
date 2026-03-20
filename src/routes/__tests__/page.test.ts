import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Page from '../+page.svelte';

// Mock canvas context
const mockContext = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  fillText: vi.fn(),
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
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {},
  }));
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => '1'),
    setItem: vi.fn(),
  });
  vi.stubGlobal('devicePixelRatio', 1);
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

  it('renders the eyebrow text', () => {
    const { container } = render(Page);
    const eyebrow = container.querySelector('.eyebrow');
    expect(eyebrow).toBeTruthy();
    expect(eyebrow!.textContent).toContain('B.C.');
  });
});

describe('Mode toggle buttons', () => {
  it('renders all three mode buttons', () => {
    const { container } = render(Page);
    const modeToggle = container.querySelector('.mode-toggle')!;
    const buttons = modeToggle.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe('Permanent PDT');
    expect(buttons[1].textContent).toBe('Old DST');
    expect(buttons[2].textContent).toBe('Permanent PST');
  });

  it('Permanent PDT button is active by default', () => {
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

  it('shows PDT-specific insight text by default', () => {
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
    expect(title!.textContent).toContain('References');
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

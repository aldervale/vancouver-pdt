import { test, expect, type Locator, type Page } from '@playwright/test';

const personaNames = ['I like sports', 'I have a kid', 'I work a 9-to-5', 'I trade stocks'];

async function controlledPanel(page: Page, toggle: Locator) {
  const panelId = await toggle.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  return page.locator(`[id="${panelId}"]`);
}

async function expectInsideViewport(locator: Locator, width: number, height?: number) {
  await expect(locator).toBeVisible();
  if (height !== undefined) await expect(locator).toBeInViewport({ ratio: 1 });
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  if (height !== undefined) {
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
  }
}

async function expectReadableButtonContrast(button: Locator) {
  const styles = await button.evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor, opacity: style.opacity };
  });
  expect(styles.opacity).toBe('1');
  function luminance(color: string) {
    const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(channels.length, color).toBeGreaterThanOrEqual(3);
    // These controls use opaque foreground/background colors, so a transparent fallback is a regression.
    expect(channels[3] ?? 1, color).toBe(1);
    const linear = channels.slice(0, 3).map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  const values = [luminance(styles.foreground), luminance(styles.background)].sort((a, b) => b - a);
  expect((values[0] + 0.05) / (values[1] + 0.05), JSON.stringify(styles)).toBeGreaterThanOrEqual(4.5);
}

test.describe('Vancouver PDT App', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('vdt_tour_done', '1');
    });
    await page.goto('/');
  });

  test('app loads and renders the title', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('No More Clock Changes');
  });

  test('subtitle shows PDT text by default', async ({ page }) => {
    await expect(page.locator('.chart-subtitle')).toContainText('Permanent PDT');
  });

  test('the old clock-change comparison has an unambiguous name everywhere', async ({ page }) => {
    await page.getByRole('button', { name: 'Old system (clock changes)', exact: true }).click();
    await expect(page.locator('.chart-subtitle')).toContainText('Old system');
    await expect(page.locator('.chart-subtitle')).toContainText('UTC−8 winter / UTC−7 summer');
    await expect(page.locator('.stat-label').first()).toContainText(/old system/i);
    await expect(page.locator('.container')).not.toContainText(/old DST/i);

    for (const name of ['I like sports', 'I trade stocks']) {
      const toggle = page.getByRole('button', { name: new RegExp(name) });
      await toggle.click();
      const panel = await controlledPanel(page, toggle);
      await expect(panel.getByRole('button', { name: 'Old system', exact: true })).toBeVisible();
    }
  });

  test('clicking Permanent PST shows PST subtitle', async ({ page }) => {
    await page.locator('.mode-toggle').getByRole('button', { name: 'Permanent PST', exact: true }).click();
    await expect(page.locator('.chart-subtitle')).toContainText('Permanent PST');
  });

  test('clicking Permanent PST shows the PST mode-note', async ({ page }) => {
    await page.locator('.mode-toggle').getByRole('button', { name: 'Permanent PST', exact: true }).click();
    await expect(page.locator('.mode-note')).toContainText('The alternative B.C. was never offered');
  });

  test('clicking Old system shows the clock-change comparison note', async ({ page }) => {
    await page.getByRole('button', { name: 'Old system (clock changes)', exact: true }).click();
    await expect(page.locator('.mode-note')).toContainText('how daylight looked under the old clock-change system');
  });

  test('no mode-note visible in PDT mode', async ({ page }) => {
    await expect(page.locator('.mode-note')).not.toBeVisible();
  });

  for (const name of personaNames) {
    test(`${name} exposes its expanded state and keeps its closed panel inert`, async ({ page }) => {
      const toggle = page.getByRole('button', { name: new RegExp(name) });
      const panel = await controlledPanel(page, toggle);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveAttribute('aria-hidden', 'true');
      await expect(panel).toHaveAttribute('inert', '');

      // Inert must prevent focus, not merely hide the panel visually.
      const hiddenControlsCanFocus = await panel.evaluate(element => {
        const controls = element.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]');
        return Array.from(controls).some(control => {
          control.focus();
          return document.activeElement === control;
        });
      });
      expect(hiddenControlsCanFocus).toBe(false);

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).toHaveAttribute('aria-hidden', 'false');
      await expect(panel).not.toHaveAttribute('inert');
      await expect(panel).toHaveClass(/open/);

      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveAttribute('aria-hidden', 'true');
      await expect(panel).toHaveAttribute('inert', '');
    });
  }

  test('opening a second persona panel closes and disables the first', async ({ page }) => {
    const sports = page.getByRole('button', { name: /I like sports/ });
    const stocks = page.getByRole('button', { name: /I trade stocks/ });
    await sports.click();
    await stocks.click();
    await expect(sports).toHaveAttribute('aria-expanded', 'false');
    await expect(await controlledPanel(page, sports)).toHaveAttribute('inert', '');
    await expect(stocks).toHaveAttribute('aria-expanded', 'true');
    await expect(await controlledPanel(page, stocks)).not.toHaveAttribute('inert');
  });

  test('wake and bedtime steppers retain their distinct accessible names', async ({ page }) => {
    const wakeSlider = page.getByLabel('Wake up', { exact: true });
    const sleepSlider = page.getByLabel('Bedtime', { exact: true });
    await expect(wakeSlider).toHaveValue('7');
    await expect(sleepSlider).toHaveValue('23');

    await page.getByRole('button', { name: 'Later wake time', exact: true }).click();
    await expect(wakeSlider).toHaveValue('8');
    await page.getByRole('button', { name: 'Earlier wake time', exact: true }).click();
    await expect(wakeSlider).toHaveValue('7');
    await page.getByRole('button', { name: 'Earlier bedtime', exact: true }).click();
    await expect(sleepSlider).toHaveValue('22');
    await page.getByRole('button', { name: 'Later bedtime', exact: true }).click();
    await expect(sleepSlider).toHaveValue('23');
  });

  test('all four panel buttons are visible', async ({ page }) => {
    await expect(page.locator('.context-toggle-grid button')).toHaveCount(4);
    for (const name of personaNames) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
  });

  test('school and work counts explicitly describe calendar days, not actual commutes', async ({ page }) => {
    for (const name of ['I have a kid', 'I work a 9-to-5']) {
      const toggle = page.getByRole('button', { name: new RegExp(name) });
      await toggle.click();
      const panel = await controlledPanel(page, toggle);
      await expect(panel.locator('.context-big-label')).toHaveCount(3);
      for (const label of await panel.locator('.context-big-label').all()) {
        await expect(label).toContainText(/calendar (days|dates)/i);
      }
      await expect(panel).toContainText(/weekends/i);
      await expect(panel).toContainText(/holidays/i);
      await expect(panel).not.toContainText(/days of dark morning commutes|days\/year you leave work|days commuting home in the dark/i);
    }
  });

  test('references and project attribution have usable source links', async ({ page }) => {
    await expect(page.locator('.references-title')).toBeVisible();
    const references = page.locator('.references-list').getByRole('link');
    expect(await references.count()).toBeGreaterThan(0);
    for (const link of await references.all()) {
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toHaveAttribute('rel', /noopener/);
      expect((await link.innerText()).trim().length).toBeGreaterThan(0);
    }
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'SunCalc', exact: true })).toHaveAttribute('href', 'https://github.com/mourner/suncalc');
    await expect(footer.getByRole('link', { name: 'Source code & feedback', exact: true })).toBeVisible();
  });

  test('health and school claims link to their matching references', async ({ page }) => {
    await page.getByRole('button', { name: 'Old system (clock changes)', exact: true }).click();
    const healthLinks = page.locator('.insight-card.con').getByRole('link');
    await expect(healthLinks).toHaveCount(4);
    for (const link of await healthLinks.all()) {
      const target = await link.getAttribute('href');
      expect(target).toMatch(/^#ref-/);
      const reference = page.locator(target!);
      await expect(reference).toHaveCount(1);
      await expect(reference.getByRole('link')).toHaveAttribute('href', /^https:\/\//);
    }
    await page.getByRole('button', { name: /I have a kid/ }).click();
    for (const name of ['VSB secondary guidance', 'David Oppenheimer Elementary']) {
      const link = page.locator('#panel-school').getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', /^#ref-school-/);
      const target = await link.getAttribute('href');
      await expect(page.locator(target!).getByRole('link')).toHaveAttribute('href', /^https:\/\/www\.vsb\.bc\.ca\//);
    }
    await expect(page.locator('.about-project')).toContainText('Created by Adam Stuckert');
    await expect(page.locator('.about-project time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  });

  test('the existing Open Graph and Twitter preview remain available', async ({ page, request }) => {
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://bcdaylight.ca/og.png');
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', 'https://bcdaylight.ca/og.png');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '1892');
    const response = await request.get('/og.png');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    const png = await response.body();
    expect(png.subarray(12, 16).toString()).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(1892);
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`chart and controls fit a ${viewport.width}×${viewport.height} viewport in every mode`, async ({ page }) => {
      await page.setViewportSize(viewport);
      for (const name of ['Permanent PDT', 'Old system (clock changes)', 'Permanent PST']) {
        await page.locator('.mode-toggle').getByRole('button', { name, exact: true }).click();
        await expectInsideViewport(page.locator('.controls-row'), viewport.width);
        await expectInsideViewport(page.locator('.chart-wrapper'), viewport.width);
        await expectInsideViewport(page.locator('.canvas-container canvas').first(), viewport.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      }
    });
  }
});

test.describe('Guided tour', () => {
  test('first visit is skippable, keeps the legacy dismissal key, and can be replayed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.driver-popover')).toBeVisible();
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await expect(page.getByRole('button', { name: 'Skip tour', exact: true })).toBeVisible();
    await expect(page.locator('.driver-overlay path')).toHaveCSS('opacity', '0');
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Take a quick tour', exact: true })).toBeVisible();
    // The automatic tour uses a delayed start. Observe past that delay on a returning visit.
    await page.waitForTimeout(700);
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    const replay = page.getByRole('button', { name: 'Take a quick tour', exact: true });
    await replay.click();
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await expect(replay).toBeFocused();
  });

  test('the legacy completed-tour flag suppresses automatic onboarding', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vdt_tour_done', '1'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Take a quick tour', exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.locator('.driver-popover')).toHaveCount(0);
  });

  test('the tour supports keyboard advancement, Escape dismissal, and restores replay focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.driver-popover-title')).toHaveText('Three scenarios');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await expect(page.locator('.driver-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');

    const replay = page.getByRole('button', { name: 'Take a quick tour', exact: true });
    await replay.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await expect(replay).toBeFocused();
    await page.getByRole('button', { name: 'Later wake time', exact: true }).click();
    await expect(page.getByLabel('Wake up', { exact: true })).toHaveValue('8');
  });

  test('Skip and Back retain readable text contrast on focus and hover', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.driver-popover-title')).toHaveText('Your schedule');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.driver-popover-title')).toHaveText('Three scenarios');

    for (const name of ['Skip tour', 'Back']) {
      const button = page.getByRole('button', { name, exact: true });
      await page.mouse.move(0, 0);
      await button.focus();
      await expect(button).toBeFocused();
      await expectReadableButtonContrast(button);

      // Move focus elsewhere so the hover state is tested independently of :focus.
      await page.getByRole('button', { name: 'Close tour', exact: true }).focus();
      await button.hover();
      await expect(button).not.toBeFocused();
      expect(await button.evaluate(element => element.matches(':hover'))).toBe(true);
      await expectReadableButtonContrast(button);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);
  });

  test('source-link navigation and browser history do not restart a dismissed tour', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.driver-popover')).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');

    await page.getByRole('button', { name: 'Old system (clock changes)', exact: true }).click();
    await page.getByRole('link', { name: 'Heart-attack findings vary', exact: true }).click();
    await expect(page).toHaveURL(/#ref-heart$/);
    await expect(page.locator('#ref-heart')).toBeInViewport();

    await page.goBack();
    await expect(page).not.toHaveURL(/#ref-heart$/);
    await page.waitForTimeout(700);
    await expect(page.locator('.driver-popover, .driver-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');

    await page.goForward();
    await expect(page).toHaveURL(/#ref-heart$/);
    await page.waitForTimeout(700);
    await expect(page.locator('.driver-popover, .driver-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');
  });

  test('blocked storage writes do not trap the tour or break the application', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException('Storage is blocked', 'SecurityError'); };
    });
    await page.goto('/');
    await expect(page.locator('.driver-popover')).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await page.getByRole('button', { name: 'Take a quick tour', exact: true }).click();
    await expect(page.locator('.driver-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await page.getByRole('button', { name: 'Later wake time', exact: true }).click();
    await expect(page.getByLabel('Wake up', { exact: true })).toHaveValue('8');
    expect(errors).toEqual([]);
  });

  for (const blocked of ['read', 'object'] as const) {
    test(`blocked storage ${blocked} keeps the tour opt-in and the page usable`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(kind => {
        if (kind === 'read') {
          Storage.prototype.getItem = () => { throw new DOMException('Storage is blocked', 'SecurityError'); };
        } else {
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('Storage is blocked', 'SecurityError'); },
          });
        }
      }, blocked);
      await page.goto('/');
      const replay = page.getByRole('button', { name: 'Take a quick tour', exact: true });
      await expect(replay).toBeVisible();
      await page.waitForTimeout(700);
      await expect(page.locator('.driver-popover')).toHaveCount(0);
      await replay.click();
      await expect(page.locator('.driver-popover')).toBeVisible();
      await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
      await expect(page.locator('.driver-popover')).toHaveCount(0);
      await page.getByRole('button', { name: 'Later wake time', exact: true }).click();
      await expect(page.getByLabel('Wake up', { exact: true })).toHaveValue('8');
      expect(errors).toEqual([]);
    });
  }

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`all tour steps and dismissal controls fit a ${viewport.width}×${viewport.height} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const titles = ['Your schedule', 'Three scenarios', 'Your daylight', 'Your daily life'];
      for (const title of titles) {
        await expect(page.locator('.driver-popover-title')).toHaveText(title);
        await expectInsideViewport(page.locator('.driver-popover'), viewport.width, viewport.height);
        await expectInsideViewport(page.getByRole('button', { name: 'Skip tour', exact: true }), viewport.width, viewport.height);
        const next = page.locator('.driver-popover-next-btn');
        await expectInsideViewport(next, viewport.width, viewport.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        await next.click();
      }
      await expect(page.locator('.driver-popover')).toHaveCount(0);
      await expect(page.locator('.driver-overlay')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('vdt_tour_done'))).toBe('1');
    });
  }
});

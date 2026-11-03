import { expect, test } from '@playwright/test';

type SecurityWindow = Window & { cspViolations: string[]; untrustedInlineRan?: boolean };

for (const width of [390, 1280]) {
  test(`CSP permits fonts, chart updates, map and tour at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    await page.addInitScript(() => {
      localStorage.setItem('vdt_tour_done', '1');
      (window as SecurityWindow).cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        (window as SecurityWindow).cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
      });
    });
    page.on('pageerror', error => errors.push(error.message));
    // Deterministic response exercises Google's allowed origin + external font
    // activation without depending on network availability in the CI runner.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
      contentType: 'text/css', body: 'body { --optional-font-css-loaded: 1; }'
    }));
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("script-src-attr 'none'");
    await expect(page.locator('link[data-optional-fonts]')).toHaveAttribute('media', 'all');
    await expect.poll(() => page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--optional-font-css-loaded').trim())).toBe('1');
    const canvas = page.locator('.canvas-container canvas').first();
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate(element => {
      const chart = element as HTMLCanvasElement;
      const context = chart.getContext('2d');
      if (!context || !chart.width || !chart.height) return false;
      const pixels = context.getImageData(0, 0, chart.width, chart.height).data;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) return true;
      }
      return false;
    })).toBe(true);
    const original = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
    await page.getByRole('button', { name: 'Later wake time', exact: true }).click();
    await expect(page.getByLabel('Wake up', { exact: true })).toHaveValue('8');
    await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(original);
    await page.locator('.mode-toggle').getByRole('button', { name: 'Permanent PST', exact: true }).click();
    await expect(page.locator('.chart-subtitle')).toContainText('Permanent PST');
    await page.locator('#regional-clocks .clock-map-trigger').click();
    const map = page.locator('#regional-clocks-dialog');
    await expect(map).toBeVisible();
    await map.locator('#clock-oct31').focus();
    await page.keyboard.press('ArrowRight');
    await expect(map.locator('#clock-nov1')).toBeChecked();
    await expect(map.locator('.callout-washington .for-nov1').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(map).toBeHidden();
    await page.getByRole('button', { name: 'Take a quick tour' }).click();
    for (const title of ['Your schedule', 'Three scenarios', 'Your daylight', 'Your daily life']) {
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: title === 'Your daily life' ? 'Done' : 'Next', exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Allow asynchronous securitypolicyviolation event delivery before checking.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as SecurityWindow).cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('CSP blocks an untrusted inline script', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vdt_tour_done', '1');
    (window as SecurityWindow).cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      (window as SecurityWindow).cspViolations.push(event.effectiveDirective);
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.untrustedInlineRan = true';
    document.head.append(script);
  });
  await expect.poll(() => page.evaluate(() => (window as SecurityWindow).cspViolations)).toContain('script-src-elem');
  expect(await page.evaluate(() => (window as SecurityWindow).untrustedInlineRan)).toBeUndefined();
});

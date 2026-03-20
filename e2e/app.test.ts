import { test, expect } from '@playwright/test';

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

  test('clicking Old DST changes the subtitle', async ({ page }) => {
    await page.locator('.mode-toggle button.mode-dst').click();
    await expect(page.locator('.chart-subtitle')).toContainText('Old DST');
  });

  test('clicking Permanent PST shows PST subtitle', async ({ page }) => {
    await page.locator('.mode-toggle button.mode-pst').click();
    await expect(page.locator('.chart-subtitle')).toContainText('Permanent PST');
  });

  test('clicking Permanent PST shows the PST mode-note', async ({ page }) => {
    await page.locator('.mode-toggle button.mode-pst').click();
    await expect(page.locator('.mode-note')).toContainText(
      'The alternative B.C. was never offered'
    );
  });

  test('clicking Old DST shows the DST mode-note', async ({ page }) => {
    await page.locator('.mode-toggle button.mode-dst').click();
    await expect(page.locator('.mode-note')).toContainText(
      'how daylight looked under the old clock-change system'
    );
  });

  test('no mode-note visible in PDT mode', async ({ page }) => {
    await expect(page.locator('.mode-note')).not.toBeVisible();
  });

  test('panel toggle opens and closes', async ({ page }) => {
    const sportsBtn = page.locator('.context-toggle-grid button').first();
    const sportsPanel = page.locator('.sports-panel').first();

    await expect(sportsPanel).not.toHaveClass(/open/);
    await sportsBtn.click();
    await expect(sportsPanel).toHaveClass(/open/);
    await sportsBtn.click();
    await expect(sportsPanel).not.toHaveClass(/open/);
  });

  test('wake slider can be adjusted', async ({ page }) => {
    const wakeSlider = page.locator('#wake-slider');
    await expect(wakeSlider).toHaveValue('7');

    await page.locator('button[aria-label="Later wake time"]').click();
    await expect(wakeSlider).toHaveValue('8');
  });

  test('bedtime slider can be adjusted', async ({ page }) => {
    const sleepSlider = page.locator('#sleep-slider');
    await expect(sleepSlider).toHaveValue('23');

    await page.locator('button[aria-label="Earlier bedtime"]').click();
    await expect(sleepSlider).toHaveValue('22');
  });

  test('all four panel buttons are visible', async ({ page }) => {
    const buttons = page.locator('.context-toggle-grid button');
    await expect(buttons).toHaveCount(4);
    await expect(buttons.nth(0)).toContainText('I like sports');
    await expect(buttons.nth(1)).toContainText('I have a kid');
    await expect(buttons.nth(2)).toContainText('I work a 9-to-5');
    await expect(buttons.nth(3)).toContainText('I trade stocks');
  });

  test('references section is visible', async ({ page }) => {
    await expect(page.locator('.references-title')).toBeVisible();
  });

  test('footer credit is visible', async ({ page }) => {
    await expect(page.locator('.footer-credit')).toContainText('SunCalc');
  });
});

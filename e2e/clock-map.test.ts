import { test, expect } from '@playwright/test';

test.describe('Regional clock map', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vdt_tour_done', '1'));
  });

  for (const width of [320, 390, 1280]) {
    test(`fits and lists both mornings at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const section = page.locator('#regional-clocks');
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await expect(page.locator('.eyebrow')).toContainText('Policy checked October 28, 2026');
      await expect(section.getByRole('table')).toBeVisible();

      const washington = section.locator('tr[data-region="washington"]');
      await expect(washington).toContainText('10:00 AM');
      await expect(washington).toContainText('UTC−7');
      await expect(washington).toContainText('9:00 AM');
      await expect(washington).toContainText('UTC−8');
      await expect(washington).toContainText('Falls back');
      await expect(section.locator('tr[data-region="bc"]')).toContainText('No change');
      await expect(section.locator('tr[data-region="alaska"]')).toContainText('8:00 AM');
      await expect(section.locator('tr[data-region="seBc"]')).toContainText('11:00 AM');
      await expect(section.locator('tr[data-region="creston"]')).toContainText('UTC−7');

      const box = await section.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      const octLabel = section.locator('.callout-washington .for-oct31').first();
      const novLabel = section.locator('.callout-washington .for-nov1').first();
      await expect(octLabel).toBeVisible();
      await expect(octLabel).toHaveText('10:00 AM');
      await expect(novLabel).toBeHidden();
      await section.locator('label').filter({ hasText: 'After 2 AM' }).click();
      await expect(novLabel).toBeVisible();
      await expect(novLabel).toHaveText('9:00 AM');
      await expect(octLabel).toBeHidden();
      await expect(section.locator('.callout-bc .for-nov1').first()).toHaveText('10:00 AM');
      const callouts = section.locator('.map-callout:visible');
      const count = await callouts.count();
      for (let i = 0; i < count; i++) {
        const labelBox = await callouts.nth(i).boundingBox();
        expect(labelBox!.x).toBeGreaterThanOrEqual(-1);
        expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(width + 1);
      }

      if (width === 390 || width === 1280) {
        await section.locator('label').filter({ hasText: 'Before the switch' }).click();
        await section.screenshot({ path: `test-results/clock-map-${width}-oct31.png` });
        await section.locator('label').filter({ hasText: 'After 2 AM' }).click();
        await section.screenshot({ path: `test-results/clock-map-${width}-nov1.png` });
      }
    });
  }

  test('table, map toggle and source links work without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('http://127.0.0.1:4173/#regional-clocks');
    const section = page.locator('#regional-clocks');
    await expect(section.getByRole('img', { name: /Clocks around B.C./ })).toBeVisible();
    await expect(section.locator('tr[data-region="montana"]')).toContainText('11:00 AM');
    await expect(section.locator('tr[data-region="montana"]')).toContainText('10:00 AM');
    await expect(section.locator('.callout-alaska .for-oct31').first()).toBeVisible();
    await section.locator('label').filter({ hasText: 'After 2 AM' }).click();
    await expect(section.locator('.callout-alaska .for-nov1').first()).toBeVisible();
    await expect(section.locator('.callout-alaska .for-nov1').first()).toHaveText('8:00 AM');
    await expect(section.locator('.callout-alaska .for-oct31').first()).toBeHidden();
    const sources = page.locator('details.references-section');
    await section.locator('a[href="#ref-abt"]').click();
    await expect(sources).toHaveAttribute('open');
    await expect(page.locator('#ref-abt')).toBeVisible();
    await context.close();
  });
});

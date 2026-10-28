import { test, expect } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`chart details and date markers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => localStorage.setItem('vdt_tour_done', '1'));
    await page.goto('/');
    await expect(page.getByLabel('Chart key dates')).toContainText('Nov 1 · No fall back');
    await expect(page.getByLabel('Chart key dates')).toContainText('Dec 21 · Winter solstice');
    const slider = page.getByLabel('Explore a date');
    await slider.focus();
    await expect(page.getByRole('tooltip')).toContainText('January 1, 2026: sunrise');
    await slider.press('ArrowRight');
    await expect(page.getByRole('tooltip')).toContainText('January 2, 2026: sunrise');
    await expect(slider).toHaveAttribute('aria-valuetext', /January 2.*sunrise.*sunset/);
    await slider.press('End');
    await expect(page.getByRole('tooltip')).toContainText('December 31');
    const canvas = page.locator('.overlay-canvas');
    const box = await canvas.boundingBox();
    await canvas.dispatchEvent('pointerdown', { clientX: box!.x + 94 + (box!.width - 114) / 2, clientY: box!.y + 100, pointerType: 'touch' });
    await expect(page.getByRole('tooltip')).toContainText('July 2');
    for (const selector of ['.key-dates', '.date-inspector', '.stats-strip']) {
      const region = page.locator(selector);
      const rect = await region.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    const pctDetails = await page.getByRole('tooltip').textContent();
    await page.getByRole('button', { name: 'Old system (clock changes)', exact: true }).click();
    await expect(page.getByLabel('Chart key dates')).toContainText('Mar 8 · Spring forward');
    await expect(page.getByLabel('Chart key dates')).toContainText('Nov 1 · Fall back');
    await page.getByRole('button', { name: 'Permanent PST', exact: true }).click();
    await expect(page.getByLabel('Chart key dates')).toContainText('Dec 21 · Winter solstice');
    await expect(page.getByRole('tooltip')).not.toHaveText(pctDetails!);
    await canvas.dispatchEvent('pointermove', { clientX: box!.x + 94, clientY: box!.y + 100 });
    await expect(page.getByRole('tooltip')).toContainText('January 1');
    await page.locator('.chart-wrapper').screenshot({ path: `test-results/chart-${width}.png` });
  });
}

import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.screenshot({ path: testInfo.outputPath('tour-failure.png'), fullPage: false });
  const layout = await page.evaluate(() => {
    const describe = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return { bounds: element.getBoundingClientRect().toJSON(), transform: style.transform, left: style.left, top: style.top, bottom: style.bottom };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, target: describe('.driver-active-element'), popover: describe('.driver-popover') };
  });
  await testInfo.attach('tour-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`tour keeps every target unobstructed at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('vdt_tour_done', '1'));
    await page.goto('/');
    const launch = page.getByRole('button', { name: 'Take a quick tour' });
    await launch.click();
    for (const title of ['Your schedule', 'Three scenarios', 'Your daylight', 'Your daily life']) {
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      await expect.poll(async () => page.evaluate(() => {
        const target = document.querySelector('.driver-active-element')!.getBoundingClientRect();
        const popover = document.querySelector('.driver-popover')!.getBoundingClientRect();
        const visible = target.top >= 0 && target.left >= 0 && target.bottom <= innerHeight && target.right <= innerWidth;
        const separate = target.bottom <= popover.top || target.top >= popover.bottom || target.right <= popover.left || target.left >= popover.right;
        return visible && separate;
      })).toBe(true);
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await dialog.getByRole('button', { name: title === 'Your daily life' ? 'Done' : 'Next', exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launch).toBeFocused();
    await launch.click();
    await expect(page.getByRole('dialog', { name: 'Your schedule' })).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launch).toBeFocused();
  });
}

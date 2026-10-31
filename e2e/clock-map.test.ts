import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const artifacts = '/opt/cursor/artifacts';

test.beforeAll(() => {
  fs.mkdirSync(artifacts, { recursive: true });
});

test.describe('Regional clock map', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vdt_tour_done', '1'));
  });

  for (const width of [320, 390, 1280]) {
    test(`collapsed trigger opens a dialog that fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const trigger = page.locator('#regional-clocks .clock-map-trigger');
      const dialog = page.locator('#regional-clocks-dialog');

      await expect(dialog).toBeHidden();
      await expect(page.locator('.map-card')).toHaveCount(2);
      await expect(page.locator('.map-card').first()).toBeHidden();
      const placedLow = await page.evaluate(() => {
        const nodes = [
          document.querySelector('.policy-update'),
          document.querySelector('.controls-row'),
          document.querySelector('#regional-clocks'),
          document.querySelector('footer'),
        ];
        return nodes.every((node, index) => Boolean(node) && (index === 0 || (nodes[index - 1]!.compareDocumentPosition(node!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
      });
      expect(placedLow).toBe(true);

      await trigger.scrollIntoViewIfNeeded();
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      const expectedName = width >= 720
        ? 'See the map: what time it is across the West on Oct 31 vs Nov 1'
        : 'See the map: Oct 31 vs Nov 1';
      await expect(trigger).toHaveAccessibleName(expectedName);

      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();
      const oneLine = await trigger.evaluate((el) => {
        const style = getComputedStyle(el);
        const line = parseFloat(style.lineHeight);
        const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        return line + pad + border;
      });
      expect(oneLine).toBeGreaterThan(24);
      expect(triggerBox!.height).toBeLessThanOrEqual(oneLine + 2);
      expect(triggerBox!.height).toBeLessThanOrEqual(48);
      expect(triggerBox!.x).toBeGreaterThanOrEqual(-1);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(width + 1);
      const labelClipped = await trigger.locator('.trigger-label').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(labelClipped).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      if (width === 320 || width === 390 || width === 1280) {
        await page.screenshot({ path: `${artifacts}/clock_map_collapsed_${width}.png` });
      }

      const scrollBefore = await page.evaluate(() => window.scrollY);
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName("When it's 10:00 AM in Vancouver");
      await expect(page.locator('html')).toHaveClass(/clock-dialog-open/);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
      const modal = await dialog.evaluate((element) => element instanceof HTMLDialogElement && element.matches(':modal') && element.open);
      expect(modal).toBe(true);
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      const scrollAfter = await page.evaluate(() => window.scrollY);
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(2);

      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(-1);
      expect(dialogBox!.y).toBeGreaterThanOrEqual(-1);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width + 1);
      expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(901);
      if (width <= 390) {
        expect(dialogBox!.width).toBeGreaterThan(width * 0.9);
        expect(dialogBox!.height).toBeGreaterThan(900 * 0.9);
      } else {
        expect(dialogBox!.width).toBeLessThan(width - 40);
        expect(dialogBox!.width).toBeGreaterThan(700);
      }

      await expect(page.locator('.eyebrow')).toHaveCount(0);
      await expect(page.locator('.scenario-note')).toHaveCount(0);
      await expect(dialog.getByRole('table')).toBeVisible();

      const washington = dialog.locator('tr[data-region="washington"]');
      await expect(washington).toContainText('10:00 AM');
      await expect(washington).toContainText('UTC−7');
      await expect(washington).toContainText('9:00 AM');
      await expect(washington).toContainText('UTC−8');
      await expect(washington).toContainText('Falls back');
      await expect(dialog.locator('tr[data-region="bc"]')).toContainText('No change');
      await expect(dialog.locator('tr[data-region="alaska"]')).toContainText('8:00 AM');
      await expect(dialog.locator('tr[data-region="seBc"]')).toContainText('11:00 AM');
      await expect(dialog.locator('tr[data-region="creston"]')).toContainText('UTC−7');

      const octLabel = dialog.locator('.callout-washington .for-oct31').first();
      const novLabel = dialog.locator('.callout-washington .for-nov1').first();
      await expect(octLabel).toBeVisible();
      await expect(octLabel).toHaveText('10:00 AM');

      if (width === 320 || width === 390 || width === 1280) {
        await page.screenshot({ path: `${artifacts}/clock_map_dialog_${width}.png` });
      }

      if (width >= 900) {
        await expect(novLabel).toBeVisible();
        await expect(novLabel).toHaveText('9:00 AM');
        await expect(dialog.locator('.map-card.map-nov1 .callout-bc .for-nov1').first()).toHaveText('10:00 AM');
        await expect(dialog.locator('.map-card.map-oct31 .callout-bc .for-oct31').first()).toHaveText('10:00 AM');
        await expect(dialog.locator('.map-card.map-nov1 .callout-alaska .for-nov1').first()).toHaveText('8:00 AM');
      } else {
        await expect(novLabel).toBeHidden();
        await dialog.locator('label').filter({ hasText: 'After 2 AM' }).click();
        await expect(novLabel).toBeVisible();
        await expect(novLabel).toHaveText('9:00 AM');
        await expect(octLabel).toBeHidden();
        await expect(dialog.locator('.callout-bc .for-nov1').first()).toHaveText('10:00 AM');
      }
      const callouts = dialog.locator('.map-callout:visible');
      const count = await callouts.count();
      for (let i = 0; i < count; i++) {
        const labelBox = await callouts.nth(i).boundingBox();
        expect(labelBox!.x).toBeGreaterThanOrEqual(-1);
        expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      if (width === 1280) {
        const closeMap = dialog.getByRole('button', { name: 'Close map', exact: true });
        await closeMap.focus();
        await page.keyboard.press('Shift+Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement) && document.activeElement !== element)).toBe(true);
        await expect(closeMap).not.toBeFocused();
        await page.keyboard.press('Tab');
        await expect(closeMap).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(page.locator('html')).not.toHaveClass(/clock-dialog-open/);
        await trigger.click();
        await expect(dialog).toBeVisible();
        await closeMap.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    });
  }

  test('policy links open the map dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    await page.getByRole('link', { name: 'before-and-after clock map', exact: true }).click();
    const dialog = page.locator('#regional-clocks-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Clocks around B.C./ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'before-and-after clock map', exact: true })).toBeFocused();
    const seattle = page.getByRole('region', { name: 'What to know about Pacific Time' }).getByRole('link', { name: 'Seattle', exact: true });
    await seattle.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(seattle).toBeFocused();
  });

  test('date toggle supports keyboard selection and returning to the first morning', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    await page.locator('#regional-clocks .clock-map-trigger').click();
    const dialog = page.locator('#regional-clocks-dialog');
    const before = dialog.locator('#clock-oct31');
    const after = dialog.locator('#clock-nov1');
    await before.focus();
    await page.keyboard.press('ArrowRight');
    await expect(after).toBeChecked();
    await expect(dialog.locator('.callout-washington .for-nov1').first()).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(before).toBeChecked();
    await expect(dialog.locator('.callout-washington .for-oct31').first()).toBeVisible();
    await dialog.locator('a[href="#ref-abt"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('details.references-section')).toHaveAttribute('open');
    await expect(page.locator('#ref-abt')).toBeVisible();
    await expect(page.locator('footer .footer-credit')).toHaveCount(1);
  });

  test('table, map toggle and source links work without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('http://127.0.0.1:4173/#regional-clocks');
    const trigger = page.locator('#regional-clocks .clock-map-trigger');
    const dialog = page.locator('#regional-clocks-dialog');
    await expect(trigger).toBeVisible();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Clocks around B.C./ }).first()).toBeVisible();
    await expect(dialog.locator('tr[data-region="montana"]')).toContainText('11:00 AM');
    await expect(dialog.locator('tr[data-region="montana"]')).toContainText('10:00 AM');
    await expect(dialog.locator('.callout-alaska .for-oct31').first()).toBeVisible();
    await dialog.locator('label').filter({ hasText: 'After 2 AM' }).click();
    await expect(dialog.locator('.callout-alaska .for-nov1').first()).toBeVisible();
    await expect(dialog.locator('.callout-alaska .for-nov1').first()).toHaveText('8:00 AM');
    await expect(dialog.locator('.callout-alaska .for-oct31').first()).toBeHidden();
    const sources = page.locator('details.references-section');
    await dialog.locator('a[href="#ref-abt"]').click();
    await dialog.getByRole('button', { name: 'Close map', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(sources).toHaveAttribute('open');
    await expect(page.locator('#ref-abt')).toBeVisible();
    await context.close();
  });
});

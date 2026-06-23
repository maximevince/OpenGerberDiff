import { expect, test } from '@playwright/test';

test('app shell loads with brand, dropzone and status bar', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'OpenGerberDiff' })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await expect(page.getByTestId('statusbar')).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
});

test('page is cross-origin isolated (COOP/COEP active)', async ({ page }) => {
  await page.goto('/');
  const isolated = await page.evaluate(() => crossOriginIsolated);
  expect(isolated).toBe(true);
});

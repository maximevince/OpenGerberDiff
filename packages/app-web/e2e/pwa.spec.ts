import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/tiny.gbr', import.meta.url));

// Service-worker offline emulation is reliable in Chromium only.
test.skip(({ browserName }) => browserName !== 'chromium', 'SW offline test is Chromium-only');

test('manifest is linked and valid', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href!, page.url()).href);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
});

test('app loads and parses files while offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
    }
  });

  // Vite worker bundles aren't in SvelteKit's precache list; the SW discovers them.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('ogd-'))!);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached.filter((p) => p.includes('/workers/')).length).toBe(2);

  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('splash-start').click();
  await page.setInputFiles('[data-testid=file-a]', fixture);
  await page.getByTestId('continue-single').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('layer-count')).toHaveText('1');
  await expect(page.getByTestId('error')).toHaveCount(0);
});

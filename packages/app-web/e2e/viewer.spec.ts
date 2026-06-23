import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { zipSync } from 'fflate';

const fixture = fileURLToPath(new URL('./fixtures/tiny.gbr', import.meta.url));
const richFixture = fileURLToPath(new URL('./fixtures/rich.gbr', import.meta.url));
const disjointFixture = fileURLToPath(new URL('./fixtures/disjoint.gbr', import.meta.url));

/** Count canvas pixels that differ clearly from the dark navy background. */
async function copperPixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // Redraws are throttled to requestAnimationFrame; wait for the pending frame.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('[data-testid=board-canvas]') as HTMLCanvasElement;
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i]! - 26);
      const dg = Math.abs(data[i + 1]! - 26);
      const db = Math.abs(data[i + 2]! - 46);
      if (dr + dg + db > 60) n++;
    }
    return n;
  });
}

test('loads a single Gerber file and renders it', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('status-layers')).toHaveText('1 layers');
  await expect(page.getByTestId('error')).toHaveCount(0);
  expect(await copperPixels(page)).toBeGreaterThan(50);
});

test('renders richer primitives (obround, polygon, region, arc)', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', richFixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('error')).toHaveCount(0);
  expect(await copperPixels(page)).toBeGreaterThan(200);
});

test('loads a multi-layer project from a zip, classifies and lists layers', async ({ page }) => {
  const pad = (x: number) =>
    Buffer.from(
      ['%FSLAX24Y24*%', '%MOMM*%', '%ADD10C,2*%', 'D10*', `X${x}Y0D03*`, 'M02*', ''].join('\n'),
    );
  const zip = zipSync({
    'board-F_Cu.gbr': new Uint8Array(pad(0)),
    'board-B_Cu.gbr': new Uint8Array(pad(20000)),
    'board-F_SilkS.gbr': new Uint8Array(pad(40000)),
    'board-Edge_Cuts.gbr': new Uint8Array(pad(60000)),
    'readme.txt': new Uint8Array([1, 2, 3]),
  });

  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'project.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });

  await expect(page.getByTestId('layer-count')).toHaveText('4');
  await expect(page.getByTestId('status-layers')).toHaveText('4 layers');
  await expect(page.getByTestId('layer-row')).toHaveCount(4);
  // classification labels (top-of-board order: silk above copper)
  await expect(page.getByText('Top Silkscreen')).toBeVisible();
  await expect(page.getByText('Top Copper')).toBeVisible();
  await expect(page.getByText('Board Outline')).toBeVisible();
  expect(await copperPixels(page)).toBeGreaterThan(100);
});

test('toggling a layer visibility changes what is drawn', async ({ page }) => {
  const pad = (x: number, d: number) =>
    Buffer.from(
      ['%FSLAX24Y24*%', '%MOMM*%', `%ADD10C,${d}*%`, 'D10*', `X${x}Y0D03*`, 'M02*', ''].join('\n'),
    );
  const zip = zipSync({
    'board-F_Cu.gbr': new Uint8Array(pad(0, 2)),
    'board-B_Cu.gbr': new Uint8Array(pad(40000, 2)),
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'p.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
  await expect(page.getByTestId('layer-row')).toHaveCount(2);

  const before = await copperPixels(page);
  // hide all layers via the visibility buttons
  for (const btn of await page.locator('[data-testid=layer-row] .vis').all()) await btn.click();
  await expect(page.getByText('0 visible')).toBeVisible();
  const after = await copperPixels(page);
  expect(after).toBeLessThan(before);
});

test('layer right-click context menu: show-only and reassign type', async ({ page }) => {
  const pad = (x: number) =>
    Buffer.from(
      ['%FSLAX24Y24*%', '%MOMM*%', '%ADD10C,2*%', 'D10*', `X${x}Y0D03*`, 'M02*', ''].join('\n'),
    );
  // "mystery.gbr" has no recognizable name -> classifies as Other; we reassign it.
  const zip = zipSync({
    'board-F_Cu.gbr': new Uint8Array(pad(0)),
    'board-B_Cu.gbr': new Uint8Array(pad(20000)),
    'mystery.gbr': new Uint8Array(pad(40000)),
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'p.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
  await expect(page.getByTestId('layer-row')).toHaveCount(3);

  // Right-click the first layer row -> "Show Only This Layer"
  await page.getByTestId('layer-row').first().click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Show Only This Layer' }).click();
  await expect(page.getByText('1 visible')).toBeVisible();

  // Reassign "mystery.gbr" (currently Other) to Bottom Silkscreen via submenu
  await expect(page.getByText('Other')).toBeVisible();
  await page.getByText('mystery.gbr').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Set Layer Type' }).click();
  await page.getByRole('menuitem', { name: 'Bottom Silkscreen', exact: true }).click();
  await expect(page.getByText('Bottom Silkscreen')).toBeVisible();
  await expect(page.getByText('Other')).toHaveCount(0);
});

test('keyboard shortcut H hides all layers', async ({ page }) => {
  const pad = Buffer.from(
    ['%FSLAX24Y24*%', '%MOMM*%', '%ADD10C,2*%', 'D10*', 'X0Y0D03*', 'M02*', ''].join('\n'),
  );
  const zip = zipSync({
    'board-F_Cu.gbr': new Uint8Array(pad),
    'board-B_Cu.gbr': new Uint8Array(pad),
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'p.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  await page.keyboard.press('h');
  await expect(page.getByText('0 visible')).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.getByText('2 visible')).toBeVisible();
});

test('disjoint traces sharing a tool do not bridge across the board', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', disjointFixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('error')).toHaveCount(0);

  const ratio = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('[data-testid=board-canvas]') as HTMLCanvasElement;
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let copperRows = 0;
    for (let y = 0; y < height; y++) {
      let has = false;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (
          Math.abs(data[i]! - 26) + Math.abs(data[i + 1]! - 26) + Math.abs(data[i + 2]! - 46) >
          60
        ) {
          has = true;
          break;
        }
      }
      if (has) copperRows++;
    }
    return copperRows / height;
  });
  expect(ratio).toBeLessThan(0.4);
});

test('a malformed file does not freeze the app', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'broken.gbr',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('%%%not a gerber%%%\nX@Y!*\n garbage'),
  });
  await expect(page.getByRole('heading', { name: 'OpenGerberDiff' })).toBeVisible();
  await page.getByRole('button', { name: /Open files/ }).click();
  await expect(page.getByRole('heading', { name: 'OpenGerberDiff' })).toBeVisible();
});

test('pan and zoom do not crash and keep the canvas alive', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture);
  const canvas = page.getByTestId('board-canvas');
  await expect(canvas).toBeVisible();

  await canvas.hover();
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, 480);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);
  await page.mouse.up();

  await expect(canvas).toBeVisible();
});

import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { zipSync } from 'fflate';

const fixture = fileURLToPath(new URL('./fixtures/tiny.gbr', import.meta.url));
const richFixture = fileURLToPath(new URL('./fixtures/rich.gbr', import.meta.url));
const disjointFixture = fileURLToPath(new URL('./fixtures/disjoint.gbr', import.meta.url));

const FILE_A = '[data-testid=file-a]';
const FILE_B = '[data-testid=file-b]';

function pad(x: number, d = 2): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      ['%FSLAX24Y24*%', '%MOMM*%', `%ADD10C,${d}*%`, 'D10*', `X${x}Y0D03*`, 'M02*', ''].join('\n'),
    ),
  );
}
function zipFile(entries: Record<string, Uint8Array>) {
  return { name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) };
}

/** Count canvas pixels that differ clearly from the dark navy background. */
async function copperPixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('[data-testid=board-canvas]') as HTMLCanvasElement;
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - 26) + Math.abs(data[i + 1]! - 26) + Math.abs(data[i + 2]! - 46) > 60)
        n++;
    }
    return n;
  });
}

test('loads a single Gerber into slot A and renders it', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(FILE_A, fixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('layer-count')).toHaveText('1');
  await expect(page.getByTestId('error')).toHaveCount(0);
  expect(await copperPixels(page)).toBeGreaterThan(50);
});

test('renders richer primitives (obround, polygon, region, arc)', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(FILE_A, richFixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  expect(await copperPixels(page)).toBeGreaterThan(200);
});

test('multi-layer zip classifies and lists layers', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(
    FILE_A,
    zipFile({
      'board-F_Cu.gbr': pad(0),
      'board-B_Cu.gbr': pad(20000),
      'board-F_SilkS.gbr': pad(40000),
      'board-Edge_Cuts.gbr': pad(60000),
    }),
  );
  await expect(page.getByTestId('layer-count')).toHaveText('4');
  await expect(page.getByText('Top Silkscreen')).toBeVisible();
  await expect(page.getByText('Board Outline')).toBeVisible();
});

test('layer context menu: show-only and reassign type', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(
    FILE_A,
    zipFile({ 'board-F_Cu.gbr': pad(0), 'mystery.gbr': pad(40000) }),
  );
  await expect(page.getByTestId('layer-row')).toHaveCount(2);

  await page.getByTestId('layer-row').first().click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Show Only This Layer' }).click();

  await expect(page.getByText('Other')).toBeVisible();
  await page.getByText('mystery.gbr').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Set Layer Type' }).click();
  await page.getByRole('menuitem', { name: 'Bottom Silkscreen', exact: true }).click();
  await expect(page.getByText('Bottom Silkscreen')).toBeVisible();
  await expect(page.getByText('Other')).toHaveCount(0);
});

test('keyboard H/A toggle all layer visibility', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(
    FILE_A,
    zipFile({ 'board-F_Cu.gbr': pad(0), 'board-B_Cu.gbr': pad(40000) }),
  );
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  const before = await copperPixels(page);
  await page.keyboard.press('h');
  expect(await copperPixels(page)).toBeLessThan(before);
  await page.keyboard.press('a');
  expect(await copperPixels(page)).toBeGreaterThan(0);
});

test('empty screen shows big A and B dropzones', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('bigdrop-a')).toBeVisible();
  await expect(page.getByTestId('bigdrop-b')).toBeVisible();
});

test('diff mode respects per-layer visibility', async ({ page }) => {
  const gb = (lines: string[]) => new Uint8Array(Buffer.from(lines.join('\n') + '\n'));
  const one = (x: number, y: number) =>
    gb(['%FSLAX24Y24*%', '%MOMM*%', '%ADD10C,4*%', 'D10*', `X${x}Y${y}D03*`, 'M02*']);
  const two = (a: [number, number], b: [number, number]) =>
    gb([
      '%FSLAX24Y24*%',
      '%MOMM*%',
      '%ADD10C,4*%',
      'D10*',
      `X${a[0]}Y${a[1]}D03*`,
      `X${b[0]}Y${b[1]}D03*`,
      'M02*',
    ]);

  await page.goto('/');
  await page.setInputFiles(
    FILE_A,
    zipFile({ 'board-F_Cu.gbr': one(0, 0), 'board-B_Cu.gbr': one(0, 0) }),
  );
  await page.setInputFiles(
    FILE_B,
    zipFile({
      'board-F_Cu.gbr': two([0, 0], [400000, 0]), // F_Cu adds a pad to the right
      'board-B_Cu.gbr': two([0, 0], [0, 400000]), // B_Cu adds a pad upward
    }),
  );
  await expect(page.getByTestId('diff-summary')).toBeVisible();
  await expect(page.getByTestId('total-regions')).toHaveText('2', { timeout: 10_000 });

  const before = await copperPixels(page);
  // hide the first layer (Top Copper) — its change region should disappear
  await page.locator('[data-testid=layer-row] .vis').first().click();
  expect(await copperPixels(page)).toBeLessThan(before);
});

test('A vs B diff: summary, totals and region navigation', async ({ page }) => {
  await page.goto('/');
  // A: one copper pad. B: same pad + an extra pad => added copper.
  await page.setInputFiles(FILE_A, zipFile({ 'board-F_Cu.gbr': pad(0, 4) }));
  await page.setInputFiles(
    FILE_B,
    zipFile({
      'board-F_Cu.gbr': new Uint8Array(
        Buffer.from(
          [
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%ADD10C,4*%',
            'D10*',
            'X0Y0D03*',
            'X400000Y0D03*',
            'M02*',
            '',
          ].join('\n'),
        ),
      ),
    }),
  );

  await expect(page.getByTestId('diff-summary')).toBeVisible();
  await expect(page.getByTestId('status-mode')).toHaveText('diff');
  // one added cluster expected
  await expect(page.getByTestId('region-count')).toContainText('/1', { timeout: 10_000 });
  await expect(page.getByTestId('total-regions')).toHaveText('1');
  // added area is non-zero (the extra 4x4-ish pad)
  await expect(page.getByTestId('status-totals')).not.toHaveText('+0.000 mm²');

  await page.keyboard.press('n');
  await expect(page.getByTestId('region-count')).toHaveText('1/1');

  // switch to overlay and back to diff
  await page.getByRole('button', { name: 'Overlay' }).click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test('disjoint traces sharing a tool do not bridge across the board', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(FILE_A, disjointFixture);
  await expect(page.getByTestId('board-canvas')).toBeVisible();

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
  await page.setInputFiles(FILE_A, {
    name: 'broken.gbr',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('%%%not a gerber%%%\nX@Y!*\n garbage'),
  });
  await expect(page.getByRole('heading', { name: 'OpenGerberDiff' })).toBeVisible();
});

test('pan and zoom do not crash', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(FILE_A, fixture);
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

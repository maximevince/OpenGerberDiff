import { describe, expect, it } from 'vitest';
import { parseImage } from './adapter-v4.js';
import { sha256Hex } from '../hash.js';

const SRC = { fileName: 'test.gbr', sha256: 'deadbeef' };

const TINY_MM = [
  'G04 spike*',
  '%FSLAX24Y24*%',
  '%MOMM*%',
  '%ADD10C,1*%',
  '%ADD11R,2X1*%',
  'D10*',
  'X0Y0D03*',
  'X100000Y0D03*',
  'D11*',
  'X0Y100000D03*',
  'D10*',
  'X0Y0D02*',
  'X100000Y100000D01*',
  'M02*',
  '',
].join('\n');

const TINY_INCH = [
  '%FSLAX24Y24*%',
  '%MOIN*%',
  '%ADD10C,1*%',
  'D10*',
  'X10000Y0D03*',
  'M02*',
  '',
].join('\n');

const CLEAR_REGION = [
  '%FSLAX24Y24*%',
  '%MOMM*%',
  '%ADD10C,1*%',
  '%LPD*%',
  'G36*',
  'X0Y0D02*',
  'X100000Y0D01*',
  'X100000Y100000D01*',
  'X0Y100000D01*',
  'X0Y0D01*',
  'G37*',
  '%LPC*%',
  'D10*',
  'X50000Y50000D03*',
  'M02*',
  '',
].join('\n');

describe('v4 parser adapter', () => {
  it('parses pads, strokes and tool shapes in millimetres', async () => {
    const { image, diagnostics } = await parseImage(TINY_MM, SRC);

    expect(image.units).toBe('mm');
    expect(image.source.sha256).toBe('deadbeef');
    expect(image.stats.padCount).toBe(3);
    expect(image.stats.strokeCount).toBe(1);

    const c = image.tools.get('10');
    expect(c?.[0]).toMatchObject({ type: 'circle', r: 0.5 });
    const r = image.tools.get('11');
    expect(r?.[0]).toMatchObject({ type: 'rect', width: 2, height: 1 });

    const stroke = image.graphics.find((g) => g.kind === 'stroke');
    expect(stroke).toBeDefined();
    if (stroke?.kind === 'stroke') expect(stroke.width).toBeCloseTo(1, 6);

    // bbox includes aperture radii: pads dia1 + rect + trace
    expect(image.boundingBox.minX).toBeCloseTo(-1, 3);
    expect(image.boundingBox.maxX).toBeCloseTo(10.5, 3);
    expect(image.boundingBox.maxY).toBeCloseTo(10.5, 3);

    // a missing-interpolation warning is expected but it's not an error
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('normalizes inch files to millimetres', async () => {
    const { image } = await parseImage(TINY_INCH, { ...SRC, fileName: 'inch.gbr' });
    const pad = image.graphics.find((g) => g.kind === 'pad');
    expect(pad?.kind).toBe('pad');
    // X10000 in 2.4 inch = 1.0 in = 25.4 mm
    if (pad?.kind === 'pad') expect(pad.x).toBeCloseTo(25.4, 3);
    // circle dia 1 inch => r 0.5 in => 12.7 mm
    expect(image.tools.get('10')?.[0]).toMatchObject({ type: 'circle' });
    const circle = image.tools.get('10')?.[0];
    if (circle?.type === 'circle') expect(circle.r).toBeCloseTo(12.7, 3);
  });

  it('carries polarity and region fills', async () => {
    const { image } = await parseImage(CLEAR_REGION, SRC);
    const fill = image.graphics.find((g) => g.kind === 'fill');
    expect(fill?.kind).toBe('fill');
    const clearPad = image.graphics.find((g) => g.kind === 'pad' && g.polarity === 'clear');
    expect(clearPad).toBeDefined();
  });

  it('does not throw on malformed input — reports diagnostics', async () => {
    const { image, diagnostics } = await parseImage('%%%not a gerber%%%\nX@Y!*', SRC);
    expect(Array.isArray(diagnostics)).toBe(true);
    expect(image).toBeDefined();
    expect(image.units).toBe('mm');
  });

  it('detects Excellon drill files by M48 header', async () => {
    const drill = ['M48', 'METRIC,TZ', 'T1C0.80', '%', 'T1', 'X010000Y010000', 'M30', ''].join(
      '\n',
    );
    const { image } = await parseImage(drill, { fileName: 'drill.drl', sha256: 'x' });
    expect(image.source.format).toBe('drill');
  });

  it('sha256Hex matches a known vector', async () => {
    // sha256("abc")
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

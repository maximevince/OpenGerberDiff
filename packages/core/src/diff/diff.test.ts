import { describe, expect, it } from 'vitest';
import type { Graphic, Image, ShapePrimitive } from '../model/index.js';
import { emptyBoundingBox, expandBoundingBox } from '../model/index.js';
import { makeGridSpec, rasterize, cellAreaMm2 } from '../raster/index.js';
import { autoAlign } from '../align/index.js';
import { classGridHash, diffImages } from './index.js';

/** Build a minimal Image from rectangular pads (size in mm, centered at x,y). */
function squares(rects: Array<{ x: number; y: number; w: number; h: number }>): Image {
  const tools = new Map<string, ShapePrimitive[]>();
  const graphics: Graphic[] = [];
  const bbox = emptyBoundingBox();
  rects.forEach((r, i) => {
    const tool = `t${i}`;
    tools.set(tool, [{ type: 'rect', cx: 0, cy: 0, width: r.w, height: r.h, r: 0 }]);
    graphics.push({ id: i, kind: 'pad', tool, x: r.x, y: r.y, polarity: 'dark' });
    expandBoundingBox(bbox, r.x - r.w / 2, r.y - r.h / 2);
    expandBoundingBox(bbox, r.x + r.w / 2, r.y + r.h / 2);
  });
  return {
    source: { fileName: 'mem', format: 'gerber', sha256: '' },
    units: 'mm',
    tools,
    graphics,
    boundingBox: bbox,
    stats: {
      graphicCount: graphics.length,
      padCount: graphics.length,
      strokeCount: 0,
      fillCount: 0,
      copperAreaMm2: 0,
    },
  };
}

describe('rasterizer area accuracy', () => {
  it('measures a 10x10 mm pad as ~100 mm²', () => {
    const img = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const spec = makeGridSpec(img.boundingBox, 0.05);
    const grid = rasterize(img, spec);
    let occ = 0;
    for (const v of grid) occ += v;
    expect(occ * cellAreaMm2(spec)).toBeCloseTo(100, 0);
  });
});

describe('diff: per-direction area', () => {
  it('identical inputs → zero change (no AA noise)', () => {
    const a = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const b = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const r = diffImages(a, b, { cellSizeMm: 0.05 });
    expect(r.metrics.addedMm2).toBe(0);
    expect(r.metrics.removedMm2).toBe(0);
    expect(r.metrics.changedPct).toBe(0);
    expect(r.clusters).toHaveLength(0);
  });

  it('detects added copper in mm² (B has an extra pad)', () => {
    const a = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const b = squares([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 4, h: 4 },
    ]);
    const r = diffImages(a, b, { cellSizeMm: 0.05, align: 'none' });
    expect(r.metrics.addedMm2).toBeCloseTo(16, 0);
    expect(r.metrics.removedMm2).toBeCloseTo(0, 1);
    expect(r.metrics.netCopperMm2).toBeGreaterThan(15);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.kind).toBe('added');
  });

  it('detects removed copper (A has a pad B lacks)', () => {
    const a = squares([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 4, h: 4 },
    ]);
    const b = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const r = diffImages(a, b, { cellSizeMm: 0.05, align: 'none' });
    expect(r.metrics.removedMm2).toBeCloseTo(16, 0);
    expect(r.metrics.addedMm2).toBeCloseTo(0, 1);
    expect(r.clusters[0]!.kind).toBe('removed');
  });

  it('two far-apart changes form two clusters', () => {
    const a = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const b = squares([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 3, h: 3 },
      { x: 30, y: 30, w: 3, h: 3 },
    ]);
    const r = diffImages(a, b, { cellSizeMm: 0.05, align: 'none' });
    expect(r.clusters.length).toBe(2);
  });
});

describe('alignment', () => {
  it('finds a pure translation', () => {
    const a = squares([{ x: 0, y: 0, w: 8, h: 8 }]);
    const b = squares([{ x: 10, y: 0, w: 8, h: 8 }]); // shifted +10 in x
    const al = autoAlign(a, b);
    expect(al.detected).toBe(true);
    expect(al.offset.x).toBeCloseTo(-10, 1);
    expect(al.offset.y).toBeCloseTo(0, 1);
  });

  it('a shifted-but-identical board diffs to ~0 after auto-align', () => {
    const a = squares([{ x: 0, y: 0, w: 8, h: 8 }]);
    const b = squares([{ x: 10, y: 0, w: 8, h: 8 }]);
    const r = diffImages(a, b, { cellSizeMm: 0.05, align: 'auto' });
    expect(r.alignDetected).toBe(true);
    expect(r.metrics.changedMm2).toBeLessThan(1); // near-perfect overlap
  });
});

describe('determinism', () => {
  it('same inputs → identical class-grid hash', () => {
    const a = squares([{ x: 0, y: 0, w: 10, h: 10 }]);
    const b = squares([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 4, h: 4 },
    ]);
    const h1 = classGridHash(diffImages(a, b, { cellSizeMm: 0.05, align: 'none' }).classGrid);
    const h2 = classGridHash(diffImages(a, b, { cellSizeMm: 0.05, align: 'none' }).classGrid);
    expect(h1).toBe(h2);
  });
});

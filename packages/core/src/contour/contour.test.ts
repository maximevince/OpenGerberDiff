import { describe, expect, it } from 'vitest';
import { contourGrid, type ContourLoop } from './index.js';
import type { GridSpec } from '../raster/index.js';

/** cols x rows grid from a row-major 0/1 string sketch (top row first). */
function grid(rows: string[]): { spec: GridSpec; data: Uint8Array } {
  const r = rows.length;
  const c = rows[0]!.length;
  const data = new Uint8Array(r * c);
  // Sketch row 0 = visual top; store so that grid row 0 = bottom (world Y up).
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < c; x++) {
      if (rows[r - 1 - y]![x] === '#') data[y * c + x] = 1;
    }
  }
  const spec: GridSpec = { originX: 0, originY: 0, cellSize: 1, cols: c, rows: r };
  return { spec, data };
}

/** Signed area of a polygon (shoelace); >0 = CCW. */
function signedArea(loop: ContourLoop): number {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    s += loop[j]![0] * loop[i]![1] - loop[i]![0] * loop[j]![1];
  }
  return s / 2;
}

function absArea(loops: ContourLoop[]): number {
  return loops.reduce((t, l) => t + Math.abs(signedArea(l)), 0);
}

describe('contourGrid', () => {
  it('empty grid → no loops', () => {
    const { spec, data } = grid(['...', '...']);
    expect(contourGrid(data, spec, 1)).toEqual([]);
  });

  it('single cell → a unit square, CCW, 4 corners', () => {
    const { spec, data } = grid(['...', '.#.', '...']);
    const loops = contourGrid(data, spec, 1);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4); // collinear collapse leaves exactly the corners
    expect(signedArea(loops[0]!)).toBeCloseTo(1); // CCW, area 1
  });

  it('a filled rectangle collapses to 4 corners with exact area', () => {
    const { spec, data } = grid(['####', '####', '####']);
    const loops = contourGrid(data, spec, 1);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(Math.abs(signedArea(loops[0]!))).toBeCloseTo(12); // 4 wide x 3 tall
  });

  it('a ring (hole) yields outer CCW + inner CW; even-odd area = filled cells', () => {
    const { spec, data } = grid(['#####', '#...#', '#...#', '#...#', '#####']);
    const loops = contourGrid(data, spec, 1);
    expect(loops).toHaveLength(2);
    const ccw = loops.filter((l) => signedArea(l) > 0);
    const cw = loops.filter((l) => signedArea(l) < 0);
    expect(ccw).toHaveLength(1); // outer
    expect(cw).toHaveLength(1); // hole
    // outer 5x5=25 minus inner 3x3=9 = 16 filled cells
    expect(Math.abs(signedArea(ccw[0]!)) - Math.abs(signedArea(cw[0]!))).toBeCloseTo(16);
  });

  it('two disjoint blobs → two separate loops', () => {
    const { spec, data } = grid(['#..#', '#..#', '....']);
    const loops = contourGrid(data, spec, 1);
    expect(loops).toHaveLength(2);
  });

  it('total contour area equals occupied cell count (× cell area)', () => {
    const { spec, data } = grid(['.##.', '###.', '.#.#']);
    const occupied = data.reduce((t, v) => t + v, 0);
    expect(absArea(contourGrid(data, spec, 1))).toBeCloseTo(occupied);
  });

  it('respects origin and cell size (world coordinates)', () => {
    const spec: GridSpec = { originX: 10, originY: -5, cellSize: 0.02, cols: 2, rows: 2 };
    const data = new Uint8Array([1, 0, 0, 0]); // bottom-left cell only
    const loops = contourGrid(data, spec, 1);
    expect(loops).toHaveLength(1);
    const xs = loops[0]!.map((p) => p[0]);
    const ys = loops[0]!.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(10.02);
    expect(Math.min(...ys)).toBeCloseTo(-5);
    expect(Math.max(...ys)).toBeCloseTo(-4.98);
  });

  it('selects only the requested class value', () => {
    const spec: GridSpec = { originX: 0, originY: 0, cellSize: 1, cols: 2, rows: 1 };
    const data = new Uint8Array([2, 3]); // ADDED, REMOVED
    expect(absArea(contourGrid(data, spec, 2))).toBeCloseTo(1);
    expect(absArea(contourGrid(data, spec, 3))).toBeCloseTo(1);
    expect(contourGrid(data, spec, 1)).toEqual([]);
  });
});

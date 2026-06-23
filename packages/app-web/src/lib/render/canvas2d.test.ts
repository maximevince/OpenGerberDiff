import { describe, expect, it } from 'vitest';
import type { PathSegment } from '@ogd/core';
import { toSubpaths } from './canvas2d.js';

const line = (a: [number, number], b: [number, number]): PathSegment => ({
  type: 'line',
  start: a,
  end: b,
});

describe('toSubpaths (disjoint-trace handling)', () => {
  it('keeps a contiguous path as a single subpath', () => {
    const subs = toSubpaths([line([0, 0], [1, 0]), line([1, 0], [1, 1])]);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('splits disjoint segments into separate subpaths (no bridging line)', () => {
    // This is the exact shape the plotter emits for two separate traces sharing
    // one aperture — the regression that drew lines all over the board.
    const subs = toSubpaths([line([0, 0], [1, 0]), line([0, 1], [1, 1])]);
    expect(subs).toHaveLength(2);
    expect(subs[0]).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(subs[1]).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('tessellates an arc into many points ending at the arc end', () => {
    const arc: PathSegment = {
      type: 'arc',
      start: [0, 0],
      end: [2, 0],
      center: [1, 0],
      radius: 1,
      sweep: Math.PI,
      dir: 'ccw',
    };
    const subs = toSubpaths([arc]);
    expect(subs).toHaveLength(1);
    const pts = subs[0]!;
    expect(pts.length).toBeGreaterThan(8);
    expect(pts[0]).toEqual([0, 0]);
    const last = pts[pts.length - 1]!;
    expect(last[0]).toBeCloseTo(2, 6);
    expect(last[1]).toBeCloseTo(0, 6);
    // CCW arc from leftmost->rightmost sweeps through the bottom (y < 0)
    expect(pts.some((p) => p[1] < -0.5)).toBe(true);
  });
});

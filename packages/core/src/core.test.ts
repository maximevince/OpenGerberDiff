import { describe, expect, it } from 'vitest';
import {
  OGD_CORE_VERSION,
  emptyBoundingBox,
  expandBoundingBox,
  isFiniteBoundingBox,
  unionBoundingBox,
  formatLength,
  inchToMm,
} from './index.js';

describe('@ogd/core smoke', () => {
  it('exposes a version', () => {
    expect(OGD_CORE_VERSION).toBe('0.0.0');
  });
});

describe('bounding box helpers', () => {
  it('empty box is not finite', () => {
    expect(isFiniteBoundingBox(emptyBoundingBox())).toBe(false);
  });

  it('expands around a point with radius', () => {
    const b = emptyBoundingBox();
    expandBoundingBox(b, 0, 0, 1);
    expandBoundingBox(b, 10, 5, 0);
    expect(b).toEqual({ minX: -1, minY: -1, maxX: 10, maxY: 5 });
    expect(isFiniteBoundingBox(b)).toBe(true);
  });

  it('unions two boxes', () => {
    const a = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const c = { minX: 1, minY: -1, maxX: 3, maxY: 1 };
    expect(unionBoundingBox(a, c)).toEqual({ minX: 0, minY: -1, maxX: 3, maxY: 2 });
  });
});

describe('unit formatting', () => {
  it('converts inch to mm', () => {
    expect(inchToMm(1)).toBeCloseTo(25.4, 10);
  });

  it('formats lengths per unit', () => {
    expect(formatLength(25.4, 'inch')).toBe('1.0000"');
    expect(formatLength(25.4, 'mm')).toBe('25.400 mm');
    // 1 inch = 1000 mil
    expect(formatLength(25.4, 'mil')).toBe('1000.0 mil');
  });
});

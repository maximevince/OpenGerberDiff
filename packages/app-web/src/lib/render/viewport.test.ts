import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAbout,
} from './viewport.js';

const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('viewport math', () => {
  it('round-trips world <-> screen', () => {
    const vp = fitView(box, 800, 600);
    const [sx, sy] = worldToScreen(vp, 25, 10);
    const [wx, wy] = screenToWorld(vp, sx, sy);
    expect(wx).toBeCloseTo(25, 6);
    expect(wy).toBeCloseTo(10, 6);
  });

  it('flips Y (world up -> screen down)', () => {
    const vp = { width: 100, height: 100, panX: 0, panY: 0, zoom: 1 };
    const [, syUp] = worldToScreen(vp, 0, 10);
    const [, syDown] = worldToScreen(vp, 0, -10);
    expect(syUp).toBeLessThan(syDown);
  });

  it('fits the box centered', () => {
    const vp = fitView(box, 800, 600, 1);
    // center of box maps to center of viewport
    const [sx, sy] = worldToScreen(vp, 50, 25);
    expect(sx).toBeCloseTo(400, 3);
    expect(sy).toBeCloseTo(300, 3);
  });

  it('keeps the anchor point stationary while zooming', () => {
    const vp = fitView(box, 800, 600);
    const before = screenToWorld(vp, 200, 150);
    const zoomed = zoomAbout(vp, 200, 150, 2.5);
    const after = screenToWorld(zoomed, 200, 150);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('clamps zoom to limits', () => {
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
    expect(clampZoom(1e-9)).toBe(MIN_ZOOM);
  });

  it('pans by screen delta', () => {
    const vp = { width: 100, height: 100, panX: 10, panY: 20, zoom: 1 };
    expect(panBy(vp, 5, -5)).toMatchObject({ panX: 15, panY: 15 });
  });

  it('handles degenerate boxes without NaN', () => {
    const vp = fitView(
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      800,
      600,
    );
    expect(Number.isFinite(vp.zoom)).toBe(true);
    expect(Number.isFinite(vp.panX)).toBe(true);
  });
});

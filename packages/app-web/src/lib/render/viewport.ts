import type { BoundingBox } from '@ogd/core';

/**
 * View transform. World units are millimetres (Y up). Screen units are CSS
 * pixels (Y down). `zoom` = pixels per millimetre. `panX/panY` is the screen
 * position (px) of world origin (0,0).
 *
 *   screenX = panX + worldX * zoom
 *   screenY = panY - worldY * zoom   (Y is flipped)
 */
export interface Viewport {
  width: number;
  height: number;
  panX: number;
  panY: number;
  zoom: number;
}

export const MIN_ZOOM = 0.02; // px/mm — zoomed way out
export const MAX_ZOOM = 20000; // px/mm — zoomed way in

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(vp: Viewport, wx: number, wy: number): [number, number] {
  return [vp.panX + wx * vp.zoom, vp.panY - wy * vp.zoom];
}

export function screenToWorld(vp: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - vp.panX) / vp.zoom, (vp.panY - sy) / vp.zoom];
}

/** Fit `box` (mm) into a width×height viewport with a margin factor (<1). */
export function fitView(box: BoundingBox, width: number, height: number, margin = 0.9): Viewport {
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  if (!(bw > 0) || !(bh > 0) || !Number.isFinite(bw) || !Number.isFinite(bh)) {
    return { width, height, panX: width / 2, panY: height / 2, zoom: 1 };
  }
  const zoom = clampZoom(Math.min(width / bw, height / bh) * margin || 1);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  // Place world center at screen center.
  return {
    width,
    height,
    zoom,
    panX: width / 2 - cx * zoom,
    panY: height / 2 + cy * zoom,
  };
}

/** Zoom by `factor` about a screen anchor point, keeping that point stationary. */
export function zoomAbout(vp: Viewport, sx: number, sy: number, factor: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  const k = zoom / vp.zoom;
  // Solve so the world point under (sx,sy) stays under (sx,sy).
  return {
    ...vp,
    zoom,
    panX: sx - (sx - vp.panX) * k,
    panY: sy - (sy - vp.panY) * k,
  };
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, panX: vp.panX + dxScreen, panY: vp.panY + dyScreen };
}

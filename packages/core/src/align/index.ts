/**
 * Translation auto-alignment. Tries a few candidate offsets (none / bbox-center /
 * min-corner) and picks the one that minimizes coarse-grid disagreement between
 * the two images. See docs/03 §4.5 (rotation/scale is a later stage).
 */
import type { Image } from '../model/index.js';
import { unionBoundingBox, type BoundingBox } from '../model/index.js';
import { makeGridSpec, rasterize, type GridSpec } from '../raster/index.js';

export interface Offset {
  x: number;
  y: number;
}

export interface AlignResult {
  offset: Offset;
  detected: boolean;
}

function center(b: BoundingBox): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function xorCount(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Compute a translation that best aligns B onto A. */
export function autoAlign(a: Image, b: Image): AlignResult {
  const ca = center(a.boundingBox);
  const cb = center(b.boundingBox);
  const candidates: Offset[] = [
    { x: 0, y: 0 },
    { x: ca.x - cb.x, y: ca.y - cb.y },
    { x: a.boundingBox.minX - b.boundingBox.minX, y: a.boundingBox.minY - b.boundingBox.minY },
  ];

  // A coarse grid spanning A plus every shifted B candidate.
  let bbox = a.boundingBox;
  for (const c of candidates) {
    bbox = unionBoundingBox(bbox, {
      minX: b.boundingBox.minX + c.x,
      minY: b.boundingBox.minY + c.y,
      maxX: b.boundingBox.maxX + c.x,
      maxY: b.boundingBox.maxY + c.y,
    });
  }
  const span = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (!(span > 0) || !Number.isFinite(span)) return { offset: { x: 0, y: 0 }, detected: false };

  const spec: GridSpec = makeGridSpec(bbox, Math.max(span / 200, 1e-4), 200_000);
  const gridA = rasterize(a, spec);

  let best = candidates[0]!;
  let bestScore = Infinity;
  let zeroScore = Infinity;
  for (const c of candidates) {
    const gridB = rasterize(b, spec, c);
    const score = xorCount(gridA, gridB);
    if (c.x === 0 && c.y === 0) zeroScore = score;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  const moved = best.x !== 0 || best.y !== 0;
  // Only claim detection if a non-zero offset meaningfully beats no-shift.
  const detected = moved && bestScore < zeroScore * 0.9;
  return { offset: detected ? best : { x: 0, y: 0 }, detected };
}

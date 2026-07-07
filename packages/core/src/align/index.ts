/**
 * Translation auto-alignment. Pipeline:
 *   1. exhaustive coarse XOR grid search over the whole A∪B extent (plus bbox
 *      seeds) to find the neighborhood of the true offset,
 *   2. coarse-to-fine local grid-shift refinement,
 *   3. exact snap to the median delta of matched pad centers.
 * Scoring compares matched layer PAIRS (caller passes copper first), never one
 * merged blob: exporters draw title blocks on every layer and mask planes can be
 * giant filled shapes, so bbox heuristics and whole-board occupancy both lie.
 * Median (not mean / least squares) for the pad snap: genuinely changed or
 * unmatched pads are outliers and must not drag the fit. See docs/03 §4.5
 * (rotation/scale is a later stage).
 */
import type { Image } from '../model/index.js';
import {
  emptyBoundingBox,
  isFiniteBoundingBox,
  unionBoundingBox,
  type BoundingBox,
} from '../model/index.js';
import { makeGridSpec, rasterize, type GridSpec } from '../raster/index.js';

export interface Offset {
  x: number;
  y: number;
}

export interface AlignResult {
  offset: Offset;
  detected: boolean;
}

/** A matched A↔B layer pair: a scoring channel and pad-snap source. */
export interface AlignPair {
  a: Image;
  b: Image;
}

const NO_ALIGN: AlignResult = { offset: { x: 0, y: 0 }, detected: false };
/** Score at most this many pairs — the caller orders them most-informative first. */
const MAX_CHANNELS = 4;

function center(b: BoundingBox): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function unionOf(images: Image[]): BoundingBox {
  let box = emptyBoundingBox();
  for (const img of images) {
    if (isFiniteBoundingBox(img.boundingBox)) box = unionBoundingBox(box, img.boundingBox);
  }
  return box;
}

function shiftBox(b: BoundingBox, o: Offset): BoundingBox {
  return { minX: b.minX + o.x, minY: b.minY + o.y, maxX: b.maxX + o.x, maxY: b.maxY + o.y };
}

function spanOf(b: BoundingBox): number {
  return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

/**
 * Disagreement between A and B with B translated by (+dx,+dy) CELLS. Shifted-out
 * B cells read as empty. Row index grows with world Y, so +dy is +Y in mm.
 */
function xorShifted(
  a: Uint8Array,
  b: Uint8Array,
  cols: number,
  rows: number,
  dx: number,
  dy: number,
): number {
  let n = 0;
  for (let y = 0; y < rows; y++) {
    const by = y - dy;
    const rowOk = by >= 0 && by < rows;
    const aBase = y * cols;
    const bBase = by * cols;
    for (let x = 0; x < cols; x++) {
      const av = a[aBase + x]!;
      const bx = x - dx;
      const bv = rowOk && bx >= 0 && bx < cols ? b[bBase + bx]! : 0;
      if (av !== bv) n++;
    }
  }
  return n;
}

/** One scoring channel: a set of A images matched against a set of B images. */
interface Channel {
  a: Image[];
  b: Image[];
}

interface Channels {
  spec: GridSpec;
  a: Uint8Array[];
  b: Uint8Array[];
}

/** OR-merge a list of images into one occupancy grid. */
function rasterizeMerged(images: Image[], spec: GridSpec, offset: Offset): Uint8Array {
  if (images.length === 1) return rasterize(images[0]!, spec, offset);
  const merged = new Uint8Array(spec.cols * spec.rows);
  for (const img of images) {
    const g = rasterize(img, spec, offset);
    for (let i = 0; i < merged.length; i++) if (g[i]) merged[i] = 1;
  }
  return merged;
}

function rasterizeChannels(channels: Channel[], spec: GridSpec, offsetB: Offset): Channels {
  return {
    spec,
    a: channels.map((c) => rasterizeMerged(c.a, spec, { x: 0, y: 0 })),
    b: channels.map((c) => rasterizeMerged(c.b, spec, offsetB)),
  };
}

function scoreShift(ch: Channels, dx: number, dy: number): number {
  let s = 0;
  for (let i = 0; i < ch.a.length; i++) {
    s += xorShifted(ch.a[i]!, ch.b[i]!, ch.spec.cols, ch.spec.rows, dx, dy);
  }
  return s;
}

/** Compute a translation that best aligns B onto A. */
export function autoAlign(a: Image, b: Image): AlignResult {
  return autoAlignSets([a], [b], [{ a, b }]);
}

/**
 * Compute ONE translation that best aligns the B board onto A. Exporters
 * disagree on the design origin globally — never per layer — so a single offset
 * is returned. `pairs` are the matched layer pairs used for scoring and pad
 * matching, ordered most-informative first (top copper, then other copper…).
 */
export function autoAlignSets(
  aImages: Image[],
  bImages: Image[],
  pairs: AlignPair[] = [],
): AlignResult {
  const boxA = unionOf(aImages);
  const boxB = unionOf(bImages);
  if (!isFiniteBoundingBox(boxA) || !isFiniteBoundingBox(boxB)) return NO_ALIGN;
  // Score per matched pair when available; otherwise fall back to comparing the
  // two sides as merged blobs.
  const channels: Channel[] = pairs.length
    ? pairs.slice(0, MAX_CHANNELS).map((p) => ({ a: [p.a], b: [p.b] }))
    : [{ a: aImages, b: bImages }];

  // --- Stage 0: exhaustive coarse search over the whole A∪B extent ------------
  const box0 = unionBoundingBox(boxA, boxB);
  const span0 = spanOf(box0);
  if (!(span0 > 0) || !Number.isFinite(span0)) return NO_ALIGN;
  const spec0 = makeGridSpec(box0, Math.max(span0 / 48, 1e-4), 6_000);
  const ch0 = rasterizeChannels(channels, spec0, { x: 0, y: 0 });

  const zeroScore = scoreShift(ch0, 0, 0);
  let best: Offset = { x: 0, y: 0 };
  let bestScore = zeroScore;
  const consider = (dx: number, dy: number) => {
    const score = scoreShift(ch0, dx, dy);
    if (score < bestScore) {
      bestScore = score;
      best = { x: dx * spec0.cellSize, y: dy * spec0.cellSize };
    }
  };
  const RANGE0 = 40;
  for (let dy = -RANGE0; dy <= RANGE0; dy++) {
    for (let dx = -RANGE0; dx <= RANGE0; dx++) {
      if (dx !== 0 || dy !== 0) consider(dx, dy);
    }
  }
  // Bbox-derived seeds (whole side + per pair) can reach beyond the scan range.
  const seeds: Offset[] = [];
  const addBoxSeeds = (a: BoundingBox, b: BoundingBox) => {
    if (!isFiniteBoundingBox(a) || !isFiniteBoundingBox(b)) return;
    const ca = center(a);
    const cb = center(b);
    seeds.push({ x: ca.x - cb.x, y: ca.y - cb.y });
    seeds.push({ x: a.minX - b.minX, y: a.minY - b.minY });
  };
  addBoxSeeds(boxA, boxB);
  for (const p of pairs) addBoxSeeds(p.a.boundingBox, p.b.boundingBox);
  for (const s of seeds) {
    consider(Math.round(s.x / spec0.cellSize), Math.round(s.y / spec0.cellSize));
  }

  // --- Stages 1..3: local refinement at 4× finer cells each time ---------------
  const spanU = Math.max(spanOf(boxA), spanOf(boxB));
  const LEVELS: Array<{ div: number; radius: number; maxCells: number }> = [
    { div: 64, radius: 6, maxCells: 100_000 },
    { div: 256, radius: 3, maxCells: 400_000 },
    { div: 1024, radius: 3, maxCells: 800_000 },
  ];
  let lastCell = spec0.cellSize;
  for (const { div, radius, maxCells } of LEVELS) {
    const cell = Math.max(spanU / div, 1e-4);
    const searchBox = unionBoundingBox(boxA, shiftBox(boxB, best));
    const margin = radius * cell;
    const spec = makeGridSpec(
      {
        minX: searchBox.minX - margin,
        minY: searchBox.minY - margin,
        maxX: searchBox.maxX + margin,
        maxY: searchBox.maxY + margin,
      },
      cell,
      maxCells,
    );
    // maxCells may have clamped the resolution; once it stops shrinking, stop.
    if (spec.cellSize >= lastCell && lastCell !== spec0.cellSize) break;
    const ch = rasterizeChannels(channels, spec, best);
    let bestDx = 0;
    let bestDy = 0;
    let levelBest = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const score = scoreShift(ch, dx, dy);
        if (score < levelBest) {
          levelBest = score;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    best = { x: best.x + bestDx * spec.cellSize, y: best.y + bestDy * spec.cellSize };
    lastCell = spec.cellSize;
  }

  // --- Exact refinement: snap to matching pad centers --------------------------
  const snapped = snapToPads(pairs, best, Math.max(3 * lastCell, 0.05));
  if (snapped) best = snapped;

  // --- Detection: does the offset meaningfully beat no-shift? ------------------
  const finalScore = scoreShift(
    ch0,
    Math.round(best.x / spec0.cellSize),
    Math.round(best.y / spec0.cellSize),
  );
  const moved = best.x !== 0 || best.y !== 0;
  const detected = moved && finalScore < zeroScore * 0.9;
  return { offset: detected ? best : { x: 0, y: 0 }, detected };
}

// ---------------------------------------------------------------------------
// Pad snap — pads carry exact coordinates, so once the grid search is within a
// few cells, the median delta between matched A/B pad centers gives a µm-exact
// offset. Median, not mean/least-squares: changed or unmatched pads are
// outliers and must not drag the fit.
// ---------------------------------------------------------------------------

const MAX_PADS = 4000;
const MIN_PAD_MATCHES = 5;

function padPoints(image: Image): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const stride = Math.max(1, Math.ceil(image.stats.padCount / MAX_PADS));
  let i = 0;
  for (const g of image.graphics) {
    if (g.kind !== 'pad') continue;
    if (i++ % stride === 0) pts.push({ x: g.x, y: g.y });
  }
  return pts;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function snapToPads(pairs: AlignPair[], offset: Offset, tol: number): Offset | null {
  const dxs: number[] = [];
  const dys: number[] = [];
  for (const p of pairs) {
    const aPads = padPoints(p.a);
    const bPads = padPoints(p.b);
    if (aPads.length === 0 || bPads.length === 0) continue;

    // Bucket B pads (pre-shifted by the search offset) for O(1) neighbor lookup.
    const buckets = new Map<string, Array<{ x: number; y: number }>>();
    const key = (cx: number, cy: number) => `${cx},${cy}`;
    for (const bp of bPads) {
      const x = bp.x + offset.x;
      const y = bp.y + offset.y;
      const k = key(Math.floor(x / tol), Math.floor(y / tol));
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push({ x, y });
    }

    for (const ap of aPads) {
      const cx = Math.floor(ap.x / tol);
      const cy = Math.floor(ap.y / tol);
      let nearest: { x: number; y: number } | null = null;
      let nearestD = tol * tol;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = buckets.get(key(cx + ox, cy + oy));
          if (!list) continue;
          for (const bp of list) {
            const d = (bp.x - ap.x) ** 2 + (bp.y - ap.y) ** 2;
            if (d < nearestD) {
              nearestD = d;
              nearest = bp;
            }
          }
        }
      }
      if (nearest) {
        dxs.push(ap.x - nearest.x);
        dys.push(ap.y - nearest.y);
      }
    }
  }
  if (dxs.length < MIN_PAD_MATCHES) return null;
  return { x: offset.x + median(dxs), y: offset.y + median(dys) };
}

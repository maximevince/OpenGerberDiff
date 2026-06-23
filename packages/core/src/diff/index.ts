/**
 * Per-direction coverage-area diff. Rasterizes A and B to a shared grid, classifies
 * each cell as common / added (B-only) / removed (A-only), suppresses sub-tolerance
 * noise via a morphological open, reports change in physical mm², and clusters the
 * changes into navigable regions. See docs/03 §4.
 */
import type { Image } from '../model/index.js';
import { unionBoundingBox, type BoundingBox } from '../model/index.js';
import { autoAlign, type Offset } from '../align/index.js';
import { cellAreaMm2, makeGridSpec, rasterize, type GridSpec } from '../raster/index.js';

export const EMPTY = 0;
export const COMMON = 1;
export const ADDED = 2;
export const REMOVED = 3;

export type ClassGrid = Uint8Array;

export interface DiffMetrics {
  addedMm2: number;
  removedMm2: number;
  commonMm2: number;
  changedMm2: number;
  netCopperMm2: number; // added - removed
  changedPct: number; // changed / (changed + common)
}

export interface ChangeRegion {
  id: number;
  bboxMm: BoundingBox;
  centroidMm: { x: number; y: number };
  areaMm2: number;
  cellCount: number;
  kind: 'added' | 'removed' | 'mixed';
}

export interface DiffResult {
  spec: GridSpec;
  classGrid: ClassGrid;
  metrics: DiffMetrics;
  clusters: ChangeRegion[];
  offset: Offset;
  alignDetected: boolean;
}

export interface DiffOptions {
  /** Target cell size in mm (subject to maxCells). Default 0.02 mm (20 µm). */
  cellSizeMm?: number;
  /** Ignore changes thinner than this (morphological open). Default 0.04 mm. */
  minFeatureMm?: number;
  /** Merge change regions whose bboxes are within this gap. Default 0.3 mm. */
  clusterGapMm?: number;
  maxCells?: number;
  /** 'auto' (default), 'none', or an explicit offset applied to B. */
  align?: 'auto' | 'none' | Offset;
}

export function diffImages(a: Image, b: Image, opts: DiffOptions = {}): DiffResult {
  const cellSizeMm = opts.cellSizeMm ?? 0.02;
  const minFeatureMm = opts.minFeatureMm ?? 0.04;
  const clusterGapMm = opts.clusterGapMm ?? 0.3;
  const maxCells = opts.maxCells ?? 6_000_000;

  let offset: Offset = { x: 0, y: 0 };
  let alignDetected = false;
  if (opts.align === 'auto' || opts.align === undefined) {
    const r = autoAlign(a, b);
    offset = r.offset;
    alignDetected = r.detected;
  } else if (opts.align !== 'none') {
    offset = opts.align;
  }

  const shiftedB: BoundingBox = {
    minX: b.boundingBox.minX + offset.x,
    minY: b.boundingBox.minY + offset.y,
    maxX: b.boundingBox.maxX + offset.x,
    maxY: b.boundingBox.maxY + offset.y,
  };
  const bbox = unionBoundingBox(a.boundingBox, shiftedB);
  const spec = makeGridSpec(bbox, cellSizeMm, maxCells);

  const gridA = rasterize(a, spec);
  const gridB = rasterize(b, spec, offset);

  const n = spec.cols * spec.rows;
  const classGrid: ClassGrid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const av = gridA[i]!;
    const bv = gridB[i]!;
    classGrid[i] = av && bv ? COMMON : !av && bv ? ADDED : av && !bv ? REMOVED : EMPTY;
  }

  // Suppress sub-tolerance noise: open the changed mask, demote opened-out cells.
  const radius = Math.round(minFeatureMm / spec.cellSize);
  if (radius >= 1) openChangedToCommon(classGrid, spec, radius);

  const cellArea = cellAreaMm2(spec);
  let added = 0;
  let removed = 0;
  let common = 0;
  for (let i = 0; i < n; i++) {
    const c = classGrid[i]!;
    if (c === ADDED) added++;
    else if (c === REMOVED) removed++;
    else if (c === COMMON) common++;
  }
  const addedMm2 = added * cellArea;
  const removedMm2 = removed * cellArea;
  const commonMm2 = common * cellArea;
  const changedMm2 = addedMm2 + removedMm2;
  const denom = changedMm2 + commonMm2;

  const metrics: DiffMetrics = {
    addedMm2,
    removedMm2,
    commonMm2,
    changedMm2,
    netCopperMm2: addedMm2 - removedMm2,
    changedPct: denom > 0 ? (changedMm2 / denom) * 100 : 0,
  };

  const clusters = clusterChanges(classGrid, spec, clusterGapMm);

  return { spec, classGrid, metrics, clusters, offset, alignDetected };
}

/** Hash of a class grid — for determinism tests. */
export function classGridHash(grid: ClassGrid): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < grid.length; i++) {
    h ^= grid[i]!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Morphological open on the changed mask (erode then dilate, square kernel).
// Cells that don't survive are demoted from ADDED/REMOVED to COMMON (treated as
// unchanged), so slivers from rounding don't count as real changes.
// ---------------------------------------------------------------------------

function openChangedToCommon(classGrid: ClassGrid, spec: GridSpec, r: number): void {
  const { cols, rows } = spec;
  const n = cols * rows;
  const changed = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    changed[i] = classGrid[i] === ADDED || classGrid[i] === REMOVED ? 1 : 0;

  const eroded = boxFilter(changed, cols, rows, r, 'min');
  const opened = boxFilter(eroded, cols, rows, r, 'max');

  for (let i = 0; i < n; i++) {
    if (changed[i] === 1 && opened[i] === 0) classGrid[i] = COMMON;
  }
}

function boxFilter(
  src: Uint8Array,
  cols: number,
  rows: number,
  r: number,
  mode: 'min' | 'max',
): Uint8Array {
  // Separable: horizontal pass then vertical pass.
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const reduce = mode === 'min' ? Math.min : Math.max;
  const init = mode === 'min' ? 1 : 0;
  for (let y = 0; y < rows; y++) {
    const base = y * cols;
    for (let x = 0; x < cols; x++) {
      let v = init;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= cols) {
          if (mode === 'min') {
            v = 0;
            break;
          }
          continue;
        }
        v = reduce(v, src[base + xx]!);
      }
      tmp[base + x] = v;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let v = init;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) {
          if (mode === 'min') {
            v = 0;
            break;
          }
          continue;
        }
        v = reduce(v, tmp[yy * cols + x]!);
      }
      out[y * cols + x] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Connected-component clustering of changed cells (8-connected), then merge
// nearby clusters and convert to world coordinates.
// ---------------------------------------------------------------------------

interface RawCluster {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
  cellCount: number;
  sumCol: number;
  sumRow: number;
  added: number;
  removed: number;
}

function clusterChanges(
  classGrid: ClassGrid,
  spec: GridSpec,
  clusterGapMm: number,
): ChangeRegion[] {
  const { cols, rows } = spec;
  const n = cols * rows;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const raw: RawCluster[] = [];

  const isChanged = (i: number) => classGrid[i] === ADDED || classGrid[i] === REMOVED;

  for (let start = 0; start < n; start++) {
    if (seen[start] || !isChanged(start)) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    const cl: RawCluster = {
      minCol: cols,
      minRow: rows,
      maxCol: -1,
      maxRow: -1,
      cellCount: 0,
      sumCol: 0,
      sumRow: 0,
      added: 0,
      removed: 0,
    };
    while (stack.length) {
      const i = stack.pop()!;
      const col = i % cols;
      const row = (i - col) / cols;
      cl.cellCount++;
      cl.sumCol += col;
      cl.sumRow += row;
      if (classGrid[i] === ADDED) cl.added++;
      else cl.removed++;
      if (col < cl.minCol) cl.minCol = col;
      if (col > cl.maxCol) cl.maxCol = col;
      if (row < cl.minRow) cl.minRow = row;
      if (row > cl.maxRow) cl.maxRow = row;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nc = col + dx;
          const nr = row + dy;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (!seen[ni] && isChanged(ni)) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    raw.push(cl);
  }

  const merged = mergeRaw(raw, clusterGapMm / spec.cellSize);
  merged.sort((a, b) => b.cellCount - a.cellCount);

  const cellArea = cellAreaMm2(spec);
  return merged.map((cl, idx) => {
    const toWorldX = (c: number) => spec.originX + c * spec.cellSize;
    const toWorldY = (r: number) => spec.originY + r * spec.cellSize;
    return {
      id: idx + 1,
      bboxMm: {
        minX: toWorldX(cl.minCol),
        minY: toWorldY(cl.minRow),
        maxX: toWorldX(cl.maxCol + 1),
        maxY: toWorldY(cl.maxRow + 1),
      },
      centroidMm: {
        x: toWorldX(cl.sumCol / cl.cellCount + 0.5),
        y: toWorldY(cl.sumRow / cl.cellCount + 0.5),
      },
      areaMm2: cl.cellCount * cellArea,
      cellCount: cl.cellCount,
      kind: cl.added > 0 && cl.removed > 0 ? 'mixed' : cl.added > 0 ? 'added' : 'removed',
    } satisfies ChangeRegion;
  });
}

function mergeRaw(raw: RawCluster[], gapCells: number): RawCluster[] {
  const clusters = raw.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (near(clusters[i]!, clusters[j]!, gapCells)) {
          clusters[i] = combine(clusters[i]!, clusters[j]!);
          clusters.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return clusters;
}

function near(a: RawCluster, b: RawCluster, gap: number): boolean {
  const dx = Math.max(0, Math.max(a.minCol - b.maxCol, b.minCol - a.maxCol));
  const dy = Math.max(0, Math.max(a.minRow - b.maxRow, b.minRow - a.maxRow));
  return dx <= gap && dy <= gap;
}

function combine(a: RawCluster, b: RawCluster): RawCluster {
  return {
    minCol: Math.min(a.minCol, b.minCol),
    minRow: Math.min(a.minRow, b.minRow),
    maxCol: Math.max(a.maxCol, b.maxCol),
    maxRow: Math.max(a.maxRow, b.maxRow),
    cellCount: a.cellCount + b.cellCount,
    sumCol: a.sumCol + b.sumCol,
    sumRow: a.sumRow + b.sumRow,
    added: a.added + b.added,
    removed: a.removed + b.removed,
  };
}

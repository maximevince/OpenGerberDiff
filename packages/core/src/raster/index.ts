/**
 * Deterministic coverage rasterizer — pure compute, no canvas. Renders an Image's
 * copper to a fixed world-space grid (cells of known physical size). Because it is
 * deterministic and AA-free, identical geometry yields identical grids → zero
 * false diff. Runs in a browser worker AND in Node (CLI). See docs/03 §4.1.
 */
import type { Image, PathSegment, ShapePrimitive } from '../model/index.js';
import { isFiniteBoundingBox, type BoundingBox } from '../model/index.js';

export interface GridSpec {
  /** World mm of the (col=0,row=0) cell's min corner. */
  originX: number;
  originY: number;
  /** Cell edge length in mm. */
  cellSize: number;
  cols: number;
  rows: number;
}

const TWO_PI = Math.PI * 2;
const ARC_STEP = Math.PI / 48;
const DEFAULT_MAX_CELLS = 6_000_000;

/** Cell occupancy grid: 1 = copper, 0 = empty. */
export type OccupancyGrid = Uint8Array;

export function cellAreaMm2(spec: GridSpec): number {
  return spec.cellSize * spec.cellSize;
}

/**
 * Build a grid spec covering `bbox` (mm) at `cellSizeMm`, with a 2-cell margin.
 * If that exceeds `maxCells`, the cell size is grown to fit (coarser but bounded).
 */
export function makeGridSpec(
  bbox: BoundingBox,
  cellSizeMm: number,
  maxCells = DEFAULT_MAX_CELLS,
): GridSpec {
  if (!isFiniteBoundingBox(bbox) || !(cellSizeMm > 0)) {
    return { originX: 0, originY: 0, cellSize: cellSizeMm > 0 ? cellSizeMm : 1, cols: 1, rows: 1 };
  }
  let cs = cellSizeMm;
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  let cols = Math.ceil(width / cs) + 4;
  let rows = Math.ceil(height / cs) + 4;
  if (cols * rows > maxCells) {
    const scale = Math.sqrt((cols * rows) / maxCells);
    cs *= scale;
    cols = Math.ceil(width / cs) + 4;
    rows = Math.ceil(height / cs) + 4;
  }
  return { originX: bbox.minX - 2 * cs, originY: bbox.minY - 2 * cs, cellSize: cs, cols, rows };
}

/** Rasterize an image to an occupancy grid, optionally translated by `offset` (mm). */
export function rasterize(image: Image, spec: GridSpec, offset = { x: 0, y: 0 }): OccupancyGrid {
  const grid = new Uint8Array(spec.cols * spec.rows);
  const ox = offset.x;
  const oy = offset.y;

  for (const g of image.graphics) {
    const value = g.polarity === 'clear' ? 0 : 1;
    if (g.kind === 'pad') {
      const shape = image.tools.get(g.tool);
      if (shape) rasterizePad(grid, spec, shape, g.x + ox, g.y + oy, value);
    } else if (g.kind === 'stroke') {
      const r = Math.max(g.width / 2, spec.cellSize * 0.25);
      eachLineSegment(g.path, (ax, ay, bx, by) =>
        capsule(grid, spec, ax + ox, ay + oy, bx + ox, by + oy, r, value),
      );
    } else {
      fillPolygon(grid, spec, regionPolygon(g.path, ox, oy), value);
    }
  }
  return grid;
}

function rasterizePad(
  grid: OccupancyGrid,
  spec: GridSpec,
  shape: ShapePrimitive[],
  x: number,
  y: number,
  baseValue: number,
): void {
  let value = baseValue;
  for (const prim of shape) {
    switch (prim.type) {
      case 'layer':
        value = prim.polarity === 'clear' ? 0 : baseValue;
        break;
      case 'circle':
        disk(grid, spec, x + prim.cx, y + prim.cy, prim.r, value);
        break;
      case 'rect':
        fillPolygon(
          grid,
          spec,
          rectPolygon(x + prim.cx, y + prim.cy, prim.width, prim.height),
          value,
        );
        break;
      case 'poly':
        fillPolygon(
          grid,
          spec,
          prim.points.map(([px, py]) => [x + px, y + py] as [number, number]),
          value,
        );
        break;
      case 'ring':
        annulus(
          grid,
          spec,
          x + prim.cx,
          y + prim.cy,
          Math.max(prim.r - prim.width / 2, 0),
          prim.r + prim.width / 2,
          value,
        );
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Grid fills. A cell is occupied iff its center falls inside the shape — exact,
// deterministic, no anti-aliasing.
// ---------------------------------------------------------------------------

function fillSpan(
  grid: OccupancyGrid,
  cols: number,
  row: number,
  xa: number,
  xb: number,
  value: number,
): void {
  const c0 = Math.max(0, Math.ceil(xa - 0.5));
  const c1 = Math.min(cols - 1, Math.floor(xb - 0.5));
  const base = row * cols;
  for (let c = c0; c <= c1; c++) grid[base + c] = value;
}

function rectPolygon(cx: number, cy: number, w: number, h: number): Array<[number, number]> {
  const hw = w / 2;
  const hh = h / 2;
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
}

function regionPolygon(path: PathSegment[], ox: number, oy: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (path.length === 0) return pts;
  pts.push([path[0]!.start[0] + ox, path[0]!.start[1] + oy]);
  eachLineSegment(path, (_ax, _ay, bx, by) => pts.push([bx + ox, by + oy]));
  return pts;
}

/** Even-odd scanline fill; samples each cell at its center. */
function fillPolygon(
  grid: OccupancyGrid,
  spec: GridSpec,
  worldPts: Array<[number, number]>,
  value: number,
): void {
  if (worldPts.length < 3) return;
  const { originX, originY, cellSize, cols, rows } = spec;
  const n = worldPts.length;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (let i = 0; i < n; i++) {
    xs[i] = (worldPts[i]![0] - originX) / cellSize;
    ys[i] = (worldPts[i]![1] - originY) / cellSize;
    if (ys[i]! < minRow) minRow = ys[i]!;
    if (ys[i]! > maxRow) maxRow = ys[i]!;
  }
  const r0 = Math.max(0, Math.floor(minRow));
  const r1 = Math.min(rows - 1, Math.ceil(maxRow));
  const xints: number[] = [];
  for (let row = r0; row <= r1; row++) {
    const cy = row + 0.5;
    xints.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ys[i]!;
      const yj = ys[j]!;
      if (yi <= cy === yj <= cy) continue;
      const t = (cy - yi) / (yj - yi);
      xints.push(xs[i]! + t * (xs[j]! - xs[i]!));
    }
    if (xints.length < 2) continue;
    xints.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xints.length; k += 2) {
      fillSpan(grid, cols, row, xints[k]!, xints[k + 1]!, value);
    }
  }
}

function disk(
  grid: OccupancyGrid,
  spec: GridSpec,
  cxw: number,
  cyw: number,
  rw: number,
  value: number,
): void {
  const { originX, originY, cellSize, cols, rows } = spec;
  const cx = (cxw - originX) / cellSize;
  const cy = (cyw - originY) / cellSize;
  const r = rw / cellSize;
  if (r <= 0) return;
  const r0 = Math.max(0, Math.ceil(cy - r - 0.5));
  const r1 = Math.min(rows - 1, Math.floor(cy + r - 0.5));
  for (let row = r0; row <= r1; row++) {
    const dy = row + 0.5 - cy;
    const dx = Math.sqrt(Math.max(r * r - dy * dy, 0));
    fillSpan(grid, cols, row, cx - dx, cx + dx, value);
  }
}

function annulus(
  grid: OccupancyGrid,
  spec: GridSpec,
  cxw: number,
  cyw: number,
  innerW: number,
  outerW: number,
  value: number,
): void {
  const { originX, originY, cellSize, cols, rows } = spec;
  const cx = (cxw - originX) / cellSize;
  const cy = (cyw - originY) / cellSize;
  const ro = outerW / cellSize;
  const ri = innerW / cellSize;
  if (ro <= 0) return;
  const r0 = Math.max(0, Math.ceil(cy - ro - 0.5));
  const r1 = Math.min(rows - 1, Math.floor(cy + ro - 0.5));
  for (let row = r0; row <= r1; row++) {
    const dy = row + 0.5 - cy;
    const dxo = Math.sqrt(Math.max(ro * ro - dy * dy, 0));
    if (ri > 0 && Math.abs(dy) < ri) {
      const dxi = Math.sqrt(Math.max(ri * ri - dy * dy, 0));
      fillSpan(grid, cols, row, cx - dxo, cx - dxi, value);
      fillSpan(grid, cols, row, cx + dxi, cx + dxo, value);
    } else {
      fillSpan(grid, cols, row, cx - dxo, cx + dxo, value);
    }
  }
}

/** A stroked segment = oriented rectangle + round caps (two disks). */
function capsule(
  grid: OccupancyGrid,
  spec: GridSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rw: number,
  value: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len > 1e-12) {
    const nx = (-dy / len) * rw;
    const ny = (dx / len) * rw;
    fillPolygon(
      grid,
      spec,
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
      value,
    );
  }
  disk(grid, spec, ax, ay, rw, value);
  disk(grid, spec, bx, by, rw, value);
}

function eachLineSegment(
  path: PathSegment[],
  cb: (ax: number, ay: number, bx: number, by: number) => void,
): void {
  for (const seg of path) {
    if (seg.type === 'line') {
      cb(seg.start[0], seg.start[1], seg.end[0], seg.end[1]);
    } else {
      const [cx, cy] = seg.center;
      const a0 = Math.atan2(seg.start[1] - cy, seg.start[0] - cx);
      const a1 = Math.atan2(seg.end[1] - cy, seg.end[0] - cx);
      let delta = a1 - a0;
      if (seg.dir === 'ccw') {
        while (delta <= 0) delta += TWO_PI;
      } else {
        while (delta >= 0) delta -= TWO_PI;
      }
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / ARC_STEP));
      let px = seg.start[0];
      let py = seg.start[1];
      for (let i = 1; i <= steps; i++) {
        const a = a0 + (delta * i) / steps;
        const qx = cx + seg.radius * Math.cos(a);
        const qy = cy + seg.radius * Math.sin(a);
        cb(px, py, qx, qy);
        px = qx;
        py = qy;
      }
    }
  }
}

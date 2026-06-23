/**
 * Vectorize a cell-class grid into rectilinear world-space polygons by tracing
 * the boundary between cells matching a target class and everything else.
 *
 * Pure compute, deterministic, no canvas. Each filled region becomes one or more
 * closed loops (outer boundary plus holes); the renderer fills them with an
 * even-odd rule. Because the contours are real vector geometry, the diff overlay
 * stays crisp at any zoom — unlike blitting the grid as a scaled bitmap. The grid
 * remains the source of truth for area/clustering; this only affects display.
 */
import type { GridSpec } from '../raster/index.js';

/** Closed loop of world-mm points (first point is NOT repeated at the end). */
export type ContourLoop = Array<[number, number]>;

/**
 * Trace the outline of all cells equal to `classValue`. Returns a flat list of
 * closed loops in world mm: outer boundaries wind CCW, holes CW, so filling the
 * whole set with the even-odd rule reproduces the occupied cells exactly.
 */
export function contourGrid(
  classGrid: Uint8Array,
  spec: GridSpec,
  classValue: number,
): ContourLoop[] {
  const { cols, rows, originX, originY, cellSize } = spec;
  const stride = cols + 1; // lattice of cell corners is (cols+1) x (rows+1)
  const inside = (c: number, r: number): boolean =>
    c >= 0 && c < cols && r >= 0 && r < rows && classGrid[r * cols + c] === classValue;

  // Collect directed boundary edges with the interior on their LEFT (CCW around
  // filled regions). Key each edge by its start corner so loops can be stitched.
  const vid = (vx: number, vy: number): number => vy * stride + vx;
  const outEdges = new Map<number, number[]>();
  const addEdge = (sx: number, sy: number, ex: number, ey: number): void => {
    const k = vid(sx, sy);
    let arr = outEdges.get(k);
    if (!arr) outEdges.set(k, (arr = []));
    arr.push(vid(ex, ey));
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (classGrid[r * cols + c] !== classValue) continue;
      if (!inside(c, r - 1)) addEdge(c, r, c + 1, r); // bottom →+x
      if (!inside(c + 1, r)) addEdge(c + 1, r, c + 1, r + 1); // right  →+y
      if (!inside(c, r + 1)) addEdge(c + 1, r + 1, c, r + 1); // top    →-x
      if (!inside(c - 1, r)) addEdge(c, r + 1, c, r); // left   →-y
    }
  }

  const loops: ContourLoop[] = [];
  const worldX = (vx: number): number => originX + vx * cellSize;
  const worldY = (vy: number): number => originY + vy * cellSize;

  for (const [startK, ends] of outEdges) {
    // A corner may start several edges (checkerboard touch points); drain them all.
    while (ends.length) {
      const corners: number[] = [startK];
      let next = ends.pop()!;
      // Follow start→end until we return to the loop's start corner.
      while (next !== startK) {
        corners.push(next);
        const arr = outEdges.get(next);
        if (!arr || arr.length === 0) break; // defensive: closed boundary shouldn't hit this
        next = arr.pop()!;
      }
      const loop = collapseCollinear(corners, stride, worldX, worldY);
      if (loop.length >= 3) loops.push(loop);
    }
  }

  return loops;
}

/** Drop interior points that lie on a straight (axis-aligned) run. */
function collapseCollinear(
  corners: number[],
  stride: number,
  worldX: (vx: number) => number,
  worldY: (vy: number) => number,
): ContourLoop {
  const n = corners.length;
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    px[i] = corners[i]! % stride;
    py[i] = (corners[i]! - px[i]!) / stride;
  }
  const out: ContourLoop = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    // collinear iff the same axis is constant across prev→cur→next
    const collinear =
      (px[prev] === px[i] && px[i] === px[next]) || (py[prev] === py[i] && py[i] === py[next]);
    if (!collinear) out.push([worldX(px[i]!), worldY(py[i]!)]);
  }
  return out;
}

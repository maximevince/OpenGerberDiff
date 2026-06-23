import type { Image, PathSegment, ShapePrimitive } from '@ogd/core';
import type { Viewport } from './viewport.js';

export interface RenderStyle {
  background: string;
  /** Copper color. */
  color: string;
}

const TWO_PI = Math.PI * 2;
const ARC_STEP = Math.PI / 48; // tessellation granularity

/**
 * Render a parsed Image to a 2D context. Geometry is drawn in world space (mm,
 * Y-up) via a flipped transform; arcs are tessellated to polylines so direction
 * is correct regardless of the flip. Clear polarity erases (destination-out);
 * the background is composited behind everything at the end.
 */
export function renderImage(
  ctx: CanvasRenderingContext2D,
  image: Image,
  vp: Viewport,
  style: RenderStyle,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, vp.width, vp.height);

  ctx.save();
  ctx.setTransform(vp.zoom, 0, 0, -vp.zoom, vp.panX, vp.panY);
  drawImageGeometry(ctx, image, style.color);
  ctx.restore();

  compositeBackground(ctx, vp, style.background);
}

export interface RenderLayer {
  image: Image;
  color: string;
  visible: boolean;
}

/**
 * Composite a stack of layers (bottom-first) into one view. Each layer is drawn
 * on its own offscreen so clear-polarity erases only within that layer, then
 * blitted over the previous ones; the background is painted last.
 */
export function renderLayers(
  ctx: CanvasRenderingContext2D,
  layers: RenderLayer[],
  vp: Viewport,
  background: string,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, vp.width, vp.height);

  const off = getOffscreen(vp.width, vp.height);
  const octx = off.ctx;
  for (const layer of layers) {
    if (!layer.visible) continue;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.clearRect(0, 0, vp.width, vp.height);
    octx.save();
    octx.setTransform(vp.zoom, 0, 0, -vp.zoom, vp.panX, vp.panY);
    drawImageGeometry(octx, layer.image, layer.color);
    octx.restore();
    ctx.drawImage(off.canvas, 0, 0);
  }

  compositeBackground(ctx, vp, background);
}

/** Draw an image's geometry in the current (already-set) world transform. */
function drawImageGeometry(ctx: CanvasRenderingContext2D, image: Image, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const g of image.graphics) {
    ctx.globalCompositeOperation = g.polarity === 'clear' ? 'destination-out' : 'source-over';
    if (g.kind === 'pad') drawPad(ctx, image.tools.get(g.tool), g.x, g.y);
    else if (g.kind === 'stroke') drawStroke(ctx, g.path, g.width);
    else drawFill(ctx, g.path);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function compositeBackground(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  background: string,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.globalCompositeOperation = 'source-over';
}

interface Offscreen {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D;
}
let offscreen: (Offscreen & { w: number; h: number }) | null = null;

function getOffscreen(w: number, h: number): Offscreen {
  if (!offscreen || offscreen.w !== w || offscreen.h !== h) {
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    offscreen = { canvas, ctx, w, h };
  }
  return offscreen;
}

function drawPad(
  ctx: CanvasRenderingContext2D,
  shape: ShapePrimitive[] | undefined,
  x: number,
  y: number,
): void {
  if (!shape) return;
  const prevOp = ctx.globalCompositeOperation;
  for (const prim of shape) {
    switch (prim.type) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(x + prim.cx, y + prim.cy, Math.max(prim.r, 0), 0, TWO_PI);
        ctx.fill();
        break;
      case 'rect': {
        const w = prim.width;
        const h = prim.height;
        ctx.beginPath();
        roundRect(
          ctx,
          x + prim.cx - w / 2,
          y + prim.cy - h / 2,
          w,
          h,
          Math.min(prim.r, w / 2, h / 2),
        );
        ctx.fill();
        break;
      }
      case 'poly':
        if (prim.points.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(x + prim.points[0]![0], y + prim.points[0]![1]);
          for (let i = 1; i < prim.points.length; i++) {
            ctx.lineTo(x + prim.points[i]![0], y + prim.points[i]![1]);
          }
          ctx.closePath();
          ctx.fill('evenodd');
        }
        break;
      case 'ring': {
        const outer = prim.r + prim.width / 2;
        const inner = Math.max(prim.r - prim.width / 2, 0);
        ctx.beginPath();
        ctx.arc(x + prim.cx, y + prim.cy, outer, 0, TWO_PI);
        ctx.arc(x + prim.cx, y + prim.cy, inner, 0, TWO_PI, true);
        ctx.fill('evenodd');
        break;
      }
      case 'layer':
        // Exposure toggle inside a macro: clear punches a hole, dark adds.
        ctx.globalCompositeOperation = prim.polarity === 'clear' ? 'destination-out' : prevOp;
        break;
    }
  }
  ctx.globalCompositeOperation = prevOp;
}

function drawStroke(ctx: CanvasRenderingContext2D, path: PathSegment[], width: number): void {
  if (path.length === 0) return;
  ctx.lineWidth = Math.max(width, 1e-4);
  ctx.beginPath();
  tracePath(ctx, path);
  ctx.stroke();
}

function drawFill(ctx: CanvasRenderingContext2D, path: PathSegment[]): void {
  if (path.length === 0) return;
  ctx.beginPath();
  tracePath(ctx, path);
  ctx.closePath();
  ctx.fill('evenodd');
}

// Largest gap (mm) between a segment's start and the running point that still
// counts as "connected". The plotter emits contiguous endpoints bit-identical,
// so this only needs to be tiny.
const GAP_EPS = 1e-7;

function tracePath(ctx: CanvasRenderingContext2D, path: PathSegment[]): void {
  for (const sub of toSubpaths(path)) {
    if (sub.length === 0) continue;
    ctx.moveTo(sub[0]![0], sub[0]![1]);
    for (let i = 1; i < sub.length; i++) ctx.lineTo(sub[i]![0], sub[i]![1]);
  }
}

/**
 * Split a path into connected subpaths (polylines), tessellating arcs. Crucially,
 * the plotter coalesces all same-aperture draws into ONE path with *disjoint*
 * subpaths (pen-up moves between separate traces), so we must break a new subpath
 * wherever a segment doesn't continue from the previous point — otherwise gaps
 * get bridged by spurious lines ("traces all over the place"). Exported for tests.
 */
export function toSubpaths(path: PathSegment[]): Array<Array<[number, number]>> {
  const subs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> | null = null;
  let cx = NaN;
  let cy = NaN;
  for (const seg of path) {
    const sx = seg.start[0];
    const sy = seg.start[1];
    if (cur === null || !(Math.abs(sx - cx) <= GAP_EPS && Math.abs(sy - cy) <= GAP_EPS)) {
      cur = [[sx, sy]];
      subs.push(cur);
    }
    if (seg.type === 'line') {
      cur.push([seg.end[0], seg.end[1]]);
    } else {
      for (const p of arcPoints(seg)) cur.push(p);
    }
    cx = seg.end[0];
    cy = seg.end[1];
  }
  return subs;
}

/** Tessellate an arc segment into points after its start, ending at its end. */
function arcPoints(seg: Extract<PathSegment, { type: 'arc' }>): Array<[number, number]> {
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
  const out: Array<[number, number]> = [];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (delta * i) / steps;
    out.push([cx + seg.radius * Math.cos(a), cy + seg.radius * Math.sin(a)]);
  }
  return out;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderStyleFromColors(color: string, background: string): RenderStyle {
  return { color, background };
}

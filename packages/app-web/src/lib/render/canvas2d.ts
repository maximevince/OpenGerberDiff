import type { Image, PathSegment, ShapePrimitive } from '@ogd/core';
import type { Viewport } from './viewport.js';

export interface RenderStyle {
  background: string;
  color: string;
}

export interface RenderLayer {
  image: Image;
  color: string;
  visible: boolean;
}

const TWO_PI = Math.PI * 2;
const ARC_STEP = Math.PI / 48;

// ---------------------------------------------------------------------------
// Compiled layers — geometry is walked ONCE into Path2D objects (in world mm)
// and cached per Image. Each frame only sets the transform and fills/strokes the
// prebuilt paths, so pan/zoom no longer re-tessellate anything.
// ---------------------------------------------------------------------------

type FillOp = { kind: 'fill'; clear: boolean; rule: CanvasFillRule; path: Path2D };
type StrokeOp = { kind: 'stroke'; clear: boolean; width: number; path: Path2D };
type LayerOp = FillOp | StrokeOp;

interface CompiledImage {
  ops: LayerOp[];
  hasClear: boolean;
}

const compileCache = new WeakMap<Image, CompiledImage>();

function compiledFor(image: Image): CompiledImage {
  let c = compileCache.get(image);
  if (!c) {
    c = compileImage(image);
    compileCache.set(image, c);
  }
  return c;
}

function compileImage(image: Image): CompiledImage {
  const ops: LayerOp[] = [];
  let cur: LayerOp | null = null;
  const flush = () => {
    if (cur) {
      ops.push(cur);
      cur = null;
    }
  };
  const fillInto = (clear: boolean, rule: CanvasFillRule): Path2D => {
    if (cur && cur.kind === 'fill' && cur.clear === clear && cur.rule === rule) return cur.path;
    flush();
    const path = new Path2D();
    cur = { kind: 'fill', clear, rule, path };
    return path;
  };
  const strokeInto = (clear: boolean, width: number): Path2D => {
    if (cur && cur.kind === 'stroke' && cur.clear === clear && cur.width === width) return cur.path;
    flush();
    const path = new Path2D();
    cur = { kind: 'stroke', clear, width, path };
    return path;
  };

  for (const g of image.graphics) {
    const clear = g.polarity === 'clear';
    if (g.kind === 'pad') {
      const shape = image.tools.get(g.tool);
      if (!shape) continue;
      if (shape.some((p) => p.type === 'layer')) {
        flush();
        compileMacroPad(ops, shape, g.x, g.y, clear);
      } else {
        for (const prim of shape) addPrimitive(fillInto, prim, g.x, g.y, clear);
      }
    } else if (g.kind === 'stroke') {
      const p = strokeInto(clear, g.width);
      for (const sub of toSubpaths(g.path)) addSubpath(p, sub, false);
    } else {
      const p = fillInto(clear, 'evenodd');
      for (const sub of toSubpaths(g.path)) addSubpath(p, sub, true);
    }
  }
  flush();

  return { ops, hasClear: ops.some((o) => o.clear) };
}

type FillProvider = (clear: boolean, rule: CanvasFillRule) => Path2D;

function addPrimitive(
  fillInto: FillProvider,
  prim: ShapePrimitive,
  x: number,
  y: number,
  clear: boolean,
): void {
  switch (prim.type) {
    case 'circle':
      circleSub(fillInto(clear, 'nonzero'), x + prim.cx, y + prim.cy, prim.r);
      break;
    case 'rect':
      roundRectSub(
        fillInto(clear, 'nonzero'),
        x + prim.cx - prim.width / 2,
        y + prim.cy - prim.height / 2,
        prim.width,
        prim.height,
        Math.min(prim.r, prim.width / 2, prim.height / 2),
      );
      break;
    case 'poly':
      if (prim.points.length >= 3) {
        const p = fillInto(clear, 'nonzero');
        p.moveTo(x + prim.points[0]![0], y + prim.points[0]![1]);
        for (let i = 1; i < prim.points.length; i++)
          p.lineTo(x + prim.points[i]![0], y + prim.points[i]![1]);
        p.closePath();
      }
      break;
    case 'ring': {
      const p = fillInto(clear, 'evenodd');
      circleSub(p, x + prim.cx, y + prim.cy, prim.r + prim.width / 2);
      circleSub(p, x + prim.cx, y + prim.cy, Math.max(prim.r - prim.width / 2, 0));
      break;
    }
    case 'layer':
      break; // handled by compileMacroPad
  }
}

/** Macro pad with internal exposure toggles — emit one op per primitive run. */
function compileMacroPad(
  ops: LayerOp[],
  shape: ShapePrimitive[],
  x: number,
  y: number,
  baseClear: boolean,
): void {
  let clear = baseClear;
  for (const prim of shape) {
    if (prim.type === 'layer') {
      clear = prim.polarity === 'clear' ? true : baseClear;
      continue;
    }
    const rule: CanvasFillRule = prim.type === 'ring' ? 'evenodd' : 'nonzero';
    const path = new Path2D();
    addPrimitive(() => path, prim, x, y, clear);
    ops.push({ kind: 'fill', clear, rule, path });
  }
}

function circleSub(path: Path2D, cx: number, cy: number, r: number): void {
  const rr = Math.max(r, 0);
  path.moveTo(cx + rr, cy);
  path.arc(cx, cy, rr, 0, TWO_PI);
}

function roundRectSub(path: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  if (r <= 0) {
    path.rect(x, y, w, h);
    return;
  }
  path.moveTo(x + r, y);
  path.arcTo(x + w, y, x + w, y + h, r);
  path.arcTo(x + w, y + h, x, y + h, r);
  path.arcTo(x, y + h, x, y, r);
  path.arcTo(x, y, x + w, y, r);
  path.closePath();
}

function addSubpath(path: Path2D, pts: Array<[number, number]>, close: boolean): void {
  if (pts.length === 0) return;
  path.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]![0], pts[i]![1]);
  if (close) path.closePath();
}

function drawCompiled(ctx: CanvasRenderingContext2D, comp: CompiledImage, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const op of comp.ops) {
    ctx.globalCompositeOperation = op.clear ? 'destination-out' : 'source-over';
    if (op.kind === 'fill') ctx.fill(op.path, op.rule);
    else {
      ctx.lineWidth = Math.max(op.width, 1e-4);
      ctx.stroke(op.path);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// Public render entry points
// ---------------------------------------------------------------------------

export function renderImage(
  ctx: CanvasRenderingContext2D,
  image: Image,
  vp: Viewport,
  style: RenderStyle,
): void {
  renderLayers(ctx, [{ image, color: style.color, visible: true }], vp, style.background);
}

/** Composite a stack of layers (bottom-first) into one view. */
export function renderLayers(
  ctx: CanvasRenderingContext2D,
  layers: RenderLayer[],
  vp: Viewport,
  background: string,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, vp.width, vp.height);

  let off: Offscreen | null = null;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const comp = compiledFor(layer.image);
    if (comp.hasClear) {
      // Isolate clear-polarity on an offscreen so it only erases within the layer.
      off ??= getOffscreen(vp.width, vp.height);
      off.ctx.setTransform(1, 0, 0, 1, 0, 0);
      off.ctx.globalCompositeOperation = 'source-over';
      off.ctx.clearRect(0, 0, vp.width, vp.height);
      off.ctx.setTransform(vp.zoom, 0, 0, -vp.zoom, vp.panX, vp.panY);
      drawCompiled(off.ctx, comp, layer.color);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off.canvas, 0, 0);
    } else {
      // No clears → paint straight onto the main canvas (skips the blit).
      ctx.setTransform(vp.zoom, 0, 0, -vp.zoom, vp.panX, vp.panY);
      drawCompiled(ctx, comp, layer.color);
    }
  }

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

// ---------------------------------------------------------------------------
// Path flattening (shared by compile + tests)
// ---------------------------------------------------------------------------

const GAP_EPS = 1e-7;

/**
 * Split a path into connected subpaths, tessellating arcs. The plotter coalesces
 * same-aperture draws into ONE path with disjoint subpaths (pen-up moves), so we
 * break a fresh subpath wherever a segment doesn't continue from the previous
 * point — otherwise gaps get bridged by spurious lines. Exported for tests.
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

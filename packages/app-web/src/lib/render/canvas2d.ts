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
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const g of image.graphics) {
    ctx.globalCompositeOperation = g.polarity === 'clear' ? 'destination-out' : 'source-over';
    if (g.kind === 'pad') drawPad(ctx, image.tools.get(g.tool), g.x, g.y);
    else if (g.kind === 'stroke') drawStroke(ctx, g.path, g.width);
    else drawFill(ctx, g.path);
  }
  ctx.restore();

  // Paint the background behind the drawn copper.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.globalCompositeOperation = 'source-over';
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
  const pts = polyline(path);
  if (pts.length < 2) {
    // a zero-length stroke = a round dot of `width` diameter
    if (pts.length === 1 && width > 0) {
      ctx.beginPath();
      ctx.arc(pts[0]![0], pts[0]![1], width / 2, 0, TWO_PI);
      ctx.fill();
    }
    return;
  }
  ctx.lineWidth = Math.max(width, 1e-4);
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
}

function drawFill(ctx: CanvasRenderingContext2D, path: PathSegment[]): void {
  const pts = polyline(path);
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fill('evenodd');
}

/** Flatten a path (lines + arcs) into a polyline of world points. */
function polyline(path: PathSegment[]): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (path.length === 0) return pts;
  pts.push([path[0]!.start[0], path[0]!.start[1]]);
  for (const seg of path) {
    if (seg.type === 'line') {
      pts.push([seg.end[0], seg.end[1]]);
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
      for (let i = 1; i <= steps; i++) {
        const a = a0 + (delta * i) / steps;
        pts.push([cx + seg.radius * Math.cos(a), cy + seg.radius * Math.sin(a)]);
      }
    }
  }
  return pts;
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

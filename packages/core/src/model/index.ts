/**
 * OGD core geometry model — the single contract every subsystem depends on.
 *
 * The parser adapter (`core/parse`) produces this from `@tracespace` v4 plotter
 * output; the rasterizer, diff, classifier, renderer, and report consume ONLY
 * this. The parser is therefore swappable without downstream churn.
 *
 * The model deliberately mirrors the plotter's "image graphics" abstraction
 * (tool shapes + pads + strokes + fills, modulated by polarity) because that is
 * already the natural input to a coverage rasterizer. Everything is normalized to
 * **millimetres**; display units are a pure UI formatting concern.
 *
 * See docs/03-proposed-architecture.md §3.
 */

export type Polarity = 'dark' | 'clear';

// ---------------------------------------------------------------------------
// Aperture shapes (a tool is a list of primitives; >1 / `layer` entries encode
// macros and clears — e.g. a donut is [circle, layer(clear), circle]).
// ---------------------------------------------------------------------------

export interface CirclePrimitive {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}
export interface RectPrimitive {
  type: 'rect';
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Corner radius (obround when r === min(width,height)/2). */
  r: number;
}
export interface PolyPrimitive {
  type: 'poly';
  points: ReadonlyArray<readonly [number, number]>;
}
export interface RingPrimitive {
  type: 'ring';
  cx: number;
  cy: number;
  r: number;
  width: number;
}
/** Exposure toggle inside a shape list (macro clear regions). */
export interface LayerPrimitive {
  type: 'layer';
  polarity: Polarity;
}

export type ShapePrimitive =
  | CirclePrimitive
  | RectPrimitive
  | PolyPrimitive
  | RingPrimitive
  | LayerPrimitive;

// ---------------------------------------------------------------------------
// Path segments (for strokes and region fills)
// ---------------------------------------------------------------------------

export interface LineSegment {
  type: 'line';
  start: readonly [number, number];
  end: readonly [number, number];
}
export interface ArcSegment {
  type: 'arc';
  start: readonly [number, number];
  end: readonly [number, number];
  center: readonly [number, number];
  radius: number;
  /** Sweep angle in radians (signed). */
  sweep: number;
  dir: 'cw' | 'ccw';
}
export type PathSegment = LineSegment | ArcSegment;

// ---------------------------------------------------------------------------
// Image graphics (the ordered draw operations)
// ---------------------------------------------------------------------------

export interface PadGraphic {
  id: number;
  kind: 'pad';
  /** Key into `Image.tools`. */
  tool: string;
  x: number;
  y: number;
  polarity: Polarity;
}
export interface StrokeGraphic {
  id: number;
  kind: 'stroke';
  width: number;
  path: PathSegment[];
  polarity: Polarity;
}
export interface FillGraphic {
  id: number;
  kind: 'fill';
  path: PathSegment[];
  polarity: Polarity;
}
export type Graphic = PadGraphic | StrokeGraphic | FillGraphic;

// ---------------------------------------------------------------------------
// Image (per-file parse result)
// ---------------------------------------------------------------------------

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type SourceFormat = 'gerber' | 'drill';

export interface ImageSource {
  fileName: string;
  format: SourceFormat;
  /** SHA-256 of the original bytes (lowercase hex) — identity + caching. */
  sha256: string;
}

export interface ImageStats {
  graphicCount: number;
  padCount: number;
  strokeCount: number;
  fillCount: number;
  /** Total copper area in mm² (computed by the rasterizer; 0 until then). */
  copperAreaMm2: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
}

export interface Image {
  source: ImageSource;
  /** Always 'mm' — the model is unit-normalized. */
  units: 'mm';
  tools: Map<string, ShapePrimitive[]>;
  graphics: Graphic[];
  boundingBox: BoundingBox;
  stats: ImageStats;
}

export interface ParseResult {
  image: Image;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Bounding-box helpers
// ---------------------------------------------------------------------------

export function emptyBoundingBox(): BoundingBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isFiniteBoundingBox(b: BoundingBox): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY) &&
    b.maxX >= b.minX &&
    b.maxY >= b.minY
  );
}

export function expandBoundingBox(b: BoundingBox, x: number, y: number, radius = 0): void {
  if (x - radius < b.minX) b.minX = x - radius;
  if (y - radius < b.minY) b.minY = y - radius;
  if (x + radius > b.maxX) b.maxX = x + radius;
  if (y + radius > b.maxY) b.maxY = y + radius;
}

export function unionBoundingBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundingBoxWidth(b: BoundingBox): number {
  return isFiniteBoundingBox(b) ? b.maxX - b.minX : 0;
}

export function boundingBoxHeight(b: BoundingBox): number {
  return isFiniteBoundingBox(b) ? b.maxY - b.minY : 0;
}

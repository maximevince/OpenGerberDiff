/**
 * OGD core geometry model — the single contract every subsystem depends on.
 *
 * The parser adapter (`core/parse`) produces this from `@tracespace` output; the
 * rasterizer, diff, classifier, renderer, and report all consume ONLY this. The
 * parser is therefore swappable without downstream churn.
 *
 * Units: ALL coordinates/dimensions are normalized to **millimetres**. Display
 * units are a pure formatting concern handled in the UI.
 *
 * See docs/03-proposed-architecture.md §3.
 */

// ---------------------------------------------------------------------------
// Enums (string-literal unions — serializable across the worker boundary)
// ---------------------------------------------------------------------------

export type ApertureState = 'off' | 'on' | 'flash';

export type Interpolation = 'linear' | 'cw' | 'ccw' | 'region_start' | 'region_end';

export type Polarity = 'dark' | 'clear';

export type ImagePolarity = 'positive' | 'negative';

export type ZeroOmission = 'leading' | 'trailing' | 'explicit';

export type CoordinateMode = 'absolute' | 'incremental';

export type SourceFormat = 'gerber' | 'gerber-x2' | 'excellon';

// ---------------------------------------------------------------------------
// Apertures
// ---------------------------------------------------------------------------

export interface CircleAperture {
  type: 'circle';
  diameter: number;
  holeDiameter?: number;
}
export interface RectangleAperture {
  type: 'rectangle';
  width: number;
  height: number;
  holeDiameter?: number;
}
export interface ObroundAperture {
  type: 'obround';
  width: number;
  height: number;
  holeDiameter?: number;
}
export interface PolygonAperture {
  type: 'polygon';
  outerDiameter: number;
  numVertices: number;
  rotation: number;
  holeDiameter?: number;
}
export interface MacroAperture {
  type: 'macro';
  /** Resolved macro primitive geometry, ready to stamp. */
  primitives: MacroPrimitive[];
}
export interface BlockAperture {
  type: 'block';
  nets: Net[];
  apertures: Map<number, Aperture>;
  boundingBox: BoundingBox;
}

export type Aperture =
  | CircleAperture
  | RectangleAperture
  | ObroundAperture
  | PolygonAperture
  | MacroAperture
  | BlockAperture;

/**
 * Flattened macro primitive (all coords in mm, exposure resolved). The adapter
 * evaluates macro expressions/variables so downstream code never re-parses.
 */
export interface MacroPrimitive {
  /** Whether this primitive adds (true) or clears (false) coverage. */
  exposure: boolean;
  /** Closed polygon outline in mm (already rotated/positioned). */
  polygon: ReadonlyArray<readonly [number, number]>;
}

// ---------------------------------------------------------------------------
// Nets (ordered draw operations)
// ---------------------------------------------------------------------------

export interface ArcSegment {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

export interface Net {
  /** Stable id assigned by the adapter (for diff cross-referencing / hit-test). */
  id: number;
  startX: number;
  startY: number;
  stopX: number;
  stopY: number;
  /** Key into `Image.apertures`. */
  apertureIndex: number;
  apertureState: ApertureState;
  interpolation: Interpolation;
  layerIndex: number;
  netStateIndex: number;
  arcSegment?: ArcSegment;
  /** From Gerber %TO object attributes. */
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Graphics-state snapshots
// ---------------------------------------------------------------------------

export interface StepAndRepeat {
  x: number;
  y: number;
  distX: number;
  distY: number;
}

export interface Layer {
  polarity: Polarity;
  rotation: number;
  name?: string;
  stepAndRepeat: StepAndRepeat;
}

export interface NetState {
  /** Original file unit (informational — coords are already mm). */
  unitWasInch: boolean;
}

// ---------------------------------------------------------------------------
// Image (per-file parse result)
// ---------------------------------------------------------------------------

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CoordinateFormat {
  zeroOmission: ZeroOmission;
  coordinateMode: CoordinateMode;
  xInteger: number;
  xDecimal: number;
  yInteger: number;
  yDecimal: number;
}

export interface ImageInfo {
  polarity: ImagePolarity;
  rotation: number;
  name?: string;
  attributes?: Record<string, string>;
}

export interface ImageSource {
  fileName: string;
  format: SourceFormat;
  /** SHA-256 of the original bytes (lowercase hex) — identity + caching. */
  sha256: string;
}

export interface ImageStats {
  netCount: number;
  flashCount: number;
  regionCount: number;
  /** Total copper area in mm² (precomputed during scan-conversion). */
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
  format: CoordinateFormat;
  info: ImageInfo;
  apertures: Map<number, Aperture>;
  nets: Net[];
  layers: Layer[];
  netStates: NetState[];
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

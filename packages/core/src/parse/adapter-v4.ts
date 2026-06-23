/**
 * Parser adapter — the ONLY module that imports `@tracespace` v4. It drives
 * `gerber-parser` → `gerber-plotter` and maps the plotter's "image graphics"
 * stream onto our normalized {@link Image} model (millimetres, stable ids).
 *
 * Swapping parsers (v5, a fork, Rust/WASM) means rewriting only this file.
 */
import gerberParser from 'gerber-parser';
import gerberPlotter from 'gerber-plotter';

import {
  emptyBoundingBox,
  type BoundingBox,
  type Diagnostic,
  type Graphic,
  type ImageSource,
  type ParseResult,
  type PathSegment,
  type Polarity,
  type ShapePrimitive,
} from '../model/index.js';
import { detectFormat } from './detect.js';

type Pt = readonly [number, number];

// Loose views of the v4 plot objects (see vendor-types.d.ts for the stream API).
interface PlotObject {
  type: string;
  [k: string]: unknown;
}

const MM_PER_INCH = 25.4;

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function scalePoint(p: unknown, s: number): Pt {
  const arr = Array.isArray(p) ? p : [0, 0];
  return [num(arr[0]) * s, num(arr[1]) * s];
}

function convertShape(raw: unknown, s: number, diagnostics: Diagnostic[]): ShapePrimitive[] {
  if (!Array.isArray(raw)) return [];
  const out: ShapePrimitive[] = [];
  for (const prim of raw as PlotObject[]) {
    switch (prim.type) {
      case 'circle':
        out.push({
          type: 'circle',
          cx: num(prim.cx) * s,
          cy: num(prim.cy) * s,
          r: num(prim.r) * s,
        });
        break;
      case 'rect':
        out.push({
          type: 'rect',
          cx: num(prim.cx) * s,
          cy: num(prim.cy) * s,
          width: num(prim.width) * s,
          height: num(prim.height) * s,
          r: num(prim.r) * s,
        });
        break;
      case 'poly':
        out.push({
          type: 'poly',
          points: (Array.isArray(prim.points) ? prim.points : []).map((p) => scalePoint(p, s)),
        });
        break;
      case 'ring':
        out.push({
          type: 'ring',
          cx: num(prim.cx) * s,
          cy: num(prim.cy) * s,
          r: num(prim.r) * s,
          width: num(prim.width) * s,
        });
        break;
      case 'layer':
        out.push({ type: 'layer', polarity: prim.polarity === 'clear' ? 'clear' : 'dark' });
        break;
      default:
        diagnostics.push({
          severity: 'warning',
          message: `Unsupported aperture primitive '${prim.type}' (skipped)`,
        });
    }
  }
  return out;
}

function convertPath(raw: unknown, s: number): PathSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: PathSegment[] = [];
  for (const seg of raw as PlotObject[]) {
    if (seg.type === 'arc') {
      out.push({
        type: 'arc',
        start: scalePoint(seg.start, s),
        end: scalePoint(seg.end, s),
        center: scalePoint(seg.center, s),
        radius: num(seg.radius) * s,
        sweep: num(seg.sweep),
        dir: seg.dir === 'cw' ? 'cw' : 'ccw',
      });
    } else {
      out.push({ type: 'line', start: scalePoint(seg.start, s), end: scalePoint(seg.end, s) });
    }
  }
  return out;
}

function translatePath(path: PathSegment[], dx: number, dy: number): PathSegment[] {
  if (dx === 0 && dy === 0) return path;
  const t = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  return path.map((seg) =>
    seg.type === 'arc'
      ? { ...seg, start: t(seg.start), end: t(seg.end), center: t(seg.center) }
      : { type: 'line', start: t(seg.start), end: t(seg.end) },
  );
}

/** Run the v4 pipeline and collect every plot object + warning. */
function runPlotter(
  content: string,
  filetype: 'gerber' | 'drill',
): Promise<{ objects: PlotObject[]; diagnostics: Diagnostic[] }> {
  return new Promise((resolve) => {
    const objects: PlotObject[] = [];
    const diagnostics: Diagnostic[] = [];
    const parser = gerberParser({ filetype });
    const plotter = gerberPlotter();

    const onWarn = (w: { message: string; line?: number }) =>
      diagnostics.push({ severity: 'warning', message: w.message, line: w.line });

    parser.on('warning', onWarn);
    plotter.on('warning', onWarn);
    parser.on('error', (err) => {
      diagnostics.push({ severity: 'error', message: `Parser error: ${err.message}` });
    });
    plotter.on('error', (err) => {
      diagnostics.push({ severity: 'error', message: `Plotter error: ${err.message}` });
      resolve({ objects, diagnostics });
    });

    parser.pipe(plotter);
    plotter.on('data', (o) => objects.push(o as PlotObject));
    plotter.on('end', () => resolve({ objects, diagnostics }));

    try {
      parser.write(content);
      parser.end();
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        message: `Parse threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      resolve({ objects, diagnostics });
    }
  });
}

export interface ParseInput {
  fileName: string;
  sha256: string;
}

/**
 * Parse Gerber/Excellon `content` into our normalized model. Never throws on bad
 * input — problems are returned as diagnostics.
 */
export async function parseImage(content: string, input: ParseInput): Promise<ParseResult> {
  const format = detectFormat(input.fileName, content);
  const { objects, diagnostics } = await runPlotter(content, format);

  // Units come from the final `size` object; everything is scaled to mm.
  const sizeObj = objects.find((o) => o.type === 'size');
  const unitsIn = (sizeObj?.units as string | undefined) === 'in';
  const s = unitsIn ? MM_PER_INCH : 1;

  const tools = new Map<string, ShapePrimitive[]>();
  const graphics: Graphic[] = [];
  let polarity: Polarity = 'dark';
  let repeatOffsets: Pt[] | null = null;
  let nextId = 0;

  const offsets = (): Pt[] => repeatOffsets ?? [[0, 0]];

  for (const o of objects) {
    switch (o.type) {
      case 'shape':
        tools.set(String(o.tool), convertShape(o.shape, s, diagnostics));
        break;
      case 'polarity':
        polarity = o.polarity === 'clear' ? 'clear' : 'dark';
        break;
      case 'repeat': {
        const offs = Array.isArray(o.offsets) ? (o.offsets as unknown[]) : [];
        repeatOffsets = offs.length > 0 ? offs.map((p) => scalePoint(p, s)) : null;
        break;
      }
      case 'pad':
        for (const [ox, oy] of offsets()) {
          graphics.push({
            id: nextId++,
            kind: 'pad',
            tool: String(o.tool),
            x: num(o.x) * s + ox,
            y: num(o.y) * s + oy,
            polarity,
          });
        }
        break;
      case 'stroke': {
        const path = convertPath(o.path, s);
        const width = num(o.width) * s;
        for (const [ox, oy] of offsets()) {
          graphics.push({
            id: nextId++,
            kind: 'stroke',
            width,
            path: translatePath(path, ox, oy),
            polarity,
          });
        }
        break;
      }
      case 'fill': {
        const path = convertPath(o.path, s);
        for (const [ox, oy] of offsets()) {
          graphics.push({
            id: nextId++,
            kind: 'fill',
            path: translatePath(path, ox, oy),
            polarity,
          });
        }
        break;
      }
      // 'size' handled above; anything else ignored.
    }
  }

  const boundingBox = sizeBox(sizeObj, s);
  const padCount = graphics.filter((g) => g.kind === 'pad').length;
  const strokeCount = graphics.filter((g) => g.kind === 'stroke').length;
  const fillCount = graphics.filter((g) => g.kind === 'fill').length;

  const source: ImageSource = { fileName: input.fileName, format, sha256: input.sha256 };

  return {
    image: {
      source,
      units: 'mm',
      tools,
      graphics,
      boundingBox,
      stats: {
        graphicCount: graphics.length,
        padCount,
        strokeCount,
        fillCount,
        copperAreaMm2: 0,
      },
    },
    diagnostics,
  };
}

function sizeBox(sizeObj: PlotObject | undefined, s: number): BoundingBox {
  const box = sizeObj?.box;
  if (Array.isArray(box) && box.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return {
      minX: (box[0] as number) * s,
      minY: (box[1] as number) * s,
      maxX: (box[2] as number) * s,
      maxY: (box[3] as number) * s,
    };
  }
  return emptyBoundingBox();
}

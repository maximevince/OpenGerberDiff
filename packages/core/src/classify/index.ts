/**
 * Layer classification — assign each file one of the 13 canonical PCB layer
 * types. Signal priority (highest first): `.gbrjob` FileFunction > Gerber X2
 * `%TF.FileFunction` > filename heuristics (whats-that-gerber + augmentation) >
 * fallback. See docs/03-proposed-architecture.md §4.1, §7.
 */
import whatsThatGerber from 'whats-that-gerber';

export type LayerType =
  | 'topCopper'
  | 'innerCopper'
  | 'bottomCopper'
  | 'topMask'
  | 'bottomMask'
  | 'topSilk'
  | 'bottomSilk'
  | 'topPaste'
  | 'bottomPaste'
  | 'outline'
  | 'drill'
  | 'drillNP'
  | 'other';

export type LayerSide = 'top' | 'bottom' | 'inner' | 'all' | 'unknown';

export type ClassificationSource = 'gbrjob' | 'attribute' | 'filename' | 'fallback';

export interface Classification {
  type: LayerType;
  side: LayerSide;
  /** 1-based copper layer index for inner layers (top copper = 1). */
  innerIndex?: number;
  source: ClassificationSource;
  /** 0..1 — how trustworthy the signal is. */
  confidence: number;
}

/** Human label for a layer type. */
export const LAYER_TYPE_LABEL: Record<LayerType, string> = {
  topCopper: 'Top Copper',
  innerCopper: 'Inner Copper',
  bottomCopper: 'Bottom Copper',
  topMask: 'Top Soldermask',
  bottomMask: 'Bottom Soldermask',
  topSilk: 'Top Silkscreen',
  bottomSilk: 'Bottom Silkscreen',
  topPaste: 'Top Paste',
  bottomPaste: 'Bottom Paste',
  outline: 'Board Outline',
  drill: 'Drill (PTH)',
  drillNP: 'Drill (NPTH)',
  other: 'Other',
};

/** Default display color per layer type (user-overridable). */
export const LAYER_TYPE_COLOR: Record<LayerType, string> = {
  topCopper: '#d4574e',
  innerCopper: '#b07cd4',
  bottomCopper: '#4e9ad4',
  topMask: '#3aa564',
  bottomMask: '#2f7d4e',
  topSilk: '#e8e8e8',
  bottomSilk: '#9aa0a6',
  topPaste: '#c0c0c0',
  bottomPaste: '#8a8a8a',
  outline: '#f0c040',
  drill: '#d0d0d0',
  drillNP: '#7a7a7a',
  other: '#00ff88',
};

// Sidebar order: top of the board first, drill/outline last. Lower = nearer top.
const SIDEBAR_ORDER: LayerType[] = [
  'topSilk',
  'topPaste',
  'topMask',
  'topCopper',
  'innerCopper',
  'bottomCopper',
  'bottomMask',
  'bottomPaste',
  'bottomSilk',
  'outline',
  'drillNP',
  'drill',
  'other',
];

/**
 * Sort key for displaying layers (top of board first). Inner layers are ordered
 * by `innerIndex`. Returns a comparable number.
 */
export function layerSortIndex(c: Classification): number {
  const base = SIDEBAR_ORDER.indexOf(c.type);
  const idx = c.type === 'innerCopper' ? (c.innerIndex ?? 1) : 0;
  return base * 100 + idx;
}

// ---------------------------------------------------------------------------
// Filename classification (whats-that-gerber + augmentation)
// ---------------------------------------------------------------------------

function isNonPlated(fileName: string): boolean {
  return /(npth|non[-_ ]?plated|nplated)/i.test(fileName);
}

function innerIndexFromName(fileName: string): number | undefined {
  const m =
    fileName.match(/in(\d+)[._-]?cu/i) ||
    fileName.match(/inner[._-]?(\d+)/i) ||
    fileName.match(/^.*\bg(\d+)\b/i);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n)) return n + 1; // top copper is index 1
  }
  return undefined;
}

export function classifyByFilename(fileName: string): Classification {
  const wtg = whatsThatGerber([fileName])[fileName];
  const type = wtg?.type ?? null;
  const side = wtg?.side ?? null;

  const map = (t: LayerType, s: LayerSide, conf = 0.7): Classification => ({
    type: t,
    side: s,
    source: 'filename',
    confidence: conf,
  });

  switch (type) {
    case 'copper':
      if (side === 'top') return map('topCopper', 'top');
      if (side === 'bottom') return map('bottomCopper', 'bottom');
      if (side === 'inner')
        return { ...map('innerCopper', 'inner'), innerIndex: innerIndexFromName(fileName) };
      return map('other', 'unknown', 0.3);
    case 'soldermask':
      return side === 'bottom' ? map('bottomMask', 'bottom') : map('topMask', 'top');
    case 'silkscreen':
      return side === 'bottom' ? map('bottomSilk', 'bottom') : map('topSilk', 'top');
    case 'solderpaste':
      return side === 'bottom' ? map('bottomPaste', 'bottom') : map('topPaste', 'top');
    case 'outline':
      return map('outline', 'all', 0.8);
    case 'drill':
      return isNonPlated(fileName) ? map('drillNP', 'all') : map('drill', 'all');
    default:
      return { type: 'other', side: 'unknown', source: 'fallback', confidence: 0.1 };
  }
}

// ---------------------------------------------------------------------------
// FileFunction classification (shared by %TF and .gbrjob)
// ---------------------------------------------------------------------------

/** Parse a Gerber FileFunction value, e.g. "Copper,L1,Top" / "Soldermask,Top". */
export function classifyByFileFunction(
  value: string,
  source: 'attribute' | 'gbrjob',
): Classification | null {
  const parts = value.split(',').map((p) => p.trim());
  const fn = parts[0]?.toLowerCase();
  const conf = source === 'gbrjob' ? 1 : 0.95;
  const lastIsBottom = parts.some((p) => /^bot$/i.test(p));
  const lastIsTop = parts.some((p) => /^top$/i.test(p));
  const side: LayerSide = lastIsBottom ? 'bottom' : lastIsTop ? 'top' : 'all';

  const c = (type: LayerType, s: LayerSide, innerIndex?: number): Classification => ({
    type,
    side: s,
    source,
    confidence: conf,
    ...(innerIndex !== undefined ? { innerIndex } : {}),
  });

  switch (fn) {
    case 'copper': {
      const lMatch = parts.find((p) => /^l\d+$/i.test(p));
      const idx = lMatch ? parseInt(lMatch.slice(1), 10) : undefined;
      const inr = parts.some((p) => /^inr$/i.test(p));
      if (side === 'top') return c('topCopper', 'top', idx);
      if (side === 'bottom') return c('bottomCopper', 'bottom', idx);
      if (inr || (idx !== undefined && idx > 1)) return c('innerCopper', 'inner', idx);
      return c('topCopper', 'top', idx);
    }
    case 'soldermask':
      return side === 'bottom' ? c('bottomMask', 'bottom') : c('topMask', 'top');
    case 'legend':
    case 'silkscreen':
      return side === 'bottom' ? c('bottomSilk', 'bottom') : c('topSilk', 'top');
    case 'paste':
    case 'solderpaste':
      return side === 'bottom' ? c('bottomPaste', 'bottom') : c('topPaste', 'top');
    case 'profile':
      return c('outline', 'all');
    case 'nonplated':
      return c('drillNP', 'all');
    case 'plated':
      return c('drill', 'all');
    default:
      return null;
  }
}

const TF_FILEFUNCTION = /(?:%TF\.FileFunction,|G04\s*#@!\s*TF\.FileFunction,)([^*%\n]+)/i;

export function classifyByAttribute(content: string): Classification | null {
  const m = content.match(TF_FILEFUNCTION);
  if (!m) return null;
  return classifyByFileFunction(m[1]!.trim(), 'attribute');
}

// ---------------------------------------------------------------------------
// .gbrjob (Gerber Job File, JSON)
// ---------------------------------------------------------------------------

/** Map of file path (as written in the job file) -> FileFunction string. */
export function parseGbrjob(text: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const job = JSON.parse(text) as {
      FilesAttributes?: Array<{ Path?: string; FileFunction?: string }>;
    };
    for (const f of job.FilesAttributes ?? []) {
      if (f.Path && f.FileFunction) out.set(f.Path, f.FileFunction);
    }
  } catch {
    // not a valid job file; ignore
  }
  return out;
}

// ---------------------------------------------------------------------------
// Combined classifier
// ---------------------------------------------------------------------------

export function classify(
  fileName: string,
  content: string,
  gbrjob?: Map<string, string>,
): Classification {
  const ff = gbrjob?.get(fileName) ?? gbrjob?.get(`./${fileName}`);
  if (ff) {
    const byJob = classifyByFileFunction(ff, 'gbrjob');
    if (byJob) return byJob;
  }
  const byAttr = classifyByAttribute(content);
  if (byAttr) return byAttr;
  return classifyByFilename(fileName);
}

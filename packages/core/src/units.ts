/** Unit conversion + display formatting. Internal model is always millimetres. */

export const MM_PER_INCH = 25.4;

export type DisplayUnit = 'mil' | 'mm' | 'inch';

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

/**
 * Format a length given in millimetres for display, matching the original tool's
 * conventions: mil → 1 decimal, mm → 3 decimals, inch → 4 decimals.
 */
export function formatLength(mm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mil':
      return `${mmToInch(mm * 1000).toFixed(1)} mil`;
    case 'mm':
      return `${mm.toFixed(3)} mm`;
    case 'inch':
      return `${mmToInch(mm).toFixed(4)}"`;
  }
}

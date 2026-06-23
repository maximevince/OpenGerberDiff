import { writable } from 'svelte/store';
import type { DisplayUnit } from '@ogd/core';

export type ViewMode = 'overlay' | 'side-by-side' | 'xor' | 'changes-only' | 'onion-skin';
export type ColorblindPalette = 'default' | 'deuteranopia' | 'tritanopia' | 'monochrome';

export interface Settings {
  defaultViewMode: ViewMode;
  colorA: string;
  colorB: string;
  backgroundColor: string;
  measurementUnit: DisplayUnit;
  colorblindPalette: ColorblindPalette;
  cellSizeMm: number;
  minFeatureMm: number;
  coverageThreshold: number;
  clusterGapMm: number;
  autoAlign: boolean;
  showGrid: boolean;
  gridSpacingMm: number;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultViewMode: 'overlay',
  colorA: '#ff5252',
  colorB: '#00e5ff',
  backgroundColor: '#1a1a2e',
  measurementUnit: 'mil',
  colorblindPalette: 'default',
  cellSizeMm: 0.01, // 10 µm
  minFeatureMm: 0.025, // ~1 mil
  coverageThreshold: 0.5, // τ
  clusterGapMm: 0.05,
  autoAlign: true,
  showGrid: true,
  gridSpacingMm: 2.54, // 0.1 in
};

// Persisted to localStorage (Phase 4). Unknown/legacy keys are dropped and missing
// keys fall back to defaults, so the schema can evolve without breaking saved prefs.
const STORAGE_KEY = 'ogd:settings';

function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (parsed[k] !== undefined) (out[k] as unknown) = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings = writable<Settings>(loadSettings());

if (typeof localStorage !== 'undefined') {
  settings.subscribe((v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* quota / private mode — ignore */
    }
  });
}

export function resetSettings(): void {
  settings.set({ ...DEFAULT_SETTINGS });
}

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

// Phase 0: in-memory only. localStorage persistence lands in Phase 4.
export const settings = writable<Settings>({ ...DEFAULT_SETTINGS });

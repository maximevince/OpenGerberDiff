import * as Comlink from 'comlink';
import {
  LAYER_TYPE_LABEL,
  layerSortIndex,
  type AlignResult,
  type Classification,
  type DiffResult,
  type Image,
  type Offset,
} from '@ogd/core';
import type { Layer } from './project';
import type { DiffWorkerApi } from './workers/diff.worker.ts';

export interface LayerPair {
  key: string;
  label: string;
  classification: Classification;
  a: Layer | null;
  b: Layer | null;
}

export interface PairDiff {
  key: string;
  label: string;
  result: DiffResult;
}

export function pairKey(c: Classification): string {
  return c.type === 'innerCopper' ? `inner:${c.innerIndex ?? 0}` : c.type;
}

function labelOf(c: Classification): string {
  return c.type === 'innerCopper' && c.innerIndex !== undefined
    ? `Inner Copper ${c.innerIndex}`
    : LAYER_TYPE_LABEL[c.type];
}

/** Pair A and B layers by classification; unmatched layers get a null side. */
export function matchLayers(a: Layer[], b: Layer[]): LayerPair[] {
  const pairs = new Map<string, LayerPair>();
  const take = (layer: Layer, side: 'a' | 'b') => {
    const key = pairKey(layer.classification);
    let p = pairs.get(key);
    if (!p) {
      p = {
        key,
        label: labelOf(layer.classification),
        classification: layer.classification,
        a: null,
        b: null,
      };
      pairs.set(key, p);
    }
    p[side] = layer;
  };
  for (const l of a) take(l, 'a');
  for (const l of b) take(l, 'b');
  return [...pairs.values()].sort(
    (x, y) => layerSortIndex(x.classification) - layerSortIndex(y.classification),
  );
}

let workerApi: Comlink.Remote<DiffWorkerApi> | null = null;
function getWorker(): Comlink.Remote<DiffWorkerApi> {
  if (!workerApi) {
    const worker = new Worker(new URL('./workers/diff.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerApi = Comlink.wrap<DiffWorkerApi>(worker);
  }
  return workerApi;
}

// Copper carries the densest, junk-free geometry, so it drives alignment
// scoring and the pad snap. Top copper first — it's present on virtually every
// board and matches the user's mental model of "line the boards up".
const ALIGN_PRIORITY: Partial<Record<Classification['type'], number>> = {
  topCopper: 0,
  bottomCopper: 1,
  innerCopper: 2,
};

/**
 * Compute ONE global translation aligning the whole B board onto A in the
 * worker. Exporters disagree on the design origin globally, so the offset is
 * board-wide, never per layer. Matched pairs are passed copper-first — the
 * aligner scores the leading pairs and pad-snaps across all of them.
 */
export async function alignBoards(
  a: Image[],
  b: Image[],
  pairs: LayerPair[],
): Promise<AlignResult> {
  const imagePairs = pairs
    .filter((p) => p.a && p.b)
    .sort(
      (x, y) =>
        (ALIGN_PRIORITY[x.classification.type] ?? 9) - (ALIGN_PRIORITY[y.classification.type] ?? 9),
    )
    .map((p) => ({ a: p.a!.image, b: p.b!.image }));
  return getWorker().alignSets(a, b, imagePairs);
}

/** Diff every matched layer pair (both sides present) in the worker. */
export async function runDiffs(
  pairs: LayerPair[],
  offset: Offset,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<PairDiff[]> {
  const both = pairs.filter((p) => p.a && p.b);
  const out: PairDiff[] = [];
  let done = 0;
  for (const p of both) {
    onProgress?.(done, both.length, p.label);
    const result = await getWorker().diff(p.a!.image, p.b!.image, { align: offset });
    out.push({ key: p.key, label: p.label, result });
    onProgress?.(++done, both.length, p.label);
  }
  return out;
}

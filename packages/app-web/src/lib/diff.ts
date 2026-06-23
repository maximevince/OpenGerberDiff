import * as Comlink from 'comlink';
import { LAYER_TYPE_LABEL, layerSortIndex, type Classification, type DiffResult } from '@ogd/core';
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

function keyOf(c: Classification): string {
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
    const key = keyOf(layer.classification);
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

/** Diff every matched layer pair (both sides present) in the worker. */
export async function runDiffs(pairs: LayerPair[]): Promise<PairDiff[]> {
  const both = pairs.filter((p) => p.a && p.b);
  const out: PairDiff[] = [];
  for (const p of both) {
    const result = await getWorker().diff(p.a!.image, p.b!.image, { align: 'auto' });
    out.push({ key: p.key, label: p.label, result });
  }
  return out;
}

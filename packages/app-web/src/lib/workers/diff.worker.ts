import * as Comlink from 'comlink';
import {
  autoAlignSets,
  diffImages,
  type AlignPair,
  type AlignResult,
  type DiffOptions,
  type DiffResult,
  type Image,
} from '@ogd/core';

const api = {
  async diff(a: Image, b: Image, opts: DiffOptions): Promise<DiffResult> {
    return diffImages(a, b, opts);
  },
  async alignSets(a: Image[], b: Image[], pairs: AlignPair[]): Promise<AlignResult> {
    return autoAlignSets(a, b, pairs);
  },
};

export type DiffWorkerApi = typeof api;

Comlink.expose(api);

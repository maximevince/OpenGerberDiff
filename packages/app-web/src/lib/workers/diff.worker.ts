import * as Comlink from 'comlink';
import { diffImages, type DiffOptions, type DiffResult, type Image } from '@ogd/core';

const api = {
  async diff(a: Image, b: Image, opts: DiffOptions): Promise<DiffResult> {
    return diffImages(a, b, opts);
  },
};

export type DiffWorkerApi = typeof api;

Comlink.expose(api);

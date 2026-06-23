import * as Comlink from 'comlink';
import {
  classifyByAttribute,
  classifyByFileFunction,
  classifyByFilename,
  parseImage,
  sha256Hex,
  type Classification,
  type Diagnostic,
  type Image,
} from '@ogd/core';

export interface ParsedLayer {
  image: Image;
  diagnostics: Diagnostic[];
  classification: Classification;
}

/**
 * Parse worker: keeps the `@tracespace` v4 parser (and its node-polyfill weight)
 * off the main thread. Receives raw bytes (+ optional .gbrjob FileFunction for
 * this file), hashes + decodes + parses + classifies.
 */
const api = {
  async parse(fileName: string, bytes: ArrayBuffer, gbrjobFn?: string): Promise<ParsedLayer> {
    const u8 = new Uint8Array(bytes);
    const sha256 = await sha256Hex(u8);
    const content = new TextDecoder('utf-8').decode(u8);
    const { image, diagnostics } = await parseImage(content, { fileName, sha256 });

    const classification =
      (gbrjobFn ? classifyByFileFunction(gbrjobFn, 'gbrjob') : null) ??
      classifyByAttribute(content) ??
      classifyByFilename(fileName);

    return { image, diagnostics, classification };
  },
};

export type ParseWorkerApi = typeof api;

Comlink.expose(api);

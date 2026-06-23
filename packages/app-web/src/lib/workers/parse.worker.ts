import * as Comlink from 'comlink';
import { parseImage, sha256Hex, type ParseResult } from '@ogd/core';

/**
 * Parse worker: keeps the `@tracespace` v4 parser (and its node-polyfill weight)
 * off the main thread. Receives raw bytes, hashes + decodes + parses, returns the
 * normalized model.
 */
const api = {
  async parse(fileName: string, bytes: ArrayBuffer): Promise<ParseResult> {
    const u8 = new Uint8Array(bytes);
    const sha256 = await sha256Hex(u8);
    const content = new TextDecoder('utf-8').decode(u8);
    return parseImage(content, { fileName, sha256 });
  },
};

export type ParseWorkerApi = typeof api;

Comlink.expose(api);

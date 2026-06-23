import * as Comlink from 'comlink';
import { unzipSync } from 'fflate';
import type { ParseResult } from '@ogd/core';
import type { ParseWorkerApi } from './workers/parse.worker.ts';

export interface RawFile {
  name: string;
  bytes: ArrayBuffer;
}

const GERBER_EXT =
  /\.(gbr|ger|gbx|grb|art|pho|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm1|gm2|g\d+|gl\d+|in\d+|drl|xln|exc|ncd|tap|drd|nc)$/i;

function isZip(name: string, bytes: ArrayBuffer): boolean {
  if (name.toLowerCase().endsWith('.zip')) return true;
  const u8 = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return u8[0] === 0x50 && u8[1] === 0x4b; // "PK"
}

/** Expand a dropped/opened file into raw member files (unzipping if needed). */
export async function expandFile(file: File): Promise<RawFile[]> {
  const bytes = await file.arrayBuffer();
  if (!isZip(file.name, bytes)) return [{ name: file.name, bytes }];

  const entries = unzipSync(new Uint8Array(bytes));
  const out: RawFile[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/') || data.length === 0) continue;
    const name = path.split('/').pop() ?? path;
    // copy into a standalone ArrayBuffer
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    out.push({ name, bytes: ab });
  }
  return out;
}

export function looksLikeGerber(name: string): boolean {
  return GERBER_EXT.test(name);
}

let workerApi: Comlink.Remote<ParseWorkerApi> | null = null;

function getWorker(): Comlink.Remote<ParseWorkerApi> {
  if (!workerApi) {
    const worker = new Worker(new URL('./workers/parse.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerApi = Comlink.wrap<ParseWorkerApi>(worker);
  }
  return workerApi;
}

/** Parse one raw file in the worker (bytes transferred, not copied). */
export function parseRawFile(raw: RawFile): Promise<ParseResult> {
  return getWorker().parse(raw.name, Comlink.transfer(raw.bytes, [raw.bytes]));
}

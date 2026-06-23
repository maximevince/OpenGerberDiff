/**
 * `.pcbdiff` session files — an explicit, user-initiated save (download), not silent
 * caching. A session is a zip bundling the ORIGINAL A/B source files plus a manifest
 * of the review state (layer assignments, colors, visibility, view mode). Import
 * reproduces the whole review standalone, even on another machine. See docs/03 §4.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { LayerType } from '@ogd/core';

export const PCBDIFF_EXT = '.pcbdiff';
const FORMAT = 'opengerberdiff';

export interface RawFileBytes {
  name: string;
  bytes: Uint8Array;
}

export interface LayerOverride {
  fileName: string;
  type: LayerType;
  color: string;
  visible: boolean;
}

export interface SessionSide {
  name: string;
  files: RawFileBytes[];
  layers: LayerOverride[];
}

export interface SessionManifest {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  viewMode: string;
  a?: { name: string; layers: LayerOverride[] };
  b?: { name: string; layers: LayerOverride[] };
}

export function isSessionFile(name: string): boolean {
  return name.toLowerCase().endsWith(PCBDIFF_EXT);
}

/** Serialize a review into a `.pcbdiff` zip (source files + manifest.json). */
export function buildSession(input: {
  viewMode: string;
  createdAt: string;
  a?: SessionSide;
  b?: SessionSide;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const manifest: SessionManifest = {
    format: FORMAT,
    version: 1,
    createdAt: input.createdAt,
    viewMode: input.viewMode,
  };
  for (const side of ['a', 'b'] as const) {
    const s = input[side];
    if (!s) continue;
    for (const f of s.files) files[`${side}/${f.name}`] = f.bytes;
    manifest[side] = { name: s.name, layers: s.layers };
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files);
}

export interface ParsedSession {
  manifest: SessionManifest;
  aFiles: File[];
  bFiles: File[];
}

/** Read a `.pcbdiff` zip back into a manifest + reconstructed source File objects. */
export function parseSession(bytes: Uint8Array): ParsedSession {
  const entries = unzipSync(bytes);
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) throw new Error('Not a valid .pcbdiff file (no manifest)');
  const manifest = JSON.parse(strFromU8(manifestRaw)) as SessionManifest;
  if (manifest.format !== FORMAT) throw new Error('Unrecognized session format');

  const aFiles: File[] = [];
  const bFiles: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path === 'manifest.json') continue;
    const slash = path.indexOf('/');
    if (slash < 0) continue;
    const side = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (!name) continue;
    const file = new File([data as BlobPart], name);
    if (side === 'a') aFiles.push(file);
    else if (side === 'b') bFiles.push(file);
  }
  return { manifest, aFiles, bFiles };
}

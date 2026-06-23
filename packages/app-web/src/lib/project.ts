import {
  LAYER_TYPE_COLOR,
  LAYER_TYPE_LABEL,
  layerSortIndex,
  parseGbrjob,
  type Classification,
  type Diagnostic,
  type Image,
} from '@ogd/core';
import { expandFile, looksLikeGerber, parseRawFile, type RawFile } from './ingest';

export interface Layer {
  id: string;
  fileName: string;
  image: Image;
  classification: Classification;
  displayName: string;
  color: string;
  visible: boolean;
  diagnostics: Diagnostic[];
}

export interface Project {
  name: string;
  layers: Layer[];
  /** Files that were present but not recognized as Gerber/Excellon. */
  skipped: string[];
}

function displayName(c: Classification): string {
  if (c.type === 'innerCopper' && c.innerIndex !== undefined) {
    return `Inner Copper ${c.innerIndex}`;
  }
  return LAYER_TYPE_LABEL[c.type];
}

/** Expand, parse, classify and order every layer in a set of dropped files. */
export async function loadProject(
  files: File[],
  name = 'Project',
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<Project> {
  const raws: RawFile[] = (await Promise.all(files.map(expandFile))).flat();

  const jobFile = raws.find((r) => r.name.toLowerCase().endsWith('.gbrjob'));
  const gbrjob = jobFile ? parseGbrjob(new TextDecoder().decode(jobFile.bytes)) : undefined;

  const candidates = raws.filter((r) => looksLikeGerber(r.name));
  const skipped = raws
    .filter((r) => !looksLikeGerber(r.name) && !r.name.toLowerCase().endsWith('.gbrjob'))
    .map((r) => r.name);

  let done = 0;
  onProgress?.(0, candidates.length, 'parsing');
  const layers: Layer[] = await Promise.all(
    candidates.map(async (raw) => {
      const fn = gbrjob?.get(raw.name) ?? gbrjob?.get(`./${raw.name}`);
      const res = await parseRawFile(raw, fn);
      onProgress?.(++done, candidates.length, raw.name);
      return {
        id: raw.name,
        fileName: raw.name,
        image: res.image,
        classification: res.classification,
        diagnostics: res.diagnostics,
        displayName: displayName(res.classification),
        color: LAYER_TYPE_COLOR[res.classification.type],
        visible: true,
      } satisfies Layer;
    }),
  );

  // Top of the board first (sidebar order); the renderer draws bottom-first.
  layers.sort((a, b) => layerSortIndex(a.classification) - layerSortIndex(b.classification));

  return { name, layers, skipped };
}

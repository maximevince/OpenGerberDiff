import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 9 invariant: the web app must NEVER import Electron, so the same bundle
 * keeps running in a plain browser. The Electron shell only injects window.nativeAPI,
 * which the platform layer feature-detects. This guard fails the build if an
 * `electron` import ever leaks into app-web source.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|svelte|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no Electron import in app-web', () => {
  it('source never imports or requires "electron"', () => {
    const src = join(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const file of walk(src)) {
      if (file.endsWith('no-electron.test.ts')) continue;
      const code = readFileSync(file, 'utf8');
      if (
        /(from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)|import\(\s*['"]electron['"])/.test(
          code,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

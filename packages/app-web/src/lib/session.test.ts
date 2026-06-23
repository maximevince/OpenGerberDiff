import { describe, expect, it } from 'vitest';
import { buildSession, isSessionFile, parseSession, type SessionSide } from './session.js';

const u8 = (s: string) => new TextEncoder().encode(s);

const sideA: SessionSide = {
  name: 'rev1.zip',
  files: [{ name: 'top.gbr', bytes: u8('G04 A*') }],
  layers: [{ fileName: 'top.gbr', type: 'topCopper', color: '#ff0000', visible: true }],
};
const sideB: SessionSide = {
  name: 'rev2.zip',
  files: [{ name: 'top.gbr', bytes: u8('G04 B*') }],
  layers: [{ fileName: 'top.gbr', type: 'topCopper', color: '#00ff00', visible: false }],
};

describe('session (.pcbdiff)', () => {
  it('detects the extension case-insensitively', () => {
    expect(isSessionFile('review.pcbdiff')).toBe(true);
    expect(isSessionFile('REVIEW.PCBDIFF')).toBe(true);
    expect(isSessionFile('board.zip')).toBe(false);
  });

  it('round-trips manifest + source files for both sides', async () => {
    const bytes = buildSession({
      viewMode: 'diff',
      createdAt: '2026-06-23T00:00:00Z',
      a: sideA,
      b: sideB,
    });
    const { manifest, aFiles, bFiles } = parseSession(bytes);

    expect(manifest.format).toBe('opengerberdiff');
    expect(manifest.viewMode).toBe('diff');
    expect(manifest.a?.layers[0]?.color).toBe('#ff0000');
    expect(manifest.b?.layers[0]?.visible).toBe(false);

    expect(aFiles.map((f) => f.name)).toEqual(['top.gbr']);
    expect(bFiles.map((f) => f.name)).toEqual(['top.gbr']);
    expect(await aFiles[0]!.text()).toBe('G04 A*');
    expect(await bFiles[0]!.text()).toBe('G04 B*');
  });

  it('supports a single-project session', () => {
    const bytes = buildSession({ viewMode: 'a', createdAt: '2026-06-23T00:00:00Z', a: sideA });
    const { manifest, aFiles, bFiles } = parseSession(bytes);
    expect(aFiles).toHaveLength(1);
    expect(bFiles).toHaveLength(0);
    expect(manifest.b).toBeUndefined();
  });

  it('rejects non-session zips', () => {
    expect(() => parseSession(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

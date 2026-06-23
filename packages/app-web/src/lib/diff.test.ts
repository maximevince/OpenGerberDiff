import { describe, expect, it } from 'vitest';
import type { Classification } from '@ogd/core';
import { matchLayers } from './diff';
import type { Layer } from './project';

function layer(id: string, type: Classification['type'], innerIndex?: number): Layer {
  const classification: Classification = {
    type,
    side: 'all',
    source: 'filename',
    confidence: 1,
    ...(innerIndex !== undefined ? { innerIndex } : {}),
  };
  return {
    id,
    fileName: id,
    image: null as never,
    classification,
    displayName: type,
    color: '#fff',
    visible: true,
    diagnostics: [],
  };
}

describe('matchLayers', () => {
  it('pairs layers by type and orders top-first', () => {
    const a = [layer('a-top', 'topCopper'), layer('a-bot', 'bottomCopper')];
    const b = [layer('b-bot', 'bottomCopper'), layer('b-top', 'topCopper')];
    const pairs = matchLayers(a, b);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.classification.type).toBe('topCopper');
    expect(pairs[0]!.a?.id).toBe('a-top');
    expect(pairs[0]!.b?.id).toBe('b-top');
  });

  it('flags an unmatched layer with a null side', () => {
    const pairs = matchLayers([layer('a', 'topCopper')], [layer('b', 'topSilk')]);
    const copper = pairs.find((p) => p.key === 'topCopper')!;
    const silk = pairs.find((p) => p.key === 'topSilk')!;
    expect(copper.a).not.toBeNull();
    expect(copper.b).toBeNull();
    expect(silk.a).toBeNull();
    expect(silk.b).not.toBeNull();
  });

  it('separates inner-copper layers by index', () => {
    const a = [layer('a1', 'innerCopper', 1), layer('a2', 'innerCopper', 2)];
    const b = [layer('b2', 'innerCopper', 2), layer('b1', 'innerCopper', 1)];
    const pairs = matchLayers(a, b);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.a?.classification.innerIndex).toBe(p.b?.classification.innerIndex);
    }
  });
});

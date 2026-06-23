import { describe, expect, it } from 'vitest';
import {
  classify,
  classifyByAttribute,
  classifyByFileFunction,
  classifyByFilename,
  layerSortIndex,
  parseGbrjob,
} from './index.js';

describe('classifyByFilename', () => {
  const cases: Array<[string, string]> = [
    ['board-F_Cu.gbr', 'topCopper'],
    ['board-B_Cu.gbr', 'bottomCopper'],
    ['board-In1_Cu.gbr', 'innerCopper'],
    ['board-F_Mask.gbr', 'topMask'],
    ['board-B_Mask.gbr', 'bottomMask'],
    ['board-F_SilkS.gbr', 'topSilk'],
    ['board-F_Paste.gbr', 'topPaste'],
    ['board-Edge_Cuts.gbr', 'outline'],
    ['board.gko', 'outline'],
    ['top.gtl', 'topCopper'],
    ['bottom.gbl', 'bottomCopper'],
    ['board.drl', 'drill'],
    ['board-NPTH.drl', 'drillNP'],
  ];
  for (const [name, type] of cases) {
    it(`${name} -> ${type}`, () => {
      expect(classifyByFilename(name).type).toBe(type);
    });
  }

  it('extracts an inner-layer index', () => {
    expect(classifyByFilename('board-In2_Cu.gbr').innerIndex).toBe(3);
  });
});

describe('classifyByFileFunction', () => {
  it('parses copper with layer index and side', () => {
    expect(classifyByFileFunction('Copper,L1,Top', 'attribute')).toMatchObject({
      type: 'topCopper',
      side: 'top',
      innerIndex: 1,
    });
    expect(classifyByFileFunction('Copper,L3,Inr', 'gbrjob')).toMatchObject({
      type: 'innerCopper',
      innerIndex: 3,
    });
    expect(classifyByFileFunction('Soldermask,Bot', 'attribute')?.type).toBe('bottomMask');
    expect(classifyByFileFunction('Legend,Top', 'attribute')?.type).toBe('topSilk');
    expect(classifyByFileFunction('Profile,NP', 'attribute')?.type).toBe('outline');
  });
});

describe('classifyByAttribute', () => {
  it('reads %TF.FileFunction', () => {
    expect(classifyByAttribute('%FSLAX24Y24*%\n%TF.FileFunction,Copper,L1,Top*%\n')?.type).toBe(
      'topCopper',
    );
  });
  it('reads the KiCad G04 comment form', () => {
    expect(classifyByAttribute('G04 #@! TF.FileFunction,Soldermask,Bot*\n')?.type).toBe(
      'bottomMask',
    );
  });
  it('returns null when absent', () => {
    expect(classifyByAttribute('X0Y0D03*')).toBeNull();
  });
});

describe('parseGbrjob + priority', () => {
  const job = JSON.stringify({
    FilesAttributes: [
      { Path: 'weird-name.gbr', FileFunction: 'Soldermask,Top' },
      { Path: 'board-F_Cu.gbr', FileFunction: 'Copper,L1,Top' },
    ],
  });

  it('parses file functions from the job file', () => {
    const map = parseGbrjob(job);
    expect(map.get('weird-name.gbr')).toBe('Soldermask,Top');
  });

  it('gbrjob overrides a misleading filename', () => {
    const map = parseGbrjob(job);
    // filename says copper, but the job file says soldermask -> job wins
    expect(classify('weird-name.gbr', '', map).type).toBe('topMask');
    expect(classify('weird-name.gbr', '', map).source).toBe('gbrjob');
  });

  it('falls back to filename when no other signal', () => {
    expect(classify('board-B_Cu.gbr', '').type).toBe('bottomCopper');
  });
});

describe('layerSortIndex', () => {
  it('orders top of board first, drill/outline last', () => {
    const i = (type: string) =>
      layerSortIndex({ type, side: 'all', source: 'filename', confidence: 1 } as never);
    expect(i('topSilk')).toBeLessThan(i('topCopper'));
    expect(i('topCopper')).toBeLessThan(i('bottomCopper'));
    expect(i('bottomCopper')).toBeLessThan(i('drill'));
  });
});

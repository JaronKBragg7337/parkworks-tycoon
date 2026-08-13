import { describe, expect, it } from 'vitest';
import { InfrastructureBuilder, cellsAlongLine } from '../src/game/InfrastructureBuilder';

describe('cellsAlongLine', () => {
  it('fills every grid cell skipped by a fast horizontal drag', () => {
    expect(cellsAlongLine({ x: -2, z: 4 }, { x: 3, z: 4 })).toEqual([
      { x: -2, z: 4 },
      { x: -1, z: 4 },
      { x: 0, z: 4 },
      { x: 1, z: 4 },
      { x: 2, z: 4 },
      { x: 3, z: 4 },
    ]);
  });

  it('produces a continuous diagonal without duplicate cells', () => {
    const cells = cellsAlongLine({ x: 0, z: 0 }, { x: 4, z: 3 });
    expect(cells[0]).toEqual({ x: 0, z: 0 });
    expect(cells.at(-1)).toEqual({ x: 4, z: 3 });
    expect(new Set(cells.map((cell) => `${cell.x},${cell.z}`)).size).toBe(cells.length);
  });
});

describe('InfrastructureBuilder', () => {
  it('deduplicates overlapping strokes and clears without mutating a grid', () => {
    const builder = new InfrastructureBuilder();
    builder.begin('sidewalk');
    builder.startStroke({ x: 0, z: 0 });
    builder.extendStroke({ x: 3, z: 0 });
    builder.endStroke();
    builder.startStroke({ x: 2, z: 0 });
    builder.extendStroke({ x: 2, z: 2 });
    builder.endStroke();
    expect(builder.cells).toHaveLength(6);
    builder.cancel();
    expect(builder.cells).toEqual([]);
    expect(builder.tool).toBeNull();
  });
});

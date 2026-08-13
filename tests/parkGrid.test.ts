import { describe, expect, it } from 'vitest';
import {
  ParkGrid,
  cellsInBounds,
  type GridCell,
  type InitialSurfaceDefinition,
} from '../src/core/ParkGrid';

function connectedStripGrid(): ParkGrid {
  const path: InitialSurfaceDefinition = {
    surface: 'sidewalk',
    cells: cellsInBounds({ minX: 0, maxX: 4, minZ: 1, maxZ: 1 }),
  };
  return new ParkGrid({
    bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
    entrance: { x: 0, z: 1 },
    parcels: [
      {
        id: 'base',
        name: 'Base',
        bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
        cost: 0,
        initiallyOwned: true,
      },
    ],
    initialSurfaces: [path],
  });
}

describe('ParkGrid land ownership', () => {
  it('models the existing parcel as 64 x 66 one-metre cells with initial promenades', () => {
    const grid = new ParkGrid();
    const snapshot = grid.getSnapshot();

    expect(snapshot.cellSizeMeters).toBe(1);
    expect(snapshot.bounds).toEqual({
      minX: -32,
      maxX: 31,
      minZ: -33,
      maxZ: 32,
      width: 64,
      height: 66,
    });
    expect(snapshot.cells).toHaveLength(64 * 66);
    expect(grid.getCell({ x: 0, z: 0 })).toMatchObject({
      surface: 'sidewalk',
      walkable: true,
      owned: true,
      parcelId: 'founders-park',
    });
    expect(grid.getCell({ x: -12, z: 0 })).toMatchObject({
      surface: 'sidewalk',
      owned: true,
    });
    expect(grid.getCell({ x: -13, z: 0 })).toMatchObject({
      surface: 'lawn',
      owned: false,
      parcelId: 'west-meadow',
    });
    expect(grid.findRoute(grid.getEntranceCell(), { x: 0, z: -20 })).not.toBeNull();
  });

  it('unlocks only parcels sharing a cardinal edge with owned land', () => {
    const grid = new ParkGrid();

    expect(grid.getParcelSnapshot('west-meadow')).toMatchObject({
      status: 'available',
      purchasable: true,
    });
    expect(grid.getParcelSnapshot('west-corner')).toMatchObject({
      status: 'locked',
      purchasable: false,
    });
    expect(grid.quoteParcelPurchase('west-corner')).toMatchObject({
      valid: false,
      reason: 'not-adjacent',
    });

    const meadow = grid.purchaseParcel('west-meadow');
    expect(meadow).toEqual({
      valid: true,
      parcelId: 'west-meadow',
      cost: 1_500,
      reason: null,
      purchased: true,
    });
    expect(grid.getParcelSnapshot('west-corner')).toMatchObject({
      status: 'available',
      adjacentOwnedParcelIds: ['west-meadow'],
    });
    expect(grid.purchaseParcel('west-corner')).toMatchObject({
      valid: true,
      cost: 1_100,
      purchased: true,
    });
    expect(grid.quoteParcelPurchase('west-corner')).toMatchObject({
      valid: false,
      reason: 'already-owned',
    });
    expect(grid.getRevision()).toBe(2);
  });
});

describe('ParkGrid surface construction', () => {
  it('quotes caller-owned costs and rejects unowned land without partial construction', () => {
    const grid = new ParkGrid();
    const ownedLawn = { x: 8, z: 8 };
    const unownedLawn = { x: 12, z: 8 };

    const rejected = grid.construct([ownedLawn, unownedLawn], 'road');
    expect(rejected).toMatchObject({
      valid: false,
      applied: false,
      cost: 0,
      reason: 'unowned-land',
      invalidCell: unownedLawn,
    });
    expect(grid.getSurface(ownedLawn)).toBe('lawn');

    expect(grid.purchaseParcel('east-grove').purchased).toBe(true);
    const quote = grid.quoteConstruction([unownedLawn, unownedLawn, { x: 13, z: 8 }], 'road');
    expect(quote).toMatchObject({ valid: true, cellCount: 2, cost: 36 });
    expect(grid.getSurface(unownedLawn)).toBe('lawn');

    const built = grid.construct(quote.cells, 'road');
    expect(built).toMatchObject({ valid: true, applied: true, cost: 36 });
    expect(grid.getSurface(unownedLawn)).toBe('road');
    expect(grid.getSurface({ x: 13, z: 8 })).toBe('road');
  });

  it('demolishes mixed road and sidewalk selections at their quoted costs', () => {
    const grid = new ParkGrid();
    const road = { x: 8, z: 8 };
    const sidewalk = { x: 0, z: 8 };
    expect(grid.construct([road], 'road').cost).toBe(18);

    const quote = grid.quoteDemolition([road, sidewalk]);
    expect(quote).toMatchObject({ valid: true, cellCount: 2, cost: 5 });
    expect(grid.demolish(quote.cells)).toMatchObject({ valid: true, applied: true, cost: 5 });
    expect(grid.getSurface(road)).toBe('lawn');
    expect(grid.getSurface(sidewalk)).toBe('lawn');
  });
});

describe('ParkGrid deterministic path graph', () => {
  it('treats roads and sidewalks as one four-neighbor graph and lawn as blocked', () => {
    const grid = new ParkGrid({
      bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      entrance: { x: 0, z: 0 },
      parcels: [
        {
          id: 'base',
          name: 'Base',
          bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
          cost: 0,
          initiallyOwned: true,
        },
      ],
      initialSurfaces: [
        { surface: 'sidewalk', cells: cellsInBounds({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }) },
        { surface: 'road', cells: cellsInBounds({ minX: 1, maxX: 1, minZ: 0, maxZ: 2 }) },
      ],
    });

    expect(grid.getSurface({ x: 1, z: 1 })).toBe('road');
    expect(grid.getWalkableNeighbors({ x: 1, z: 1 })).toEqual([
      { x: 1, z: 2 },
      { x: 2, z: 1 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
    ]);
    expect(grid.getPathGraphSnapshot()).toHaveLength(9);
  });

  it('uses a stable north/east/south/west tie-break for shortest routes', () => {
    const allCells = cellsInBounds({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 });
    const grid = new ParkGrid({
      bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      entrance: { x: 0, z: 0 },
      initialSurfaces: [{ surface: 'sidewalk', cells: allCells }],
    });
    const expected: GridCell[] = [
      { x: 0, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: 2 },
      { x: 1, z: 2 },
      { x: 2, z: 2 },
    ];

    expect(grid.findRoute({ x: 0, z: 0 }, { x: 2, z: 2 })).toEqual(expected);
    expect(grid.findRoute({ x: 0, z: 0 }, { x: 2, z: 2 })).toEqual(expected);
    expect(grid.findRoute({ x: 0, z: 0 }, { x: 2, z: 2.5 })).toBeNull();
  });

  it('reports facility disconnection and reachable cells after a path is cut', () => {
    const grid = connectedStripGrid();
    const approaches = [
      { x: 4, z: 2 },
      { x: 4, z: 1 },
    ];

    expect(grid.getFacilityConnectivity(approaches)).toMatchObject({
      connected: true,
      approachCell: { x: 4, z: 1 },
      reason: null,
    });
    expect(grid.getReachableCells()).toEqual([
      { x: 0, z: 1 },
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 3, z: 1 },
      { x: 4, z: 1 },
    ]);

    expect(grid.demolish([{ x: 2, z: 1 }]).applied).toBe(true);
    expect(grid.findRoute({ x: 0, z: 1 }, { x: 4, z: 1 })).toBeNull();
    expect(grid.getReachableCells()).toEqual([
      { x: 0, z: 1 },
      { x: 1, z: 1 },
    ]);
    expect(grid.getFacilityConnectivity(approaches)).toEqual({
      connected: false,
      entrance: { x: 0, z: 1 },
      approachCell: null,
      route: null,
      reason: 'no-route',
    });
  });

  it('selects equal-distance facility approaches deterministically', () => {
    const allCells = cellsInBounds({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 });
    const grid = new ParkGrid({
      bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      entrance: { x: 1, z: 0 },
      initialSurfaces: [{ surface: 'sidewalk', cells: allCells }],
    });
    const left = { x: 0, z: 2 };
    const right = { x: 2, z: 2 };

    expect(grid.getFacilityConnectivity([right, left])).toMatchObject({
      connected: true,
      approachCell: left,
      route: [
        { x: 1, z: 0 },
        { x: 1, z: 1 },
        { x: 1, z: 2 },
        { x: 0, z: 2 },
      ],
    });
  });
});

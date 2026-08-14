import { describe, expect, it } from 'vitest';
import { ParkGrid } from '../src/core/ParkGrid';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { PARK_SAVE_FORMAT, PARK_SAVE_VERSION, parseSave, serializeSave } from '../src/core/saveGame';
import type { ParkSaveDocument } from '../src/core/saveGame';
import {
  LocalSaveBackend,
  MemorySaveBackend,
  resolveSaveBackend,
  type SaveBackend,
} from '../src/core/SaveStore';

function documentFrom(grid: ParkGrid, simulation: ParkSimulation): ParkSaveDocument {
  return {
    format: PARK_SAVE_FORMAT,
    version: PARK_SAVE_VERSION,
    savedAt: 1_700_000_000_000,
    parkName: 'Test Park',
    started: true,
    grid: grid.getSaveState(),
    simulation: simulation.getSaveState(),
    buildings: [{ id: 'a', kind: 'carousel', x: 4, z: -6, rotation: Math.PI / 2 }],
    player: { x: 1.5, z: 18.5 },
  };
}

describe('ParkGrid persistence', () => {
  it('round-trips owned land and drawn paths', () => {
    const source = new ParkGrid();
    source.purchaseParcel('south-promenade');
    source.construct([{ x: 0, z: -21 }, { x: 0, z: -22 }], 'road');

    const restored = new ParkGrid();
    expect(restored.loadSaveState(source.getSaveState())).toBe(true);
    expect(restored.isOwned({ x: 0, z: -22 })).toBe(true);
    expect(restored.getSurface({ x: 0, z: -21 })).toBe('road');
    expect(restored.getSurface({ x: 0, z: -22 })).toBe('road');
    expect(restored.getSaveState()).toEqual(source.getSaveState());
  });

  it('preserves the default promenades through a round trip', () => {
    const source = new ParkGrid();
    const before = source.getReachableCells().length;
    const restored = new ParkGrid();
    restored.loadSaveState(source.getSaveState());
    expect(restored.getReachableCells().length).toBe(before);
  });

  it('keeps the starting parcel owned even if a save omits it', () => {
    const grid = new ParkGrid();
    expect(grid.loadSaveState({ ownedParcelIds: [], surfaceRuns: [0, 64 * 66] })).toBe(true);
    expect(grid.isOwned({ x: 0, z: 0 })).toBe(true);
  });

  it('rejects a save whose runs do not cover the grid', () => {
    const grid = new ParkGrid();
    const before = grid.getSaveState();
    expect(grid.loadSaveState({ ownedParcelIds: [], surfaceRuns: [0, 10] })).toBe(false);
    expect(grid.getSaveState()).toEqual(before);
  });

  it('rejects odd-length, out-of-range, and unknown-parcel saves', () => {
    const grid = new ParkGrid();
    expect(grid.loadSaveState({ ownedParcelIds: [], surfaceRuns: [0] })).toBe(false);
    expect(grid.loadSaveState({ ownedParcelIds: [], surfaceRuns: [7, 64 * 66] })).toBe(false);
    expect(grid.loadSaveState({ ownedParcelIds: ['moon-base'], surfaceRuns: [0, 64 * 66] })).toBe(false);
  });

  it('rejects paths on land the save does not own', () => {
    const source = new ParkGrid();
    source.purchaseParcel('south-promenade');
    source.construct([{ x: 0, z: -25 }], 'sidewalk');
    const state = source.getSaveState();

    const restored = new ParkGrid();
    expect(
      restored.loadSaveState({ ownedParcelIds: [], surfaceRuns: state.surfaceRuns }),
    ).toBe(false);
  });
});

describe('ParkSimulation persistence', () => {
  it('round-trips the books and any litter left behind', () => {
    const source = new ParkSimulation();
    source.spend(1_000);
    const state = source.getSaveState();

    const restored = new ParkSimulation();
    restored.loadSaveState(state);
    expect(restored.getStats().cash).toBe(source.getStats().cash);
    expect(restored.getStats().expenses).toBe(source.getStats().expenses);
  });

  it('replaces non-finite values with safe defaults instead of spreading NaN', () => {
    const simulation = new ParkSimulation();
    simulation.loadSaveState({
      stats: {
        cash: Number.NaN,
        reputation: 900,
        cleanliness: -4,
        guestCount: 12,
        guestsServed: Number.POSITIVE_INFINITY,
        guestsVisited: 3,
        litterCleaned: 2,
        revenue: 10,
        expenses: 5,
        day: 0,
        minuteOfDay: 99_999,
      },
      litter: [],
      nextGuestId: Number.NaN,
      nextLitterId: 4,
    });

    const stats = simulation.getStats();
    expect(Number.isFinite(stats.cash)).toBe(true);
    expect(stats.reputation).toBe(100);
    expect(stats.cleanliness).toBe(0);
    expect(stats.guestsServed).toBe(0);
    expect(stats.day).toBe(1);
    expect(stats.minuteOfDay).toBe(21 * 60);
    expect(stats.guestCount).toBe(0);
  });

  it('drops litter entries with unusable positions', () => {
    const simulation = new ParkSimulation();
    simulation.loadSaveState({
      stats: simulation.getStats(),
      litter: [
        { id: 'keep', position: { x: 2, z: 3 }, variant: 1, age: 5 },
        { id: 'drop', position: { x: Number.NaN, z: 3 }, variant: 1, age: 5 },
      ],
      nextGuestId: 1,
      nextLitterId: 1,
    });
    expect(simulation.getLitter().map((item) => item.id)).toEqual(['keep']);
  });
});

describe('save documents', () => {
  it('round-trips through JSON', () => {
    const grid = new ParkGrid();
    grid.purchaseParcel('west-grove');
    const simulation = new ParkSimulation();
    const original = documentFrom(grid, simulation);

    const { save, warnings } = parseSave(serializeSave(original));
    expect(warnings).toEqual([]);
    expect(save?.parkName).toBe('Test Park');
    expect(save?.buildings).toEqual(original.buildings);
    expect(save?.grid.ownedParcelIds).toContain('west-grove');
  });

  it('refuses text that is not a park', () => {
    expect(parseSave('not json').save).toBeNull();
    expect(parseSave('{"format":"something-else"}').save).toBeNull();
    expect(parseSave(JSON.stringify({ format: PARK_SAVE_FORMAT, version: 99 })).save).toBeNull();
  });

  it('drops buildings whose kind no longer exists but keeps the park', () => {
    const grid = new ParkGrid();
    const simulation = new ParkSimulation();
    const document = documentFrom(grid, simulation);
    const text = JSON.stringify({
      ...document,
      buildings: [
        ...document.buildings,
        { id: 'ghost', kind: 'monorail', x: 0, z: 0, rotation: 0 },
      ],
    });

    const { save, warnings } = parseSave(text);
    expect(save?.buildings.map((building) => building.kind)).toEqual(['carousel']);
    expect(warnings.join(' ')).toContain('could not be rebuilt');
  });
});

describe('save backends', () => {
  it('prefers a backend supplied by the host page', () => {
    const cloud: SaveBackend = {
      name: 'cloud',
      label: 'your Heartbeat account',
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    };
    expect(resolveSaveBackend({ createSaveBackend: () => cloud })).toBe(cloud);
  });

  it('falls back when the host offers nothing or throws', () => {
    const fallbackName = LocalSaveBackend.isAvailable() ? 'local' : 'memory';
    expect(resolveSaveBackend({}).name).toBe(fallbackName);
    expect(
      resolveSaveBackend({
        createSaveBackend: () => {
          throw new Error('no session');
        },
      }).name,
    ).toBe(fallbackName);
  });

  it('keeps a park for the session in memory', async () => {
    const backend = new MemorySaveBackend();
    expect(await backend.load()).toBeNull();
    await backend.save('park');
    expect(await backend.load()).toBe('park');
    await backend.clear();
    expect(await backend.load()).toBeNull();
  });
});

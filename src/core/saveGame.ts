/**
 * Save documents for Parkworks Tycoon.
 *
 * A save is a self-contained, portable description of one park: the land the
 * player owns, the paths they drew, every building they placed, and the park's
 * books. It deliberately carries no engine state, no Three.js objects, and no
 * absolute URLs, so the same document can be stored in a browser, uploaded to
 * Supabase, or handed to another player without translation.
 */
import { SPEC_BY_KIND } from './catalog';
import type { ParkGridSaveState } from './ParkGrid';
import type { ParkSimulationSaveState } from './ParkSimulation';
import type { PlaceableKind } from './types';

export const PARK_SAVE_FORMAT = 'parkworks-tycoon-save' as const;
export const PARK_SAVE_VERSION = 1 as const;

export interface SavedBuilding {
  id: string;
  kind: PlaceableKind;
  x: number;
  z: number;
  rotation: number;
}

export interface ParkSaveDocument {
  format: typeof PARK_SAVE_FORMAT;
  version: number;
  /** Epoch milliseconds at write time; drives the away report on load. */
  savedAt: number;
  parkName: string;
  /** False when the player saved before opening the gates for the first time. */
  started: boolean;
  grid: ParkGridSaveState;
  simulation: ParkSimulationSaveState;
  buildings: readonly SavedBuilding[];
  player: { x: number; z: number };
}

export interface ParseSaveResult {
  save: ParkSaveDocument | null;
  /** Player-facing notes about anything that could not be restored verbatim. */
  warnings: readonly string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function serializeSave(save: ParkSaveDocument): string {
  return JSON.stringify(save);
}

/**
 * Parses and validates a save document.
 *
 * Anything structurally wrong yields a null save, which the caller treats as
 * "start a new park" rather than an error. Buildings whose kind no longer
 * exists in the catalog are dropped with a warning instead of failing the whole
 * load, so renaming or retiring a ride never strands a player's park.
 */
export function parseSave(text: string): ParseSaveResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { save: null, warnings: ['That save could not be read.'] };
  }

  if (!isRecord(parsed)) return { save: null, warnings: ['That save is not a park.'] };
  if (parsed.format !== PARK_SAVE_FORMAT) {
    return { save: null, warnings: ['That file is not a Parkworks park.'] };
  }
  if (!isFiniteNumber(parsed.version) || parsed.version > PARK_SAVE_VERSION) {
    return { save: null, warnings: ['That park was saved by a newer version of the game.'] };
  }

  const grid = parsed.grid;
  const simulation = parsed.simulation;
  if (!isRecord(grid) || !Array.isArray(grid.ownedParcelIds) || !Array.isArray(grid.surfaceRuns)) {
    return { save: null, warnings: ['That park is missing its land.'] };
  }
  if (!isRecord(simulation) || !isRecord(simulation.stats)) {
    return { save: null, warnings: ['That park is missing its accounts.'] };
  }

  const rawBuildings = Array.isArray(parsed.buildings) ? parsed.buildings : [];
  const buildings: SavedBuilding[] = [];
  let unknownKinds = 0;
  for (const entry of rawBuildings) {
    if (!isRecord(entry)) continue;
    if (typeof entry.kind !== 'string' || !SPEC_BY_KIND.has(entry.kind as PlaceableKind)) {
      unknownKinds += 1;
      continue;
    }
    if (!isFiniteNumber(entry.x) || !isFiniteNumber(entry.z)) continue;
    buildings.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : `restored-${buildings.length + 1}`,
      kind: entry.kind as PlaceableKind,
      x: entry.x,
      z: entry.z,
      rotation: isFiniteNumber(entry.rotation) ? entry.rotation : 0,
    });
  }
  if (unknownKinds > 0) {
    warnings.push(
      `${unknownKinds} building${unknownKinds === 1 ? '' : 's'} from an older version could not be rebuilt.`,
    );
  }

  const player = isRecord(parsed.player) ? parsed.player : {};

  return {
    save: {
      format: PARK_SAVE_FORMAT,
      version: PARK_SAVE_VERSION,
      savedAt: isFiniteNumber(parsed.savedAt) ? parsed.savedAt : 0,
      parkName: typeof parsed.parkName === 'string' && parsed.parkName ? parsed.parkName : 'My Park',
      started: parsed.started === true,
      grid: {
        ownedParcelIds: grid.ownedParcelIds.filter(
          (id: unknown): id is string => typeof id === 'string',
        ),
        surfaceRuns: grid.surfaceRuns.filter(isFiniteNumber),
      },
      simulation: simulation as unknown as ParkSimulationSaveState,
      buildings,
      player: {
        x: isFiniteNumber(player.x) ? player.x : 0,
        z: isFiniteNumber(player.z) ? player.z : 18.5,
      },
    },
    warnings,
  };
}

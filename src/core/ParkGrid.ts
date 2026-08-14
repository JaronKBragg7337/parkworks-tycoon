/**
 * Deterministic one-metre land, surface, and pedestrian navigation grid.
 *
 * Grid coordinates are integer world-space cell centres. Cell bounds and parcel
 * bounds are inclusive, so the default x range of -32..31 is exactly 64 metres.
 * Roads and sidewalks are both pedestrian graph nodes; lawn is never walkable.
 */

export const PARK_GRID_CELL_SIZE_METERS = 1 as const;

export type SurfaceType = 'lawn' | 'sidewalk' | 'road';
export type WalkableSurface = Exclude<SurfaceType, 'lawn'>;

export interface GridCell {
  x: number;
  z: number;
}

/** Inclusive integer cell bounds. */
export interface CellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ParkGridBoundsSnapshot extends CellBounds {
  width: number;
  height: number;
}

export interface ParcelDefinition {
  id: string;
  name: string;
  bounds: CellBounds;
  cost: number;
  initiallyOwned?: boolean;
}

export type ParcelStatus = 'owned' | 'available' | 'locked';

export interface ParcelSnapshot {
  id: string;
  name: string;
  bounds: CellBounds;
  area: number;
  cost: number;
  owned: boolean;
  purchasable: boolean;
  status: ParcelStatus;
  adjacentParcelIds: readonly string[];
  adjacentOwnedParcelIds: readonly string[];
}

export interface InitialSurfaceDefinition {
  surface: WalkableSurface;
  cells: readonly GridCell[];
}

export interface ParkGridCosts {
  construction: Readonly<Record<WalkableSurface, number>>;
  demolition: Readonly<Record<WalkableSurface, number>>;
}

export interface ParkGridCostOverrides {
  construction?: Partial<Record<WalkableSurface, number>>;
  demolition?: Partial<Record<WalkableSurface, number>>;
}

export interface ParkGridOptions {
  bounds?: CellBounds;
  entrance?: GridCell;
  parcels?: readonly ParcelDefinition[];
  costs?: ParkGridCostOverrides;
  /**
   * Explicit initial surfaces. Pass an empty array for a lawn-only custom map.
   * The built-in promenades are seeded only when using the default geometry and
   * this property is omitted.
   */
  initialSurfaces?: readonly InitialSurfaceDefinition[];
}

export type SurfaceOperation = 'construct' | 'demolish';

export type SurfaceOperationInvalidReason =
  | 'empty-selection'
  | 'invalid-cell'
  | 'out-of-bounds'
  | 'unowned-land'
  | 'surface-not-lawn'
  | 'surface-is-lawn';

export interface SurfaceOperationQuote {
  valid: boolean;
  operation: SurfaceOperation;
  targetSurface: WalkableSurface | null;
  cells: readonly GridCell[];
  cellCount: number;
  cost: number;
  reason: SurfaceOperationInvalidReason | null;
  invalidCell: GridCell | null;
}

export interface SurfaceOperationResult extends SurfaceOperationQuote {
  applied: boolean;
}

export type ParcelPurchaseInvalidReason =
  | 'unknown-parcel'
  | 'already-owned'
  | 'not-adjacent';

export interface ParcelPurchaseQuote {
  valid: boolean;
  parcelId: string;
  cost: number;
  reason: ParcelPurchaseInvalidReason | null;
}

export interface ParcelPurchaseResult extends ParcelPurchaseQuote {
  purchased: boolean;
}

export interface ParkGridCellSnapshot extends GridCell {
  surface: SurfaceType;
  walkable: boolean;
  owned: boolean;
  parcelId: string | null;
}

/** Persistence view of everything the player changed about the land itself. */
export interface ParkGridSaveState {
  ownedParcelIds: readonly string[];
  /** Row-major surface codes as [code, count, code, count, ...]. */
  surfaceRuns: readonly number[];
}

export interface ParkGridSnapshot {
  revision: number;
  cellSizeMeters: typeof PARK_GRID_CELL_SIZE_METERS;
  bounds: ParkGridBoundsSnapshot;
  entrance: GridCell;
  cells: readonly ParkGridCellSnapshot[];
  parcels: readonly ParcelSnapshot[];
}

export interface PathNodeSnapshot {
  cell: GridCell;
  surface: WalkableSurface;
  neighbors: readonly GridCell[];
}

export type FacilityConnectivityFailure =
  | 'entrance-not-walkable'
  | 'no-walkable-approach'
  | 'no-route';

export interface FacilityConnectivity {
  connected: boolean;
  entrance: GridCell;
  approachCell: GridCell | null;
  /** Ordered from the park entrance to the chosen facility approach cell. */
  route: readonly GridCell[] | null;
  reason: FacilityConnectivityFailure | null;
}

export const DEFAULT_GRID_BOUNDS: Readonly<CellBounds> = Object.freeze({
  minX: -32,
  maxX: 31,
  minZ: -33,
  maxZ: 32,
});

export const DEFAULT_ENTRANCE_CELL: Readonly<GridCell> = Object.freeze({ x: 0, z: 32 });

export const DEFAULT_SURFACE_COSTS: Readonly<ParkGridCosts> = Object.freeze({
  construction: Object.freeze({ sidewalk: 10, road: 18 }),
  demolition: Object.freeze({ sidewalk: 2, road: 3 }),
});

/**
 * Default parcel plan for the existing 64 x 66 metre park. Founder's Park is
 * the initial rectangular holding. The two lower corner parcels become
 * available only after a parcel sharing one of their cardinal edges is owned.
 */
export const DEFAULT_PARCELS: readonly ParcelDefinition[] = Object.freeze([
  {
    id: 'founders-park',
    name: "Founder's Park",
    bounds: Object.freeze({ minX: -12, maxX: 11, minZ: -20, maxZ: 32 }),
    cost: 0,
    initiallyOwned: true,
  },
  {
    id: 'south-promenade',
    name: 'South Promenade',
    bounds: Object.freeze({ minX: -12, maxX: 11, minZ: -33, maxZ: -21 }),
    cost: 950,
  },
  {
    id: 'west-grove',
    name: 'West Grove',
    bounds: Object.freeze({ minX: -32, maxX: -13, minZ: 6, maxZ: 32 }),
    cost: 1_600,
  },
  {
    id: 'west-meadow',
    name: 'West Meadow',
    bounds: Object.freeze({ minX: -32, maxX: -13, minZ: -20, maxZ: 5 }),
    cost: 1_500,
  },
  {
    id: 'west-corner',
    name: 'West Corner',
    bounds: Object.freeze({ minX: -32, maxX: -13, minZ: -33, maxZ: -21 }),
    cost: 1_100,
  },
  {
    id: 'east-grove',
    name: 'East Grove',
    bounds: Object.freeze({ minX: 12, maxX: 31, minZ: 6, maxZ: 32 }),
    cost: 1_650,
  },
  {
    id: 'east-meadow',
    name: 'East Meadow',
    bounds: Object.freeze({ minX: 12, maxX: 31, minZ: -20, maxZ: 5 }),
    cost: 1_550,
  },
  {
    id: 'east-corner',
    name: 'East Corner',
    bounds: Object.freeze({ minX: 12, maxX: 31, minZ: -33, maxZ: -21 }),
    cost: 1_150,
  },
]);

/** North, east, south, west. This order is the routing tie-break rule. */
export const CARDINAL_NEIGHBOR_OFFSETS: readonly Readonly<GridCell>[] = Object.freeze([
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: 0, z: -1 }),
  Object.freeze({ x: -1, z: 0 }),
]);

const SURFACE_TO_CODE: Readonly<Record<SurfaceType, number>> = {
  lawn: 0,
  sidewalk: 1,
  road: 2,
};

const CODE_TO_SURFACE = ['lawn', 'sidewalk', 'road'] as const;

interface ParcelRuntime {
  definition: ParcelDefinition;
  owned: boolean;
}

function copyCell(cell: GridCell): GridCell {
  return { x: cell.x, z: cell.z };
}

function copyBounds(bounds: CellBounds): CellBounds {
  return { ...bounds };
}

function isIntegerCell(cell: GridCell): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.z);
}

function validateBounds(bounds: CellBounds, label: string): void {
  if (
    !Number.isInteger(bounds.minX) ||
    !Number.isInteger(bounds.maxX) ||
    !Number.isInteger(bounds.minZ) ||
    !Number.isInteger(bounds.maxZ) ||
    bounds.minX > bounds.maxX ||
    bounds.minZ > bounds.maxZ
  ) {
    throw new Error(`${label} must use ordered, inclusive integer bounds.`);
  }
}

function validateCost(cost: number, label: string): void {
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error(`${label} must be a finite, non-negative number.`);
  }
}

function rectsOverlap(a: CellBounds, b: CellBounds): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return Math.max(aMin, bMin) <= Math.min(aMax, bMax);
}

function shareCardinalEdge(a: CellBounds, b: CellBounds): boolean {
  const shareVerticalEdge =
    (a.maxX + 1 === b.minX || b.maxX + 1 === a.minX) &&
    rangesOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ);
  const shareHorizontalEdge =
    (a.maxZ + 1 === b.minZ || b.maxZ + 1 === a.minZ) &&
    rangesOverlap(a.minX, a.maxX, b.minX, b.maxX);
  return shareVerticalEdge || shareHorizontalEdge;
}

function compareCells(a: GridCell, b: GridCell): number {
  return a.z - b.z || a.x - b.x;
}

function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.z}`;
}

function normalizeCells(cells: readonly GridCell[]): GridCell[] {
  const unique = new Map<string, GridCell>();
  for (const cell of cells) unique.set(cellKey(cell), copyCell(cell));
  return [...unique.values()].sort(compareCells);
}

function areaOf(bounds: CellBounds): number {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxZ - bounds.minZ + 1);
}

/** Enumerates an inclusive cell rectangle in stable row-major (z, then x) order. */
export function cellsInBounds(bounds: CellBounds): readonly GridCell[] {
  validateBounds(bounds, 'Cell rectangle');
  const cells: GridCell[] = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) cells.push({ x, z });
  }
  return cells;
}

/**
 * Mutable gameplay state with immutable/copy-on-read public snapshots.
 * Economy state intentionally lives outside this class: quote first, verify the
 * caller's cash, then apply and debit exactly the returned cost.
 */
export class ParkGrid {
  readonly cellSizeMeters = PARK_GRID_CELL_SIZE_METERS;

  private readonly bounds: CellBounds;
  private readonly width: number;
  private readonly height: number;
  private readonly entrance: GridCell;
  private readonly costs: ParkGridCosts;
  private readonly surfaces: Uint8Array;
  private readonly parcels = new Map<string, ParcelRuntime>();
  private readonly parcelIdByCell: Array<string | null>;
  private revision = 0;

  constructor(options: ParkGridOptions = {}) {
    const usesDefaultGeometry =
      options.bounds === undefined &&
      options.entrance === undefined &&
      options.parcels === undefined;
    this.bounds = copyBounds(options.bounds ?? DEFAULT_GRID_BOUNDS);
    validateBounds(this.bounds, 'Grid');
    this.width = this.bounds.maxX - this.bounds.minX + 1;
    this.height = this.bounds.maxZ - this.bounds.minZ + 1;

    const fallbackEntrance = options.bounds
      ? {
          x: Math.floor((this.bounds.minX + this.bounds.maxX) / 2),
          z: this.bounds.maxZ,
        }
      : DEFAULT_ENTRANCE_CELL;
    this.entrance = copyCell(options.entrance ?? fallbackEntrance);
    if (!isIntegerCell(this.entrance) || !this.contains(this.entrance)) {
      throw new Error('Entrance must be an integer cell inside the grid.');
    }

    this.costs = {
      construction: {
        ...DEFAULT_SURFACE_COSTS.construction,
        ...options.costs?.construction,
      },
      demolition: {
        ...DEFAULT_SURFACE_COSTS.demolition,
        ...options.costs?.demolition,
      },
    };
    validateCost(this.costs.construction.sidewalk, 'Sidewalk construction cost');
    validateCost(this.costs.construction.road, 'Road construction cost');
    validateCost(this.costs.demolition.sidewalk, 'Sidewalk demolition cost');
    validateCost(this.costs.demolition.road, 'Road demolition cost');

    this.surfaces = new Uint8Array(this.width * this.height);
    this.parcelIdByCell = new Array<string | null>(this.width * this.height).fill(null);

    const parcelDefinitions = options.parcels ??
      (options.bounds
        ? [
            {
              id: 'founders-park',
              name: "Founder's Park",
              bounds: this.bounds,
              cost: 0,
              initiallyOwned: true,
            },
          ]
        : DEFAULT_PARCELS);
    this.initializeParcels(parcelDefinitions);

    if (options.initialSurfaces !== undefined) {
      this.initializeSurfaces(options.initialSurfaces);
    } else if (usesDefaultGeometry) {
      this.initializeDefaultPromenades();
    }
  }

  getRevision(): number {
    return this.revision;
  }

  getBounds(): ParkGridBoundsSnapshot {
    return { ...this.bounds, width: this.width, height: this.height };
  }

  getEntranceCell(): GridCell {
    return copyCell(this.entrance);
  }

  getCosts(): ParkGridCosts {
    return {
      construction: { ...this.costs.construction },
      demolition: { ...this.costs.demolition },
    };
  }

  contains(cell: GridCell): boolean {
    return (
      isIntegerCell(cell) &&
      cell.x >= this.bounds.minX &&
      cell.x <= this.bounds.maxX &&
      cell.z >= this.bounds.minZ &&
      cell.z <= this.bounds.maxZ
    );
  }

  /** Maps world x/z to the nearest one-metre cell centre. */
  worldToCell(x: number, z: number): GridCell | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const cell = { x: Math.floor(x + 0.5), z: Math.floor(z + 0.5) };
    return this.contains(cell) ? cell : null;
  }

  /** Grid cells already use world-space centre coordinates; this returns a safe copy. */
  cellToWorld(cell: GridCell): GridCell | null {
    return this.contains(cell) ? copyCell(cell) : null;
  }

  getSurface(cell: GridCell): SurfaceType | null {
    const index = this.indexOf(cell);
    return index < 0 ? null : this.surfaceAtIndex(index);
  }

  isOwned(cell: GridCell): boolean {
    const index = this.indexOf(cell);
    if (index < 0) return false;
    const parcelId = this.parcelIdByCell[index];
    return parcelId !== null && (this.parcels.get(parcelId)?.owned ?? false);
  }

  isWalkable(cell: GridCell): boolean {
    const surface = this.getSurface(cell);
    return surface === 'sidewalk' || surface === 'road';
  }

  getCell(cell: GridCell): ParkGridCellSnapshot | null {
    const index = this.indexOf(cell);
    if (index < 0) return null;
    return this.cellSnapshot(index);
  }

  getCells(): readonly ParkGridCellSnapshot[] {
    return Array.from({ length: this.surfaces.length }, (_, index) => this.cellSnapshot(index));
  }

  getSnapshot(): ParkGridSnapshot {
    return {
      revision: this.revision,
      cellSizeMeters: PARK_GRID_CELL_SIZE_METERS,
      bounds: this.getBounds(),
      entrance: this.getEntranceCell(),
      cells: this.getCells(),
      parcels: this.getParcelSnapshots(),
    };
  }

  /**
   * Compact persistence view: owned parcels plus run-length encoded surfaces in
   * row-major cell order. Parcel definitions, bounds, and costs are rebuilt from
   * code, so a save never pins the map layout to whatever shipped that day.
   */
  getSaveState(): ParkGridSaveState {
    const surfaceRuns: number[] = [];
    let runCode = this.surfaces[0] ?? 0;
    let runLength = 0;
    for (let index = 0; index < this.surfaces.length; index += 1) {
      const code = this.surfaces[index] ?? 0;
      if (code === runCode) {
        runLength += 1;
        continue;
      }
      surfaceRuns.push(runCode, runLength);
      runCode = code;
      runLength = 1;
    }
    if (runLength > 0) surfaceRuns.push(runCode, runLength);

    return {
      ownedParcelIds: [...this.parcels.values()]
        .filter((parcel) => parcel.owned)
        .map((parcel) => parcel.definition.id),
      surfaceRuns,
    };
  }

  /**
   * Restores a save produced by getSaveState. Returns false and leaves the grid
   * untouched when the state does not fit this map, so a stale or corrupt save
   * degrades to a new park instead of a broken one.
   */
  loadSaveState(state: ParkGridSaveState): boolean {
    if (!state || !Array.isArray(state.ownedParcelIds) || !Array.isArray(state.surfaceRuns)) {
      return false;
    }
    if (state.surfaceRuns.length % 2 !== 0) return false;
    for (const parcelId of state.ownedParcelIds) {
      if (!this.parcels.has(parcelId)) return false;
    }

    const decoded = new Uint8Array(this.surfaces.length);
    let cursor = 0;
    for (let index = 0; index < state.surfaceRuns.length; index += 2) {
      const code = state.surfaceRuns[index] ?? -1;
      const length = state.surfaceRuns[index + 1] ?? -1;
      if (!Number.isInteger(code) || code < 0 || code >= CODE_TO_SURFACE.length) return false;
      if (!Number.isInteger(length) || length < 0) return false;
      if (cursor + length > decoded.length) return false;
      decoded.fill(code, cursor, cursor + length);
      cursor += length;
    }
    if (cursor !== decoded.length) return false;

    const owned = new Set(state.ownedParcelIds);
    for (const parcel of this.parcels.values()) {
      if (parcel.definition.initiallyOwned) owned.add(parcel.definition.id);
    }
    // Surfaces may only exist on owned land; reject rather than silently repair,
    // because a mismatch means the save and the map disagree about the world.
    for (let index = 0; index < decoded.length; index += 1) {
      if (decoded[index] === SURFACE_TO_CODE.lawn) continue;
      const parcelId = this.parcelIdByCell[index];
      if (!parcelId || !owned.has(parcelId)) return false;
    }

    for (const parcel of this.parcels.values()) {
      parcel.owned = owned.has(parcel.definition.id);
    }
    this.surfaces.set(decoded);
    this.revision += 1;
    return true;
  }

  getParcelSnapshots(): readonly ParcelSnapshot[] {
    return [...this.parcels.values()].map((parcel) => this.parcelSnapshot(parcel));
  }

  getParcelSnapshot(parcelId: string): ParcelSnapshot | null {
    const parcel = this.parcels.get(parcelId);
    return parcel ? this.parcelSnapshot(parcel) : null;
  }

  quoteParcelPurchase(parcelId: string): ParcelPurchaseQuote {
    const parcel = this.parcels.get(parcelId);
    if (!parcel) {
      return { valid: false, parcelId, cost: 0, reason: 'unknown-parcel' };
    }
    if (parcel.owned) {
      return { valid: false, parcelId, cost: parcel.definition.cost, reason: 'already-owned' };
    }
    if (!this.getAdjacentParcels(parcel).some((candidate) => candidate.owned)) {
      return { valid: false, parcelId, cost: parcel.definition.cost, reason: 'not-adjacent' };
    }
    return { valid: true, parcelId, cost: parcel.definition.cost, reason: null };
  }

  /**
   * Purchases a parcel after an economy preflight. This class does not hold or
   * debit cash; use quoteParcelPurchase before calling when funds may be short.
   */
  purchaseParcel(parcelId: string): ParcelPurchaseResult {
    const quote = this.quoteParcelPurchase(parcelId);
    if (!quote.valid) return { ...quote, purchased: false };
    const parcel = this.parcels.get(parcelId);
    if (!parcel) return { ...quote, valid: false, reason: 'unknown-parcel', purchased: false };
    parcel.owned = true;
    this.revision += 1;
    return { ...quote, purchased: true };
  }

  quoteConstruction(
    cells: readonly GridCell[],
    surface: WalkableSurface,
  ): SurfaceOperationQuote {
    const base = this.validateCellSelection(cells, 'construct', surface);
    if (!base.valid) return base;
    for (const cell of base.cells) {
      if (!this.isOwned(cell)) return this.invalidSurfaceQuote(base, 'unowned-land', cell);
      if (this.getSurface(cell) !== 'lawn') {
        return this.invalidSurfaceQuote(base, 'surface-not-lawn', cell);
      }
    }
    return {
      ...base,
      cost: base.cellCount * this.costs.construction[surface],
    };
  }

  /** Applies an all-or-nothing road/sidewalk construction selection. */
  construct(cells: readonly GridCell[], surface: WalkableSurface): SurfaceOperationResult {
    const quote = this.quoteConstruction(cells, surface);
    if (!quote.valid) return { ...quote, applied: false };
    for (const cell of quote.cells) this.setSurface(cell, surface);
    this.revision += 1;
    return { ...quote, applied: true };
  }

  quoteDemolition(cells: readonly GridCell[]): SurfaceOperationQuote {
    const base = this.validateCellSelection(cells, 'demolish', null);
    if (!base.valid) return base;
    let cost = 0;
    for (const cell of base.cells) {
      if (!this.isOwned(cell)) return this.invalidSurfaceQuote(base, 'unowned-land', cell);
      const surface = this.getSurface(cell);
      if (surface === null || surface === 'lawn') {
        return this.invalidSurfaceQuote(base, 'surface-is-lawn', cell);
      }
      cost += this.costs.demolition[surface];
    }
    return { ...base, cost };
  }

  /** Applies an all-or-nothing demolition, returning affected cells to lawn. */
  demolish(cells: readonly GridCell[]): SurfaceOperationResult {
    const quote = this.quoteDemolition(cells);
    if (!quote.valid) return { ...quote, applied: false };
    for (const cell of quote.cells) this.setSurface(cell, 'lawn');
    this.revision += 1;
    return { ...quote, applied: true };
  }

  /** Cardinal walkable neighbors in the documented north/east/south/west order. */
  getWalkableNeighbors(cell: GridCell): readonly GridCell[] {
    if (!this.isWalkable(cell)) return [];
    const neighbors: GridCell[] = [];
    for (const offset of CARDINAL_NEIGHBOR_OFFSETS) {
      const candidate = { x: cell.x + offset.x, z: cell.z + offset.z };
      if (this.isWalkable(candidate)) neighbors.push(candidate);
    }
    return neighbors;
  }

  getPathGraphSnapshot(): readonly PathNodeSnapshot[] {
    const nodes: PathNodeSnapshot[] = [];
    for (let index = 0; index < this.surfaces.length; index += 1) {
      const surface = this.surfaceAtIndex(index);
      if (surface === 'lawn') continue;
      const cell = this.cellFromIndex(index);
      nodes.push({ cell, surface, neighbors: this.getWalkableNeighbors(cell) });
    }
    return nodes;
  }

  /**
   * Breadth-first discovery order for the connected path component containing
   * start. Omitting start returns every path cell guests can reach from the gate.
   */
  getReachableCells(start: GridCell = this.entrance): readonly GridCell[] {
    const startIndex = this.indexOf(start);
    if (startIndex < 0 || !this.isWalkable(start)) return [];

    const visited = new Uint8Array(this.surfaces.length);
    const queue = new Int32Array(this.surfaces.length);
    const reachable: GridCell[] = [];
    let queueHead = 0;
    let queueLength = 1;
    visited[startIndex] = 1;
    queue[0] = startIndex;

    while (queueHead < queueLength) {
      const currentIndex = queue[queueHead];
      queueHead += 1;
      const current = this.cellFromIndex(currentIndex);
      reachable.push(current);
      for (const offset of CARDINAL_NEIGHBOR_OFFSETS) {
        const neighbor = { x: current.x + offset.x, z: current.z + offset.z };
        const neighborIndex = this.indexOf(neighbor);
        if (neighborIndex < 0 || visited[neighborIndex] === 1 || !this.isWalkable(neighbor)) {
          continue;
        }
        visited[neighborIndex] = 1;
        queue[queueLength] = neighborIndex;
        queueLength += 1;
      }
    }
    return reachable;
  }

  /**
   * Deterministic unweighted shortest path. Both endpoints are included. Ties
   * are resolved north, east, south, then west at every breadth-first step.
   */
  findRoute(start: GridCell, goal: GridCell): readonly GridCell[] | null {
    const startIndex = this.indexOf(start);
    const goalIndex = this.indexOf(goal);
    if (startIndex < 0 || goalIndex < 0 || !this.isWalkable(start) || !this.isWalkable(goal)) {
      return null;
    }
    if (startIndex === goalIndex) return [copyCell(start)];

    const predecessor = new Int32Array(this.surfaces.length);
    predecessor.fill(-2);
    predecessor[startIndex] = -1;
    const queue = new Int32Array(this.surfaces.length);
    let queueHead = 0;
    let queueLength = 1;
    queue[0] = startIndex;

    while (queueHead < queueLength) {
      const currentIndex = queue[queueHead];
      queueHead += 1;
      const current = this.cellFromIndex(currentIndex);
      for (const offset of CARDINAL_NEIGHBOR_OFFSETS) {
        const neighbor = { x: current.x + offset.x, z: current.z + offset.z };
        const neighborIndex = this.indexOf(neighbor);
        if (
          neighborIndex < 0 ||
          predecessor[neighborIndex] !== -2 ||
          !this.isWalkable(neighbor)
        ) {
          continue;
        }
        predecessor[neighborIndex] = currentIndex;
        if (neighborIndex === goalIndex) {
          return this.reconstructRoute(predecessor, goalIndex);
        }
        queue[queueLength] = neighborIndex;
        queueLength += 1;
      }
    }
    return null;
  }

  /**
   * Finds the shortest entrance route to any supplied facility approach cell.
   * Equal choices use stable cell ordering (z, then x), independent of input order.
   */
  getFacilityConnectivity(approachCells: readonly GridCell[]): FacilityConnectivity {
    if (!this.isWalkable(this.entrance)) {
      return {
        connected: false,
        entrance: this.getEntranceCell(),
        approachCell: null,
        route: null,
        reason: 'entrance-not-walkable',
      };
    }

    const candidates = normalizeCells(
      approachCells.filter((cell) => isIntegerCell(cell) && this.isWalkable(cell)),
    );
    if (candidates.length === 0) {
      return {
        connected: false,
        entrance: this.getEntranceCell(),
        approachCell: null,
        route: null,
        reason: 'no-walkable-approach',
      };
    }

    let chosenCell: GridCell | null = null;
    let chosenRoute: readonly GridCell[] | null = null;
    for (const candidate of candidates) {
      const route = this.findRoute(this.entrance, candidate);
      if (route && (chosenRoute === null || route.length < chosenRoute.length)) {
        chosenCell = candidate;
        chosenRoute = route;
      }
    }

    if (!chosenCell || !chosenRoute) {
      return {
        connected: false,
        entrance: this.getEntranceCell(),
        approachCell: null,
        route: null,
        reason: 'no-route',
      };
    }
    return {
      connected: true,
      entrance: this.getEntranceCell(),
      approachCell: copyCell(chosenCell),
      route: chosenRoute,
      reason: null,
    };
  }

  isFacilityConnected(approachCells: readonly GridCell[]): boolean {
    return this.getFacilityConnectivity(approachCells).connected;
  }

  /**
   * Returns the cardinal ring immediately outside an inclusive facility
   * footprint. The connectivity method will filter this ring to built paths.
   */
  getApproachCells(footprint: CellBounds): readonly GridCell[] {
    validateBounds(footprint, 'Facility footprint');
    const cells: GridCell[] = [];
    for (let x = footprint.minX; x <= footprint.maxX; x += 1) {
      cells.push({ x, z: footprint.maxZ + 1 }, { x, z: footprint.minZ - 1 });
    }
    for (let z = footprint.minZ; z <= footprint.maxZ; z += 1) {
      cells.push({ x: footprint.maxX + 1, z }, { x: footprint.minX - 1, z });
    }
    return normalizeCells(cells.filter((cell) => this.contains(cell)));
  }

  private initializeParcels(definitions: readonly ParcelDefinition[]): void {
    if (definitions.length === 0) throw new Error('At least one parcel is required.');
    for (const source of definitions) {
      if (!source.id.trim()) throw new Error('Parcel ids cannot be empty.');
      if (this.parcels.has(source.id)) throw new Error(`Duplicate parcel id: ${source.id}`);
      validateBounds(source.bounds, `Parcel ${source.id}`);
      validateCost(source.cost, `Parcel ${source.id} cost`);
      if (
        source.bounds.minX < this.bounds.minX ||
        source.bounds.maxX > this.bounds.maxX ||
        source.bounds.minZ < this.bounds.minZ ||
        source.bounds.maxZ > this.bounds.maxZ
      ) {
        throw new Error(`Parcel ${source.id} lies outside the grid.`);
      }
      for (const existing of this.parcels.values()) {
        if (rectsOverlap(source.bounds, existing.definition.bounds)) {
          throw new Error(`Parcel ${source.id} overlaps parcel ${existing.definition.id}.`);
        }
      }

      const definition: ParcelDefinition = {
        id: source.id,
        name: source.name,
        bounds: copyBounds(source.bounds),
        cost: source.cost,
        initiallyOwned: source.initiallyOwned ?? false,
      };
      this.parcels.set(definition.id, {
        definition,
        owned: definition.initiallyOwned ?? false,
      });

      for (const cell of cellsInBounds(definition.bounds)) {
        this.parcelIdByCell[this.indexOf(cell)] = definition.id;
      }
    }
    if (![...this.parcels.values()].some((parcel) => parcel.owned)) {
      throw new Error('At least one parcel must be initially owned.');
    }
  }

  private initializeSurfaces(definitions: readonly InitialSurfaceDefinition[]): void {
    for (const definition of definitions) {
      for (const cell of definition.cells) {
        if (!isIntegerCell(cell) || !this.contains(cell)) {
          throw new Error('Initial surfaces must use integer cells inside the grid.');
        }
        if (!this.isOwned(cell)) {
          throw new Error('Initial surfaces can only be placed on initially owned land.');
        }
        this.setSurface(cell, definition.surface);
      }
    }
  }

  private initializeDefaultPromenades(): void {
    const founder = this.parcels.get('founders-park');
    if (!founder?.owned) return;
    const pathCells: GridCell[] = [];
    for (let z = founder.definition.bounds.minZ; z <= founder.definition.bounds.maxZ; z += 1) {
      for (let x = -2; x <= 2; x += 1) pathCells.push({ x, z });
    }
    for (let z = -2; z <= 2; z += 1) {
      for (
        let x = founder.definition.bounds.minX;
        x <= founder.definition.bounds.maxX;
        x += 1
      ) {
        pathCells.push({ x, z });
      }
    }
    // A seven-metre-wide gate apron makes the entrance connection explicit.
    for (let z = 29; z <= 32; z += 1) {
      for (let x = -3; x <= 3; x += 1) pathCells.push({ x, z });
    }
    for (const cell of normalizeCells(pathCells)) {
      if (this.contains(cell) && this.isOwned(cell)) this.setSurface(cell, 'sidewalk');
    }
  }

  private validateCellSelection(
    selection: readonly GridCell[],
    operation: SurfaceOperation,
    targetSurface: WalkableSurface | null,
  ): SurfaceOperationQuote {
    if (selection.length === 0) {
      return {
        valid: false,
        operation,
        targetSurface,
        cells: [],
        cellCount: 0,
        cost: 0,
        reason: 'empty-selection',
        invalidCell: null,
      };
    }
    const malformed = selection.find((cell) => !isIntegerCell(cell));
    if (malformed) {
      return {
        valid: false,
        operation,
        targetSurface,
        cells: [],
        cellCount: 0,
        cost: 0,
        reason: 'invalid-cell',
        invalidCell: copyCell(malformed),
      };
    }
    const cells = normalizeCells(selection);
    const outside = cells.find((cell) => !this.contains(cell));
    if (outside) {
      return {
        valid: false,
        operation,
        targetSurface,
        cells,
        cellCount: cells.length,
        cost: 0,
        reason: 'out-of-bounds',
        invalidCell: copyCell(outside),
      };
    }
    return {
      valid: true,
      operation,
      targetSurface,
      cells,
      cellCount: cells.length,
      cost: 0,
      reason: null,
      invalidCell: null,
    };
  }

  private invalidSurfaceQuote(
    base: SurfaceOperationQuote,
    reason: SurfaceOperationInvalidReason,
    invalidCell: GridCell,
  ): SurfaceOperationQuote {
    return {
      ...base,
      valid: false,
      cost: 0,
      reason,
      invalidCell: copyCell(invalidCell),
    };
  }

  private parcelSnapshot(parcel: ParcelRuntime): ParcelSnapshot {
    const adjacent = this.getAdjacentParcels(parcel);
    const adjacentOwned = adjacent.filter((candidate) => candidate.owned);
    const purchasable = !parcel.owned && adjacentOwned.length > 0;
    return {
      id: parcel.definition.id,
      name: parcel.definition.name,
      bounds: copyBounds(parcel.definition.bounds),
      area: areaOf(parcel.definition.bounds),
      cost: parcel.definition.cost,
      owned: parcel.owned,
      purchasable,
      status: parcel.owned ? 'owned' : purchasable ? 'available' : 'locked',
      adjacentParcelIds: adjacent.map((candidate) => candidate.definition.id),
      adjacentOwnedParcelIds: adjacentOwned.map((candidate) => candidate.definition.id),
    };
  }

  private getAdjacentParcels(parcel: ParcelRuntime): ParcelRuntime[] {
    return [...this.parcels.values()].filter(
      (candidate) =>
        candidate !== parcel &&
        shareCardinalEdge(parcel.definition.bounds, candidate.definition.bounds),
    );
  }

  private reconstructRoute(predecessor: Int32Array, goalIndex: number): readonly GridCell[] {
    const reversed: GridCell[] = [];
    let current = goalIndex;
    while (current >= 0) {
      reversed.push(this.cellFromIndex(current));
      current = predecessor[current];
    }
    reversed.reverse();
    return reversed;
  }

  private cellSnapshot(index: number): ParkGridCellSnapshot {
    const cell = this.cellFromIndex(index);
    const surface = this.surfaceAtIndex(index);
    const parcelId = this.parcelIdByCell[index];
    return {
      ...cell,
      surface,
      walkable: surface !== 'lawn',
      owned: parcelId !== null && (this.parcels.get(parcelId)?.owned ?? false),
      parcelId,
    };
  }

  private indexOf(cell: GridCell): number {
    if (!this.contains(cell)) return -1;
    return (cell.z - this.bounds.minZ) * this.width + (cell.x - this.bounds.minX);
  }

  private cellFromIndex(index: number): GridCell {
    return {
      x: this.bounds.minX + (index % this.width),
      z: this.bounds.minZ + Math.floor(index / this.width),
    };
  }

  private surfaceAtIndex(index: number): SurfaceType {
    return CODE_TO_SURFACE[this.surfaces[index] as 0 | 1 | 2];
  }

  private setSurface(cell: GridCell, surface: SurfaceType): void {
    const index = this.indexOf(cell);
    if (index >= 0) this.surfaces[index] = SURFACE_TO_CODE[surface];
  }
}

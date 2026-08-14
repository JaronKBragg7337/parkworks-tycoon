import { getPlaceableSpec } from './catalog';
import {
  FUN_PRIORITY_WEIGHT,
  FUN_RECONSIDER_THRESHOLD,
  GUEST_LIFETIME_SECONDS,
  NEED_FLOOR_AFTER_SERVICE,
  NEED_GROWTH_PER_SECOND,
  NEED_PRIORITY_THRESHOLD,
  NEED_RELIEF_PER_SERVICE,
} from './needRates';
import { acceptanceRate, priceFor, sanitizePriceBook, type PriceBook } from './pricing';
import { SeededRandom } from './random';
import type {
  FacilitySnapshot,
  GuestNeeds,
  GuestSnapshot,
  LitterSnapshot,
  ParkStats,
  PlaceableKind,
  ServiceNeed,
  SimulationEvent,
  Vec2,
} from './types';

interface ActiveService {
  guestId: string;
  remaining: number;
}

interface FacilityRuntime extends FacilitySnapshot {
  queue: string[];
  services: ActiveService[];
}

interface GuestRuntime extends GuestSnapshot {
  destination: Vec2;
  route: Vec2[];
  routeIndex: number;
  decisionTimer: number;
  lifetime: number;
  dwellTimer: number;
  trashTimer: number;
  targetNeed: ServiceNeed;
  /**
   * Where this guest sits in the crowd's willingness to pay, 0 (will pay almost
   * anything) to 1 (walks away first). Drawn once at the gate rather than rolled
   * per decision, so a guest who refused the price of a ride keeps refusing it
   * instead of flickering between queueing and walking off.
   */
  priceSensitivity: number;
}

export interface GuestNavigationNetwork {
  findPath: (start: Vec2, destination: Vec2) => readonly Vec2[] | null;
  destinations: readonly Vec2[];
}

/**
 * Weight each departing guest carries in the park's running reputation. Low
 * enough that one bad afternoon does not erase a good park, high enough that a
 * park left broken visibly slides.
 */
const REPUTATION_SMOOTHING = 0.012;

/**
 * Guests the park can hold. This is an economic ceiling, not a rendering one:
 * ParkGame draws only the nearest handful, so a park can keep growing long
 * after the screen stops showing every visitor.
 */
const MAX_ATTENDANCE = 600;

const GATE_POSITION: Vec2 = { x: 0, z: 32 };
const ENTRY_POSITION: Vec2 = { x: 0, z: 22 };
const EPSILON = 0.0001;

export type SimulationListener = (event: SimulationEvent) => void;

/**
 * Persistence view of the simulation. Guests are deliberately excluded: they are
 * transient visitors, and respawning them on load is both cheaper and truer to
 * what a park is between sessions. Litter is kept, because a park the player
 * left dirty should still be dirty when they come back.
 */
export interface ParkSimulationSaveState {
  stats: ParkStats;
  litter: readonly LitterSnapshot[];
  nextGuestId: number;
  nextLitterId: number;
  /** Player-set prices. Absent in saves written before pricing existed. */
  prices?: PriceBook;
}

/**
 * The part of an offline projection the simulation writes back. Declared here
 * structurally so the live rules never depend on the projection module.
 */
export interface AwayProgress {
  netCash: number;
  revenue: number;
  upkeep: number;
  guestsVisited: number;
  guestsServed: number;
  reputation: number;
  cleanliness: number;
  daysPassed: number;
  litterCreated: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function copyNeeds(needs: GuestNeeds): GuestNeeds {
  return { ...needs };
}

export class ParkSimulation {
  private readonly random: SeededRandom;
  private readonly listeners = new Set<SimulationListener>();
  private readonly facilities = new Map<string, FacilityRuntime>();
  private readonly guests = new Map<string, GuestRuntime>();
  private readonly litter = new Map<string, LitterSnapshot>();
  private nextGuestId = 1;
  private nextLitterId = 1;
  private spawnTimer = 1.25;
  private upkeepTimer = 45;
  private running = false;
  private navigation: GuestNavigationNetwork | null = null;
  private configuredAppeal: number | null = null;
  private configuredUpkeep: number | null = null;
  private prices: PriceBook = {};
  private stats: ParkStats = {
    cash: 4_200,
    reputation: 38,
    cleanliness: 1,
    guestCount: 0,
    guestsServed: 0,
    guestsVisited: 0,
    litterCleaned: 0,
    revenue: 0,
    expenses: 0,
    day: 1,
    minuteOfDay: 9 * 60,
  };

  constructor(seed = 0x5041524b) {
    this.random = new SeededRandom(seed);
  }

  subscribe(listener: SimulationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  isRunning(): boolean {
    return this.running;
  }

  setNavigationNetwork(navigation: GuestNavigationNetwork | null): void {
    const nextDestinations = new Set(
      navigation?.destinations.map((point) => `${Math.round(point.x)},${Math.round(point.z)}`) ?? [],
    );
    this.navigation = navigation;
    for (const guest of this.guests.values()) {
      if (guest.state === 'using' || guest.state === 'queueing') continue;
      const routeIsStillWalkable = guest.route
        .slice(guest.routeIndex)
        .every((point) => nextDestinations.has(`${Math.round(point.x)},${Math.round(point.z)}`));
      if (!routeIsStillWalkable || !this.assignRoute(guest, guest.destination)) {
        if (guest.state === 'seeking') this.clearTarget(guest);
        else if (guest.state === 'leaving') {
          if (!this.assignRoute(guest, GATE_POSITION)) this.routeToRandomDestination(guest);
        } else if (guest.state === 'arriving') {
          if (!this.assignRoute(guest, ENTRY_POSITION)) this.routeToRandomDestination(guest);
        } else if (guest.state === 'wandering') this.routeToRandomDestination(guest);
      }
    }
  }

  setParkMetrics(appeal: number, upkeep: number): void {
    this.configuredAppeal = Math.max(0, appeal);
    this.configuredUpkeep = Math.max(0, upkeep);
  }

  /** Sets what one kind of facility charges. Returns the price actually applied. */
  setPrice(kind: PlaceableKind, price: number): number {
    const book = sanitizePriceBook({ ...this.prices, [kind]: price });
    this.prices = book;
    const applied = priceFor(kind, book);
    this.emit({ type: 'price-changed', kind, price: applied });
    return applied;
  }

  getPrices(): Readonly<PriceBook> {
    return this.prices;
  }

  /** What this kind charges a guest today. */
  getPrice(kind: PlaceableKind): number {
    return priceFor(kind, this.prices);
  }

  /** Share of guests currently willing to pay for this kind, 0 to 1. */
  getAcceptanceRate(kind: PlaceableKind): number {
    return acceptanceRate(kind, this.prices, this.stats.reputation);
  }

  getStats(): Readonly<ParkStats> {
    return this.stats;
  }

  getGuests(): readonly GuestSnapshot[] {
    return Array.from(this.guests.values(), (guest) => ({
      ...guest,
      position: { ...guest.position },
      needs: copyNeeds(guest.needs),
    }));
  }

  getLitter(): readonly LitterSnapshot[] {
    return Array.from(this.litter.values(), (item) => ({ ...item, position: { ...item.position } }));
  }

  getFacilities(): readonly FacilitySnapshot[] {
    return Array.from(this.facilities.values(), (facility) => ({
      id: facility.id,
      kind: facility.kind,
      position: { ...facility.position },
      rotation: facility.rotation,
      queueLength: facility.queue.length,
      activeUsers: facility.services.length,
      enabled: facility.enabled,
      accessPoint: facility.accessPoint ? { ...facility.accessPoint } : undefined,
    }));
  }

  /** Test/debug observable: route waypoints are copied and never expose mutable runtime state. */
  getGuestRoutes(): Readonly<Record<string, readonly Vec2[]>> {
    return Object.fromEntries(
      Array.from(this.guests.values(), (guest) => [
        guest.id,
        guest.route.slice(guest.routeIndex).map((point) => ({ ...point })),
      ]),
    );
  }

  getSaveState(): ParkSimulationSaveState {
    return {
      stats: { ...this.stats },
      litter: this.getLitter().map((item) => ({ ...item, position: { ...item.position } })),
      nextGuestId: this.nextGuestId,
      nextLitterId: this.nextLitterId,
      prices: { ...this.prices },
    };
  }

  /**
   * Restores saved stats and litter. Unknown or non-finite values fall back to
   * the fresh-park defaults rather than poisoning the economy with NaN.
   */
  loadSaveState(state: ParkSimulationSaveState): void {
    const defaults = this.stats;
    const saved = state.stats ?? ({} as ParkStats);
    this.stats = {
      cash: Math.round(finiteOr(saved.cash, defaults.cash)),
      reputation: Math.max(0, Math.min(100, finiteOr(saved.reputation, defaults.reputation))),
      cleanliness: clamp01(finiteOr(saved.cleanliness, defaults.cleanliness)),
      guestCount: 0,
      guestsServed: Math.max(0, Math.round(finiteOr(saved.guestsServed, 0))),
      guestsVisited: Math.max(0, Math.round(finiteOr(saved.guestsVisited, 0))),
      litterCleaned: Math.max(0, Math.round(finiteOr(saved.litterCleaned, 0))),
      revenue: Math.max(0, Math.round(finiteOr(saved.revenue, 0))),
      expenses: Math.max(0, Math.round(finiteOr(saved.expenses, 0))),
      day: Math.max(1, Math.round(finiteOr(saved.day, 1))),
      minuteOfDay: Math.max(9 * 60, Math.min(21 * 60, finiteOr(saved.minuteOfDay, 9 * 60))),
    };

    this.guests.clear();
    this.litter.clear();
    for (const item of state.litter ?? []) {
      if (!item || typeof item.id !== 'string') continue;
      const x = finiteOr(item.position?.x, Number.NaN);
      const z = finiteOr(item.position?.z, Number.NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      this.litter.set(item.id, {
        id: item.id,
        position: { x, z },
        variant: Math.max(0, Math.min(3, Math.round(finiteOr(item.variant, 0)))),
        age: Math.max(0, finiteOr(item.age, 0)),
      });
    }

    // A save written before pricing existed has no price book, which is the
    // same thing as "everything charges the designed price".
    this.prices = sanitizePriceBook(state.prices);
    this.nextGuestId = Math.max(1, Math.round(finiteOr(state.nextGuestId, 1)));
    this.nextLitterId = Math.max(1, Math.round(finiteOr(state.nextLitterId, 1)));
    this.spawnTimer = 1.25;
    this.upkeepTimer = 45;
  }

  /**
   * Writes an offline projection into the books. Litter produced while away is
   * scattered near the park's food traffic so the mess the report describes is
   * the mess the player walks back into, not just a lower number.
   */
  applyAwayProgress(report: AwayProgress): void {
    this.stats = {
      ...this.stats,
      cash: this.stats.cash + report.netCash,
      revenue: this.stats.revenue + report.revenue,
      expenses: this.stats.expenses + report.upkeep,
      guestsVisited: this.stats.guestsVisited + report.guestsVisited,
      guestsServed: this.stats.guestsServed + report.guestsServed,
      reputation: Math.max(0, Math.min(100, report.reputation)),
      cleanliness: clamp01(report.cleanliness),
      day: this.stats.day + report.daysPassed,
    };

    const spots = [...this.facilities.values()].filter(
      (facility) => facility.enabled && getPlaceableSpec(facility.kind).category === 'food',
    );
    for (let index = 0; index < report.litterCreated; index += 1) {
      const spot = spots[this.random.integer(0, spots.length - 1)];
      const origin = spot ? this.approachPoint(spot) : { ...ENTRY_POSITION };
      this.createLitter({
        x: origin.x + this.random.range(-4.5, 4.5),
        z: origin.z + this.random.range(-4.5, 4.5),
      });
    }
  }

  setFacilities(snapshots: readonly FacilitySnapshot[]): void {
    const incoming = new Set(snapshots.map((snapshot) => snapshot.id));

    for (const id of this.facilities.keys()) {
      if (!incoming.has(id)) {
        this.cancelFacility(id);
        this.facilities.delete(id);
      }
    }

    for (const snapshot of snapshots) {
      const current = this.facilities.get(snapshot.id);
      if (current) {
        const disabled = current.enabled && !snapshot.enabled;
        current.position = { ...snapshot.position };
        current.rotation = snapshot.rotation;
        current.enabled = snapshot.enabled;
        current.accessPoint = snapshot.accessPoint ? { ...snapshot.accessPoint } : undefined;
        if (disabled) this.cancelFacility(snapshot.id);
      } else {
        this.facilities.set(snapshot.id, {
          ...snapshot,
          position: { ...snapshot.position },
          queue: [],
          services: [],
        });
      }
    }
  }

  purchase(kind: PlaceableKind): boolean {
    const spec = getPlaceableSpec(kind);
    return this.spend(spec.cost);
  }

  refund(kind: PlaceableKind): void {
    this.refundExpense(getPlaceableSpec(kind).cost);
  }

  spend(amount: number): boolean {
    const normalized = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    if (this.stats.cash < normalized) {
      this.emit({ type: 'insufficient-funds', required: normalized });
      return false;
    }

    this.stats = {
      ...this.stats,
      cash: this.stats.cash - normalized,
      expenses: this.stats.expenses + normalized,
    };
    return true;
  }

  refundExpense(amount: number): void {
    const normalized = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    this.stats = {
      ...this.stats,
      cash: this.stats.cash + normalized,
      expenses: Math.max(0, this.stats.expenses - normalized),
    };
  }

  update(deltaSeconds: number, playerPosition: Vec2): void {
    if (!this.running) return;

    const dt = Math.min(deltaSeconds, 0.1);
    this.advanceClock(dt);
    this.processUpkeep(dt);
    this.processSpawning(dt);
    this.processFacilities(dt);

    for (const guest of [...this.guests.values()]) {
      this.updateGuest(guest, dt);
    }

    this.cleanNearbyLitter(playerPosition);
    this.ageLitter(dt);
    this.recalculateCleanliness(dt);
    this.stats = { ...this.stats, guestCount: this.guests.size };
  }

  private advanceClock(dt: number): void {
    let minuteOfDay = this.stats.minuteOfDay + dt * 3.5;
    let day = this.stats.day;
    if (minuteOfDay >= 21 * 60) {
      minuteOfDay = 9 * 60;
      day += 1;
    }
    this.stats = { ...this.stats, minuteOfDay, day };
  }

  private processUpkeep(dt: number): void {
    this.upkeepTimer -= dt;
    if (this.upkeepTimer > 0) return;

    this.upkeepTimer += 45;
    let upkeep = this.configuredUpkeep ?? 0;
    if (this.configuredUpkeep === null) {
      for (const facility of this.facilities.values()) upkeep += getPlaceableSpec(facility.kind).upkeep;
    }
    if (upkeep > 0) {
      this.stats = {
        ...this.stats,
        cash: this.stats.cash - upkeep,
        expenses: this.stats.expenses + upkeep,
      };
    }
  }

  private processSpawning(dt: number): void {
    this.spawnTimer -= dt;
    const attractionAppeal = this.configuredAppeal ?? Array.from(this.facilities.values()).reduce(
      (total, facility) => total + (facility.enabled ? getPlaceableSpec(facility.kind).appeal : 0),
      0,
    );
    const capacity = Math.min(MAX_ATTENDANCE, 5 + Math.floor(attractionAppeal / 3));
    if (this.spawnTimer > 0 || this.guests.size >= capacity) return;

    this.spawnGuest();
    const reputationFactor = 1 - this.stats.reputation / 180;
    this.spawnTimer = Math.max(2.2, 6.8 * reputationFactor + this.random.range(0.5, 2.8));
  }

  private spawnGuest(): void {
    const id = `guest-${this.nextGuestId++}`;
    const position = {
      x: this.random.range(-0.7, 0.7),
      z: GATE_POSITION.z + this.random.range(-0.3, 0.3),
    };
    const guest: GuestRuntime = {
      id,
      position,
      heading: Math.PI,
      speed: this.random.range(1.65, 2.15),
      state: 'arriving',
      targetFacilityId: null,
      needs: {
        hunger: this.random.range(0.18, 0.48),
        fun: this.random.range(0.3, 0.58),
        bladder: this.random.range(0.08, 0.36),
        rest: this.random.range(0.05, 0.25),
      },
      happiness: this.random.range(0.72, 0.92),
      carryingTrash: false,
      paletteIndex: this.random.integer(0, 7),
      ageScale: this.random.next() < 0.2 ? 0.78 : this.random.range(0.92, 1.06),
      destination: { ...ENTRY_POSITION },
      route: [],
      routeIndex: 0,
      decisionTimer: this.random.range(0.4, 1.2),
      lifetime: 0,
      dwellTimer: 0,
      trashTimer: 0,
      targetNeed: null,
      priceSensitivity: this.random.next(),
    };
    this.assignRoute(guest, ENTRY_POSITION);
    this.guests.set(id, guest);
    this.stats = { ...this.stats, guestsVisited: this.stats.guestsVisited + 1 };
    this.emit({ type: 'guest-spawned', guest: { ...guest, needs: copyNeeds(guest.needs) } });
  }

  private updateGuest(guest: GuestRuntime, dt: number): void {
    guest.lifetime += dt;
    guest.decisionTimer -= dt;
    guest.needs.hunger = clamp01(guest.needs.hunger + dt * NEED_GROWTH_PER_SECOND.hunger);
    guest.needs.fun = clamp01(guest.needs.fun + dt * NEED_GROWTH_PER_SECOND.fun);
    guest.needs.bladder = clamp01(guest.needs.bladder + dt * NEED_GROWTH_PER_SECOND.bladder);
    guest.needs.rest = clamp01(guest.needs.rest + dt * NEED_GROWTH_PER_SECOND.rest);

    const worstNeed = Math.max(
      guest.needs.hunger,
      guest.needs.fun,
      guest.needs.bladder,
      guest.needs.rest,
    );
    if (worstNeed > 0.86) {
      guest.happiness = clamp01(guest.happiness - dt * 0.018 * (1 + (worstNeed - 0.86) * 4));
    } else {
      guest.happiness = clamp01(guest.happiness + dt * 0.0015 * this.stats.cleanliness);
    }

    if (guest.carryingTrash && guest.trashTimer > 0) {
      guest.trashTimer -= dt;
      if (guest.trashTimer <= 0) this.routeTrash(guest);
    }

    if (guest.state === 'using' || guest.state === 'queueing') return;

    if (guest.state === 'leaving') {
      if (this.moveAlongRoute(guest, dt, 0.55)) this.removeGuest(guest);
      return;
    }

    if (guest.lifetime > GUEST_LIFETIME_SECONDS || guest.happiness < 0.22) {
      this.startLeaving(guest);
      return;
    }

    if (guest.state === 'arriving') {
      if (this.moveAlongRoute(guest, dt, 0.45)) {
        guest.state = 'wandering';
        guest.decisionTimer = 0;
      }
      return;
    }

    if (guest.state === 'seeking') {
      const facility = guest.targetFacilityId
        ? this.facilities.get(guest.targetFacilityId)
        : undefined;
      if (!facility || !facility.enabled) {
        this.clearTarget(guest);
      } else if (this.moveAlongRoute(guest, dt, 0.45)) {
        this.enqueueGuest(guest, facility);
      }
      return;
    }

    if (guest.dwellTimer > 0) {
      guest.dwellTimer -= dt;
      return;
    }

    if (guest.decisionTimer <= 0) this.chooseGuestAction(guest);
    if (guest.state === 'wandering') {
      if (this.moveAlongRoute(guest, dt, 0.36)) {
        guest.dwellTimer = this.random.range(0.5, 2.2);
        guest.decisionTimer = Math.min(guest.decisionTimer, 0.4);
      }
    }
  }

  private chooseGuestAction(guest: GuestRuntime): void {
    guest.decisionTimer = this.random.range(2.4, 4.4);

    const needs: Array<[ServiceNeed, number]> = [
      ['bladder', guest.needs.bladder * 1.15],
      ['hunger', guest.needs.hunger],
      ['fun', guest.needs.fun * FUN_PRIORITY_WEIGHT],
      ['rest', guest.needs.rest * 0.8],
    ];
    needs.sort((a, b) => b[1] - a[1]);
    const [need, urgency] = needs[0] ?? [null, 0];

    if (need && urgency > NEED_PRIORITY_THRESHOLD && this.seekFacility(guest, need)) return;
    if (
      guest.needs.fun > FUN_RECONSIDER_THRESHOLD &&
      this.random.next() < 0.38 &&
      this.seekFacility(guest, 'fun')
    ) {
      return;
    }
    if (this.random.next() < 0.08 && this.seekFacility(guest, 'information')) return;

    guest.state = 'wandering';
    this.routeToRandomDestination(guest);
  }

  private seekFacility(guest: GuestRuntime, need: ServiceNeed): boolean {
    const candidates = [...this.facilities.values()].filter((facility) => {
      const spec = getPlaceableSpec(facility.kind);
      if (!facility.enabled || spec.serviceNeed !== need) return false;
      return this.willPay(guest, facility.kind);
    });
    // A guest who refuses every price simply does not go, and the need they came
    // in with keeps climbing. That is the whole cost of overcharging: unmet
    // needs make guests unhappy, unhappy guests drag reputation down as they
    // leave, and a lower reputation narrows what the park may charge next. The
    // punishment for greed is not a rule anywhere — it is this loop closing.
    if (candidates.length === 0) return false;

    candidates.sort((a, b) => {
      const aScore = distanceSquared(guest.position, a.position) + a.queue.length * 11;
      const bScore = distanceSquared(guest.position, b.position) + b.queue.length * 11;
      return aScore - bScore;
    });
    const target = candidates[0];
    if (!target) return false;

    guest.state = 'seeking';
    guest.targetNeed = need;
    guest.targetFacilityId = target.id;
    if (this.assignRoute(guest, this.approachPoint(target))) return true;
    this.clearTarget(guest);
    return false;
  }

  /**
   * Whether this guest accepts what this kind of facility is charging. Free
   * facilities are always accepted, so restrooms and bins never take part.
   */
  private willPay(guest: GuestRuntime, kind: PlaceableKind): boolean {
    const accepted = acceptanceRate(kind, this.prices, this.stats.reputation);
    return accepted >= 1 || guest.priceSensitivity < accepted;
  }

  private enqueueGuest(guest: GuestRuntime, facility: FacilityRuntime): void {
    if (facility.services.some((service) => service.guestId === guest.id)) return;
    if (!facility.queue.includes(guest.id)) facility.queue.push(guest.id);
    guest.state = 'queueing';
    guest.position = this.queuePoint(facility, facility.queue.indexOf(guest.id));
    this.startQueuedServices(facility);
  }

  private processFacilities(dt: number): void {
    for (const facility of this.facilities.values()) {
      if (!facility.enabled) {
        facility.queueLength = 0;
        facility.activeUsers = 0;
        continue;
      }
      for (const service of [...facility.services]) {
        service.remaining -= dt;
        if (service.remaining <= 0) this.completeService(facility, service);
      }
      this.startQueuedServices(facility);
      facility.queueLength = facility.queue.length;
      facility.activeUsers = facility.services.length;
    }
  }

  private startQueuedServices(facility: FacilityRuntime): void {
    if (!facility.enabled) return;
    const spec = getPlaceableSpec(facility.kind);
    while (facility.services.length < spec.capacity && facility.queue.length > 0) {
      const guestId = facility.queue.shift();
      const guest = guestId ? this.guests.get(guestId) : undefined;
      if (!guest) continue;
      guest.state = 'using';
      guest.position = { ...facility.position };
      facility.services.push({ guestId: guest.id, remaining: spec.serviceSeconds });
    }
  }

  private completeService(facility: FacilityRuntime, service: ActiveService): void {
    facility.services = facility.services.filter((active) => active !== service);
    const guest = this.guests.get(service.guestId);
    if (!guest) return;

    const spec = getPlaceableSpec(facility.kind);
    switch (spec.serviceNeed) {
      case 'hunger':
        guest.needs.hunger = Math.max(
          NEED_FLOOR_AFTER_SERVICE.hunger,
          guest.needs.hunger - NEED_RELIEF_PER_SERVICE.hunger,
        );
        guest.needs.bladder = clamp01(guest.needs.bladder + 0.12);
        guest.carryingTrash = true;
        guest.trashTimer = this.random.range(9, 17);
        break;
      case 'fun':
        guest.needs.fun = Math.max(
          NEED_FLOOR_AFTER_SERVICE.fun,
          guest.needs.fun - NEED_RELIEF_PER_SERVICE.fun,
        );
        guest.needs.rest = clamp01(guest.needs.rest + 0.09);
        break;
      case 'bladder':
        guest.needs.bladder = NEED_FLOOR_AFTER_SERVICE.bladder;
        break;
      case 'rest':
        guest.needs.rest = Math.max(
          NEED_FLOOR_AFTER_SERVICE.rest,
          guest.needs.rest - NEED_RELIEF_PER_SERVICE.rest,
        );
        break;
      case 'information':
        guest.happiness = clamp01(guest.happiness + 0.035);
        guest.needs.fun = Math.max(0.18, guest.needs.fun - 0.16);
        guest.decisionTimer = 0;
        break;
      case 'trash':
        guest.carryingTrash = false;
        guest.trashTimer = 0;
        break;
      default:
        break;
    }

    guest.happiness = clamp01(guest.happiness + 0.08 + spec.appeal * 0.0015);
    guest.state = 'wandering';
    guest.targetFacilityId = null;
    guest.targetNeed = null;
    guest.position = this.approachPoint(facility);
    this.routeToRandomDestination(guest);
    guest.decisionTimer = this.random.range(1.2, 2.8);

    // The guest pays what the park is asking today, not what the spec sheet
    // says. They already accepted this price before joining the queue.
    const charged = priceFor(facility.kind, this.prices);
    this.stats = {
      ...this.stats,
      cash: this.stats.cash + charged,
      revenue: this.stats.revenue + charged,
      guestsServed: this.stats.guestsServed + 1,
    };
    this.emit({
      type: 'service-complete',
      guestId: guest.id,
      facilityId: facility.id,
      revenue: charged,
    });
  }

  private routeTrash(guest: GuestRuntime): void {
    const bins = [...this.facilities.values()].filter(
      (facility) => facility.enabled && getPlaceableSpec(facility.kind).serviceNeed === 'trash',
    );
    bins.sort(
      (a, b) => distanceSquared(guest.position, a.position) - distanceSquared(guest.position, b.position),
    );
    const nearest = bins[0];
    if (nearest && distanceSquared(guest.position, nearest.position) <= 12 * 12) {
      guest.state = 'seeking';
      guest.targetNeed = 'trash';
      guest.targetFacilityId = nearest.id;
      if (this.assignRoute(guest, this.approachPoint(nearest))) return;
      this.clearTarget(guest);
    }

    this.createLitter(guest.position);
    guest.carryingTrash = false;
    guest.happiness = clamp01(guest.happiness - 0.035);
  }

  private createLitter(position: Vec2): void {
    const item: LitterSnapshot = {
      id: `litter-${this.nextLitterId++}`,
      position: {
        x: position.x + this.random.range(-0.35, 0.35),
        z: position.z + this.random.range(-0.35, 0.35),
      },
      variant: this.random.integer(0, 3),
      age: 0,
    };
    this.litter.set(item.id, item);
    this.emit({ type: 'litter-created', litter: { ...item, position: { ...item.position } } });
  }

  private cleanNearbyLitter(playerPosition: Vec2): void {
    for (const item of this.litter.values()) {
      if (distanceSquared(item.position, playerPosition) > 1.7 * 1.7) continue;
      this.litter.delete(item.id);
      this.stats = {
        ...this.stats,
        cash: this.stats.cash + 3,
        litterCleaned: this.stats.litterCleaned + 1,
        cleanliness: Math.min(1, this.stats.cleanliness + 0.06),
      };
      this.emit({ type: 'litter-removed', litterId: item.id, byPlayer: true });
    }
  }

  private ageLitter(dt: number): void {
    for (const item of this.litter.values()) item.age += dt;
  }

  private recalculateCleanliness(dt: number): void {
    const desired = clamp01(1 - this.litter.size * 0.045);
    const cleanliness = this.stats.cleanliness + (desired - this.stats.cleanliness) * dt * 0.55;
    this.stats = { ...this.stats, cleanliness };
  }

  private moveToward(guest: GuestRuntime, destination: Vec2, stepBudget: number, arriveRadius: number): number {
    const dx = destination.x - guest.position.x;
    const dz = destination.z - guest.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= arriveRadius) return stepBudget;

    const step = Math.min(distance, stepBudget);
    guest.position.x += (dx / Math.max(distance, EPSILON)) * step;
    guest.position.z += (dz / Math.max(distance, EPSILON)) * step;
    guest.heading = Math.atan2(dx, dz);
    return Math.max(0, stepBudget - step);
  }

  private moveAlongRoute(guest: GuestRuntime, dt: number, arriveRadius: number): boolean {
    let stepBudget = guest.speed * dt;
    while (guest.routeIndex < guest.route.length) {
      const waypoint = guest.route[guest.routeIndex];
      if (!waypoint) break;
      const isFinal = guest.routeIndex === guest.route.length - 1;
      const radius = isFinal ? arriveRadius : 0.12;
      const before = stepBudget;
      stepBudget = this.moveToward(guest, waypoint, stepBudget, radius);
      const reached = distanceSquared(guest.position, waypoint) <= radius * radius;
      if (!reached) return false;
      guest.routeIndex += 1;
      if (stepBudget <= EPSILON || stepBudget === before) {
        if (guest.routeIndex >= guest.route.length) return true;
        if (stepBudget <= EPSILON) return false;
      }
    }
    return guest.routeIndex >= guest.route.length;
  }

  private assignRoute(guest: GuestRuntime, destination: Vec2): boolean {
    const start = this.nearestWalkableDestination(guest.position) ?? guest.position;
    const route = this.navigation
      ? this.navigation.findPath(start, destination)
      : [destination];
    if (!route) {
      guest.route = [];
      guest.routeIndex = 0;
      return false;
    }

    guest.destination = { ...destination };
    guest.route = route.map((point) => ({ ...point }));
    if (distanceSquared(guest.position, start) > 0.08) guest.route.unshift({ ...start });
    if (guest.route.length === 0) guest.route.push({ ...destination });
    guest.routeIndex = 0;
    while (
      guest.routeIndex < guest.route.length - 1 &&
      distanceSquared(guest.position, guest.route[guest.routeIndex] ?? guest.position) < 0.08
    ) {
      guest.routeIndex += 1;
    }
    return true;
  }

  private routeToRandomDestination(guest: GuestRuntime): void {
    const choices = this.navigation?.destinations;
    if (choices && choices.length > 0) {
      const attempts = Math.min(8, choices.length);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const destination = choices[this.random.integer(0, choices.length - 1)];
        if (destination && this.assignRoute(guest, destination)) return;
      }
    }
    this.assignRoute(guest, ENTRY_POSITION);
  }

  private nearestWalkableDestination(position: Vec2): Vec2 | null {
    const choices = this.navigation?.destinations;
    if (!choices || choices.length === 0) return null;
    let nearest: Vec2 | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of choices) {
      const candidateDistance = distanceSquared(position, candidate);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearest = candidate;
      }
    }
    return nearest ? { ...nearest } : null;
  }

  private approachPoint(facility: FacilityRuntime): Vec2 {
    if (facility.accessPoint) return { ...facility.accessPoint };
    const spec = getPlaceableSpec(facility.kind);
    const distance = Math.max(spec.footprint[0], spec.footprint[1]) * 0.54 + 0.65;
    return {
      x: facility.position.x + Math.sin(facility.rotation) * distance,
      z: facility.position.z + Math.cos(facility.rotation) * distance,
    };
  }

  private queuePoint(facility: FacilityRuntime, index: number): Vec2 {
    const approach = this.approachPoint(facility);
    const angle = index * 2.399963;
    const spacing = Math.min(0.32, 0.08 + index * 0.045);
    return {
      x: approach.x + Math.sin(angle) * spacing,
      z: approach.z + Math.cos(angle) * spacing,
    };
  }

  private clearTarget(guest: GuestRuntime): void {
    guest.targetFacilityId = null;
    guest.targetNeed = null;
    guest.state = 'wandering';
    this.routeToRandomDestination(guest);
  }

  private cancelFacility(facilityId: string): void {
    const facility = this.facilities.get(facilityId);
    if (!facility) return;
    const affected = [
      ...facility.queue,
      ...facility.services.map((service) => service.guestId),
    ];
    for (const guestId of affected) {
      const guest = this.guests.get(guestId);
      if (guest) {
        guest.position = this.approachPoint(facility);
        this.clearTarget(guest);
      }
    }
    facility.queue = [];
    facility.services = [];
    facility.queueLength = 0;
    facility.activeUsers = 0;
  }

  private startLeaving(guest: GuestRuntime): void {
    this.removeGuestFromFacilities(guest.id);
    guest.state = 'leaving';
    guest.targetFacilityId = null;
    guest.targetNeed = null;
    this.assignRoute(guest, GATE_POSITION);
  }

  private removeGuest(guest: GuestRuntime): void {
    this.guests.delete(guest.id);
    this.removeGuestFromFacilities(guest.id);
    const happy = guest.happiness >= 0.55;

    // Reputation tracks how guests actually leave rather than counting visits.
    // The old rule added a fixed amount per departure, which pinned any busy
    // park at 100 within minutes and then stopped meaning anything. As an
    // average it keeps responding for as long as the park runs: it drifts
    // toward the happiness guests leave with, so a park that grows past what
    // it can serve is felt immediately.
    const previous = this.stats.reputation;
    const target = guest.happiness * 100;
    const reputation = Math.max(
      0,
      Math.min(100, previous + (target - previous) * REPUTATION_SMOOTHING),
    );
    this.stats = { ...this.stats, reputation };
    this.emit({ type: 'guest-left', guestId: guest.id, happy });
    this.emit({ type: 'reputation-changed', delta: reputation - previous });
  }

  private removeGuestFromFacilities(guestId: string): void {
    for (const facility of this.facilities.values()) {
      facility.queue = facility.queue.filter((id) => id !== guestId);
      facility.services = facility.services.filter((service) => service.guestId !== guestId);
    }
  }

  private emit(event: SimulationEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

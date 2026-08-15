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
import {
  TOP_UP_THRESHOLD,
  WITHDRAWAL_MULTIPLE,
  acceptanceRate,
  priceFor,
  sanitizePriceBook,
  startingWallet,
  typicalWallet,
  type PriceBook,
} from './pricing';
import { advanceClock, isParkOpen, normaliseMinute } from './dayCycle';
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
  StaffSnapshot,
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

/**
 * The part of a person the movement code touches.
 *
 * Guests and staff walk the same paths, at their own speeds, under the same
 * rule that a route is followed waypoint by waypoint and never short-cut. They
 * share one implementation rather than two that drift, which is the only way to
 * be sure a janitor cannot walk through a building the guests have to go round.
 */
interface Walker {
  position: Vec2;
  heading: number;
  speed: number;
  destination: Vec2;
  route: Vec2[];
  routeIndex: number;
}

interface GuestRuntime extends GuestSnapshot, Walker {
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

interface StaffRuntime extends StaffSnapshot, Walker {
  destination: Vec2;
  route: Vec2[];
  routeIndex: number;
  /** Seconds left of the pause taken to actually pick something up. */
  collectTimer: number;
  /** Seconds until this worker next looks around for a job. */
  searchTimer: number;
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

/**
 * The overnight settlement. A struggling park still gets the subsidy, so a bad
 * day is survivable; the other two parts only pay a park that is well regarded
 * and busy. Tuned against a mid-sized park taking roughly $3,000 a day: that
 * settles at about $1,400, meaningful next to a $1,850 carousel without ever
 * replacing the job of actually running the place.
 */
const DAILY_SUBSIDY = 300;
const DAILY_PER_REPUTATION_POINT = 10;
const DAILY_TAKINGS_SHARE = 0.1;

/**
 * A janitor's walking speed. Guests draw 1.65-2.15 m/s and stop to dwell; a
 * janitor is at work, so they sit just above the top of the guest range and
 * never stand around unless there is nothing to do.
 */
const JANITOR_SPEED = 2.2;

/**
 * How close a janitor stops to the last waypoint of a route, how far their
 * picker reaches from there, and how far off the path a piece of litter may lie
 * before it is not their job.
 *
 * The three numbers are one decision, which is why they are written together.
 * The reach is deliberately near the 1.7 m the player works at: a crew is meant
 * to cover ground the player is not standing on, not to clean at range, and a
 * wider radius would let a janitor parked at a junction sterilise a whole plaza
 * without walking anywhere. The off-path limit is then the reach minus the
 * arrival slack, so a janitor who finishes a route is always in reach of what
 * they set out for. Getting that subtraction wrong does not look like a
 * rounding error from the ground — the janitor arrives, finds the wrapper a
 * hand's width too far away, gives up, and comes back for it forever.
 *
 * Litter beyond the limit is left for the player, who can cut across the grass
 * where a janitor on the paths cannot. Almost none of it is: a guest drops
 * litter where they are standing, and where they are standing is a path.
 */
const JANITOR_ARRIVE_RADIUS = 0.15;
const JANITOR_REACH = 1.6;
const JANITOR_OFF_PATH_LIMIT = JANITOR_REACH - JANITOR_ARRIVE_RADIUS;

/**
 * Seconds a janitor spends bent over a piece of litter before moving on.
 * Without the pause the crew skims a messy plaza deleting wrappers at walking
 * speed, which is both faster than one person can work and the difference
 * between a park that has staff in it and a park where litter blinks out.
 */
const JANITOR_COLLECT_SECONDS = 1.4;

/** How often a janitor with nothing to do looks around for something. */
const JANITOR_SEARCH_INTERVAL = 1.5;

/**
 * How many pieces of litter a janitor will try to route to before giving up for
 * this look-around. The nearest is almost always reachable; the cap is there so
 * a park whose paths have just been cut in half cannot make one worker run the
 * pathfinder over every wrapper in it.
 */
const JANITOR_ROUTE_ATTEMPTS = 4;


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
  /** Litter the crew cleared while nobody was watching. */
  litterRemoved: number;
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
  private readonly staff = new Map<string, StaffRuntime>();
  private readonly litter = new Map<string, LitterSnapshot>();
  private nextGuestId = 1;
  private nextLitterId = 1;
  private nextStaffId = 1;
  private spawnTimer = 1.25;
  private upkeepTimer = 45;
  private running = false;
  private navigation: GuestNavigationNetwork | null = null;
  private configuredAppeal: number | null = null;
  private configuredUpkeep: number | null = null;
  private prices: PriceBook = {};
  /** Revenue reading when the current day began, for the overnight settlement. */
  private revenueAtDayStart = 0;
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

    // A janitor whose route was paved over drops the job rather than finishing
    // a walk that no longer exists. The next look-around finds the litter again
    // if it is still reachable, and gives up on it honestly if it is not.
    for (const worker of this.staff.values()) {
      const routeIsStillWalkable = worker.route
        .slice(worker.routeIndex)
        .every((point) => nextDestinations.has(`${Math.round(point.x)},${Math.round(point.z)}`));
      if (routeIsStillWalkable && this.assignRoute(worker, worker.destination)) continue;
      this.releaseJanitor(worker);
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

  /**
   * Moves the clock, for development checks only. Wired to `window.__parkworks`
   * in dev builds so dusk and the small hours can be looked at without waiting
   * out a full day of daylight first.
   */
  debugSetClock(minuteOfDay: number): void {
    this.stats = { ...this.stats, minuteOfDay: normaliseMinute(minuteOfDay) };
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

  getStaff(): readonly StaffSnapshot[] {
    return Array.from(this.staff.values(), (worker) => ({
      id: worker.id,
      role: worker.role,
      postId: worker.postId,
      position: { ...worker.position },
      heading: worker.heading,
      speed: worker.speed,
      state: worker.state,
      targetLitterId: worker.targetLitterId,
      paletteIndex: worker.paletteIndex,
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
      minuteOfDay: normaliseMinute(finiteOr(saved.minuteOfDay, 9 * 60)),
    };

    this.guests.clear();
    // Staff are rebuilt from the crew posts the save restored, on the next
    // setFacilities. Persisting a janitor's half-finished walk would be
    // persisting engine state, which a save document deliberately does not
    // carry; a reloaded park puts its crew back on their posts instead.
    this.staff.clear();
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
    this.revenueAtDayStart = this.stats.revenue;
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

    // The crew cleared a backlog overnight, so the wrappers have to actually
    // leave the ground. Reporting them gone while they are still lying there
    // would be the report and the park disagreeing about the same park — and the
    // player would walk out into the mess the summary just told them was dealt
    // with. Oldest first, which is the order a janitor works a park in.
    if (report.litterRemoved > 0) {
      const oldest = [...this.litter.values()].sort((a, b) => b.age - a.age);
      for (let index = 0; index < report.litterRemoved && index < oldest.length; index += 1) {
        const item = oldest[index];
        if (!item) break;
        this.litter.delete(item.id);
        this.stats = { ...this.stats, litterCleaned: this.stats.litterCleaned + 1 };
        this.emit({ type: 'litter-removed', litterId: item.id, byPlayer: false });
      }
    }

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

    this.syncStaff();
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
    this.updateStaff(dt);

    this.cleanNearbyLitter(playerPosition);
    this.ageLitter(dt);
    this.recalculateCleanliness(dt);
    this.stats = { ...this.stats, guestCount: this.guests.size };
  }

  private advanceClock(dt: number): void {
    const wasOpen = isParkOpen(this.stats.minuteOfDay);
    const step = advanceClock(this.stats.minuteOfDay, dt);
    this.stats = {
      ...this.stats,
      minuteOfDay: step.minuteOfDay,
      day: this.stats.day + step.daysPassed,
    };

    // Closing time. Everyone still in the park makes for the gate, including
    // anyone mid-queue — a park that shut with guests frozen in place would
    // look broken and would keep earning after hours.
    if (wasOpen && !isParkOpen(step.minuteOfDay)) {
      for (const guest of this.guests.values()) {
        if (guest.state !== 'leaving') this.startLeaving(guest);
      }
      this.emit({ type: 'park-closed' });
    }

    if (step.daysPassed > 0) this.settleDay(step.daysPassed);
  }

  /**
   * The books close overnight and the park is paid.
   *
   * This exists to make tomorrow worth reaching. Building the next thing is a
   * long wait when takings trickle in a fare at a time, so a day should end with
   * something arriving — and it should be *earned*, not a flat handout, or it
   * stops meaning anything. Hence the three parts: a small fixed subsidy that
   * keeps a struggling park alive, a reputation share that rewards running the
   * place well, and a cut of the day's own takings that rewards running it busy.
   */
  private settleDay(days: number): void {
    for (let index = 0; index < days; index += 1) {
      const takings = Math.max(0, this.stats.revenue - this.revenueAtDayStart);
      const subsidy = DAILY_SUBSIDY;
      const standing = Math.round(this.stats.reputation * DAILY_PER_REPUTATION_POINT);
      const share = Math.round(takings * DAILY_TAKINGS_SHARE);
      const total = subsidy + standing + share;

      this.stats = {
        ...this.stats,
        cash: this.stats.cash + total,
        revenue: this.stats.revenue + total,
      };
      this.revenueAtDayStart = this.stats.revenue;
      this.emit({ type: 'day-settled', day: this.stats.day, subsidy, standing, share, total });
    }
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
    // Nobody arrives at a shut park. The gates being closed is the whole reason
    // night exists, and without this guests would keep queueing in the dark.
    if (!isParkOpen(this.stats.minuteOfDay)) return;
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
      wallet: startingWallet(this.stats.reputation, this.random.next()),
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

    if (guest.state === 'using' || guest.state === 'queueing') return;

    // Litter is dropped only by a guest who is on their feet somewhere the
    // player could walk.
    //
    // This block used to run above the return, so a guest could drop a wrapper
    // while strapped into a ride — and a guest being served has their position
    // set to the exact centre of the building. The litter therefore materialised
    // inside the carousel, under the kiosk, in the middle of the sky wheel:
    // measured at **35% of all litter**, none of it reachable, because the
    // player cannot walk into a building to pick it up. The park got steadily
    // dirtier and there was nothing to clean.
    //
    // Holding the wrapper until the ride ends is also just what people do.
    if (guest.carryingTrash && guest.trashTimer > 0) {
      guest.trashTimer -= dt;
      if (guest.trashTimer <= 0) this.routeTrash(guest);
    }

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

    // Money is not a need — it is what makes the others actionable. A guest
    // running low goes for a top-up before their wallet decides their afternoon
    // for them, which is why the threshold sits well above the point of being
    // stranded rather than at zero.
    if (
      guest.wallet < typicalWallet(this.stats.reputation) * TOP_UP_THRESHOLD &&
      this.seekFacility(guest, 'cash')
    ) {
      return;
    }

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
   * Whether this guest both accepts and can afford what this facility charges.
   *
   * Willingness and means are separate refusals and the order matters: someone
   * who thinks a price is fair still cannot pay it with an empty wallet, and
   * that is the case that makes money worth managing. Free facilities pass both
   * tests, so restrooms and bins are always available no matter how broke a
   * guest is — a park should never trap someone who needs a toilet.
   */
  private willPay(guest: GuestRuntime, kind: PlaceableKind): boolean {
    const price = priceFor(kind, this.prices);
    if (price <= 0) return true;
    // The one place affordability cannot apply: a cash machine's fee comes out
    // of the money it hands over. Requiring the fee up front would lock the
    // broke guest out of the only thing that could help them.
    if (getPlaceableSpec(kind).serviceNeed === 'cash') return true;
    if (price > guest.wallet) return false;
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
      case 'cash':
        // The top-up lands before the fee is taken below, which is both how a
        // cash machine actually works and what stops a guest with nothing from
        // being unable to afford the withdrawal that would rescue them.
        guest.wallet += Math.round(typicalWallet(this.stats.reputation) * WITHDRAWAL_MULTIPLE);
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
    // says. They already accepted this price and had the money before joining
    // the queue, but a price rise while they queued could have outrun the
    // wallet, so the park takes what is actually there rather than pushing a
    // guest into debt the game has no concept of.
    const asking = priceFor(facility.kind, this.prices);
    const charged = Math.min(asking, Math.max(0, guest.wallet));
    guest.wallet = Math.max(0, guest.wallet - charged);
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

  /**
   * Pushes a point out of any building it landed in, to the nearest edge.
   *
   * The live path already avoids this by only dropping litter under a guest who
   * is on their feet, but the offline projection scatters litter several metres
   * around food outlets, which lands inside them often enough to matter. Litter
   * the player cannot reach is litter that never goes away, so it is worth being
   * certain rather than nearly certain.
   */
  private pushOutOfBuildings(point: Vec2): Vec2 {
    for (const facility of this.facilities.values()) {
      const spec = getPlaceableSpec(facility.kind);
      // Footprints are axis-aligned before rotation; a quarter turn swaps them.
      const turned = Math.abs(Math.round(facility.rotation / (Math.PI / 2))) % 2 === 1;
      const halfX = (turned ? spec.footprint[1] : spec.footprint[0]) / 2 + 0.35;
      const halfZ = (turned ? spec.footprint[0] : spec.footprint[1]) / 2 + 0.35;
      const dx = point.x - facility.position.x;
      const dz = point.z - facility.position.z;
      if (Math.abs(dx) >= halfX || Math.abs(dz) >= halfZ) continue;

      // Leave by whichever wall is closest, so the wrapper ends up beside the
      // building it came from rather than teleporting across the park.
      const outX = halfX - Math.abs(dx);
      const outZ = halfZ - Math.abs(dz);
      if (outX < outZ) point = { x: facility.position.x + Math.sign(dx || 1) * halfX, z: point.z };
      else point = { x: point.x, z: facility.position.z + Math.sign(dz || 1) * halfZ };
    }
    return point;
  }

  private createLitter(position: Vec2): void {
    const clear = this.pushOutOfBuildings(position);
    const item: LitterSnapshot = {
      id: `litter-${this.nextLitterId++}`,
      position: {
        x: clear.x + this.random.range(-0.35, 0.35),
        z: clear.z + this.random.range(-0.35, 0.35),
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

  /**
   * Puts one janitor on the books for every open crew post, and takes them off
   * again when the post is sold, moved out of reach, or cut off from the paths.
   *
   * Staff are derived from buildings rather than owned outright. That is what
   * makes them survive a save without the save format learning what a janitor
   * is: a park that reloads with two crew posts reloads with two janitors,
   * standing at their posts rather than wherever they happened to be when the
   * player closed the tab. It is also why a disconnected post employs nobody —
   * the wage is still charged, because upkeep is charged on what is built, and a
   * hut behind a hedge with nobody able to leave it is exactly the mistake the
   * player should be able to see and fix.
   */
  private syncStaff(): void {
    const posts = new Map<string, FacilityRuntime>();
    for (const facility of this.facilities.values()) {
      if (!facility.enabled) continue;
      if (getPlaceableSpec(facility.kind).staff === 'janitor') posts.set(facility.id, facility);
    }

    for (const [id, worker] of [...this.staff]) {
      if (!posts.has(worker.postId)) this.staff.delete(id);
    }

    const employed = new Set(Array.from(this.staff.values(), (worker) => worker.postId));
    for (const post of posts.values()) {
      if (!employed.has(post.id)) this.hireJanitor(post);
    }
  }

  private hireJanitor(post: FacilityRuntime): void {
    const start = this.approachPoint(post);
    const worker: StaffRuntime = {
      id: `staff-${this.nextStaffId++}`,
      role: 'janitor',
      postId: post.id,
      position: { ...start },
      heading: post.rotation,
      speed: JANITOR_SPEED,
      state: 'idle',
      targetLitterId: null,
      paletteIndex: this.random.integer(0, 5),
      destination: { ...start },
      route: [],
      routeIndex: 0,
      collectTimer: 0,
      searchTimer: 0,
    };
    this.staff.set(worker.id, worker);
  }

  private updateStaff(dt: number): void {
    for (const worker of this.staff.values()) {
      if (worker.state === 'collecting') {
        worker.collectTimer -= dt;
        if (worker.collectTimer <= 0) this.finishCollecting(worker);
        continue;
      }

      // A wrapper the player walked over, or one another janitor reached first,
      // has stopped being a job halfway through the walk to it.
      if (worker.targetLitterId && !this.litter.has(worker.targetLitterId)) {
        this.releaseJanitor(worker);
      }

      worker.searchTimer -= dt;
      if (worker.state === 'idle' && worker.searchTimer <= 0) {
        worker.searchTimer = JANITOR_SEARCH_INTERVAL;
        this.assignJanitorWork(worker);
      }

      const arrived = this.moveAlongRoute(worker, dt, JANITOR_ARRIVE_RADIUS);
      if (worker.state !== 'walking') continue;

      const target = worker.targetLitterId ? this.litter.get(worker.targetLitterId) : undefined;
      if (!target) {
        this.releaseJanitor(worker);
        continue;
      }
      // Arriving is not the only way to be close enough: the route may pass
      // straight over something dropped since it was issued.
      if (arrived || distanceSquared(worker.position, target.position) <= JANITOR_REACH ** 2) {
        worker.state = 'collecting';
        worker.collectTimer = JANITOR_COLLECT_SECONDS;
      }
    }
  }

  /**
   * Sends a janitor after the nearest piece of litter nobody else has claimed,
   * or back to their post when the park is clean.
   */
  private assignJanitorWork(worker: StaffRuntime): void {
    const claimed = new Set<string>();
    for (const other of this.staff.values()) {
      if (other !== worker && other.targetLitterId) claimed.add(other.targetLitterId);
    }

    const candidates = [...this.litter.values()]
      .filter((item) => !claimed.has(item.id) && this.canWalkTo(item.position))
      .sort(
        (a, b) =>
          distanceSquared(worker.position, a.position) - distanceSquared(worker.position, b.position),
      )
      .slice(0, JANITOR_ROUTE_ATTEMPTS);

    for (const item of candidates) {
      const standing = this.nearestWalkableDestination(item.position) ?? item.position;
      if (!this.assignRoute(worker, standing)) continue;
      worker.targetLitterId = item.id;
      worker.state = 'walking';
      return;
    }

    // Nothing to do. Head back to the post — but only once, because re-issuing
    // the route on every look-around would restart it at its first waypoint and
    // walk the janitor backwards down the path they are already halfway along.
    if (worker.routeIndex < worker.route.length) return;
    const post = this.facilities.get(worker.postId);
    if (!post) return;
    const home = this.approachPoint(post);
    if (distanceSquared(worker.position, home) <= 1) return;
    this.assignRoute(worker, home);
  }

  private finishCollecting(worker: StaffRuntime): void {
    const target = worker.targetLitterId ? this.litter.get(worker.targetLitterId) : undefined;
    this.releaseJanitor(worker);
    // The reach is checked again after the pause rather than trusted from
    // before it. The one promise a cleaning crew has to keep is that nothing is
    // ever cleaned from further away than a person could bend down and pick it
    // up, and the only way to keep it is to measure at the moment of the pickup.
    if (!target || distanceSquared(worker.position, target.position) > JANITOR_REACH ** 2) return;

    this.litter.delete(target.id);
    // No three dollars, unlike the player's own pickups. The player is paid for
    // doing it themselves; a janitor is the thing the player pays. What the wage
    // buys is the cleanliness, and cleanliness recovers on its own once the
    // litter is gone.
    this.stats = { ...this.stats, litterCleaned: this.stats.litterCleaned + 1 };
    this.emit({ type: 'litter-removed', litterId: target.id, byPlayer: false });
  }

  /** Puts a janitor back on the clock with no job and no claim on any litter. */
  private releaseJanitor(worker: StaffRuntime): void {
    worker.targetLitterId = null;
    worker.state = 'idle';
    worker.collectTimer = 0;
    worker.searchTimer = 0;
  }

  /**
   * Whether a janitor could stand on the path network and still reach this
   * point. With no network at all — the plain simulation the tests drive —
   * everybody walks in straight lines and everywhere is reachable.
   */
  private canWalkTo(point: Vec2): boolean {
    const standing = this.nearestWalkableDestination(point);
    if (!standing) return true;
    return distanceSquared(standing, point) <= JANITOR_OFF_PATH_LIMIT ** 2;
  }

  private ageLitter(dt: number): void {
    for (const item of this.litter.values()) item.age += dt;
  }

  private recalculateCleanliness(dt: number): void {
    const desired = clamp01(1 - this.litter.size * 0.045);
    const cleanliness = this.stats.cleanliness + (desired - this.stats.cleanliness) * dt * 0.55;
    this.stats = { ...this.stats, cleanliness };
  }

  private moveToward(walker: Walker, destination: Vec2, stepBudget: number, arriveRadius: number): number {
    const dx = destination.x - walker.position.x;
    const dz = destination.z - walker.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= arriveRadius) return stepBudget;

    const step = Math.min(distance, stepBudget);
    walker.position.x += (dx / Math.max(distance, EPSILON)) * step;
    walker.position.z += (dz / Math.max(distance, EPSILON)) * step;
    walker.heading = Math.atan2(dx, dz);
    return Math.max(0, stepBudget - step);
  }

  private moveAlongRoute(walker: Walker, dt: number, arriveRadius: number): boolean {
    let stepBudget = walker.speed * dt;
    while (walker.routeIndex < walker.route.length) {
      const waypoint = walker.route[walker.routeIndex];
      if (!waypoint) break;
      const isFinal = walker.routeIndex === walker.route.length - 1;
      const radius = isFinal ? arriveRadius : 0.12;
      const before = stepBudget;
      stepBudget = this.moveToward(walker, waypoint, stepBudget, radius);
      const reached = distanceSquared(walker.position, waypoint) <= radius * radius;
      if (!reached) return false;
      walker.routeIndex += 1;
      if (stepBudget <= EPSILON || stepBudget === before) {
        if (walker.routeIndex >= walker.route.length) return true;
        if (stepBudget <= EPSILON) return false;
      }
    }
    return walker.routeIndex >= walker.route.length;
  }

  private assignRoute(walker: Walker, destination: Vec2): boolean {
    const start = this.nearestWalkableDestination(walker.position) ?? walker.position;
    const route = this.navigation
      ? this.navigation.findPath(start, destination)
      : [destination];
    if (!route) {
      walker.route = [];
      walker.routeIndex = 0;
      return false;
    }

    walker.destination = { ...destination };
    walker.route = route.map((point) => ({ ...point }));
    if (distanceSquared(walker.position, start) > 0.08) walker.route.unshift({ ...start });
    if (walker.route.length === 0) walker.route.push({ ...destination });
    walker.routeIndex = 0;
    while (
      walker.routeIndex < walker.route.length - 1 &&
      distanceSquared(walker.position, walker.route[walker.routeIndex] ?? walker.position) < 0.08
    ) {
      walker.routeIndex += 1;
    }
    return true;
  }

  private routeToRandomDestination(walker: Walker): void {
    const choices = this.navigation?.destinations;
    if (choices && choices.length > 0) {
      const attempts = Math.min(8, choices.length);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const destination = choices[this.random.integer(0, choices.length - 1)];
        if (destination && this.assignRoute(walker, destination)) return;
      }
    }
    this.assignRoute(walker, ENTRY_POSITION);
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

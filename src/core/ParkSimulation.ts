import { getPlaceableSpec } from './catalog';
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
  decisionTimer: number;
  lifetime: number;
  dwellTimer: number;
  trashTimer: number;
  targetNeed: ServiceNeed;
}

const GATE_POSITION: Vec2 = { x: 0, z: 31 };
const ENTRY_POSITION: Vec2 = { x: 0, z: 22 };
const PARK_LIMIT = 27;
const EPSILON = 0.0001;

export type SimulationListener = (event: SimulationEvent) => void;

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
    }));
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
        current.position = { ...snapshot.position };
        current.rotation = snapshot.rotation;
        current.enabled = snapshot.enabled;
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
    if (this.stats.cash < spec.cost) {
      this.emit({ type: 'insufficient-funds', required: spec.cost });
      return false;
    }

    this.stats = {
      ...this.stats,
      cash: this.stats.cash - spec.cost,
      expenses: this.stats.expenses + spec.cost,
      reputation: clamp01((this.stats.reputation + spec.appeal * 0.12) / 100) * 100,
    };
    return true;
  }

  refund(kind: PlaceableKind): void {
    const amount = getPlaceableSpec(kind).cost;
    this.stats = {
      ...this.stats,
      cash: this.stats.cash + amount,
      expenses: Math.max(0, this.stats.expenses - amount),
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
    let upkeep = 0;
    for (const facility of this.facilities.values()) {
      upkeep += getPlaceableSpec(facility.kind).upkeep;
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
    const attractionAppeal = Array.from(this.facilities.values()).reduce(
      (total, facility) => total + getPlaceableSpec(facility.kind).appeal,
      0,
    );
    const capacity = Math.min(42, 5 + Math.floor(attractionAppeal / 3));
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
      decisionTimer: this.random.range(0.4, 1.2),
      lifetime: 0,
      dwellTimer: 0,
      trashTimer: 0,
      targetNeed: null,
    };
    this.guests.set(id, guest);
    this.stats = { ...this.stats, guestsVisited: this.stats.guestsVisited + 1 };
    this.emit({ type: 'guest-spawned', guest: { ...guest, needs: copyNeeds(guest.needs) } });
  }

  private updateGuest(guest: GuestRuntime, dt: number): void {
    guest.lifetime += dt;
    guest.decisionTimer -= dt;
    guest.needs.hunger = clamp01(guest.needs.hunger + dt * 0.0042);
    guest.needs.fun = clamp01(guest.needs.fun + dt * 0.0036);
    guest.needs.bladder = clamp01(guest.needs.bladder + dt * 0.0031);
    guest.needs.rest = clamp01(guest.needs.rest + dt * 0.0022);

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
      if (this.moveToward(guest, GATE_POSITION, dt, 0.55)) this.removeGuest(guest);
      return;
    }

    if (guest.lifetime > 155 || guest.happiness < 0.22) {
      this.startLeaving(guest);
      return;
    }

    if (guest.state === 'arriving') {
      if (this.moveToward(guest, ENTRY_POSITION, dt, 0.45)) {
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
      } else if (this.moveToward(guest, this.approachPoint(facility), dt, 0.7)) {
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
      if (this.moveToward(guest, guest.destination, dt, 0.45)) {
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
      ['fun', guest.needs.fun * 0.94],
      ['rest', guest.needs.rest * 0.8],
    ];
    needs.sort((a, b) => b[1] - a[1]);
    const [need, urgency] = needs[0] ?? [null, 0];

    if (need && urgency > 0.48 && this.seekFacility(guest, need)) return;
    if (guest.needs.fun > 0.34 && this.random.next() < 0.38 && this.seekFacility(guest, 'fun')) return;

    guest.state = 'wandering';
    guest.destination = this.randomParkPoint();
  }

  private seekFacility(guest: GuestRuntime, need: ServiceNeed): boolean {
    const candidates = [...this.facilities.values()].filter((facility) => {
      const spec = getPlaceableSpec(facility.kind);
      return facility.enabled && spec.serviceNeed === need;
    });
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
    guest.destination = this.approachPoint(target);
    return true;
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
        guest.needs.hunger = Math.max(0.04, guest.needs.hunger - 0.72);
        guest.needs.bladder = clamp01(guest.needs.bladder + 0.12);
        guest.carryingTrash = true;
        guest.trashTimer = this.random.range(9, 17);
        break;
      case 'fun':
        guest.needs.fun = Math.max(0.03, guest.needs.fun - 0.82);
        guest.needs.rest = clamp01(guest.needs.rest + 0.09);
        break;
      case 'bladder':
        guest.needs.bladder = 0.03;
        break;
      case 'rest':
        guest.needs.rest = Math.max(0.02, guest.needs.rest - 0.6);
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
    guest.destination = this.randomParkPoint();
    guest.decisionTimer = this.random.range(1.2, 2.8);

    this.stats = {
      ...this.stats,
      cash: this.stats.cash + spec.revenue,
      revenue: this.stats.revenue + spec.revenue,
      guestsServed: this.stats.guestsServed + 1,
      reputation: Math.min(100, this.stats.reputation + 0.08),
    };
    this.emit({
      type: 'service-complete',
      guestId: guest.id,
      facilityId: facility.id,
      revenue: spec.revenue,
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
      guest.destination = this.approachPoint(nearest);
      return;
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

  private moveToward(guest: GuestRuntime, destination: Vec2, dt: number, arriveRadius: number): boolean {
    const dx = destination.x - guest.position.x;
    const dz = destination.z - guest.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= arriveRadius) return true;

    const step = Math.min(distance, guest.speed * dt);
    guest.position.x += (dx / Math.max(distance, EPSILON)) * step;
    guest.position.z += (dz / Math.max(distance, EPSILON)) * step;
    guest.heading = Math.atan2(dx, dz);
    return false;
  }

  private randomParkPoint(): Vec2 {
    const useCentralPath = this.random.next() < 0.72;
    if (useCentralPath) {
      if (this.random.next() < 0.55) {
        return { x: this.random.range(-2.2, 2.2), z: this.random.range(-PARK_LIMIT, 25) };
      }
      return { x: this.random.range(-PARK_LIMIT, PARK_LIMIT), z: this.random.range(-2.2, 2.2) };
    }
    return { x: this.random.range(-23, 23), z: this.random.range(-22, 22) };
  }

  private approachPoint(facility: FacilityRuntime): Vec2 {
    const spec = getPlaceableSpec(facility.kind);
    const distance = Math.max(spec.footprint[0], spec.footprint[1]) * 0.54 + 0.65;
    return {
      x: facility.position.x + Math.sin(facility.rotation) * distance,
      z: facility.position.z + Math.cos(facility.rotation) * distance,
    };
  }

  private queuePoint(facility: FacilityRuntime, index: number): Vec2 {
    const approach = this.approachPoint(facility);
    const spacing = 0.72 * (index + 1);
    return {
      x: approach.x + Math.sin(facility.rotation) * spacing,
      z: approach.z + Math.cos(facility.rotation) * spacing,
    };
  }

  private clearTarget(guest: GuestRuntime): void {
    guest.targetFacilityId = null;
    guest.targetNeed = null;
    guest.state = 'wandering';
    guest.destination = this.randomParkPoint();
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
      if (guest) this.clearTarget(guest);
    }
  }

  private startLeaving(guest: GuestRuntime): void {
    this.removeGuestFromFacilities(guest.id);
    guest.state = 'leaving';
    guest.targetFacilityId = null;
    guest.targetNeed = null;
    guest.destination = { ...GATE_POSITION };
  }

  private removeGuest(guest: GuestRuntime): void {
    this.guests.delete(guest.id);
    this.removeGuestFromFacilities(guest.id);
    const happy = guest.happiness >= 0.55;
    const delta = happy ? 0.2 : -0.7;
    this.stats = {
      ...this.stats,
      reputation: Math.max(0, Math.min(100, this.stats.reputation + delta)),
    };
    this.emit({ type: 'guest-left', guestId: guest.id, happy });
    this.emit({ type: 'reputation-changed', delta });
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

import { describe, expect, it } from 'vitest';
import { ParkGrid } from '../src/core/ParkGrid';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { getPlaceableSpec, requiresPathAccess } from '../src/core/catalog';
import type { FacilitySnapshot, LitterSnapshot, PlaceableKind, Vec2 } from '../src/core/types';
import type { ParkStats } from '../src/core/types';
import { computeAwayProgress, createEmptyAwayProfile } from '../src/core/awayReport';

function facility(
  id: string,
  kind: PlaceableKind,
  x: number,
  z: number,
  accessPoint?: Vec2,
): FacilitySnapshot {
  return {
    id,
    kind,
    position: { x, z },
    rotation: 0,
    queueLength: 0,
    activeUsers: 0,
    enabled: true,
    accessPoint,
  };
}

/** A park that generates litter: two food outlets, a ride, and nowhere to put a wrapper. */
function messyPark(huts: number): FacilitySnapshot[] {
  const facilities = [
    facility('food-a', 'burger-kiosk', -7, 9),
    facility('food-b', 'ice-cream-cart', 8, 7),
    facility('ride', 'carousel', 9, -6),
    facility('toilet', 'restroom', -9, -6),
  ];
  for (let index = 0; index < huts; index += 1) {
    facilities.push(facility(`crew-${index}`, 'maintenance-hut', index === 0 ? -8 : 8, -14));
  }
  return facilities;
}

/** Runs a park with the player parked well outside their own cleaning radius. */
function run(seed: number, facilities: FacilitySnapshot[], seconds: number) {
  const simulation = new ParkSimulation(seed);
  simulation.setFacilities(facilities);
  simulation.setRunning(true);
  for (let tick = 0; tick < seconds * 10; tick += 1) {
    simulation.update(0.1, { x: 400, z: 400 });
  }
  return simulation;
}

function litterOnlySave(simulation: ParkSimulation, litter: readonly LitterSnapshot[]): void {
  simulation.loadSaveState({ ...simulation.getSaveState(), litter });
}

describe('the cleaning crew', () => {
  it('is bought as a facility that employs one janitor per post', () => {
    const spec = getPlaceableSpec('maintenance-hut');
    expect(spec.category).toBe('facilities');
    expect(spec.staff).toBe('janitor');
    // A wage, not maintenance: it has to cost more to run than the park's first
    // real ride or it is not a decision.
    expect(spec.upkeep).toBeGreaterThan(getPlaceableSpec('carousel').upkeep);
    expect(spec.revenue).toBe(0);
    // Serves no guest need, but still has to reach the paths its janitor walks.
    expect(spec.serviceNeed).toBeNull();
    expect(requiresPathAccess(spec)).toBe(true);
    expect(requiresPathAccess(getPlaceableSpec('shade-tree'))).toBe(false);
  });

  it('leaves a park with no crew post exactly as dirty as it was', () => {
    const simulation = new ParkSimulation(4242);
    simulation.setFacilities(messyPark(0));
    simulation.setRunning(true);

    let previousLitter = 0;
    for (let tick = 0; tick < 1_800; tick += 1) {
      simulation.update(0.1, { x: 400, z: 400 });
      // Without staff the only thing that removes litter is the player walking
      // over it, and the player is 400 metres away. The count may only climb.
      const litter = simulation.getLitter().length;
      expect(litter).toBeGreaterThanOrEqual(previousLitter);
      previousLitter = litter;
    }

    expect(simulation.getStaff()).toHaveLength(0);
    expect(simulation.getStats().litterCleaned).toBe(0);
    expect(previousLitter).toBeGreaterThan(10);
  });

  it('leaves a park visibly cleaner once a crew post is built', () => {
    const withoutCrew = run(4242, messyPark(0), 180);
    const withCrew = run(4242, messyPark(1), 180);

    expect(withCrew.getStaff()).toHaveLength(1);
    expect(withCrew.getStats().litterCleaned).toBeGreaterThan(0);
    expect(withCrew.getLitter().length).toBeLessThan(withoutCrew.getLitter().length / 2);
    expect(withCrew.getStats().cleanliness).toBeGreaterThan(
      withoutCrew.getStats().cleanliness + 0.4,
    );
  });

  it('never removes litter it has not walked to', () => {
    const simulation = new ParkSimulation(9001);
    simulation.setFacilities(messyPark(2));
    simulation.setRunning(true);

    let checked = 0;
    for (let tick = 0; tick < 2_400; tick += 1) {
      const before = new Map(simulation.getLitter().map((item) => [item.id, item.position]));
      const crew = simulation.getStaff().map((worker) => ({ ...worker.position }));
      simulation.update(0.1, { x: 400, z: 400 });
      const after = new Set(simulation.getLitter().map((item) => item.id));

      for (const [id, position] of before) {
        if (after.has(id)) continue;
        const nearest = Math.min(
          ...crew.map((at) => Math.hypot(at.x - position.x, at.z - position.z)),
        );
        // A person bending down to pick something up, and nothing wider. The
        // bar is the player's own 1.7 m radius: a janitor may never out-reach
        // the hands the player cleans with.
        expect(nearest).toBeLessThanOrEqual(1.7);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('walks all the way across the park before collecting a single distant wrapper', () => {
    const simulation = new ParkSimulation(31);
    litterOnlySave(simulation, [{ id: 'far', position: { x: 30, z: 0 }, variant: 0, age: 0 }]);
    simulation.setFacilities([facility('crew', 'maintenance-hut', 0, 0)]);
    simulation.setRunning(true);

    const start = simulation.getStaff()[0];
    expect(start).toBeDefined();
    if (!start) return;
    expect(Math.hypot(start.position.x - 30, start.position.z)).toBeGreaterThan(25);

    // Five seconds in: on the way, and the wrapper is still on the ground.
    for (let tick = 0; tick < 50; tick += 1) simulation.update(0.1, { x: 400, z: 400 });
    const midway = simulation.getStaff()[0]!;
    expect(simulation.getLitter().map((item) => item.id)).toContain('far');
    expect(midway.position.x).toBeGreaterThan(start.position.x + 5);
    expect(Math.hypot(midway.position.x - 30, midway.position.z)).toBeGreaterThan(1.7);

    // Thirty seconds is plenty of walking for thirty metres.
    for (let tick = 0; tick < 300; tick += 1) simulation.update(0.1, { x: 400, z: 400 });
    expect(simulation.getLitter().map((item) => item.id)).not.toContain('far');
    expect(simulation.getStats().litterCleaned).toBe(1);
  });

  it('pays the player nothing for work the player did not do', () => {
    const simulation = new ParkSimulation(77);
    litterOnlySave(simulation, [{ id: 'near', position: { x: 0, z: 5 }, variant: 0, age: 0 }]);
    simulation.setFacilities([facility('crew', 'maintenance-hut', 0, 0)]);
    simulation.setRunning(true);
    const cashBefore = simulation.getStats().cash;

    const collected: Array<{ litterId: string; byPlayer: boolean }> = [];
    simulation.subscribe((event) => {
      if (event.type === 'litter-removed') collected.push(event);
    });
    for (let tick = 0; tick < 200; tick += 1) simulation.update(0.1, { x: 400, z: 400 });

    expect(collected).toContainEqual({ type: 'litter-removed', litterId: 'near', byPlayer: false });
    // The player's own pickups pay $3. A janitor is the thing the player pays.
    expect(simulation.getStats().cash).toBe(cashBefore);
    expect(simulation.getStats().litterCleaned).toBe(1);
  });

  it('keeps its janitor on the connected path network', () => {
    const grid = new ParkGrid();
    const simulation = new ParkSimulation(515);
    simulation.setNavigationNetwork({
      destinations: grid.getReachableCells(),
      findPath: (start, destination) => {
        const startCell = grid.worldToCell(start.x, start.z);
        const destinationCell = grid.worldToCell(destination.x, destination.z);
        return startCell && destinationCell ? grid.findRoute(startCell, destinationCell) : null;
      },
    });
    simulation.setFacilities([
      { ...facility('food', 'burger-kiosk', -7, 9), accessPoint: { x: -2, z: 9 } },
      { ...facility('ride', 'carousel', 9, -6), accessPoint: { x: 2, z: -6 } },
      { ...facility('crew', 'maintenance-hut', -8, -14), accessPoint: { x: -2, z: -14 } },
    ]);
    simulation.setRunning(true);

    let walkedOffPath = 0;
    for (let tick = 0; tick < 3_000; tick += 1) {
      simulation.update(0.1, { x: 400, z: 400 });
      for (const worker of simulation.getStaff()) {
        const cell = grid.worldToCell(worker.position.x, worker.position.z);
        if (!cell || !grid.isWalkable(cell)) walkedOffPath += 1;
      }
    }
    expect(walkedOffPath).toBe(0);
    expect(simulation.getStats().litterCleaned).toBeGreaterThan(0);
  });

  it('employs nobody from a crew post no path reaches', () => {
    const cutOff = facility('crew', 'maintenance-hut', -8, -14);
    cutOff.enabled = false;
    const simulation = run(1234, [...messyPark(0), cutOff], 120);
    expect(simulation.getStaff()).toHaveLength(0);
    expect(simulation.getStats().litterCleaned).toBe(0);
  });

  it('takes the janitor off the books when the post is sold', () => {
    const simulation = new ParkSimulation(64);
    simulation.setFacilities(messyPark(2));
    simulation.setRunning(true);
    for (let tick = 0; tick < 600; tick += 1) simulation.update(0.1, { x: 400, z: 400 });
    expect(simulation.getStaff()).toHaveLength(2);

    simulation.setFacilities(messyPark(1));
    expect(simulation.getStaff()).toHaveLength(1);
    expect(simulation.getStaff()[0]?.postId).toBe('crew-0');

    simulation.setFacilities(messyPark(0));
    expect(simulation.getStaff()).toHaveLength(0);
  });

  /**
   * Staff are derived from the buildings a save already carries, so the save
   * format never learned what a janitor is. This is the test that keeps that
   * true: a reloaded park has to come back with its crew working, not with a
   * hut nobody works out of.
   */
  it('brings the crew back after a save and load round trip', () => {
    const before = new ParkSimulation(808);
    before.setFacilities(messyPark(1));
    before.setRunning(true);
    for (let tick = 0; tick < 1_200; tick += 1) before.update(0.1, { x: 400, z: 400 });
    const cleanedBefore = before.getStats().litterCleaned;
    expect(cleanedBefore).toBeGreaterThan(0);

    const document = JSON.parse(JSON.stringify(before.getSaveState()));
    const after = new ParkSimulation(808);
    after.loadSaveState(document);
    // Buildings are restored by ParkGame, then handed straight back over.
    after.setFacilities(messyPark(1));
    after.setRunning(true);

    expect(after.getStaff()).toHaveLength(1);
    expect(after.getStats().litterCleaned).toBe(cleanedBefore);
    // A restored janitor starts at their post rather than mid-walk, and gets
    // straight back to work.
    expect(after.getStaff()[0]?.state).toBe('idle');
    for (let tick = 0; tick < 1_200; tick += 1) after.update(0.1, { x: 400, z: 400 });
    expect(after.getStats().litterCleaned).toBeGreaterThan(cleanedBefore);
  });

  it('stays deterministic for a seed and a crew', () => {
    const snapshot = (simulation: ParkSimulation) => ({
      staff: simulation.getStaff(),
      litter: simulation.getLitter(),
      stats: { ...simulation.getStats() },
    });
    expect(snapshot(run(555, messyPark(2), 200))).toEqual(snapshot(run(555, messyPark(2), 200)));
  });
});

describe('the crew while nobody is watching', () => {
  const stats: ParkStats = {
    cash: 0, reputation: 50, cleanliness: 0.3, guestCount: 0, guestsServed: 0,
    guestsVisited: 0, litterCleaned: 0, revenue: 0, expenses: 0, day: 1, minuteOfDay: 540,
  };

  function profileWith(janitorCount: number) {
    const profile = createEmptyAwayProfile();
    profile.appeal = 200;
    profile.janitorCount = janitorCount;
    profile.foodCount = 4;
    profile.binCount = 0;
    profile.needs.hunger = { throughput: 0.6, revenuePerService: 30, acceptance: 1 };
    return profile;
  }

  it('leaves a park dirtier without a crew than with one', () => {
    const alone = computeAwayProgress(stats, profileWith(0), 3600, 40)!;
    const staffed = computeAwayProgress(stats, profileWith(2), 3600, 40)!;
    expect(staffed.cleanliness).toBeGreaterThan(alone.cleanliness);
    expect(staffed.litterCreated).toBeLessThan(alone.litterCreated);
  });

  it('clears a backlog it was left with, rather than only slowing the mess', () => {
    // Paying wages through the night and coming back to the same heap was the
    // bug: the crew was on the payroll offline and did nothing for it.
    const staffed = computeAwayProgress(stats, profileWith(3), 3600, 40)!;
    expect(staffed.litterRemoved).toBeGreaterThan(0);
    expect(staffed.cleanliness).toBeGreaterThan(0.5);
  });

  it('does nothing at all for a park with no crew', () => {
    const alone = computeAwayProgress(stats, profileWith(0), 3600, 40)!;
    expect(alone.litterRemoved).toBe(0);
  });

  it('actually takes the litter off the ground, not just off the report', () => {
    const simulation = new ParkSimulation(88);
    simulation.setFacilities([]);
    simulation.loadSaveState({
      ...simulation.getSaveState(),
      litter: Array.from({ length: 30 }, (_, index) => ({
        id: `old-${index}`,
        position: { x: index, z: 0 },
        variant: 0,
        age: index,
      })),
    });
    expect(simulation.getLitter().length).toBe(30);

    const report = computeAwayProgress(simulation.getStats(), profileWith(3), 3600, 30)!;
    expect(report.litterRemoved).toBeGreaterThan(0);
    simulation.applyAwayProgress(report);
    // The summary said the crew cleared it; the park has to agree.
    expect(simulation.getLitter().length).toBeLessThan(30);
  });
});

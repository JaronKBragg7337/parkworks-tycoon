import { describe, expect, it } from 'vitest';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { getPlaceableSpec } from '../src/core/catalog';
import {
  FUN_PRIORITY_WEIGHT,
  FUN_RECONSIDER_THRESHOLD,
  GUEST_LIFETIME_SECONDS,
  NEED_GROWTH_PER_SECOND,
  NEED_PRIORITY_THRESHOLD,
  NEED_RELIEF_PER_SERVICE,
  secondsUntilNeedReturns,
} from '../src/core/needRates';
import type { FacilitySnapshot, PlaceableKind } from '../src/core/types';

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return {
    id,
    kind,
    position: { x, z },
    rotation: 0,
    queueLength: 0,
    activeUsers: 0,
    enabled: true,
  };
}

/**
 * Runs a park and records who used what. Guests are the unit of interest here,
 * not totals: a park serving 40 rides to 40 guests and a park serving 40 rides
 * to 13 guests look identical on the books and completely different to play.
 */
function ridesPerGuest(seed: number, seconds: number) {
  const simulation = new ParkSimulation(seed);
  const rides = new Map<string, number>();
  const seen = new Set<string>();

  simulation.subscribe((event) => {
    if (event.type === 'guest-spawned') seen.add(event.guest.id);
    if (event.type !== 'service-complete') return;
    const kind = layout.find((item) => item.id === event.facilityId)?.kind;
    if (!kind || getPlaceableSpec(kind).serviceNeed !== 'fun') return;
    rides.set(event.guestId, (rides.get(event.guestId) ?? 0) + 1);
  });

  // Rides 30-45m apart: at guest walking speed that is 15-25 seconds of travel
  // each way, which is the case that actually caught the bug. Rides packed
  // together hide it, because the walk is free.
  const layout = [
    facility('ride-a', 'carousel', 34, -8),
    facility('ride-b', 'bumper-cars', -32, -14),
    facility('ride-c', 'pirate-ship', 4, -44),
    facility('food', 'burger-kiosk', -18, 12),
    facility('toilet', 'restroom', 22, 14),
    facility('bin', 'trash-bin', -2, 2),
  ];
  simulation.setFacilities(layout);
  simulation.setRunning(true);
  for (let tick = 0; tick < seconds * 10; tick += 1) {
    simulation.update(0.1, { x: 200, z: 200 });
  }

  // Only guests who came and went are judged; someone who arrived at the very
  // end of the window has not had a visit yet.
  const departed = [...seen].filter(
    (id) => !simulation.getGuests().some((guest) => guest.id === id),
  );
  const counts = departed.map((id) => rides.get(id) ?? 0);
  const riders = counts.filter((count) => count > 0);
  return {
    departed: departed.length,
    riders: riders.length,
    averageRidesPerRider: riders.length > 0
      ? riders.reduce((total, count) => total + count, 0) / riders.length
      : 0,
    repeatRiders: riders.filter((count) => count > 1).length,
  };
}

describe('a guest visit', () => {
  it('leaves enough time to ride again after a ride', () => {
    // The bug was arithmetic: a ride relieved more `fun` than a guest could
    // regrow before the gate called them home, so one ride per visit was
    // forced no matter how many rides the park had.
    //
    // The quantity that decides this is the recovery cycle — how long it takes
    // to regain exactly what one ride consumed — plus the length of the ride
    // itself. At the old relief of 0.82 that was 228 + 20 = 248 seconds against
    // a 155-second visit, which is why guests only ever rode once. This asserts
    // the relationship rather than the number, so retuning the rates together
    // keeps passing and retuning one of them alone does not.
    const longestRide = Math.max(
      getPlaceableSpec('drop-tower').serviceSeconds,
      getPlaceableSpec('sky-wheel').serviceSeconds,
    );
    const recoveryCycle = NEED_RELIEF_PER_SERVICE.fun / NEED_GROWTH_PER_SECOND.fun;
    expect(recoveryCycle + longestRide).toBeLessThan(GUEST_LIFETIME_SECONDS);

    // A guest who rode when they were barely interested lands on the floor and
    // waits longest of anyone. Even they must get a second chance inside a visit.
    const fromTheFloor = secondsUntilNeedReturns('fun', FUN_RECONSIDER_THRESHOLD);
    expect(fromTheFloor + longestRide).toBeLessThan(GUEST_LIFETIME_SECONDS);

    // Wanting a ride badly enough to prioritise it over eating is the stricter
    // bar, and it still has to be reachable twice in a visit.
    const prioritise = secondsUntilNeedReturns(
      'fun',
      NEED_PRIORITY_THRESHOLD / FUN_PRIORITY_WEIGHT,
    );
    expect(prioritise).toBeLessThan(GUEST_LIFETIME_SECONDS);
  });

  it('rides more than once across several seeds', () => {
    // Bars chosen from measurement, not taste. On this layout the old relief of
    // 0.82 produced 1.56-1.69 rides per rider with 33-44% of guests riding only
    // once; 0.30 produces 2.22-2.44 with at most one such guest per run. These
    // thresholds sit in the gap, so the old value fails them and the new value
    // clears them with room to spare.
    for (const seed of [11, 404, 8675, 90210]) {
      const result = ridesPerGuest(seed, 420);
      expect(result.riders, `seed ${seed} produced too few riders`).toBeGreaterThan(20);
      expect(
        result.averageRidesPerRider,
        `seed ${seed} averaged ${result.averageRidesPerRider.toFixed(2)} rides per rider`,
      ).toBeGreaterThan(2);
      expect(
        result.repeatRiders / result.riders,
        `seed ${seed} had ${result.repeatRiders}/${result.riders} repeat riders`,
      ).toBeGreaterThan(0.9);
    }
  });
});

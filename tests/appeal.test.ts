import { describe, expect, it } from 'vitest';
import { appealFalloff, decorAppealAt, totalParkAppeal, type AppealContribution } from '../src/core/appeal';
import { computeAwayProgress, createEmptyAwayProfile } from '../src/core/awayReport';
import { OPEN_SHARE_OF_REAL_TIME, isParkOpen } from '../src/core/dayCycle';
import { getPlaceableSpec } from '../src/core/catalog';
import { ParkSimulation } from '../src/core/ParkSimulation';
import type { PlaceableKind } from '../src/core/types';

function at(kind: PlaceableKind, x: number, z: number, connected = true): AppealContribution {
  return { spec: getPlaceableSpec(kind), position: { x, z }, connected };
}

describe('appeal falloff', () => {
  it('is full value against the building and nothing at the rim', () => {
    expect(appealFalloff(0, 10)).toBe(1);
    expect(appealFalloff(10, 10)).toBe(0);
    expect(appealFalloff(14, 10)).toBe(0);
  });

  it('holds up near the source and drops away late', () => {
    expect(appealFalloff(2.5, 10)).toBeCloseTo(0.9375, 5);
    expect(appealFalloff(5, 10)).toBeCloseTo(0.75, 5);
    expect(appealFalloff(7.5, 10)).toBeCloseTo(0.4375, 5);
    expect(appealFalloff(9, 10)).toBeCloseTo(0.19, 5);
  });

  it('never increases as the item moves away', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let distance = 0; distance <= 12; distance += 0.5) {
      const value = appealFalloff(distance, 9);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBe(0);
  });

  it('refuses to give value for a radius that is not one', () => {
    expect(appealFalloff(1, 0)).toBe(0);
    expect(appealFalloff(1, Number.NaN)).toBe(0);
    expect(appealFalloff(Number.NaN, 8)).toBe(0);
  });
});

describe('what a decoration is worth where it stands', () => {
  const lamp = getPlaceableSpec('park-lamp');

  it('is worth nothing with nothing to decorate', () => {
    expect(decorAppealAt(at('park-lamp', 0, 0), [at('park-lamp', 0, 0)])).toBe(0);
    expect(decorAppealAt(at('park-lamp', 0, 0), [at('shade-tree', 1, 1)])).toBe(0);
  });

  it('is worth its full appeal against the building it lights', () => {
    const kiosk = at('burger-kiosk', 0, 0);
    const beside = at('park-lamp', 0, 2.5);
    expect(decorAppealAt(beside, [kiosk, beside])).toBeCloseTo(lamp.appeal, 5);
  });

  it('fades to nothing as it is pushed towards the fence', () => {
    const kiosk = at('burger-kiosk', 0, 0);
    const near = at('park-lamp', 0, 6);
    const far = at('park-lamp', 0, 10);
    const abandoned = at('park-lamp', 0, 20);
    const nearValue = decorAppealAt(near, [kiosk, near]);
    const farValue = decorAppealAt(far, [kiosk, far]);
    expect(nearValue).toBeGreaterThan(farValue);
    expect(farValue).toBeGreaterThan(0);
    expect(decorAppealAt(abandoned, [kiosk, abandoned])).toBe(0);
  });

  it('measures to the edge of a large ride, not to its distant centre', () => {
    // Both lamps stand 8 m from the middle of the building. Against the sky
    // wheel that is a lamp at the fence of the ride; against the kiosk it is a
    // lamp on its own in the grass, and it is worth correspondingly less.
    const wheel = at('sky-wheel', 0, 0);
    const kiosk = at('burger-kiosk', 0, 0);
    const beside = at('park-lamp', 0, 8);
    expect(decorAppealAt(beside, [wheel, beside])).toBeGreaterThan(
      decorAppealAt(beside, [kiosk, beside]),
    );
  });

  it('takes its best anchor and does not stack them', () => {
    const lamp1 = at('park-lamp', 0, 5);
    const nearest = at('burger-kiosk', 0, 0);
    const alone = decorAppealAt(lamp1, [nearest, lamp1]);
    const surrounded = decorAppealAt(lamp1, [
      nearest,
      at('lemonade-stand', 5, 7),
      at('restroom', -6, 8),
      at('carousel', 9, 9),
      lamp1,
    ]);
    expect(alone).toBeGreaterThan(0);
    expect(surrounded).toBeCloseTo(alone, 5);
    expect(surrounded).toBeLessThanOrEqual(lamp.appeal);
  });

  it('will not anchor to another decoration or to a cut-off facility', () => {
    const lamp1 = at('park-lamp', 0, 2);
    expect(decorAppealAt(lamp1, [at('shade-tree', 0, 0), lamp1])).toBe(0);
    expect(decorAppealAt(lamp1, [at('carousel', 0, 0, false), lamp1])).toBe(0);
  });

  it('leaves anything without a radius exactly as it was', () => {
    const wheel = at('sky-wheel', 20, 20);
    expect(decorAppealAt(wheel, [])).toBe(getPlaceableSpec('sky-wheel').appeal);
  });
});

describe('the park total', () => {
  it('counts attractions wherever they stand', () => {
    const park = [at('carousel', -20, -20), at('burger-kiosk', 20, 20)];
    expect(totalParkAppeal(park)).toBe(
      getPlaceableSpec('carousel').appeal + getPlaceableSpec('burger-kiosk').appeal,
    );
  });

  it('drops a disconnected facility out of the total entirely', () => {
    expect(totalParkAppeal([at('carousel', 0, 0, false)])).toBe(0);
  });

  it('pays for decoration placed where the guests are', () => {
    const spread = [at('carousel', 0, 0), at('shade-tree', 0, 22), at('park-lamp', 22, 0)];
    const gathered = [at('carousel', 0, 0), at('shade-tree', 0, 6), at('park-lamp', 5.5, 0)];
    expect(totalParkAppeal(spread)).toBe(getPlaceableSpec('carousel').appeal);
    expect(totalParkAppeal(gathered)).toBeGreaterThan(totalParkAppeal(spread));
    // Even placed perfectly, decoration cannot be worth more than it says.
    expect(totalParkAppeal(gathered)).toBeLessThanOrEqual(
      getPlaceableSpec('carousel').appeal +
        getPlaceableSpec('shade-tree').appeal +
        getPlaceableSpec('park-lamp').appeal,
    );
  });

  it('makes the fountain the decoration worth planning a plaza around', () => {
    const plaza = (kind: PlaceableKind, z: number): number =>
      totalParkAppeal([at('carousel', 0, 0), at(kind, 0, z)]) - getPlaceableSpec('carousel').appeal;
    expect(plaza('tiered-fountain', 9)).toBeGreaterThan(plaza('shade-tree', 9));
    expect(plaza('shade-tree', 9)).toBeGreaterThan(plaza('blossom-planter', 9));
    // Out past the planter's reach it is landscaping nobody is standing in.
    expect(plaza('blossom-planter', 11)).toBe(0);
    expect(plaza('tiered-fountain', 11)).toBeGreaterThan(0);
  });
});

describe('live and offline agree about a crowd', () => {
  // ParkGame hands one appeal total to both the live spawner and the away
  // report, so the check that matters is that the two turn that total into the
  // same crowd. Anything else is the two halves of the game disagreeing about
  // how good the park is while the player is not looking.
  const HOUR = 3_600;
  const VISIT_SECONDS = 155;

  function liveAttendance(appeal: number) {
    const simulation = new ParkSimulation(411);
    simulation.setParkMetrics(appeal, 0);
    simulation.setFacilities([]);
    simulation.setRunning(true);
    let peak = 0;
    for (let tick = 0; tick < 8_000; tick += 1) {
      simulation.update(0.1, { x: 200, z: 200 });
      // Only while trading. The park now shuts overnight and empties, and a
      // reading taken at 3am would say the crowd is nobody.
      if (isParkOpen(simulation.getStats().minuteOfDay)) {
        peak = Math.max(peak, simulation.getStats().guestCount);
      }
    }
    return { peak, stats: { ...simulation.getStats() } };
  }

  function expectAgreement(appeal: number): void {
    const { peak, stats } = liveAttendance(appeal);
    expect(peak).toBeGreaterThan(5);

    const profile = createEmptyAwayProfile();
    profile.appeal = appeal;
    // Judged against the same park's reputation, because attendance now depends
    // on it: a better-regarded park is one people arrive at faster.
    const projected = computeAwayProgress(stats, profile, HOUR, 0)!.guestsVisited;

    // An hour of absence is not an hour of trading — the gates are shut for part
    // of it, and only the open share sends anybody home.
    const expected = (peak * HOUR * OPEN_SHARE_OF_REAL_TIME) / VISIT_SECONDS;

    // Within a tenth, rather than exactly. The projection is explicitly an
    // estimate: it derives attendance from the mean spawn interval while the
    // live park rolls a fresh interval every arrival, so the two land close but
    // never identical. Agreeing to the guest is not the invariant worth pinning;
    // agreeing about the size of the crowd is.
    expect(projected).toBeGreaterThan(expected * 0.9);
    expect(projected).toBeLessThan(expected * 1.1);
  }

  it('draws the same crowd for a park whose decoration is where the guests are', () => {
    const park = [
      at('carousel', 0, 0),
      at('burger-kiosk', 8, 2),
      at('shade-tree', 4, 4),
      at('park-lamp', 3, -3),
      at('blossom-planter', 1.5, 5),
      at('tiered-fountain', 0, 25),
    ];
    const appeal = totalParkAppeal(park);
    expect(appeal).toBeGreaterThan(getPlaceableSpec('carousel').appeal);
    expectAgreement(appeal);
  });

  it('agrees again on the smaller crowd once the decoration is out at the fence', () => {
    const attractions = [at('carousel', 0, 0), at('burger-kiosk', 8, 2)];
    const abandoned = totalParkAppeal([
      ...attractions,
      at('shade-tree', -24, 24),
      at('park-lamp', 24, -24),
    ]);
    expect(abandoned).toBe(
      getPlaceableSpec('carousel').appeal + getPlaceableSpec('burger-kiosk').appeal,
    );
    expectAgreement(abandoned);
  });
});

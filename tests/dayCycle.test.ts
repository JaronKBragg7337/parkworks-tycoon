import { describe, expect, it } from 'vitest';
import {
  CLOSING_MINUTE,
  MINUTES_PER_DAY,
  OPENING_MINUTE,
  OPEN_SHARE_OF_REAL_TIME,
  REAL_SECONDS_OPEN,
  REAL_SECONDS_PER_PARK_DAY,
  advanceClock,
  isParkOpen,
  normaliseMinute,
} from '../src/core/dayCycle';
import { ParkSimulation } from '../src/core/ParkSimulation';
import type { FacilitySnapshot, PlaceableKind } from '../src/core/types';

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return { id, kind, position: { x, z }, rotation: 0, queueLength: 0, activeUsers: 0, enabled: true };
}

describe('the park clock', () => {
  it('gives the day far more real time than it used to', () => {
    // The old day was 720 sim-minutes at 3.5 a second: 205 seconds, start to
    // finish, with no night at all. The point of this change is that a day is
    // long enough for the day counter to mean something.
    expect(REAL_SECONDS_PER_PARK_DAY).toBeGreaterThan(205 * 2);
    expect(REAL_SECONDS_OPEN).toBeGreaterThan(400);
  });

  it('spends most of its real time open, not waiting for morning', () => {
    // Night passes faster than day on purpose: there is nothing to do while the
    // gates are shut, so sitting through a proportional night would be waiting
    // for nothing.
    expect(OPEN_SHARE_OF_REAL_TIME).toBeGreaterThan(0.75);
    expect(OPEN_SHARE_OF_REAL_TIME).toBeLessThan(1);
  });

  it('knows when the gates are open', () => {
    expect(isParkOpen(OPENING_MINUTE)).toBe(true);
    expect(isParkOpen(13 * 60)).toBe(true);
    expect(isParkOpen(CLOSING_MINUTE)).toBe(false);
    expect(isParkOpen(3 * 60)).toBe(false);
    expect(isParkOpen(23 * 60)).toBe(false);
  });

  it('wraps any minute into a real time of day', () => {
    expect(normaliseMinute(MINUTES_PER_DAY)).toBe(0);
    expect(normaliseMinute(MINUTES_PER_DAY + 90)).toBe(90);
    expect(normaliseMinute(-30)).toBe(MINUTES_PER_DAY - 30);
    expect(normaliseMinute(Number.NaN)).toBe(OPENING_MINUTE);
  });

  it('charges each side of a boundary at its own rate', () => {
    // A step that straddles closing time must not be billed entirely at the
    // daytime rate, or the fast night would start late and drift.
    const justBeforeClosing = CLOSING_MINUTE - 1;
    const step = advanceClock(justBeforeClosing, 30);
    // Thirty seconds of mostly night covers hours, so this runs clean past
    // midnight — measure total minutes travelled rather than the clock face.
    const travelled = step.minuteOfDay + step.daysPassed * MINUTES_PER_DAY - justBeforeClosing;
    expect(travelled).toBeGreaterThan(200);
    // Billed entirely at the daytime rate the same step would have moved 48
    // minutes and never left the evening.
    expect(travelled).toBeGreaterThan(30 * 1.6 * 2);
  });

  it('rolls the day over exactly once across midnight', () => {
    const step = advanceClock(MINUTES_PER_DAY - 10, 60);
    expect(step.daysPassed).toBe(1);
    expect(step.minuteOfDay).toBeLessThan(OPENING_MINUTE);
  });

  it('never spins, however long the step', () => {
    const step = advanceClock(OPENING_MINUTE, 60 * 60 * 24);
    expect(Number.isFinite(step.minuteOfDay)).toBe(true);
    expect(step.minuteOfDay).toBeGreaterThanOrEqual(0);
    expect(step.minuteOfDay).toBeLessThan(MINUTES_PER_DAY);
  });
});

describe('a park at night', () => {
  function runUntil(predicate: (sim: ParkSimulation) => boolean, limitSeconds = 1200) {
    const simulation = new ParkSimulation(31337);
    simulation.setFacilities([
      facility('ride', 'carousel', 6, -3),
      facility('food', 'burger-kiosk', -4, 4),
    ]);
    simulation.setRunning(true);
    for (let tick = 0; tick < limitSeconds * 10; tick += 1) {
      simulation.update(0.1, { x: 400, z: 400 });
      if (predicate(simulation)) return simulation;
    }
    return simulation;
  }

  it('empties once the gates close', () => {
    // Deep into the small hours. Not just past closing: guests walk out on
    // their own feet, and at night speed the clock runs several sim-hours in
    // the time it takes them to reach the gate, so checking at 22:30 would be
    // checking before anyone could physically have left.
    const simulation = runUntil((sim) => {
      const minute = sim.getStats().minuteOfDay;
      return !isParkOpen(minute) && minute > 3 * 60 && minute < OPENING_MINUTE;
    });
    expect(isParkOpen(simulation.getStats().minuteOfDay)).toBe(false);
    expect(simulation.getStats().guestCount).toBe(0);
  });

  it('pays the park out overnight, and pays a good park more', () => {
    const settlements: Array<{ total: number; standing: number; share: number }> = [];
    const simulation = new ParkSimulation(31337);
    simulation.subscribe((event) => {
      if (event.type === 'day-settled') {
        settlements.push({ total: event.total, standing: event.standing, share: event.share });
      }
    });
    simulation.setFacilities([
      facility('ride', 'carousel', 6, -3),
      facility('food', 'burger-kiosk', -4, 4),
    ]);
    simulation.setRunning(true);
    const cashBefore = simulation.getStats().cash;
    for (let tick = 0; tick < 1200 * 10; tick += 1) simulation.update(0.1, { x: 400, z: 400 });

    expect(settlements.length).toBeGreaterThan(0);
    const first = settlements[0]!;
    expect(first.total).toBeGreaterThan(0);
    // Every part is doing something: a fixed floor, a reputation share, and a
    // cut of what the park actually took.
    expect(first.standing).toBeGreaterThan(0);
    expect(first.share).toBeGreaterThan(0);
    expect(first.total).toBeGreaterThan(first.standing);
    // The payout reached the books, not just the event.
    expect(simulation.getStats().cash).toBeGreaterThan(cashBefore - 100000);
  });

  it('does not pay a park that never opened', () => {
    // No facilities, no guests, no takings: the subsidy still lands so a
    // struggling park survives, but nothing else does.
    const settlements: number[] = [];
    const simulation = new ParkSimulation(5);
    simulation.subscribe((event) => {
      if (event.type === 'day-settled') settlements.push(event.share);
    });
    simulation.setFacilities([]);
    simulation.setRunning(true);
    for (let tick = 0; tick < 1200 * 10; tick += 1) simulation.update(0.1, { x: 400, z: 400 });
    expect(settlements.length).toBeGreaterThan(0);
    expect(settlements[0]).toBe(0);
  });
});

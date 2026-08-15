import { describe, expect, it } from 'vitest';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { getPlaceableSpec } from '../src/core/catalog';
import { typicalWallet } from '../src/core/pricing';
import type { FacilitySnapshot, PlaceableKind } from '../src/core/types';

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return { id, kind, position: { x, z }, rotation: 0, queueLength: 0, activeUsers: 0, enabled: true };
}

const CAROUSEL = getPlaceableSpec('carousel').revenue;

/**
 * A park charging half as much again as standard: enough that wallets actually
 * run dry inside a visit, but not so much that guests refuse everything.
 *
 * The distinction matters and cost a rewrite to learn. At triple price nobody
 * buys at all — acceptance is zero, so no wallet ever drains and the cash
 * machine sees no one. A park has to be *expensive and worth it* before a cash
 * machine has a job.
 */
function drainingPark(withCashMachine: boolean) {
  const layout = [
    facility('ride', 'carousel', 6, -3),
    facility('ride2', 'bumper-cars', -6, -3),
    facility('ride3', 'pirate-ship', 0, -12),
    facility('food', 'burger-kiosk', -4, 4),
    facility('pizza', 'pizza-kitchen', 8, 4),
  ];
  if (withCashMachine) layout.push(facility('atm', 'cash-machine', 0, 6));

  const simulation = new ParkSimulation(9001);
  simulation.setFacilities(layout);
  for (const kind of ['carousel', 'bumper-cars', 'pirate-ship', 'burger-kiosk', 'pizza-kitchen'] as PlaceableKind[]) {
    simulation.setPrice(kind, Math.round(getPlaceableSpec(kind).revenue * 1.5));
  }
  simulation.setRunning(true);

  let withdrawals = 0;
  simulation.subscribe((event) => {
    if (event.type === 'service-complete' && event.facilityId === 'atm') withdrawals += 1;
  });
  for (let tick = 0; tick < 600 * 10; tick += 1) {
    simulation.update(0.1, { x: 400, z: 400 });
  }
  return { simulation, withdrawals };
}

describe('the cash machine', () => {
  it('charges a withdrawal fee rather than being free', () => {
    expect(getPlaceableSpec('cash-machine').revenue).toBeGreaterThan(0);
    expect(getPlaceableSpec('cash-machine').serviceNeed).toBe('cash');
  });

  it('gets used when guests run low', () => {
    const { withdrawals } = drainingPark(true);
    // Measured at ~39 over ten minutes on this layout; the bar is set low enough
    // that ordinary drift will not trip it, and at zero the feature is dead.
    expect(withdrawals).toBeGreaterThan(10);
  });

  it('is worth most to a park that charges the most', () => {
    const withOne = drainingPark(true).simulation.getStats().revenue;
    const without = drainingPark(false).simulation.getStats().revenue;
    // Measured: $8,731 against $5,915, about half as much again. A park that
    // lets people top up keeps selling; one that does not runs its guests dry
    // and then cannot sell to them at any price.
    expect(withOne).toBeGreaterThan(without * 1.25);
  });

  it('is reachable by a guest who has nothing at all', () => {
    // The trap this avoids: charging a fee up front would mean the guest who
    // most needs a cash machine is the one guest who cannot use it. A broke
    // guest must still be able to walk up to it.
    const simulation = new ParkSimulation(4);
    simulation.setFacilities([facility('atm', 'cash-machine', 0, 6)]);
    simulation.setPrice('carousel', CAROUSEL);
    simulation.setRunning(true);
    for (let tick = 0; tick < 200 * 10; tick += 1) {
      simulation.update(0.1, { x: 400, z: 400 });
    }
    // Nobody ended up in debt, and the machine did not refuse anyone.
    expect(simulation.getGuests().every((guest) => guest.wallet >= 0)).toBe(true);
  });

  it('hands over more than it charges', () => {
    const fee = getPlaceableSpec('cash-machine').revenue;
    // A top-up that did not clear its own fee would be a trap of a different
    // shape: guests would queue, get poorer, and queue again.
    expect(typicalWallet(38)).toBeGreaterThan(fee * 10);
  });
});

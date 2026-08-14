/**
 * What a park's appeal adds up to, and why a lamp in the far corner is worth
 * less than the same lamp beside the burger stand.
 *
 * Appeal is the number the guest population is derived from, so it has to be a
 * single total in the end. The question this file answers is what each building
 * puts into that total.
 *
 * Attractions put in all of it. A carousel is a reason to come to the park, and
 * it is that wherever it stands. Decoration is not: nobody travels to see a
 * planter. A planter is worth something because of what it is next to, so its
 * appeal is scaled by how close it is to somewhere guests actually go, and a
 * park with its trees pushed against the fence line is worth what an empty lawn
 * is worth. That is the whole rule; everything below is that rule with numbers.
 *
 * The live park and the offline projection both total appeal by calling
 * `totalParkAppeal`, rather than each summing `spec.appeal` in their own loop.
 * A park that reads 180 appeal on screen therefore draws exactly the crowd the
 * away report projects for it, and the two cannot drift apart without the
 * function they share changing underneath both.
 */
import type { PlaceableSpec, Vec2 } from './types';

/** One placed building, as the appeal total sees it. */
export interface AppealContribution {
  spec: PlaceableSpec;
  position: Vec2;
  /** Facilities cut off from the path network draw nobody and decorate nothing. */
  connected: boolean;
}

/**
 * How much of a decor item's appeal survives at this distance from the thing it
 * decorates, from 1 alongside to 0 at the rim.
 *
 * The falloff is squared for the same reason the lamp's ground decal is: real
 * illumination holds up near the source and then goes quickly, which puts the
 * interesting decision — is this close enough to count? — in the last third of
 * the radius rather than spread evenly across it. Beside a building is full
 * value; halfway out is still three quarters; at the rim it is nothing.
 */
export function appealFalloff(distance: number, radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const reach = Math.max(0, Number.isFinite(distance) ? distance : radius) / radius;
  if (reach >= 1) return 0;
  return 1 - reach * reach;
}

/**
 * Distance from a decor item to the edge of an attraction rather than to its
 * middle. A sky wheel's centre is six metres inside its own footprint, and a
 * lamp standing at its fence should not be charged for that. The footprint is
 * axis-aligned and buildings rotate, so this deliberately takes the longer side:
 * it is generous by up to a couple of metres, which is the right way to be wrong
 * about whether a decoration you placed against a wall counts.
 */
function distanceToFootprint(from: Vec2, anchor: AppealContribution): number {
  const dx = from.x - anchor.position.x;
  const dz = from.z - anchor.position.z;
  const footprintRadius = Math.max(anchor.spec.footprint[0], anchor.spec.footprint[1]) / 2;
  return Math.max(0, Math.hypot(dx, dz) - footprintRadius);
}

/**
 * What one decor item is worth where it stands.
 *
 * Only the strongest single anchor counts. Ringing one ride with eight trees
 * should be eight trees' worth of appeal and no more — the trees are not worth
 * more because they can see each other, and letting them stack would make a
 * dense knot of cheap decoration the most efficient thing in the game.
 */
export function decorAppealAt(
  item: AppealContribution,
  anchors: readonly AppealContribution[],
): number {
  const radius = item.spec.radius;
  if (typeof radius !== 'number') return item.spec.appeal;

  let best = 0;
  for (const anchor of anchors) {
    if (anchor === item || !anchor.connected || anchor.spec.category === 'decor') continue;
    best = Math.max(best, appealFalloff(distanceToFootprint(item.position, anchor), radius));
    if (best >= 1) break;
  }
  return item.spec.appeal * best;
}

/**
 * The park's appeal, as both the live spawner and the away projection see it.
 *
 * Decoration is anchored to attractions only, never to other decoration, so a
 * bed of flowers in an empty field stays worth nothing however many beds are
 * planted around it.
 */
export function totalParkAppeal(items: readonly AppealContribution[]): number {
  let total = 0;
  for (const item of items) {
    if (!item.connected) continue;
    total += typeof item.spec.radius === 'number' ? decorAppealAt(item, items) : item.spec.appeal;
  }
  return total;
}

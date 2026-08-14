/**
 * The rates that govern a guest's visit, in one place.
 *
 * These numbers used to live twice: once in ParkSimulation as literals inside
 * `updateGuest` and `completeService`, and once in awayReport as a copied table
 * with a comment asking whoever changed one to remember the other. Nobody
 * remembers. The offline projection is only honest while it uses the same rates
 * the live park does, so the two now read from here and cannot drift.
 *
 * ## Why `fun` relief is 0.30
 *
 * It was 0.82, and that was the bug behind guests not moving on to another
 * ride. The arithmetic:
 *
 *   - A ride dropped `fun` by 0.82, taking almost any guest to the 0.03 floor.
 *   - `fun` regrows at 0.0036/sec, so regaining what one ride consumed took 228
 *     seconds — longer than the 155-second visit it had to happen inside.
 *   - A guest reconsiders a ride at `fun > 0.34` (on a 38% roll) and prioritises
 *     one at `fun > 0.51`; from the floor that is 86 and 134 seconds.
 *
 * Measured against the simulation over four seeds and 420 seconds, the old
 * value put a hard ceiling of **two** rides on a visit, and in a park with
 * rides 30-45m apart **a third to a half of all guests managed only one**
 * (11-15 of ~34 departures per run). Those runs walk in straight lines with no
 * path network, so real play — where guests follow the paths you drew — sits at
 * or below that. This is what "guests only ever ride one ride" looked like from
 * the inside: not a hard limit of one, but a ceiling of two that walking
 * distance routinely knocked down to one.
 *
 * At 0.30 the recovery cycle is 83 seconds, which fits inside a visit with room
 * for the ride itself. The same measurement gives **2.2 to 2.6 rides per
 * guest**, a ceiling of three, and essentially no one-ride visits (at most one
 * guest per run). Ride revenue rises 16-21%.
 *
 * Lowering the relief was preferred over lengthening the visit, which would
 * have made the park feel slower rather than making rides feel worth building.
 */

/** Need growth per second, per guest. Used by ParkSimulation.updateGuest. */
export const NEED_GROWTH_PER_SECOND = {
  hunger: 0.0042,
  fun: 0.0036,
  bladder: 0.0031,
  rest: 0.0022,
} as const;

/**
 * How much one completed service takes off a need.
 *
 * `bladder` is a special case: the live simulation resets it to the floor
 * outright rather than subtracting, because a restroom either solves the
 * problem or it does not. 0.83 is the effective subtraction that reset performs
 * on a guest who actually needed it, which is what the offline projection wants
 * in order to count restroom demand correctly.
 */
export const NEED_RELIEF_PER_SERVICE = {
  hunger: 0.72,
  fun: 0.3,
  bladder: 0.83,
  rest: 0.6,
} as const;

/** A served need never reaches zero — nobody leaves a ride with no wish to do anything. */
export const NEED_FLOOR_AFTER_SERVICE = {
  hunger: 0.04,
  fun: 0.03,
  bladder: 0.03,
  rest: 0.02,
} as const;

/** Seconds a guest stays before heading for the gate. ParkSimulation.updateGuest. */
export const GUEST_LIFETIME_SECONDS = 155;

/** `fun` above this puts a ride in play on a 38% roll — ParkSimulation.chooseGuestAction. */
export const FUN_RECONSIDER_THRESHOLD = 0.34;

/** Weighted urgency above this makes a need the guest's top priority. */
export const NEED_PRIORITY_THRESHOLD = 0.48;

/** `fun` is weighted at 0.94 when needs are ranked, so this is the real bar for a ride. */
export const FUN_PRIORITY_WEIGHT = 0.94;

export type ServicedNeed = keyof typeof NEED_GROWTH_PER_SECOND;

export const SERVICED_NEEDS: readonly ServicedNeed[] = ['hunger', 'fun', 'bladder', 'rest'];

/**
 * Seconds before a guest whose need was just served wants that need met again.
 * Exported because it is the number that decides whether a park's rides get
 * used more than once, and the test suite asserts on it directly.
 */
export function secondsUntilNeedReturns(need: ServicedNeed, threshold: number): number {
  const floor = NEED_FLOOR_AFTER_SERVICE[need];
  return Math.max(0, (threshold - floor) / NEED_GROWTH_PER_SECOND[need]);
}

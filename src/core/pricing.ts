/**
 * What the park charges, and whether guests think it is worth it.
 *
 * This is the lever that makes a big park feel different from a small one. Any
 * park can raise a price; only a park with a reputation can raise one and keep
 * its guests. A well-run park charges double and stays full. A park with a
 * reputation of nothing charges above the going rate and watches people walk
 * past the queue.
 *
 * The rule is deliberately one sentence: reputation buys tolerance. Everything
 * below is that sentence with numbers attached, kept as pure functions so the
 * live simulation, the offline projection, and the UI all predict the same
 * thing — the price preview a player sees before committing is computed by the
 * same code that will charge their guests.
 */
import { getPlaceableSpec } from './catalog';
import type { PlaceableKind } from './types';

/** Prices the player has set, by kind. Anything absent charges the spec's price. */
export type PriceBook = Partial<Record<PlaceableKind, number>>;

/** Nobody may charge more than this multiple of a facility's designed price. */
export const MAX_PRICE_MULTIPLE = 3;

/**
 * Tolerance at rock bottom and at a perfect reputation.
 *
 * A park nobody rates is still worth something — 0.75 rather than 0 — because
 * guests came through the gate and a cheap day out is a real offer. The ceiling
 * of 2.0 is what makes reputation worth chasing: at 100 the park charges double
 * and nobody blinks, which is a different business from the one at 38.
 */
const TOLERANCE_AT_ZERO_REPUTATION = 0.75;
const TOLERANCE_AT_FULL_REPUTATION = 2;

/**
 * How far past tolerance a price can go before literally nobody pays. Guests do
 * not all have the same limit, so the refusal ramps over this band instead of
 * switching off at a single number — one penny over tolerance should cost a few
 * customers, not all of them.
 */
const REFUSAL_BAND = 0.5;

/** What a facility charges today: the player's price, or the designed one. */
export function priceFor(kind: PlaceableKind, prices: PriceBook | undefined): number {
  const base = getPlaceableSpec(kind).revenue;
  if (base <= 0) return 0;
  const set = prices?.[kind];
  if (typeof set !== 'number' || !Number.isFinite(set)) return base;
  return clampPrice(kind, set);
}

/** Keeps a price inside what the game allows: never negative, never gouging past the cap. */
export function clampPrice(kind: PlaceableKind, price: number): number {
  const base = getPlaceableSpec(kind).revenue;
  if (base <= 0) return 0;
  if (!Number.isFinite(price)) return base;
  return Math.max(0, Math.min(Math.round(base * MAX_PRICE_MULTIPLE), Math.round(price)));
}

/** Whether this kind can have a price at all. Restrooms and bins are free and stay free. */
export function isPriceable(kind: PlaceableKind): boolean {
  return getPlaceableSpec(kind).revenue > 0;
}

/** The multiple of base price this park can charge before guests start refusing. */
export function priceTolerance(reputation: number): number {
  const rating = Math.max(0, Math.min(100, Number.isFinite(reputation) ? reputation : 0)) / 100;
  return (
    TOLERANCE_AT_ZERO_REPUTATION +
    (TOLERANCE_AT_FULL_REPUTATION - TOLERANCE_AT_ZERO_REPUTATION) * rating
  );
}

/**
 * The share of guests willing to pay this price, from 0 to 1.
 *
 * At or below tolerance everyone pays. Above it, willingness falls off across
 * REFUSAL_BAND and then stops entirely. Free things are always accepted, which
 * keeps restrooms and bins out of this calculation completely.
 */
export function acceptanceRate(
  kind: PlaceableKind,
  prices: PriceBook | undefined,
  reputation: number,
): number {
  const base = getPlaceableSpec(kind).revenue;
  if (base <= 0) return 1;
  const multiple = priceFor(kind, prices) / base;
  const tolerance = priceTolerance(reputation);
  if (multiple <= tolerance) return 1;
  return Math.max(0, Math.min(1, 1 - (multiple - tolerance) / REFUSAL_BAND));
}

/**
 * Revenue per guest arriving at this facility, once refusals are accounted for.
 *
 * This is the number that decides whether a price rise was a good idea, and it
 * is not monotonic: past a point each further pound charged loses more guests
 * than it gains. Showing the player this curve is the whole game of the lever.
 */
export function expectedRevenuePerGuest(
  kind: PlaceableKind,
  prices: PriceBook | undefined,
  reputation: number,
): number {
  return priceFor(kind, prices) * acceptanceRate(kind, prices, reputation);
}

/** Drops prices that are not real numbers or not for real kinds. Used when loading a save. */
export function sanitizePriceBook(raw: unknown): PriceBook {
  if (!raw || typeof raw !== 'object') return {};
  const book: PriceBook = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    let base: number;
    try {
      base = getPlaceableSpec(key as PlaceableKind).revenue;
    } catch {
      continue;
    }
    if (base <= 0) continue;
    book[key as PlaceableKind] = clampPrice(key as PlaceableKind, value);
  }
  return book;
}

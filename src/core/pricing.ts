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

/**
 * What a guest arrives carrying.
 *
 * A price means nothing until the guest can run out of money — that is the whole
 * reason wallets exist. But the wallet must not become the thing that limits an
 * ordinary visit, or it quietly undoes the ride fix in `needRates.ts` by a
 * different route: a guest who cannot afford a second ride looks exactly like a
 * guest who does not want one.
 *
 * These bounds were measured, not guessed. Over four seeds and 420 seconds on a
 * park with rides 30-45m apart:
 *
 *   - At standard prices, guests take **2.29 rides** each and almost nobody
 *     manages only one. That matches the 2.31 the park produced before wallets
 *     existed, which is the point: at the designed prices, money is not what is
 *     stopping anyone.
 *   - Raise every price 15% and takings go **up** ($4,431 to $4,986) while rides
 *     barely move. A park that has earned the right to charge more is paid for
 *     it.
 *   - Raise them 50% and takings **collapse** to $2,790, with rides down to
 *     1.86. Guests run dry, and the ones who do not simply refuse.
 *
 * An earlier range of 55-175 was rejected: it held guests to 1.98 rides at
 * standard prices, so the wallet was doing damage before the player had made a
 * single decision.
 */
const WALLET_MIN = 90;
const WALLET_MAX = 240;

/**
 * A park people rate is a park people come to spend at. This tilts the crowd's
 * money by up to a quarter either side of the base range, so reputation pays
 * twice: it widens what the park may charge, and it thickens the wallets it is
 * charging. That is the compounding a big park should feel and a small one
 * should not.
 */
const WALLET_REPUTATION_SWING = 0.25;

/**
 * How much a guest draws when they top up, as a multiple of the base wallet.
 * Generous on purpose: a guest who queues at a cash machine should be set up for
 * the rest of their visit, not back in the queue two minutes later.
 */
export const WITHDRAWAL_MULTIPLE = 0.9;

/**
 * Below this share of a full wallet a guest starts thinking about a top-up.
 * Set so they go looking while they can still afford something, rather than
 * after they are already stranded.
 */
export const TOP_UP_THRESHOLD = 0.28;

/**
 * The money one guest walks in with, given the park's standing.
 * `roll` is a 0-1 sample, kept as a parameter so the simulation's seeded
 * generator stays the only source of randomness and this stays pure.
 */
export function startingWallet(reputation: number, roll: number): number {
  const rating = Math.max(0, Math.min(100, Number.isFinite(reputation) ? reputation : 0)) / 100;
  const sample = Math.max(0, Math.min(1, Number.isFinite(roll) ? roll : 0.5));
  const base = WALLET_MIN + (WALLET_MAX - WALLET_MIN) * sample;
  // Reputation 0 pays 0.75x, 50 pays 1x, 100 pays 1.25x.
  const standing = 1 + (rating - 0.5) * 2 * WALLET_REPUTATION_SWING;
  return Math.round(base * standing);
}

/** A full wallet at this reputation, used to judge when a guest is running low. */
export function typicalWallet(reputation: number): number {
  return startingWallet(reputation, 0.5);
}

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

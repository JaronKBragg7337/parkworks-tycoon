/**
 * The park's clock: how fast a day passes, and when the gates are shut.
 *
 * A day used to be 3 minutes 25 seconds of real time and there was no night at
 * all — the clock ran 9:00 to 21:00 and then snapped back to morning. Days went
 * by so fast that the day counter meant nothing, and an hour away advanced the
 * calendar by seventeen days.
 *
 * Now the clock runs a full twenty-four hours and the park closes overnight.
 * The two halves deliberately pass at **different speeds**, which is the one
 * thing here that is not physically honest and is worth saying plainly:
 *
 *   - Open, 9:00 to 21:00, runs slowly — 7 minutes 30 seconds of real time.
 *     This is the part with guests in it and decisions to make, so it gets the
 *     time.
 *   - Closed, 21:00 to 9:00, runs fast — 1 minute 30 seconds. The park is empty
 *     and there is nothing to serve; making the player sit through a
 *     proportional night would be making them wait for nothing.
 *
 * A full day is therefore 9 minutes, against 3:25 before, and roughly 6.7 days
 * pass in an hour instead of seventeen. Night is a real beat — the gates shut,
 * the crowd files out, the books close and pay out, and the next morning opens.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Gates open and shut. Between them the park has guests; outside, it does not. */
export const OPENING_MINUTE = 9 * 60;
export const CLOSING_MINUTE = 21 * 60;

/** Sim-minutes per real second, during and outside opening hours. */
export const OPEN_SIM_MINUTES_PER_SECOND = 1.6;
export const CLOSED_SIM_MINUTES_PER_SECOND = 8;

const OPEN_SIM_MINUTES = CLOSING_MINUTE - OPENING_MINUTE;
const CLOSED_SIM_MINUTES = MINUTES_PER_DAY - OPEN_SIM_MINUTES;

/** Real seconds the park spends open, and shut, each day. */
export const REAL_SECONDS_OPEN = OPEN_SIM_MINUTES / OPEN_SIM_MINUTES_PER_SECOND;
export const REAL_SECONDS_CLOSED = CLOSED_SIM_MINUTES / CLOSED_SIM_MINUTES_PER_SECOND;
export const REAL_SECONDS_PER_PARK_DAY = REAL_SECONDS_OPEN + REAL_SECONDS_CLOSED;

/**
 * Share of real time the park is actually open for business.
 *
 * The offline projection needs this: a park left running overnight is not
 * earning overnight, and crediting the closed hours would pay for trade that
 * could not have happened.
 */
export const OPEN_SHARE_OF_REAL_TIME = REAL_SECONDS_OPEN / REAL_SECONDS_PER_PARK_DAY;

export function isParkOpen(minuteOfDay: number): boolean {
  const minute = normaliseMinute(minuteOfDay);
  return minute >= OPENING_MINUTE && minute < CLOSING_MINUTE;
}

/** Wraps any minute value into a real time of day. */
export function normaliseMinute(minuteOfDay: number): number {
  if (!Number.isFinite(minuteOfDay)) return OPENING_MINUTE;
  const wrapped = minuteOfDay % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

export function simMinutesPerSecond(minuteOfDay: number): number {
  return isParkOpen(minuteOfDay) ? OPEN_SIM_MINUTES_PER_SECOND : CLOSED_SIM_MINUTES_PER_SECOND;
}

export interface ClockStep {
  minuteOfDay: number;
  /** Whole days rolled over during this step — normally 0, and 1 at dawn. */
  daysPassed: number;
}

/**
 * Advances the clock by real seconds.
 *
 * The step is taken in pieces so a frame that straddles opening or closing time
 * is charged at the right rate on each side of the boundary. Without that, a
 * long frame during the fast night could overshoot deep into the morning and
 * skip the opening the player was waiting for.
 */
export function advanceClock(minuteOfDay: number, deltaSeconds: number): ClockStep {
  let minute = normaliseMinute(minuteOfDay);
  let remaining = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
  let daysPassed = 0;

  // Bounded so a pathological delta cannot spin here; a step this long is an
  // absence, and absences are the away report's job rather than the clock's.
  for (let guard = 0; guard < 64 && remaining > 0; guard += 1) {
    const rate = simMinutesPerSecond(minute);
    const nextBoundary = minute < OPENING_MINUTE
      ? OPENING_MINUTE
      : minute < CLOSING_MINUTE
        ? CLOSING_MINUTE
        : MINUTES_PER_DAY;
    const secondsToBoundary = (nextBoundary - minute) / rate;

    if (remaining < secondsToBoundary) {
      minute += remaining * rate;
      remaining = 0;
      break;
    }

    remaining -= secondsToBoundary;
    minute = nextBoundary;
    if (minute >= MINUTES_PER_DAY) {
      minute = 0;
      daysPassed += 1;
    }
  }

  return { minuteOfDay: normaliseMinute(minute), daysPassed };
}

/** How many whole park days fit in a stretch of real time. */
export function daysInRealSeconds(realSeconds: number): number {
  if (!Number.isFinite(realSeconds) || realSeconds <= 0) return 0;
  return Math.floor(realSeconds / REAL_SECONDS_PER_PARK_DAY);
}

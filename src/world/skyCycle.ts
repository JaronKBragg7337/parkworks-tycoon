/**
 * The park's daylight, derived from the simulation clock.
 *
 * ParkSimulation already runs a 9:00-to-21:00 day and increments a day counter;
 * until now nothing looked at it, so a park at opening and a park at closing
 * were lit identically. This maps the clock onto a sun, a sky, and the moment
 * the lamps come on.
 *
 * Pure and keyframed so it can be tested without a renderer. Keyframes are
 * ordered by minute; values between them are interpolated component-wise.
 */

export interface SkyState {
  /** Sun position in metres, relative to the park centre. */
  sunPosition: readonly [number, number, number];
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  skyColor: number;
  fogColor: number;
  /**
   * 0 in daylight, 1 after dark. Drives the shared lamp-glow emissive and the
   * pools of light on the ground, so every lit fixture in the park comes up
   * together.
   */
  lampGlow: number;
}

interface SkyKeyframe extends SkyState {
  minute: number;
}

const MORNING = 9 * 60;
const CLOSING = 21 * 60;
const MIDNIGHT = 0;
const END_OF_DAY = 24 * 60;

/**
 * Sun elevation peaks near 13:00 rather than exactly midday, and the sky keeps
 * a little light after the gates close so the last hour reads as dusk rather
 * than a blackout.
 *
 * The evening ambient floor is deliberately higher than a physically faithful
 * dusk would be. This is a game the player walks around in, hunting litter by
 * eye, so the park has to stay readable after sundown; the mood comes from the
 * colour shift and the lamps, not from taking the light away.
 *
 * The table now runs the whole twenty-four hours rather than stopping at the
 * gates. It used to cover 9:00 to 21:00 and clamp, so there was no night to
 * look at — the sky simply held at dusk until the clock snapped back to morning.
 * With the park closing overnight there is a real night to cross, and the same
 * readability rule governs it: the small hours are moonlit and blue, never
 * black, because the player still walks the park while it is shut.
 *
 * Midnight and end-of-day are the same moment and carry identical values, which
 * is what lets a normalised minute be looked up without any wrap-around logic.
 */
const KEYFRAMES: readonly SkyKeyframe[] = [
  {
    minute: MIDNIGHT,
    // Moonlight, not darkness. The park is shut but still walkable — the player
    // builds at night — so this is lifted well above a physically honest 2am.
    sunPosition: [10, 26, -18],
    sunColor: 0x9fb0e2,
    sunIntensity: 0.62,
    ambientColor: 0x7183bb,
    ambientIntensity: 1.02,
    skyColor: 0x18234c,
    fogColor: 0x1b2750,
    lampGlow: 1,
  },
  {
    minute: 5 * 60,
    sunPosition: [-24, 22, 26],
    sunColor: 0xa3b2e4,
    sunIntensity: 0.66,
    ambientColor: 0x7686bd,
    ambientIntensity: 1.04,
    skyColor: 0x1d2854,
    fogColor: 0x202c5c,
    lampGlow: 1,
  },
  {
    minute: 7 * 60 + 15,
    // First light comes up in the east, opposite where the sun set.
    sunPosition: [-46, 5, 28],
    sunColor: 0xffb488,
    sunIntensity: 0.72,
    ambientColor: 0x8a86ae,
    ambientIntensity: 0.9,
    skyColor: 0x5d5378,
    fogColor: 0x6a5f80,
    lampGlow: 0.82,
  },
  {
    minute: MORNING,
    sunPosition: [-38, 16, 30],
    sunColor: 0xffd9a8,
    sunIntensity: 2.15,
    ambientColor: 0x9fc0cc,
    ambientIntensity: 1.05,
    skyColor: 0x9dc6cc,
    fogColor: 0xb2cfd0,
    lampGlow: 0.16,
  },
  {
    minute: 11 * 60,
    sunPosition: [-26, 34, 20],
    sunColor: 0xffeccd,
    sunIntensity: 3.05,
    ambientColor: 0xaaccc5,
    ambientIntensity: 1.18,
    skyColor: 0x9fc2be,
    fogColor: 0xa8c8c0,
    lampGlow: 0,
  },
  {
    minute: 13 * 60,
    sunPosition: [-4, 42, 8],
    sunColor: 0xfff4e2,
    sunIntensity: 3.35,
    ambientColor: 0xb4d2c8,
    ambientIntensity: 1.22,
    skyColor: 0xa6cac4,
    fogColor: 0xaccdc4,
    lampGlow: 0,
  },
  {
    minute: 16 * 60,
    sunPosition: [20, 30, -6],
    sunColor: 0xffe0ac,
    sunIntensity: 3.0,
    ambientColor: 0xb0c9c0,
    ambientIntensity: 1.12,
    skyColor: 0xa8c4bb,
    fogColor: 0xb0c8bd,
    lampGlow: 0.05,
  },
  {
    minute: 18 * 60 + 30,
    // Golden hour: the sun is low and to the west, so everything casts long.
    sunPosition: [36, 9, -16],
    sunColor: 0xffab5e,
    sunIntensity: 2.5,
    ambientColor: 0xa88f96,
    ambientIntensity: 0.92,
    skyColor: 0xd9a071,
    fogColor: 0xd2a179,
    lampGlow: 0.42,
  },
  {
    minute: 19 * 60 + 45,
    sunPosition: [40, 2.5, -22],
    sunColor: 0xf07a4e,
    sunIntensity: 1.35,
    ambientColor: 0x8b87ad,
    ambientIntensity: 1.05,
    skyColor: 0x7c6a8e,
    fogColor: 0x7d6c8b,
    lampGlow: 0.88,
  },
  {
    minute: CLOSING,
    sunPosition: [34, -3, -26],
    sunColor: 0xa694c9,
    sunIntensity: 0.62,
    ambientColor: 0x6d7ba8,
    ambientIntensity: 0.95,
    skyColor: 0x27314f,
    fogColor: 0x27314f,
    lampGlow: 1,
  },
  {
    minute: 22 * 60 + 30,
    sunPosition: [22, 20, -22],
    sunColor: 0x9aa8d9,
    sunIntensity: 0.55,
    ambientColor: 0x6d7eb2,
    ambientIntensity: 0.98,
    skyColor: 0x1c2750,
    fogColor: 0x1f2b57,
    lampGlow: 1,
  },
  {
    // The same instant as MIDNIGHT, so the table closes on itself.
    minute: END_OF_DAY,
    // Moonlight, not darkness. The park is shut but still walkable — the player
    // builds at night — so this is lifted well above a physically honest 2am.
    sunPosition: [10, 26, -18],
    sunColor: 0x9fb0e2,
    sunIntensity: 0.62,
    ambientColor: 0x7183bb,
    ambientIntensity: 1.02,
    skyColor: 0x18234c,
    fogColor: 0x1b2750,
    lampGlow: 1,
  },
];

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Interpolates two packed 0xRRGGBB colours channel by channel. */
export function lerpHexColor(from: number, to: number, t: number): number {
  const red = Math.round(lerp((from >> 16) & 0xff, (to >> 16) & 0xff, t));
  const green = Math.round(lerp((from >> 8) & 0xff, (to >> 8) & 0xff, t));
  const blue = Math.round(lerp(from & 0xff, to & 0xff, t));
  return (red << 16) | (green << 8) | blue;
}

/** Samples the sky for any moment in the twenty-four hour cycle. */
export function sampleSkyCycle(minuteOfDay: number): SkyState {
  const minute = Number.isFinite(minuteOfDay)
    ? Math.max(MIDNIGHT, Math.min(END_OF_DAY, minuteOfDay))
    : MORNING;

  let previous = KEYFRAMES[0] as SkyKeyframe;
  let next = KEYFRAMES[KEYFRAMES.length - 1] as SkyKeyframe;
  for (let index = 0; index < KEYFRAMES.length - 1; index += 1) {
    const candidate = KEYFRAMES[index] as SkyKeyframe;
    const following = KEYFRAMES[index + 1] as SkyKeyframe;
    if (minute >= candidate.minute && minute <= following.minute) {
      previous = candidate;
      next = following;
      break;
    }
  }

  const span = next.minute - previous.minute;
  const t = span > 0 ? (minute - previous.minute) / span : 0;

  return {
    sunPosition: [
      lerp(previous.sunPosition[0], next.sunPosition[0], t),
      lerp(previous.sunPosition[1], next.sunPosition[1], t),
      lerp(previous.sunPosition[2], next.sunPosition[2], t),
    ],
    sunColor: lerpHexColor(previous.sunColor, next.sunColor, t),
    sunIntensity: lerp(previous.sunIntensity, next.sunIntensity, t),
    ambientColor: lerpHexColor(previous.ambientColor, next.ambientColor, t),
    ambientIntensity: lerp(previous.ambientIntensity, next.ambientIntensity, t),
    skyColor: lerpHexColor(previous.skyColor, next.skyColor, t),
    fogColor: lerpHexColor(previous.fogColor, next.fogColor, t),
    lampGlow: lerp(previous.lampGlow, next.lampGlow, t),
  };
}

/** Human label for the current light, used by the end-of-day summary. */
export function describeTimeOfDay(minuteOfDay: number): string {
  if (minuteOfDay < 5 * 60) return 'the small hours';
  if (minuteOfDay < 7 * 60 + 15) return 'before dawn';
  if (minuteOfDay < MORNING) return 'dawn';
  if (minuteOfDay < 11 * 60) return 'morning';
  if (minuteOfDay < 15 * 60) return 'midday';
  if (minuteOfDay < 17 * 60 + 30) return 'afternoon';
  if (minuteOfDay < 19 * 60 + 15) return 'golden hour';
  if (minuteOfDay <= CLOSING) return 'dusk';
  return 'night';
}

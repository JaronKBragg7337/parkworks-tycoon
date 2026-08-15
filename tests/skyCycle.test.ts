import { describe, expect, it } from 'vitest';
import { describeTimeOfDay, lerpHexColor, sampleSkyCycle } from '../src/world/skyCycle';

const MORNING = 9 * 60;
const CLOSING = 21 * 60;

describe('colour interpolation', () => {
  it('returns the endpoints exactly', () => {
    expect(lerpHexColor(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
    expect(lerpHexColor(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
  });

  it('mixes each channel independently', () => {
    expect(lerpHexColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpHexColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });
});

describe('sky cycle', () => {
  it('covers the whole day and closes on itself', () => {
    // The table used to stop at the gates and clamp, so there was no night to
    // look at. Now the park shuts overnight and the cycle has to carry the
    // player across it, which means midnight and the end of the day must be the
    // same sky — otherwise the light would jump at the rollover.
    expect(sampleSkyCycle(0)).toEqual(sampleSkyCycle(24 * 60));
    expect(sampleSkyCycle(Number.NaN)).toEqual(sampleSkyCycle(MORNING));

    // Night is genuinely darker than the day it sits between, but never black:
    // the park stays walkable while it is closed, because the player builds at
    // night.
    //
    // The bar is deliberately set against midday rather than at some absolute
    // floor. An earlier version of this test asked only for ambient above 0.4
    // and passed happily while the ground was, on screen, almost invisible —
    // the number said "lit" and the park said otherwise. Holding night to a
    // fraction of the day it is compared against is the thing that actually
    // tracks whether you can see where you are going.
    const midnight = sampleSkyCycle(0);
    const midday = sampleSkyCycle(13 * 60);
    expect(midnight.ambientIntensity).toBeLessThan(midday.ambientIntensity);
    expect(midnight.ambientIntensity).toBeGreaterThan(midday.ambientIntensity * 0.75);
    // Lit from above rather than from below the horizon, so surfaces catch
    // something and the park does not flatten into silhouettes.
    expect(midnight.sunPosition[1]).toBeGreaterThan(0);
    expect(midnight.lampGlow).toBe(1);
  });

  it('lifts the sun toward midday and drops it by closing', () => {
    const morning = sampleSkyCycle(MORNING).sunPosition[1];
    const midday = sampleSkyCycle(13 * 60).sunPosition[1];
    const closing = sampleSkyCycle(CLOSING).sunPosition[1];
    expect(midday).toBeGreaterThan(morning);
    expect(closing).toBeLessThan(morning);
  });

  it('sweeps the sun from east to west', () => {
    const morning = sampleSkyCycle(MORNING).sunPosition[0];
    const evening = sampleSkyCycle(19 * 60).sunPosition[0];
    expect(morning).toBeLessThan(0);
    expect(evening).toBeGreaterThan(0);
  });

  it('dims the sun through the evening', () => {
    const midday = sampleSkyCycle(13 * 60).sunIntensity;
    const golden = sampleSkyCycle(18 * 60 + 30).sunIntensity;
    const closing = sampleSkyCycle(CLOSING).sunIntensity;
    expect(golden).toBeLessThan(midday);
    expect(closing).toBeLessThan(golden);
  });

  it('brings the lamps up only as the light goes', () => {
    expect(sampleSkyCycle(13 * 60).lampGlow).toBe(0);
    expect(sampleSkyCycle(18 * 60 + 30).lampGlow).toBeGreaterThan(0.2);
    expect(sampleSkyCycle(CLOSING).lampGlow).toBe(1);
  });

  it('never runs the lamps backwards through the afternoon', () => {
    let previous = -1;
    for (let minute = 15 * 60; minute <= CLOSING; minute += 5) {
      const glow = sampleSkyCycle(minute).lampGlow;
      expect(glow).toBeGreaterThanOrEqual(previous);
      previous = glow;
    }
  });

  it('keeps every value finite and in range across the whole day', () => {
    for (let minute = MORNING; minute <= CLOSING; minute += 1) {
      const sky = sampleSkyCycle(minute);
      expect(Number.isFinite(sky.sunIntensity)).toBe(true);
      expect(sky.sunIntensity).toBeGreaterThanOrEqual(0);
      expect(sky.ambientIntensity).toBeGreaterThan(0);
      expect(sky.lampGlow).toBeGreaterThanOrEqual(0);
      expect(sky.lampGlow).toBeLessThanOrEqual(1);
      for (const channel of [sky.skyColor, sky.fogColor, sky.sunColor, sky.ambientColor]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('interpolates continuously across keyframe boundaries', () => {
    const before = sampleSkyCycle(18 * 60 + 29);
    const after = sampleSkyCycle(18 * 60 + 31);
    expect(Math.abs(after.sunIntensity - before.sunIntensity)).toBeLessThan(0.1);
  });
});

describe('time of day labels', () => {
  it('names the parts of the park day', () => {
    expect(describeTimeOfDay(MORNING)).toBe('morning');
    expect(describeTimeOfDay(13 * 60)).toBe('midday');
    expect(describeTimeOfDay(16 * 60)).toBe('afternoon');
    expect(describeTimeOfDay(18 * 60 + 30)).toBe('golden hour');
    expect(describeTimeOfDay(CLOSING)).toBe('dusk');
  });
});

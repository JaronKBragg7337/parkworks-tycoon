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
  it('clamps outside opening hours instead of wrapping', () => {
    expect(sampleSkyCycle(0)).toEqual(sampleSkyCycle(MORNING));
    expect(sampleSkyCycle(24 * 60)).toEqual(sampleSkyCycle(CLOSING));
    expect(sampleSkyCycle(Number.NaN)).toEqual(sampleSkyCycle(MORNING));
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

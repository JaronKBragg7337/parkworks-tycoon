import { describe, expect, it } from 'vitest';
import { normalizeJoystickVector } from '../src/controls/joystickMath';

describe('normalizeJoystickVector', () => {
  it('stays still inside the dead zone', () => {
    expect(normalizeJoystickVector({ x: 100, y: 100 }, { x: 104, y: 103 }, 56)).toEqual({
      x: 0,
      y: 0,
      distance: 0,
    });
  });

  it('clamps a long drag to full speed', () => {
    const sample = normalizeJoystickVector({ x: 0, y: 0 }, { x: 200, y: 0 }, 50);
    expect(sample.x).toBeCloseTo(1);
    expect(sample.y).toBeCloseTo(0);
    expect(sample.distance).toBeCloseTo(1);
  });

  it('preserves diagonal direction after remapping', () => {
    const sample = normalizeJoystickVector({ x: 0, y: 0 }, { x: 40, y: 40 }, 80, 0);
    expect(sample.x).toBeCloseTo(0.5);
    expect(sample.y).toBeCloseTo(0.5);
    expect(sample.distance).toBeCloseTo(Math.SQRT1_2);
  });
});

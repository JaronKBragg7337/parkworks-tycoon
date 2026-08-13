export class SeededRandom {
  private state: number;

  constructor(seed = 0x51f15e) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  integer(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(values: readonly T[]): T {
    const value = values[Math.floor(this.next() * values.length)];
    if (value === undefined) {
      throw new Error('Cannot pick from an empty collection.');
    }
    return value;
  }
}

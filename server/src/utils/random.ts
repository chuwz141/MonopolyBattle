import seedrandom from 'seedrandom';

export class SeededRNG {
  private prng: seedrandom.PRNG;

  constructor(seed: string) {
    this.prng = seedrandom(seed);
  }

  /**
   * Returns a pseudo-random float between 0 (inclusive) and 1 (exclusive).
   */
  public next(): number {
    return this.prng();
  }

  /**
   * Returns a pseudo-random integer between min (inclusive) and max (inclusive).
   */
  public nextInt(min: number, max: number): number {
    const minCeil = Math.ceil(min);
    const maxFloor = Math.floor(max);
    return Math.floor(this.prng() * (maxFloor - minCeil + 1)) + minCeil;
  }

  /**
   * Shuffles an array in place using the seeded random generator.
   */
  public shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.prng() * (i + 1));
      const temp = shuffled[i];
      const target = shuffled[j];
      if (temp !== undefined && target !== undefined) {
        shuffled[i] = target;
        shuffled[j] = temp;
      }
    }
    return shuffled;
  }
}

import { Injectable } from '@nestjs/common';
import { RandomGenerator } from './random-generator.interface';

@Injectable()
export class CryptoRandomGenerator implements RandomGenerator {
  nextFloat(): number {
    return Math.random();
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloatBetween(min, max + 1));
  }

  nextFloatBetween(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

/**
 * SeededRandomGenerator produces deterministic sequences for testing.
 * Uses a linear congruential generator — suitable for tests only.
 * Never use this in production for security-sensitive randomness.
 */
export class SeededRandomGenerator implements RandomGenerator {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  nextFloat(): number {
    this.seed = (this.seed * 1_664_525 + 1_013_904_223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloatBetween(min, max + 1));
  }

  nextFloatBetween(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

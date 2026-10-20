import type { ID } from '../../domain/types';

/** Deterministic randomness for the demo data: the same seed always gives the same numbers. */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] (both ends included). */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Approximately standard normal (sum of uniforms), mean 0, deviation 1. */
  gaussian(): number;
}

/** mulberry32: a tiny, well-distributed 32-bit generator. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const float = (min: number, max: number): number => min + next() * (max - min);
  return {
    next,
    float,
    int: (min, max) => Math.floor(float(min, max + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => items[Math.floor(next() * items.length)],
    gaussian: () => {
      let sum = 0;
      for (let index = 0; index < 6; index += 1) sum += next();
      return (sum - 3) * Math.SQRT2;
    },
  };
}

/** cyrb128: four 32-bit words from a string. */
function hash128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** A stable 32-bit unsigned hash of a string. */
export function hashString(text: string): number {
  return hash128(text)[0];
}

const hex8 = (value: number): string => value.toString(16).padStart(8, '0');

/**
 * A stable UUID-shaped id for a demo record: the same key always gives the same id, so the
 * records can reference each other without a lookup table and re-seeding replaces them in place.
 */
export function demoId(key: string): ID {
  const [a, b, c, d] = hash128(`orbita-demo:${key}`);
  const hex = `${hex8(a)}${hex8(b)}${hex8(c)}${hex8(d)}`;
  const version = `4${hex.slice(13, 16)}`;
  const variant = `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}

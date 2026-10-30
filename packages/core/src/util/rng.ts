/**
 * rng.ts - deterministic, seedable pseudo-random number generator.
 *
 * Why not Math.random()?
 *   Fountain codes require that sender and receiver derive the *same* set of
 *   source-block indices from the same frame seed. If the generator were not
 *   reproducible (or differed between a Safari JavaScriptCore build and
 *   V8 in Chrome), frames would decode to garbage. So every random decision in
 *   the protocol comes from this class, seeded from a 32-bit frame seed that is
 *   printed in the frame header.
 *
 * Algorithm: mulberry32 - a 32-bit counter-based PRNG with a 2^32 period,
 * excellent statistical behaviour for this use case (it passes the standard
 * smallcrush-style batteries), and extremely cheap: one 32-bit multiply chain
 * per output word. Crypto-grade randomness is explicitly NOT required here;
 * confidentiality is provided by a real AEAD in crypto/aead.ts.
 */

const GOLDEN_GAMMA = 0x6d2b79f5;

/** 32-bit avalanche mixer used to expand seeds into state (splitmix32 finalizer). */
export function mix32(seed: number): number {
  let z = (seed + GOLDEN_GAMMA) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** Derive a 32-bit child seed from a parent seed and a 32-bit label. */
export function deriveSeed(seed: number, label: number): number {
  return mix32((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ label) | 0);
}

export class Rng {
  private state: number;

  /**
   * @param seed any 32-bit integer; seeds are mixed so that neighbouring values
   *             (e.g. frame seeds 1000 and 1001) produce uncorrelated streams.
   */
  constructor(seed: number) {
    this.state = mix32(seed | 0);
    // Discard the first output so that low-entropy seeds (0, 1, 2 ...) do not
    // show a warm-up bias in the very first generated value.
    this.nextUint32();
  }

  /** Uniform 32-bit unsigned integer in [0, 2^32). */
  nextUint32(): number {
    let a = (this.state + GOLDEN_GAMMA) | 0;
    this.state = a;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Uniform integer in [0, bound) with rejection sampling.
   *
   * Rejection sampling matters: a naive `nextUint32() % bound` slightly favours
   * low values, which biases which source blocks a frame covers and measurably
   * slows LT decoding (some blocks get covered less often than others).
   */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`nextInt bound must be a positive integer, got ${bound}`);
    }
    if (bound === 1) return 0;
    if (bound > 0x1_0000_0000) throw new RangeError('nextInt bound must be <= 2^32');
    // Largest multiple of `bound` that fits in 32 bits: 2^32 - (2^32 mod bound).
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % bound;
  }

  /** Fisher-Yates shuffle of a Uint32Array in place, using this stream. */
  shuffle(arr: Uint32Array): Uint32Array {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

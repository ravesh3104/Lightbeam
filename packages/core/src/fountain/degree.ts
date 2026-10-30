/**
 * degree.ts - degree distributions for Luby Transform (LT) codes.
 *
 * THE IDEA
 * --------
 * A fountain code turns a file of K source blocks into an endless stream of
 * encoded blocks, such that ANY K + epsilon distinct encoded blocks reconstruct
 * the file. The receiver does not care which ones it gets, in what order, or how
 * many it missed: a lost frame is not an error, it just means "wait one more
 * frame". That property is exactly what an optical channel needs, because a
 * hand-held camera misses frames constantly (blur, rolling shutter, glare, the
 * sender displaying faster than the camera's exposure).
 *
 * Each encoded block is the XOR of a pseudo-random subset ("neighbours") of the
 * source blocks. How many neighbours - the *degree* - is drawn from the degree
 * distribution, and the choice of distribution is the entire art of LT codes:
 *
 *   Ideal Soliton (Luby 2002)
 *     rho(1) = 1/K,  rho(d) = 1 / (d * (d-1))
 *     Optimal in the limit, but the tail of the procedure is fragile: the last
 *     few source blocks are covered by exponentially few equations, so decoding
 *     stalls and the true overhead runs to ~5-10%.
 *
 *   Robust Soliton (Luby 2002)
 *     rho + tau, where tau puts an extra spike of mass at degrees
 *     K/R ... 1 and at degree 1, with R = c * ln(K/delta) * sqrt(K).
 *     This "robustifies" the tail; standard LT overhead is 3-10% and typically
 *     ~5%. Larger c = more degree-1 blocks = faster start, slightly more overhead.
 *
 *   Systematic-first (our variant, see `SYSTEMATIC_PREFIX`)
 *     Real receivers join a stream mid-flight, and the most valuable frames are
 *     the *systematic* ones: degree 1, i.e. "source block i, verbatim". One
 *     captured frame then completes one source block outright. LightBeam emits a
 *     systematic prefix (frame s carries block s ^ r where r is a small random
 *     mask, see lt.ts) and then falls through to robust soliton.
 *
 * The distributions are precomputed into a CDF so sampling is O(log K) per frame
 * via binary search rather than O(K).
 */

import type { Rng } from '../util/rng.js';

export interface DegreeDistribution {
  /** Number of source blocks. */
  k: number;
  /** cdf[d - 1] = P(degree <= d). Length k. */
  cdf: Float64Array;
  /** Mean degree (diagnostic: the average XOR cost per encoded block). */
  meanDegree: number;
  /** Human-readable identifier of the distribution actually used. */
  name: string;
}

/** Ideal soliton probability mass function, index d-1 => P(degree = d). */
export function idealSolitonPmf(k: number): Float64Array {
  const pmf = new Float64Array(k);
  if (k === 1) {
    pmf[0] = 1;
    return pmf;
  }
  pmf[0] = 1 / k;
  for (let d = 2; d <= k; d++) pmf[d - 1] = 1 / (d * (d - 1));
  return pmf;
}

/**
 * Robust soliton PMF: rho(d) + tau(d), normalised.
 *
 * @param k     number of source blocks
 * @param c     tuning constant (0.01 .. 0.2). Lower = less overhead, slower start.
 * @param delta failure probability bound used to size the spike.
 */
export function robustSolitonPmf(k: number, c = 0.03, delta = 0.5): Float64Array {
  if (k <= 1) {
    return new Float64Array([1]);
  }
  const rho = idealSolitonPmf(k);
  const tau = new Float64Array(k);

  // R = c * ln(k / delta) * sqrt(k) is the expected number of source blocks of
  // degree 1 that the ideal soliton is missing; the spike compensates.
  const R = c * Math.log(k / delta) * Math.sqrt(k);
  // The spike occupies degrees 1 .. dStar (the textbook writes K/R, rounded).
  const dStar = Math.min(k, Math.max(1, Math.round(k / R)));

  // tau(d) = R / (d * K) for d = 1 .. dStar - 1
  for (let d = 1; d <= dStar - 1; d++) tau[d - 1] = R / (d * k);
  // tau(dStar) = R * ln(R / delta) / K  - the single big bin that guarantees the
  // degree-1..dStar cover is complete with high probability.
  tau[dStar - 1] = (R * Math.log(R / delta)) / k;

  const pmf = new Float64Array(k);
  let total = 0;
  for (let d = 1; d <= k; d++) {
    const value = rho[d - 1] + tau[d - 1];
    pmf[d - 1] = value > 0 ? value : 0;
    total += pmf[d - 1];
  }
  if (total <= 0) {
    pmf.fill(1 / k); // degenerate guard
    return pmf;
  }
  for (let d = 0; d < k; d++) pmf[d] /= total;
  return pmf;
}

/** Convert a PMF into a monotone CDF (with a hard 1.0 at the end). */
export function toCdf(pmf: Float64Array): Float64Array {
  const cdf = new Float64Array(pmf.length);
  let acc = 0;
  for (let i = 0; i < pmf.length; i++) {
    acc += pmf[i];
    cdf[i] = acc;
  }
  if (cdf.length > 0) cdf[cdf.length - 1] = 1;
  return cdf;
}

export interface DegreeOptions {
  /** 'robust' (default), 'ideal', or 'uniform'. */
  variant?: 'robust' | 'ideal' | 'uniform';
  /** Robust-soliton c parameter. */
  c?: number;
  /** Robust-soliton delta parameter. */
  delta?: number;
}

/**
 * Build the degree distribution used by a session.
 *
 * Small K is handled explicitly: for K <= 2 the robust soliton degenerates
 * (the tail is longer than the block count), so we use the exact ideal soliton.
 */
export function buildDegreeDistribution(k: number, options: DegreeOptions = {}): DegreeDistribution {
  const variant = options.variant ?? 'robust';
  if (k < 1) throw new RangeError('k must be at least 1');

  if (k <= 2 || variant === 'ideal') {
    const pmf = idealSolitonPmf(k);
    return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: k <= 2 ? 'ideal (tiny k)' : 'ideal soliton' };
  }
  if (variant === 'uniform') {
    const pmf = new Float64Array(k).fill(1 / k);
    return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: 'uniform' };
  }

  const c = options.c ?? 0.03;
  const delta = options.delta ?? 0.5;
  const pmf = robustSolitonPmf(k, c, delta);
  // Guarantee a floor on degree 1: if the spike fell below 1/k the first frames
  // of a session would rarely be systematic, which hurts perceived startup.
  const floor = 1 / k;
  if (pmf[0] < floor) {
    const deficit = floor - pmf[0];
    pmf[0] = floor;
    // Take the mass from the largest degree entries that can spare it.
    let remaining = deficit;
    for (let d = k - 1; d > 0 && remaining > 0; d--) {
      const take = Math.min(pmf[d], remaining);
      pmf[d] -= take;
      remaining -= take;
    }
    let total = 0;
    for (let i = 0; i < k; i++) total += pmf[i];
    for (let i = 0; i < k; i++) pmf[i] /= total;
  }
  return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: `robust soliton (c=${c}, delta=${delta})` };
}

function meanOf(pmf: Float64Array): number {
  let mean = 0;
  for (let d = 0; d < pmf.length; d++) mean += (d + 1) * pmf[d];
  return mean;
}

/** Sample a degree from the CDF using binary search over the RNG's output. */
export function sampleDegree(rng: Rng, dist: DegreeDistribution): number {
  if (dist.k === 1) return 1;
  const u = rng.nextFloat();
  const cdf = dist.cdf;
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1; // degree is 1-based
}

/** Diagnostics for the docs/tests: distribution shape summary. */
export function describeDistribution(dist: DegreeDistribution): {
  name: string;
  k: number;
  meanDegree: number;
  pDegree1: number;
  pDegree2Plus: number;
  entropyBits: number;
} {
  const cdf = dist.cdf;
  const pmf: number[] = [];
  let prev = 0;
  for (let i = 0; i < cdf.length; i++) {
    pmf.push(cdf[i] - prev);
    prev = cdf[i];
  }
  let entropy = 0;
  for (const p of pmf) if (p > 0) entropy -= p * Math.log2(p);
  return {
    name: dist.name,
    k: dist.k,
    meanDegree: dist.meanDegree,
    pDegree1: pmf[0] ?? 0,
    pDegree2Plus: 1 - (pmf[0] ?? 0),
    entropyBits: entropy,
  };
}

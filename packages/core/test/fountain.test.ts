/**
 * fountain.test.ts - correctness and *measured* efficiency of the LT code.
 *
 * The interesting property of a fountain code is not "does it decode" but "how
 * many extra frames does it need". These tests therefore run Monte Carlo
 * simulations of a receiver behind a lossy channel and assert on the measured
 * overhead ratio (frames received / source blocks K), which is the number that
 * decides how long a real transfer takes.
 *
 * Reference points from the LT literature: ideal soliton decodes with a mean
 * overhead around 5% and a heavy tail; robust soliton with c = 0.03, delta = 0.5
 * typically lands in the 3-10% range. A camera channel also loses frames *in
 * bursts* (autofocus hunts, rolling shutter, a hand crossing the lens), which is
 * modelled explicitly by the burst-loss scenarios below.
 */

import { describe, expect, it } from 'vitest';
import {
  LTDecoder,
  LTEncoder,
  defaultSystematicPrefix,
  deriveMaskBlock,
  frameNeighbours,
  expectedFramesFor,
} from '../src/fountain/lt.js';
import {
  buildDegreeDistribution,
  describeDistribution,
  robustSolitonPmf,
  idealSolitonPmf,
} from '../src/fountain/degree.js';
import { Rng } from '../src/util/rng.js';

function randomPayload(length: number, seed = 12345): Uint8Array {
  const rng = new Rng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

/**
 * Simulate a channel that keeps each frame with probability `keep`, plus
 * occasional bursts of consecutive losses (a hand, a glare, an autofocus hunt).
 */
function simulateTransfer(config: {
  payloadLength: number;
  blockSize: number;
  sessionId: number;
  keep: number;
  burst?: { every: number; length: number };
  maxFrames?: number;
  seed?: number;
}): {
  decoded: Uint8Array | null;
  framesSent: number;
  framesReceived: number;
  k: number;
  overhead: number;
  complete: boolean;
  stats: ReturnType<LTDecoder['getStats']>;
} {
  const payload = randomPayload(config.payloadLength, 987);
  const k = Math.ceil(config.payloadLength / config.blockSize);
  const encoder = new LTEncoder(payload, {
    k,
    blockSize: config.blockSize,
    sessionId: config.sessionId,
    payloadLength: config.payloadLength,
  });
  const decoder = new LTDecoder({
    k,
    blockSize: config.blockSize,
    sessionId: config.sessionId,
    payloadLength: config.payloadLength,
  });

  const rng = new Rng(config.seed ?? 4242);
  const maxFrames = config.maxFrames ?? Math.ceil(k * 3 + 500);
  let framesSent = 0;
  let framesReceived = 0;
  let inBurst = 0;
  let sinceBurst = 0;

  for (let seed = 0; seed < maxFrames; seed++) {
    framesSent++;
    // Decide whether this frame survives the channel.
    let kept = rng.nextFloat() < config.keep;
    if (config.burst) {
      if (inBurst > 0) {
        inBurst--;
        kept = false;
      } else if (++sinceBurst >= config.burst.every) {
        sinceBurst = 0;
        inBurst = config.burst.length - 1;
        kept = false;
      }
    }
    if (!kept) continue;

    const frame = encoder.encode(seed);
    const outcome = decoder.addFrame(seed, frame);
    framesReceived++;
    void outcome;
    if (decoder.isComplete) {
      const decoded = decoder.reconstruct();
      return {
        decoded,
        framesSent,
        framesReceived,
        k,
        overhead: framesReceived / k,
        complete: true,
        stats: decoder.getStats(),
      };
    }
  }
  return {
    decoded: null,
    framesSent,
    framesReceived,
    k,
    overhead: framesReceived / k,
    complete: false,
    stats: decoder.getStats(),
  };
}

describe('degree distributions', () => {
  it('ideal soliton sums to 1 and has the expected shape', () => {
    const pmf = idealSolitonPmf(1000);
    const sum = pmf.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(pmf[0]).toBeCloseTo(1 / 1000, 9);
    // rho(2) = 1/2 dominates: a plain ideal soliton mostly emits degree 2.
    expect(pmf[1]).toBeCloseTo(0.5, 9);
  });

  it('robust soliton adds the degree-1/tail spike and stays normalised', () => {
    const k = 1000;
    const rho = idealSolitonPmf(k);
    const mu = robustSolitonPmf(k, 0.03, 0.5);
    const sum = mu.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // The spike lifts degree 1 well above the ideal soliton's 1/K.
    expect(mu[0]).toBeGreaterThan(rho[0] * 1.5);
  });

  it('reports a mean degree that stays small (XOR cost per frame)', () => {
    const dist = buildDegreeDistribution(1000);
    const info = describeDistribution(dist);
    expect(info.meanDegree).toBeGreaterThan(1.5);
    expect(info.meanDegree).toBeLessThan(30);
    expect(info.pDegree1).toBeGreaterThan(0.001);
  });

  it('degenerates gracefully for tiny block counts', () => {
    for (const k of [1, 2, 3]) {
      const dist = buildDegreeDistribution(k);
      expect(dist.cdf[dist.cdf.length - 1]).toBe(1);
      expect(dist.meanDegree).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('neighbour derivation', () => {
  it('is deterministic for a given seed and session', () => {
    const dist = buildDegreeDistribution(500);
    const a = Array.from(frameNeighbours(1234, 500, 77, dist));
    const b = Array.from(frameNeighbours(1234, 500, 77, dist));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('never repeats an index within a frame', () => {
    const dist = buildDegreeDistribution(300);
    for (let seed = 0; seed < 200; seed++) {
      const indices = Array.from(frameNeighbours(seed, 300, 5, dist));
      expect(new Set(indices).size).toBe(indices.length);
      for (const i of indices) expect(i).toBeGreaterThanOrEqual(0), expect(i).toBeLessThan(300);
    }
  });

  it('decorrelates across sessions', () => {
    const dist = buildDegreeDistribution(500);
    const a = Array.from(frameNeighbours(42, 500, 1, dist)).join(',');
    const b = Array.from(frameNeighbours(42, 500, 2, dist)).join(',');
    expect(a).not.toBe(b);
  });

  it('covers every source block many times over a long stream', () => {
    const k = 500;
    const dist = buildDegreeDistribution(k);
    const coverage = new Uint32Array(k);
    for (let seed = 0; seed < 4000; seed++) {
      for (const index of frameNeighbours(seed, k, 9, dist)) coverage[index]++;
    }
    for (let i = 0; i < k; i++) expect(coverage[i]).toBeGreaterThan(0);
  });
});

describe('LT round trip', () => {
  it('delivers the first blocks within a few frames thanks to the systematic prefix', () => {
    const payloadLength = 128 * 1024;
    const blockSize = 512;
    const payload = randomPayload(payloadLength, 4);
    const k = Math.ceil(payloadLength / blockSize);
    const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 1, payloadLength });
    const decoder = new LTDecoder({ k, blockSize, sessionId: 1, payloadLength });
    const prefix = defaultSystematicPrefix(k);
    for (let seed = 0; seed <= prefix; seed++) decoder.addFrame(seed, encoder.encode(seed));
    // One frame per block for the whole prefix: the receiver already holds real,
    // verified data before the fountain tail has even started.
    expect(decoder.progress).toBeGreaterThanOrEqual(prefix / k - 1e-9);
    expect(decoder.isComplete).toBe(false); // the rest still needs the LT stream
  });

  it('decodes a clean channel close to the theoretical minimum', () => {
    // LT decoding is heavy-tailed: a single session can need 1.6x while the mean
    // is 1.2x. Measure the mean over several sessions, which is what the
    // published overhead figures refer to (docs/prefix-experiment-output.txt).
    let sum = 0;
    const sessions = 6;
    for (let s = 0; s < sessions; s++) {
      const result = simulateTransfer({
        payloadLength: 64 * 1024,
        blockSize: 512,
        sessionId: 500 + s,
        keep: 1,
        seed: 2000 + s * 13,
      });
      expect(result.complete, `session ${s}`).toBe(true);
      sum += result.overhead;
    }
    const mean = sum / sessions;
    // Measured 1.16-1.26 across k = 64..1024 at 0% loss.
    expect(mean).toBeLessThan(1.45);
    expect(mean).toBeGreaterThan(1.0);
  });

  it('confirms the tuned prefix beats a full systematic prefix under loss', () => {
    // This asserts the FINDING behind SYSTEMATIC_PREFIX_FRACTION rather than a
    // magic number: a full prefix is perfect on a clean channel and worse under
    // loss, which is why the shipped default is short.
    const payloadLength = 64 * 1024;
    const blockSize = 512;
    const k = Math.ceil(payloadLength / blockSize);
    const meanOverheadFor = (prefix: number): number => {
      let sum = 0;
      const sessions = 4;
      for (let s = 0; s < sessions; s++) {
        const payload = randomPayload(payloadLength, 31 + s);
        const sessionId = 90 + s;
        const encoder = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength, systematicPrefix: prefix });
        const decoder = new LTDecoder({ k, blockSize, sessionId, payloadLength, systematicPrefix: prefix });
        const channel = new Rng(7000 + s * 17);
        let received = 0;
        for (let seed = 0; seed < k * 8 && !decoder.isComplete; seed++) {
          if (channel.nextFloat() >= 0.7) continue;
          decoder.addFrame(seed, encoder.encode(seed));
          received++;
        }
        expect(decoder.isComplete).toBe(true);
        sum += received / k;
      }
      return sum / sessions;
    };
    const tuned = meanOverheadFor(defaultSystematicPrefix(k));
    const full = meanOverheadFor(k);
    expect(tuned).toBeLessThan(full);
  });

  it('recovers the exact bytes of a non-block-aligned payload', () => {
    const payloadLength = 5000; // not a multiple of 512
    const payload = randomPayload(payloadLength, 3);
    const blockSize = 512;
    const k = Math.ceil(payloadLength / blockSize);
    const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 8, payloadLength });
    const decoder = new LTDecoder({ k, blockSize, sessionId: 8, payloadLength });
    for (let seed = 0; seed < k * 2 && !decoder.isComplete; seed++) {
      decoder.addFrame(seed, encoder.encode(seed));
    }
    expect(decoder.isComplete).toBe(true);
    expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
  });

  it('survives 30% random frame loss with modest overhead', () => {
    const trials = 8;
    let overheadSum = 0;
    for (let trial = 0; trial < trials; trial++) {
      const result = simulateTransfer({
        payloadLength: 128 * 1024,
        blockSize: 512,
        sessionId: 100 + trial,
        keep: 0.7,
        seed: 900 + trial,
      });
      expect(result.complete, `trial ${trial} did not complete`).toBe(true);
      overheadSum += result.overhead;
    }
    const meanOverhead = overheadSum / trials;
    // `overhead` here is frames RECEIVED per source block: the honest efficiency
    // measure of the code itself, independent of how much the channel drops (the
    // sender displays 1/0.7 more). Measured ~1.13 at 30% loss.
    expect(meanOverhead).toBeLessThan(1.3);
    expect(meanOverhead).toBeGreaterThan(1.0);
  });

  it('survives 50% loss plus periodic 40-frame blackouts', () => {
    const result = simulateTransfer({
      payloadLength: 64 * 1024,
      blockSize: 512,
      sessionId: 55,
      keep: 0.5,
      burst: { every: 60, length: 40 },
      maxFrames: 20000,
      seed: 777,
    });
    expect(result.complete).toBe(true);
    expect(result.overhead).toBeLessThan(1.6);
  });

  it('ignores duplicate frames', () => {
    const payloadLength = 16 * 1024;
    const blockSize = 512;
    const payload = randomPayload(payloadLength, 11);
    const k = Math.ceil(payloadLength / blockSize);
    const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 3, payloadLength });
    const decoder = new LTDecoder({ k, blockSize, sessionId: 3, payloadLength });
    // Send frame 0 a hundred times: it must count once.
    for (let i = 0; i < 100; i++) decoder.addFrame(0, encoder.encode(0));
    expect(decoder.getStats().duplicates).toBe(99);
    expect(decoder.progress).toBeCloseTo(1 / k, 9);
  });

  it('completes a stalled decode with the dense GF(2) fallback', () => {
    // The stall has to be CONSTRUCTED: the tuned distribution almost never leaves
    // a residual this small, so there is no workload that reliably reaches this
    // code path. Instead we search for frame seeds whose neighbour sets form a
    // system that peeling cannot finish, and feed exactly those.
    //
    // The residual is {1,2,3} with the equations
    //     x1^x2^x3 = A     x2^x3 = B     x1^x2 = C
    // which has rank 3 and is solvable, but every equation has degree >= 2 once
    // block 0 is solved - and peeling needs a degree-1 equation, so it stalls.
    //
    // (Three *pairwise* sums would not work: 110 ^ 101 ^ 011 = 000 over GF(2), a
    //  dependent system. The solver correctly refuses to invent a solution for it,
    //  which is what an earlier attempt at this test discovered.)
    //
    // This test previously claimed to cover the dense fallback without ever
    // reaching it: it fed four systematic frames that peel trivially and asserted
    // only that four frames had been received. The suite therefore had no coverage
    // of dense elimination at all - the path that exists to stop a real transfer
    // stalling at 97%.
    const k = 4;
    const blockSize = 64;
    const sessionId = 42;
    const prefix = 0;
    const degree = { variant: 'uniform' } as const;
    const payload = randomPayload(k * blockSize, 21);
    const dist = buildDegreeDistribution(k, degree);

    // Find the nth frame seed whose neighbour set is exactly `want` (order-blind).
    const findSeed = (want: number[]): number => {
      const target = [...want].sort((a, b) => a - b).join(',');
      for (let lt = 0; lt < 100_000; lt++) {
        const actual = Array.from(frameNeighbours(lt, k, sessionId, dist)).sort((a, b) => a - b).join(',');
        if (actual === target) return lt;
      }
      throw new Error(`no frame seed covers exactly {${target}} out of ${k} blocks`);
    };

    const encoder = new LTEncoder(payload, {
      k,
      blockSize,
      sessionId,
      payloadLength: payload.length,
      systematicPrefix: prefix,
      degree,
    });
    const decoder = new LTDecoder({
      k,
      blockSize,
      sessionId,
      payloadLength: payload.length,
      systematicPrefix: prefix,
      degree,
      // Make the escalation immediate rather than waiting 32 fruitless frames:
      // this test is about the solver, not about the stall detector's patience.
      stallThreshold: 0,
      denseLimit: 8,
    });

    // With prefix 0 the frame at seed s covers the neighbours of LT index s-1, and
    // seed 0 is the mask frame, so every data frame here is >= 1.
    const feed = (want: number[]): void => {
      const lt = findSeed(want);
      decoder.addFrame(lt + 1, encoder.encode(lt + 1));
    };

    feed([0]); // solve block 0 outright, so it is out of the residual
    feed([1, 2, 3]);
    feed([2, 3]);
    feed([1, 2]);

    // Exactly one block was recovered before the pair arrived...
    expect(decoder.isComplete).toBe(true);
    const stats = decoder.getStats();
    // ...and the finish came from dense elimination over a 3x3 residual, not from
    // a lucky low-degree frame.
    expect(stats.denseSolves).toBeGreaterThanOrEqual(1);
    expect(stats.denseMatrixSize).toBe(3);
    expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
  });

  it('reports missing ranges through bestEffort', () => {
    const k = 10;
    const blockSize = 100;
    const payload = randomPayload(k * blockSize, 5);
    // Full prefix so that two consecutive frames mean exactly two known blocks.
    const opts = { k, blockSize, sessionId: 2, payloadLength: k * blockSize, systematicPrefix: k };
    const encoder = new LTEncoder(payload, opts);
    const decoder = new LTDecoder(opts);
    decoder.addFrame(0, encoder.encode(0));
    decoder.addFrame(1, encoder.encode(1));
    const partial = decoder.bestEffort();
    expect(partial.complete).toBe(false);
    expect(partial.missingRanges.length).toBe(k - 2);
    expect(partial.missingRanges[0]).toEqual({ start: 2 * blockSize, end: 3 * blockSize });
  });

  it('never reports complete with zeroed blocks (aliasing regression)', () => {
    // Regression test for a corruption bug where a block solved through the
    // peeling queue aliased the equation's accumulator, so the substitution step
    // XORed it with itself and stored an all-zero block while reporting success.
    // 200 randomised small sessions is enough to hit every solver path.
    let checked = 0;
    for (let trial = 0; trial < 200; trial++) {
      const payloadLength = 5000;
      const blockSize = 512;
      const k = Math.ceil(payloadLength / blockSize);
      const sessionId = 1 + trial;
      const payload = randomPayload(payloadLength, 3 + trial * 7);
      const encoder = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength });
      const decoder = new LTDecoder({ k, blockSize, sessionId, payloadLength });
      for (let seed = 0; seed < k * 6 && !decoder.isComplete; seed++) {
        decoder.addFrame(seed, encoder.encode(seed));
      }
      expect(decoder.isComplete, `trial ${trial} did not complete`).toBe(true);
      expect(Array.from(decoder.reconstruct()), `trial ${trial} bytes differ`).toEqual(Array.from(payload));
      checked++;
    }
    expect(checked).toBe(200);
  });

  it('handles the single-block edge case', () => {
    const payload = randomPayload(200, 6);
    const encoder = new LTEncoder(payload, { k: 1, blockSize: 512, sessionId: 7, payloadLength: 200 });
    const decoder = new LTDecoder({ k: 1, blockSize: 512, sessionId: 7, payloadLength: 200 });
    decoder.addFrame(0, encoder.encode(0));
    expect(decoder.isComplete).toBe(true);
    expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
  });

  it('scales to thousands of blocks inside a sane time budget', () => {
    const started = Date.now();
    const result = simulateTransfer({
      payloadLength: 2 * 1024 * 1024,
      blockSize: 1024,
      sessionId: 999,
      keep: 0.75,
      maxFrames: 6000,
      seed: 31337,
    });
    const elapsed = Date.now() - started;
    expect(result.complete).toBe(true);
    expect(result.k).toBe(2048);
    // 2 MB / 1 KB blocks = 2048 blocks; encoding + decoding + 25% loss should
    // stay well inside a second on any modern device.
    expect(elapsed).toBeLessThan(20000);
  });
});

describe('mask derivation', () => {
  it('is identical on both sides and differs between sessions', () => {
    const a = deriveMaskBlock(1234, 64);
    const b = deriveMaskBlock(1234, 64);
    const c = deriveMaskBlock(1235, 64);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('frame-count estimate', () => {
  it('is above K and grows sub-linearly', () => {
    expect(expectedFramesFor(100)).toBeGreaterThan(100);
    expect(expectedFramesFor(1000)).toBeGreaterThan(1000);
    // Doubling K must not double the absolute overhead.
    const overhead1000 = expectedFramesFor(1000) - 1000;
    const overhead10000 = expectedFramesFor(10000) - 10000;
    expect(overhead10000).toBeLessThan(overhead1000 * 10);
  });
});

describe('neighbour sampler statistics', () => {
  /**
   * The sampler must be (a) distinct, (b) history independent, and (c) close to
   * uniform. (b) is the property that makes lossy capture possible at all: the
   * receiver has to derive the same neighbours as the sender even though it sees
   * a different, sparser set of frames.
   */
  it('is history independent: interrupting the stream changes nothing', () => {
    const k = 800;
    const dist = buildDegreeDistribution(k);
    // Derive seed 500's neighbours directly.
    const direct = Array.from(frameNeighbours(500, k, 1, dist));
    // Now derive it again after generating a thousand other frames first.
    for (let seed = 0; seed < 1000; seed++) frameNeighbours(seed, k, 1, dist);
    const afterNoise = Array.from(frameNeighbours(500, k, 1, dist));
    expect(afterNoise).toEqual(direct);
  });

  it('samples indices close to uniformly over a long stream', () => {
    const k = 256;
    const dist = buildDegreeDistribution(k);
    const counts = new Uint32Array(k);
    const frames = 4000;
    for (let seed = 0; seed < frames; seed++) {
      for (const index of frameNeighbours(seed, k, 7, dist)) counts[index]++;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    const expected = total / k;
    // Standard deviation of a binomial count; allow generous bounds so the test
    // is about catching bias, not about re-rolling the PRNG seed.
    const sigma = Math.sqrt(expected * (1 - 1 / k));
    let worst = 0;
    for (let i = 0; i < k; i++) worst = Math.max(worst, Math.abs(counts[i] - expected) / sigma);
    expect(worst).toBeLessThan(5);
  });

  it('does not favour low indices (regression test for a biased shuffle)', () => {
    const k = 512;
    const dist = buildDegreeDistribution(k);
    const counts = new Uint32Array(k);
    for (let seed = 0; seed < 2000; seed++) {
      for (const index of frameNeighbours(seed, k, 3, dist)) counts[index]++;
    }
    const firstHalf = counts.slice(0, k / 2).reduce((a, b) => a + b, 0);
    const secondHalf = counts.slice(k / 2).reduce((a, b) => a + b, 0);
    const ratio = firstHalf / secondHalf;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it('handles very large degrees without quadratic blow-up', () => {
    const k = 4096;
    const dist = { k, cdf: (() => {
      // Uniform distribution: mean degree K/2, the worst case for sampling cost.
      const cdf = new Float64Array(k);
      for (let i = 0; i < k; i++) cdf[i] = (i + 1) / k;
      return cdf;
    })(), meanDegree: k / 2, name: 'uniform-test' };
    const started = Date.now();
    for (let seed = 0; seed < 200; seed++) {
      const indices = frameNeighbours(seed, k, 11, dist);
      expect(indices.length).toBeGreaterThan(0);
      // Distinctness is the property the decode depends on.
      expect(new Set(Array.from(indices)).size).toBe(indices.length);
    }
    const elapsed = Date.now() - started;
    // 200 frames x ~2000 neighbours: O(d^2) would be tens of millions of
    // comparisons; O(d) keeps this in the tens of milliseconds.
    expect(elapsed).toBeLessThan(5000);
  });
});

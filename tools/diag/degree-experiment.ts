/**
 * degree-experiment.ts - which degree distribution should LightBeam use?
 *
 * This is the experiment behind the tuning constants in fountain/degree.ts and
 * the choice of frame schedule in the sender. It measures the number of frames a
 * SENDER must display for a receiver to finish, which is the quantity that maps
 * directly to transfer time on screen.
 *
 * Two schedules are compared:
 *   'lt'          pure LT stream from frame 0 (no systematic prefix)
 *   'sys+lt'      K systematic frames first, then the LT stream
 *
 * ...across degree distributions and channel conditions. The channel is
 * modelled as per-frame loss (blur / rolling shutter / missed exposure) plus an
 * optional burst model.
 *
 * Run: npm run diag:degree
 */

import { LTEncoder, LTDecoder } from '../../packages/core/src/fountain/lt.js';
import { buildDegreeDistribution, type DegreeOptions } from '../../packages/core/src/fountain/degree.js';
import { Rng } from '../../packages/core/src/util/rng.js';

interface Config {
  label: string;
  schedule: 'lt' | 'sys+lt';
  degree: DegreeOptions;
  denseLimit: number;
  stallThreshold: number;
  /**
   * Optional leash for configurations that are expected to be pathological. The
   * uniform distribution draws every frame's neighbours from the whole file, so a
   * frame XORs ~k/2 blocks and the run is two orders of magnitude slower than the
   * shipped distribution - it is included as a control, not as a candidate, and
   * giving it a short budget keeps the sweep's wall-clock time reasonable without
   * changing what it demonstrates. It takes priority over LB_MAX_FRAMES: that
   * variable raises the budget for everything, and the whole point of the leash is
   * that this one configuration must not be swept for minutes to learn what its row
   * already says.
   */
  maxFrames?: number;
}

interface Result {
  sentFrames: number;
  receivedFrames: number;
  sentPerBlock: number;
  redundant: number;
  denseSolves: number;
  denseSize: number;
  ms: number;
  complete: boolean;
}

function randomPayload(length: number, seed: number): Uint8Array {
  const rng = new Rng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

function runOnce(config: Config, k: number, blockSize: number, keep: number, burst: number, seed: number): Result {
  const payloadLength = k * blockSize;
  const payload = randomPayload(payloadLength, seed);
  const sessionId = seed ^ 0x51ab;
  const encoder = new LTEncoder(payload, { k, blockSize, sessionId, degree: config.degree, payloadLength });
  const decoder = new LTDecoder({
    k,
    blockSize,
    sessionId,
    degree: config.degree,
    payloadLength,
    denseLimit: config.denseLimit,
    stallThreshold: config.stallThreshold,
  });

  const rng = new Rng(seed * 7919 + 13);
  let received = 0;
  let sinceBurst = 0;
  let burstLeft = 0;
  const started = Date.now();
  // In the LT-only schedule the sender never displays the systematic prefix, so
  // those frames must not be counted as "sent" - otherwise the comparison with
  // sys+lt is inflated by exactly K frames.
  const firstFrame = config.schedule === 'lt' ? k + 1 : 0;
  /*
   * The budget is a number of frames the SENDER displays, not an absolute frame
   * index: the LT-only schedule starts at frame k + 1 (the systematic slots are
   * skipped), so an index cap shorter than k would mean "display nothing at all"
   * and the row would read as a zero-cost success.
   */
  const budget = Number(config.maxFrames ?? process.env.LB_MAX_FRAMES ?? k * 12 + 2000);
  const maxFrames = firstFrame + budget;

  for (let frame = firstFrame; frame < maxFrames; frame++) {
    let kept = rng.nextFloat() < keep;
    if (burst > 0) {
      if (burstLeft > 0) {
        burstLeft--;
        kept = false;
      } else if (++sinceBurst >= 60) {
        sinceBurst = 0;
        burstLeft = burst - 1;
        kept = false;
      }
    }
    if (!kept) continue;
    decoder.addFrame(frame, encoder.encode(frame));
    received++;
    if (decoder.isComplete) {
      const stats = decoder.getStats();
      const sent = frame - firstFrame + 1;
      return {
        sentFrames: sent,
        receivedFrames: received,
        sentPerBlock: sent / k,
        redundant: stats.redundant + stats.duplicates,
        denseSolves: stats.denseSolves,
        denseSize: stats.denseMatrixSize,
        ms: Date.now() - started,
        complete: true,
      };
    }
  }
  const stats = decoder.getStats();
  return {
    sentFrames: maxFrames - firstFrame,
    receivedFrames: received,
    sentPerBlock: Infinity,
    redundant: stats.redundant + stats.duplicates,
    denseSolves: stats.denseSolves,
    denseSize: stats.denseMatrixSize,
    ms: Date.now() - started,
    complete: false,
  };
}

function average(config: Config, k: number, blockSize: number, keep: number, burst: number, trials: number) {
  let sent = 0;
  let received = 0;
  let redundant = 0;
  let ms = 0;
  let complete = 0;
  for (let t = 0; t < trials; t++) {
    const r = runOnce(config, k, blockSize, keep, burst, 1000 + t * 17);
    sent += r.sentFrames;
    received += r.receivedFrames;
    redundant += r.redundant;
    ms += r.ms;
    if (r.complete) complete++;
  }
  return {
    sentPerBlock: sent / trials / k,
    receivedPerBlock: received / trials / k,
    redundantPerBlock: redundant / trials / k,
    msPerRun: Math.round(ms / trials),
    completeRatio: complete / trials,
  };
}

const configs: Config[] = [
  { label: 'robust c=0.03 (current)', schedule: 'lt', degree: { variant: 'robust', c: 0.03, delta: 0.5 }, denseLimit: 256, stallThreshold: 32 },
  { label: 'robust c=0.03 +sys', schedule: 'sys+lt', degree: { variant: 'robust', c: 0.03, delta: 0.5 }, denseLimit: 256, stallThreshold: 32 },
  { label: 'robust c=0.10 (current)', schedule: 'lt', degree: { variant: 'robust', c: 0.1, delta: 0.5 }, denseLimit: 256, stallThreshold: 32 },
  { label: 'robust c=0.10 +sys', schedule: 'sys+lt', degree: { variant: 'robust', c: 0.1, delta: 0.5 }, denseLimit: 256, stallThreshold: 32 },
  { label: 'ideal soliton', schedule: 'lt', degree: { variant: 'ideal' }, denseLimit: 256, stallThreshold: 32 },
  { label: 'ideal soliton +sys', schedule: 'sys+lt', degree: { variant: 'ideal' }, denseLimit: 256, stallThreshold: 32 },
  { label: 'ideal + dense 512', schedule: 'lt', degree: { variant: 'ideal' }, denseLimit: 512, stallThreshold: 24 },
  { label: 'ideal + dense 512 +sys', schedule: 'sys+lt', degree: { variant: 'ideal' }, denseLimit: 512, stallThreshold: 24 },
  { label: 'uniform', schedule: 'lt', degree: { variant: 'uniform' }, denseLimit: 256, stallThreshold: 32, maxFrames: 400 },
];

const K = Number(process.env.LB_K ?? 1024);
const BLOCK = 512;
const TRIALS = Number(process.env.LB_TRIALS ?? 3);
console.log(`k=${K} blocks of ${BLOCK} B (${(K * BLOCK) / 1024} KiB payload), ${TRIALS} trials per cell\n`);
for (const [keep, burst] of [
  [1.0, 0],
  [0.7, 0],
  [0.5, 40],
] as Array<[number, number]>) {
  console.log(`--- channel: keep=${keep}${burst ? `, bursts of ${burst} lost frames every 60` : ''} ---`);
  console.log(
    'schedule/degree'.padEnd(30) + 'sent/K'.padEnd(10) + 'recv/K'.padEnd(10) + 'redund/K'.padEnd(10) + 'ms'.padEnd(8) + 'done',
  );
  for (const config of configs) {
    const r = average(config, K, BLOCK, keep, burst, TRIALS);
    console.log(
      `${config.label} ${config.schedule}`.padEnd(30) +
        r.sentPerBlock.toFixed(3).padEnd(10) +
        r.receivedPerBlock.toFixed(3).padEnd(10) +
        r.redundantPerBlock.toFixed(3).padEnd(10) +
        String(r.msPerRun).padEnd(8) +
        `${(r.completeRatio * 100).toFixed(0)}%`,
    );
  }
  console.log('');
}

// Distribution shape summary for the selected configuration.
for (const variant of ['robust', 'ideal'] as const) {
  const dist = buildDegreeDistribution(K, { variant, c: 0.03, delta: 0.5 });
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;
  let prev = 0;
  const pmf: number[] = [];
  for (let i = 0; i < dist.cdf.length; i++) {
    pmf.push(dist.cdf[i] - prev);
    prev = dist.cdf[i];
  }
  p1 = pmf[0];
  p2 = pmf[1];
  p3 = pmf[2];
  p4 = pmf[3];
  console.log(
    `${dist.name}: mean degree ${dist.meanDegree.toFixed(2)}, P(1)=${(p1 * 100).toFixed(2)}%, P(2)=${(p2 * 100).toFixed(1)}%, P(3)=${(p3 * 100).toFixed(1)}%, P(4)=${(p4 * 100).toFixed(1)}%`,
  );
}

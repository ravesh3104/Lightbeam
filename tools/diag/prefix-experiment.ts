/**
 * prefix-experiment.ts - how long should the systematic prefix be?
 *
 * Sweeps the prefix length as a fraction of K across clean, moderately lossy and
 * bursty channels, and reports frames-sent per block (the quantity that maps
 * directly to transfer time). The chosen default is documented in
 * fountain/lt.ts as SYSTEMATIC_PREFIX_FRACTION.
 *
 * Run: npx tsx tools/diag/prefix-experiment.ts
 */
import { LTEncoder, LTDecoder } from '../../packages/core/src/fountain/lt.js';
import { Rng } from '../../packages/core/src/util/rng.js';

const K = Number(process.env.LB_K ?? 1024);
const BLOCK = 512;
const TRIALS = Number(process.env.LB_TRIALS ?? 3);

function payload(length: number, seed: number) {
  const rng = new Rng(seed); const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

function run(prefixFraction: number, keep: number, burst: number, seed: number) {
  const k = K;
  const len = k * BLOCK;
  const prefix = Math.max(1, Math.round(k * prefixFraction));
  const sessionId = seed ^ 0x2f1b;
  const data = payload(len, seed);
  const enc = new LTEncoder(data, { k, blockSize: BLOCK, sessionId, payloadLength: len, systematicPrefix: prefix });
  const dec = new LTDecoder({ k, blockSize: BLOCK, sessionId, payloadLength: len, systematicPrefix: prefix });
  const chan = new Rng(seed * 7919 + 13);
  let received = 0, insideBurst = 0, sinceBurst = 0;
  const maxFrames = k * 8;
  for (let frame = 0; frame < maxFrames; frame++) {
    let kept = chan.nextFloat() < keep;
    if (burst > 0) {
      if (insideBurst > 0) { insideBurst--; kept = false; }
      else if (++sinceBurst >= 60) { sinceBurst = 0; insideBurst = burst - 1; kept = false; }
    }
    if (!kept) continue;
    dec.addFrame(frame, enc.encode(frame));
    received++;
    if (dec.isComplete) return { sent: frame + 1, received, overhead: received / k, ok: true };
  }
  return { sent: maxFrames, received, overhead: received / k, ok: false };
}

console.log(`k=${K} blocks of ${BLOCK} B, ${TRIALS} trials each\n`);
console.log('prefix/K'.padEnd(12) + 'sent/K @0%'.padEnd(14) + 'sent/K @30%'.padEnd(14) + 'sent/K @50%+bursts');
for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1.0]) {
  const cells: string[] = [];
  for (const [keep, burst] of [[1.0, 0], [0.7, 0], [0.5, 40]] as Array<[number, number]>) {
    let sent = 0;
    for (let t = 0; t < TRIALS; t++) sent += run(fraction, keep, burst, 1000 + t * 37).sent;
    cells.push((sent / TRIALS / K).toFixed(3).padEnd(14));
  }
  console.log(String(fraction).padEnd(12) + cells.join(''));
}

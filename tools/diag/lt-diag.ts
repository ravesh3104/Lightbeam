/**
 * lt-diag.ts - how does the systematic prefix behave on a clean channel?
 *
 * Historical diagnostic (see README.md in this directory). Establishes that the
 * prefix is a latency optimisation and never a correctness requirement: the
 * decoder completes whether or not the prefix is present, it just needs fewer
 * frames when it is.
 */
import { LTEncoder, LTDecoder } from '../../packages/core/src/fountain/lt.js';
import { buildDegreeDistribution, describeDistribution } from '../../packages/core/src/fountain/degree.js';
import { Rng } from '../../packages/core/src/util/rng.js';

function payload(n: number, seed = 1) {
  const rng = new Rng(seed); const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

function run(k: number, blockSize: number, keep: number, skipSystematic: boolean, sessionId: number) {
  const len = k * blockSize;
  const data = payload(len, 5);
  const enc = new LTEncoder(data, { k, blockSize, sessionId, payloadLength: len });
  const dec = new LTDecoder({ k, blockSize, sessionId, payloadLength: len });
  const rng = new Rng(99);
  let received = 0, accepted = 0, redundant = 0, dup = 0;
  const startSeed = skipSystematic ? k + 1 : 0;
  for (let seed = startSeed; seed < startSeed + k * 6; seed++) {
    if (rng.nextFloat() >= keep) continue;
    const out = dec.addFrame(seed, enc.encode(seed));
    received++;
    if (out === 'accepted' || out === 'complete') accepted++;
    else if (out === 'redundant') redundant++;
    else dup++;
    if (dec.isComplete) break;
  }
  const s = dec.getStats();
  const dist = buildDegreeDistribution(k);
  return { k, keep, skipSystematic, received, accepted, redundant, overhead: received / k, meanDegree: describeDistribution(dist).meanDegree.toFixed(2), complete: dec.isComplete, eqHeld: s.equationsHeld, dense: s.denseSolves };
}

for (const k of [256, 1024]) {
  console.log('--- k =', k, ' systematic ON, keep=1   ', JSON.stringify(run(k, 512, 1.0, false, 10)));
  console.log('--- k =', k, ' systematic ON, keep=0.7 ', JSON.stringify(run(k, 512, 0.7, false, 11)));
  console.log('--- k =', k, ' LT only,       keep=1   ', JSON.stringify(run(k, 512, 1.0, true, 12)));
  console.log('--- k =', k, ' LT only,       keep=0.7 ', JSON.stringify(run(k, 512, 0.7, true, 13)));
}

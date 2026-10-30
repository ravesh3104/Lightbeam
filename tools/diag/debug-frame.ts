/** Frame-by-frame trace of one failing session. */
import { LTEncoder, LTDecoder, deriveMaskBlock } from '../../packages/core/src/fountain/lt.js';
import { Rng } from '../../packages/core/src/util/rng.js';

const payloadLength = 5000, blockSize = 512;
const k = Math.ceil(payloadLength / blockSize);
const sessionId = 3;
const rng = new Rng(3 + 2 * 7);
const payload = new Uint8Array(payloadLength);
for (let i = 0; i < payloadLength; i++) payload[i] = rng.nextUint32() & 0xff;

const enc = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength });
const dec = new LTDecoder({ k, blockSize, sessionId, payloadLength });
console.log('k=', k, 'encoder.prefix=', (enc as any).prefix, 'decoder.prefix=', (dec as any).prefix);
console.log('mask equal:', Array.from(deriveMaskBlock(sessionId, blockSize).subarray(0,4)),
            Array.from((enc as any).mask.subarray(0,4)), Array.from((dec as any).maskData.subarray(0,4)));

// Wrap solveVariable to see what gets solved.
const solvedLog: string[] = [];
const origSolve = (dec as any).solveVariable.bind(dec);
(dec as any).solveVariable = (variable: number, value: Uint8Array) => {
  const prefix = Array.from(value.subarray(0, 4));
  solvedLog.push(`solve block ${variable} bytes0-3=${prefix} allZero=${value.every((b: number) => b === 0)}`);
  return origSolve(variable, value);
};

for (let seed = 0; seed < 20 && !dec.isComplete; seed++) {
  const frame = enc.encode(seed);
  const kind = seed < (enc as any).prefix ? 'sys' : seed === (enc as any).prefix ? 'mask' : 'LT';
  const outcome = dec.addFrame(seed, frame);
  console.log(`seed=${seed} kind=${kind} out=${outcome} solved=${dec.getStats().solved} frameBytes0-3=${Array.from(frame.subarray(0,4))}`);
  if (seed === 3) console.log('   (LT seed used =', seed - (enc as any).prefix - 1, ')');
}
console.log('\nSolves:'); for (const l of solvedLog) console.log(' ', l);

const got = dec.reconstruct();
for (let b = 0; b < k; b++) {
  const want = payload.subarray(b*blockSize, Math.min(payloadLength, (b+1)*blockSize));
  const have = got.subarray(b*blockSize, Math.min(payloadLength, (b+1)*blockSize));
  let same = true; for (let i = 0; i < want.length; i++) if (want[i] !== have[i]) { same = false; break; }
  console.log(`block ${b}: ${same ? 'OK' : 'WRONG'} have0-3=${Array.from(have.subarray(0,4))} want0-3=${Array.from(want.subarray(0,4))}`);
}

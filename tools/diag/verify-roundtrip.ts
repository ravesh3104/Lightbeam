/** Isolates a suspected correctness bug: bytes differ after isComplete === true. */
import { LTEncoder, LTDecoder } from '../../packages/core/src/fountain/lt.js';
import { Rng } from '../../packages/core/src/util/rng.js';

function randomPayload(length: number, seed: number) {
  const rng = new Rng(seed); const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

let bad = 0, ok = 0, incomplete = 0;
for (let trial = 0; trial < 200; trial++) {
  const payloadLength = 5000;
  const blockSize = 512;
  const k = Math.ceil(payloadLength / blockSize); // 10
  const sessionId = 1 + trial;
  const payload = randomPayload(payloadLength, 3 + trial * 7);
  const enc = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength });
  const dec = new LTDecoder({ k, blockSize, sessionId, payloadLength });
  let seed = 0;
  for (; seed < k * 6 && !dec.isComplete; seed++) dec.addFrame(seed, enc.encode(seed));
  if (!dec.isComplete) { incomplete++; continue; }
  const got = dec.reconstruct();
  const want = payload;
  let firstDiff = -1;
  for (let i = 0; i < want.length; i++) { if (got[i] !== want[i]) { firstDiff = i; break; } }
  if (firstDiff >= 0) {
    bad++;
    if (bad <= 3) {
      console.log(`MISMATCH trial=${trial} session=${sessionId} firstDiff=${firstDiff} block=${Math.floor(firstDiff / blockSize)} seedsUsed=${seed}`);
      console.log('  prefix =', (enc as any).prefix, ' solved =', dec.getStats().solved, '/', k, ' dense =', dec.getStats().denseSolves);
      console.log('  got  blk:', Array.from(got.subarray(Math.floor(firstDiff/blockSize)*blockSize, Math.floor(firstDiff/blockSize)*blockSize+8)));
      console.log('  want blk:', Array.from(want.subarray(Math.floor(firstDiff/blockSize)*blockSize, Math.floor(firstDiff/blockSize)*blockSize+8)));
    }
  } else ok++;
}
console.log(`\nok=${ok} bad=${bad} incomplete=${incomplete}`);

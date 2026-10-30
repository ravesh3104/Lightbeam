/** Finds which part of the decoder is slow for a given config. */
import { LTEncoder, LTDecoder } from '../../packages/core/src/fountain/lt.js';
import { Rng } from '../../packages/core/src/util/rng.js';

const k = Number(process.env.LB_K ?? 1024);
const blockSize = 512;
const keep = Number(process.env.LB_KEEP ?? 0.7);
const variant = (process.env.LB_VARIANT ?? 'robust') as 'robust' | 'ideal' | 'uniform';
const denseLimit = Number(process.env.LB_DENSE ?? 256);
const stall = Number(process.env.LB_STALL ?? 32);

const rng = new Rng(4242);
const payload = new Uint8Array(k * blockSize);
for (let i = 0; i < payload.length; i++) payload[i] = rng.nextUint32() & 0xff;
const sessionId = 12345;
const enc = new LTEncoder(payload, { k, blockSize, sessionId, degree: { variant }, payloadLength: payload.length });
const dec = new LTDecoder({ k, blockSize, sessionId, degree: { variant }, payloadLength: payload.length, denseLimit, stallThreshold: stall });
const chan = new Rng(99);

let encodeMs = 0, decodeMs = 0, received = 0;
const t0 = Date.now();
const maxFrames = k * 8;
for (let seed = k + 1; seed < maxFrames; seed++) {
  if (chan.nextFloat() >= keep) continue;
  let t = Date.now();
  const block = enc.encode(seed);
  encodeMs += Date.now() - t;
  t = Date.now();
  dec.addFrame(seed, block);
  decodeMs += Date.now() - t;
  received++;
  if (received % 250 === 0 || dec.isComplete) {
    const s = dec.getStats();
    console.log(`seed=${seed} recv=${received} solved=${s.solved}/${k} eq=${s.equationsHeld} stall=${s.redundant + s.duplicates} dense=${s.denseSolves} denseR=${s.denseMatrixSize} enc=${encodeMs}ms dec=${decodeMs}ms total=${Date.now() - t0}ms`);
  }
  if (dec.isComplete) { console.log('COMPLETE overhead', (received/k).toFixed(3)); break; }
}
console.log(JSON.stringify(dec.getStats(), null, 1));

/**
 * core-link-check.ts - standalone optical chain diagnostic.
 *
 * Exercises the protocol engine end to end with no DOM and no camera:
 *   sender.symbolAt(t) -> rasterizeRgba -> jsQR -> receiver.accept
 *
 * Usage: npm run diag:core
 */
import jsQR from 'jsqr';
import {
  FrameType,
  TransferReceiver,
  TransferSender,
  base32Decode,
  parseFrame,
  prepareTransfer,
  rasterizeRgba,
} from '@lightbeam/core';

const text = 'The quick brown fox jumps over the lazy dog. '.repeat(24);
const payload = new TextEncoder().encode(text);

const prepared = await prepareTransfer({
  data: payload,
  name: 'core-link.txt',
  mime: 'text/plain',
  profile: 'balanced',
});
console.log('manifest   :', JSON.stringify(prepared.manifest));
console.log('plan       :', {
  modules: prepared.plan.modules,
  blockSize: prepared.plan.blockSize,
  k: prepared.plan.k,
  wireEncoding: prepared.plan.wireEncoding,
});

const sender = new TransferSender(prepared);
const receiver = new TransferReceiver();

let sent = 0;
for (let t = 0; t < 400; t++) {
  const symbol = sender.symbolAt(t);
  const raster = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
  const pixels = new Uint8ClampedArray(raster.data.length);
  pixels.set(raster.data);
  const decoded = jsQR(pixels, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
  sent++;
  if (!decoded) {
    console.log(`t=${t} UNDECODED`);
    continue;
  }
  const phase = receiver.accept(decoded.data);
  const progress = receiver.getProgress();
  const parsed = parseFrame(base32Decode(decoded.data));
  console.log(
    `t=${t} ${parsed?.type === FrameType.Manifest ? 'manifest' : 'data    '} ` +
      `ver=${symbol.version} chars=${decoded.data.length} -> ${phase} ` +
      `blocks=${progress.blocksSolved}/${progress.blocksTotal} accepted=${progress.framesAccepted}`,
  );
  if (phase === 'complete') {
    const result = receiver.getResult();
    console.log(
      `\nCOMPLETE after ${sent} frames: ${result?.payload.length} bytes, ` +
        `SHA-256 ${result?.integrity.ok ? 'ok' : 'FAILED'}, overhead ${(sent / (progress.blocksTotal || 1)).toFixed(2)}x`,
    );
    console.log('payload matches source:', new TextDecoder().decode(result!.payload) === text);
    break;
  }
}

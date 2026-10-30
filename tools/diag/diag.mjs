/**
 * diag.mjs - does the QR encoder produce symbols that a real decoder can read?
 *
 * Historical diagnostic (see README.md in this directory). The first thing ever
 * run in this project: encode a payload at several sizes and raster scales, decode
 * every symbol with jsQR, and compare the bytes. It is what established the
 * minimum usable `scale` and the maximum payload that decodes reliably at each
 * size - both of which the browser app now uses directly.
 *
 * Run: npx tsx tools/diag/diag.mjs
 */
import jsQR from 'jsqr';
const { encodeBinary, encodeText } = await import('../../packages/core/src/qr/encoder.ts');
const { rasterizeRgba } = await import('../../packages/core/src/qr/render.ts');

function tryDecode(bytes, opts, scale) {
  const sym = encodeBinary(bytes, opts);
  const img = rasterizeRgba(sym, { scale, quietZone: 4 });
  const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  return { v: sym.version, size: sym.size, ec: sym.ecLevel, mask: sym.mask, px: img.width, ok: !!res, match: res ? JSON.stringify(Array.from(res.binaryData)) === JSON.stringify(Array.from(bytes)) : false };
}
console.log('--- all-byte-values payload, varying size/scale ---');
for (const n of [16, 64, 100, 128, 200, 256]) {
  const bytes = new Uint8Array(n); for (let i=0;i<n;i++) bytes[i]=i&0xff;
  for (const scale of [4, 6]) {
    console.log(`n=${n} scale=${scale}`, JSON.stringify(tryDecode(bytes, {}, scale)));
  }
}
console.log('--- v40 at several scales ---');
const big = new Uint8Array(2953); for (let i=0;i<big.length;i++) big[i]=(i*131+7)&0xff;
for (const scale of [2,3,4]) console.log('scale',scale, JSON.stringify(tryDecode(big, {ecLevel:'L', boostEcLevel:false}, scale)));

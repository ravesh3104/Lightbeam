/**
 * qr-encoder.test.ts - round-trip verification of the QR encoder.
 *
 * Method: encode payloads with our encoder, rasterise to an RGBA image, then
 * decode that image with jsQR - a completely independent decoder implementation.
 * If our bitstream, Reed-Solomon blocks, interleaving, mask, or format bits were
 * wrong, jsQR would either fail or return different data. This is the strongest
 * correctness check available without physical hardware.
 */

import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { encodeBinary, encodeText, maxBytePayload } from '../src/qr/encoder.js';
import { rasterizeRgba, inkCoverage, toSvg, toSvgPath, moduleCountWithQuietZone } from '../src/qr/render.js';
import { rsEncode, rsVerify } from '../src/qr/reed-solomon.js';
import { sanitiseFileName } from '../src/util/bytes.js';
import type { EcLevel } from '../src/qr/tables.js';

/** Encode -> rasterise -> decode with jsQR. Returns the decoded text. */
function roundTrip(payload: string, options: Parameters<typeof encodeText>[1] = {}, scale = 4): string {
  const symbol = encodeText(payload, options);
  const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  expect(result, `jsQR failed to decode: "${payload.slice(0, 40)}"`).not.toBeNull();
  return result!.data;
}

/** Round-trip a byte payload through byte mode (the binary transfer path). */
function roundTripBinary(bytes: Uint8Array, options: Parameters<typeof encodeBinary>[1] = {}, scale = 4): number[] {
  const symbol = encodeBinary(bytes, options);
  const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  expect(result, `jsQR failed to decode ${bytes.length} bytes`).not.toBeNull();
  return Array.from(result!.binaryData);
}

describe('QR encoder - round trip through an independent decoder', () => {
  it('encodes a short URL', () => {
    expect(roundTrip('https://lightbeam.app/r/AB12CD')).toBe('https://lightbeam.app/r/AB12CD');
  });

  it('encodes plain text with lowercase (forces byte mode)', () => {
    const text = 'LightBeam: transfer files with light, no network required.';
    expect(roundTrip(text)).toBe(text);
  });

  it('exploits numeric mode for digit strings', () => {
    const digits = '1234567890'.repeat(8);
    const symbol = encodeText(digits);
    // Numeric mode at ~3.33 bits/char: 80 digits need about 267 bits + headers,
    // i.e. a version 5-L symbol (data capacity 864 bits). Byte mode would need
    // 640 bits + header, which also fits v5 - so assert on the *bits*, not the
    // version, to keep the test meaningful:
    // 4 (mode) + 10 (count) + 267 payload bits (26 triples x 10 bits + 7 bits).
    expect(symbol.bitLength).toBe(4 + 10 + 267);
    expect(roundTrip(digits)).toBe(digits);
  });

  it('exploits alphanumeric mode', () => {
    const text = 'LIGHTBEAM 2026-09-24 TEST 12345';
    const symbol = encodeText(text);
    // 11 bits per 2 chars instead of 8 bits per char.
    expect(symbol.bitLength).toBeLessThan(text.length * 8);
    expect(roundTrip(text)).toBe(text);
  });

  it('handles multi-byte UTF-8 text', () => {
    const text = 'नमस्ते 🌈 Ünïcödé — 光';
    expect(roundTrip(text, { boostEcLevel: false })).toBe(text);
  });

  it('round-trips every error correction level', () => {
    const payload = 'LIGHTBEAM-EC-TEST-';
    for (const ecLevel of ['L', 'M', 'Q', 'H'] as EcLevel[]) {
      for (const boostEcLevel of [true, false]) {
        const symbol = encodeText(payload, { ecLevel, boostEcLevel });
        const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
        const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
        expect(result?.data, `failed for ${ecLevel} boost=${boostEcLevel}`).toBe(payload);
      }
    }
  });

  it('round-trips every mask pattern', () => {
    const payload = 'MASK-PATTERN-COVERAGE-0123456789';
    for (let mask = 0; mask < 8; mask++) {
      const symbol = encodeText(payload, { mask });
      expect(symbol.mask).toBe(mask);
      const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
      const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
      expect(result?.data, `failed for mask ${mask}`).toBe(payload);
    }
  });

  it('round-trips binary payloads (byte mode, all 256 byte values)', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(roundTripBinary(bytes)).toEqual(Array.from(bytes));
  });

  it('round-trips a payload at the exact capacity boundary', () => {
    // Version 5-L holds 106 codewords; byte mode needs 4 + 8 bits of header.
    const capacity = maxBytePayload(5, 'L');
    expect(capacity).toBeGreaterThan(100);
    const bytes = new Uint8Array(capacity);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
    expect(roundTripBinary(bytes, { minVersion: 5, maxVersion: 5, ecLevel: 'L', boostEcLevel: false })).toEqual(
      Array.from(bytes),
    );
  });

  it('rejects a payload that is one byte over capacity', () => {
    const capacity = maxBytePayload(5, 'L');
    const bytes = new Uint8Array(capacity + 1);
    expect(() =>
      encodeBinary(bytes, { minVersion: 5, maxVersion: 5, ecLevel: 'L', boostEcLevel: false }),
    ).toThrow(/does not fit/);
  });

  it('round-trips a large version-40 symbol', () => {
    // 2953 bytes is the byte-mode ceiling for version 40-L.
    const bytes = new Uint8Array(2953);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff;
    const symbol = encodeBinary(bytes, { ecLevel: 'L', boostEcLevel: false });
    expect(symbol.version).toBe(40);
    expect(symbol.size).toBe(177);
    const image = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
    const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(result).not.toBeNull();
    expect(Array.from(result!.binaryData)).toEqual(Array.from(bytes));
  });

  it('produces a symbol with a balanced ink coverage', () => {
    const symbol = encodeText('LIGHTBEAM INK COVERAGE TEST 0123456789', {});
    const coverage = inkCoverage(symbol);
    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.7);
  });
});

describe('Reed-Solomon encoder', () => {
  it('produces valid codewords for every EC width used by QR', () => {
    // Every degree that actually occurs in ISO 18004 across the 40 versions x 4
    // EC levels. (An earlier revision built this set by looping over the EC levels
    // and discarding the loop variable - a no-op that hid the fact that the list
    // below is the real subject of the test.)
    const degrees = [7, 10, 13, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30];
    for (const degree of degrees) {
      const data = new Uint8Array(40);
      for (let i = 0; i < data.length; i++) data[i] = (i * 17 + degree) & 0xff;
      const parity = rsEncode(data, degree);
      expect(parity.length).toBe(degree);
      const codeword = new Uint8Array(data.length + parity.length);
      codeword.set(data);
      codeword.set(parity, data.length);
      expect(rsVerify(codeword, degree), `syndrome check failed for degree ${degree}`).toBe(true);
    }
  });

  it('matches the worked example from ISO/IEC 18004 (Annex I)', () => {
    // The published worked example: 16 data codewords, 10 EC codewords, giving the
    // parity block 0xA5 0x24 0xD4 ... This is a stronger assertion than the
    // syndrome check above: a wrong generator polynomial could still produce a
    // codeword whose syndromes all vanish if the data were chosen adversarially,
    // whereas matching the standard's own numbers byte for byte cannot be
    // satisfied by an implementation that differs from the standard.
    const data = Uint8Array.from([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]);
    const parity = rsEncode(data, 10);
    expect(Array.from(parity)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });
});

describe('SVG path rendering (used by the native app)', () => {
  it('emits one merged rectangle per run of dark modules, in module units', () => {
    const symbol = encodeText('hello', { minVersion: 1, maxVersion: 1, ecLevel: 'M' });
    const path = toSvgPath(symbol, { quietZone: 4 });
    // Rectangle subpaths only, one per horizontal run.
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    // Mostly runs of length >= 1; merging must have happened.
    const runs = path.split('M').length - 1;
    let darkModules = 0;
    for (const value of symbol.modules) darkModules += value;
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThanOrEqual(darkModules);
    // Every coordinate sits inside the quiet-zoned square.
    const limit = moduleCountWithQuietZone(symbol, 4);
    for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, run] = [Number(match[1]), Number(match[2]), Number(match[3])];
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x + run).toBeLessThanOrEqual(limit - 4);
    }
  });

  it('renders the same geometry as the SVG rasteriser', () => {
    const symbol = encodeText('geometry check', { minVersion: 2, maxVersion: 2, ecLevel: 'M' });
    const svg = toSvg(symbol, { scale: 1, quietZone: 4 });
    const path = toSvgPath(symbol, { quietZone: 4 });
    // The `<path d="...">` inside toSvg() must be byte-identical to toSvgPath().
    const embedded = /<path d="([^"]*)"/.exec(svg)?.[1];
    expect(embedded).toBe(path);
  });

  it('stays within the size budget the native renderer rebuilds every frame', () => {
    // Measured cost, and the numbers the native app is designed around:
    //
    //   version  modules  dark  runs  path chars   chars/module
    //      1       21      222   ~170     1.5 k         3.50
    //     15       77     3018  ~2300    20.4 k         3.45
    //     27      125     7516  ~5800    57.2 k         3.66
    //
    // A QR symbol is deliberately high-frequency, so horizontal merging of dark
    // runs saves far less than one might expect (mean run length is only ~1.3
    // modules). The budget below is therefore "under 4 characters per module",
    // which keeps the inline `<svg><path/></svg>` fallback compact: ~20 kB of path
    // string per frame at 77 modules, rebuilt 15 times a second on the UI thread.
    // If a low-end device cannot keep up, the answer is a smaller profile or a
    // lower frame rate - both user-visible settings - not a cleverer path syntax.
    for (const [version, maxCharsPerModule] of [
      [1, 4],
      [15, 3.6],
      [27, 3.8],
    ] as const) {
      const symbol = encodeText('x'.repeat(10), {
        minVersion: version,
        maxVersion: version,
        ecLevel: 'L',
      });
      const path = toSvgPath(symbol);
      const perModule = path.length / (symbol.size * symbol.size);
      expect(perModule).toBeLessThan(maxCharsPerModule);
      // Sanity: merging must never produce more runs than there are dark modules.
      let dark = 0;
      for (const value of symbol.modules) dark += value;
      expect(path.split('M').length - 1).toBeLessThanOrEqual(dark);
    }
  });
});

describe('sanitiseFileName (must never escape the receiver inbox)', () => {
  it('strips directory components and traversal', () => {
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('/tmp/evil.sh')).toBe('evil.sh');
    expect(sanitiseFileName('a\\b\\c.txt')).toBe('c.txt');
    expect(sanitiseFileName('..')).toBe('received.bin');
    expect(sanitiseFileName('.hidden')).toBe('hidden');
    expect(sanitiseFileName('...')).toBe('received.bin');
  });

  it('removes control characters and platform-hostile ones', () => {
    expect(sanitiseFileName('in\u0000voice<>:"|?*.pdf')).toBe('invoice_______.pdf');
    expect(sanitiseFileName('  spaced   out.txt  ')).toBe('spaced out.txt');
  });

  it('caps the length and still produces something usable', () => {
    const long = sanitiseFileName(`${'x'.repeat(400)}.txt`);
    expect(long.length).toBe(200);
    expect(sanitiseFileName('')).toBe('received.bin');
    expect(sanitiseFileName('   ')).toBe('received.bin');
  });
});

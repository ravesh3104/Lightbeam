/**
 * reed-solomon.ts - Reed-Solomon error correction encoder for QR Code symbols.
 *
 * QR Codes use a systematic Reed-Solomon code RS(n, k) over GF(2^8):
 *   - k = number of data codewords,
 *   - n - k = `ecPerBlock` error-correction codewords,
 *   - the generator polynomial is
 *         g(x) = (x - a^0)(x - a^1) ... (x - a^(ecPerBlock-1))
 *     with a = 2 (see galois.ts).
 *
 * Encoding a block C(x) (data codewords as polynomial coefficients, highest
 * power first) means computing the remainder of
 *         C(x) * x^(ecPerBlock)  /  g(x)
 * and appending that remainder. Systematic form: the data codewords appear
 * verbatim, followed by the parity codewords.
 *
 * Implementation: the classic LFSR / synthetic-division loop. We divide by the
 * *monic* generator with its leading coefficient stripped, which is O(k *
 * ecPerBlock) field operations and needs no polynomial division bookkeeping.
 *
 * The generator polynomial depends only on `ecPerBlock` (which takes a handful
 * of distinct values across all 40 versions x 4 EC levels), so results are
 * memoised.
 */

import { EXP, LOG, gfPolyMul } from './galois.js';

const generatorCache = new Map<number, Uint8Array>();

/**
 * Generator polynomial of the requested degree, coefficients highest power
 * first and monic (leading coefficient 1, which is why we store degree entries
 * and drop the leading 1 in the division loop).
 */
export function generatorPolynomial(degree: number): Uint8Array {
  if (degree < 1) throw new RangeError('Reed-Solomon degree must be >= 1');
  const cached = generatorCache.get(degree);
  if (cached) return cached;

  // g(x) = product of (x - a^i); in GF(2^8) subtraction is XOR.
  // The explicit annotation widens the buffer type to ArrayBufferLike, which is
  // what the helpers return; TS >= 5.7 types typed arrays by their buffer.
  let poly: Uint8Array = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = gfPolyMul(poly, new Uint8Array([1, EXP[i]]));
  }
  // `poly` has degree+1 coefficients including the monic leading 1; keep the
  // rest, which is what the division loop consumes. (Built with an explicit
  // copy rather than slice() to stay agnostic about typed-array buffer types.)
  const stripped = new Uint8Array(poly.length - 1);
  stripped.set(poly.subarray(1));
  generatorCache.set(degree, stripped);
  return stripped;
}

/**
 * Compute the `ecCount` parity codewords for a data block.
 *
 * @param data    data codewords of one RS block
 * @param ecCount number of parity codewords to append
 * @returns       a new array of length `ecCount`
 */
export function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  if (ecCount <= 0) return new Uint8Array(0);
  const gen = generatorPolynomial(ecCount);
  const rem = new Uint8Array(ecCount);

  for (let i = 0; i < data.length; i++) {
    // Feedback term: the byte shifted out of the register XORed with data[i].
    const factor = data[i] ^ rem[0];
    // Shift the register one step.
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      const logFactor = LOG[factor];
      for (let j = 0; j < ecCount; j++) {
        const g = gen[j];
        if (g !== 0) rem[j] ^= EXP[logFactor + LOG[g]];
      }
    }
  }
  return rem;
}

/**
 * Verify that a codeword (data + parity) is a valid RS codeword by evaluating
 * the full polynomial at a^0 ... a^(ecCount-1). All syndromes must be zero.
 * Used by the unit tests and by the diagnostics screen.
 */
export function rsVerify(code: Uint8Array, ecCount: number): boolean {
  const poly = code;
  for (let i = 0; i < ecCount; i++) {
    let y = 0;
    const x = EXP[i];
    for (let j = 0; j < poly.length; j++) {
      y = (y === 0 ? 0 : EXP[LOG[y] + LOG[x]]) ^ poly[j];
    }
    if (y !== 0) return false;
  }
  return true;
}

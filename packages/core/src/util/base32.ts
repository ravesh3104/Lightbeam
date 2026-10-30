/**
 * base32.ts - RFC 4648 base32, the text-safe wire encoding for QR frames.
 *
 * WHY THIS EXISTS
 * ---------------
 * A QR symbol can carry arbitrary bytes (ISO 18004 "byte mode"), and a pure-JS
 * decoder like jsQR can return those bytes. However, hardware-accelerated browser
 * barcode APIs (`window.BarcodeDetector`, backed by OS vision engines) return
 * `DetectedBarcode.rawValue` as a UTF-16 DOMString, not raw bytes — any byte
 * sequence that is not valid UTF-8 is replaced with U+FFFD at that boundary.
 *
 * So a file containing arbitrary bytes cannot survive a native scan: a 0x80 byte
 * comes back mangled, and the SHA-256 check fails with no clue why. Encoding the
 * frame payload as Base32 fixes this at a cost of only ~10% - and it costs even
 * less than it looks, because Base32's alphabet (A-Z, 2-7) is a *subset of QR's
 * alphanumeric mode*, which packs 2 characters into 11 bits instead of 16:
 *
 *   raw byte mode        8.00 bits per payload byte
 *   base64 in byte mode  10.67 bits per payload byte   (+33%)
 *   base32 in alnum mode  8.80 bits per payload byte   (+10%)   <-- used here
 *
 * Base32 is therefore both the most compatible AND (behind raw bytes) the
 * cheapest text-safe option. Hex would cost 16.5 bits/byte (+106%).
 *
 * The encoding is signalled per frame in the header flags, so a web-to-web
 * transfer can still opt into raw byte mode for the extra 10%.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Reverse lookup table (-1 = not a base32 character). */
const DECODE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  // Accept lowercase input: some scanners normalise case.
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET[i].toLowerCase().charCodeAt(0)] = i;
  return table;
})();

/**
 * Number of base32 characters needed to encode `length` bytes.
 *
 * Note this is ceil(8n/5), NOT the "8 characters per 5 bytes" rule of thumb: that
 * rule describes the *padded* RFC 4648 convention, and we deliberately emit no
 * padding (the '=' character is not in QR's alphanumeric set, so padding would
 * force the whole symbol back into byte mode and cost ~30% more).
 */
export function base32EncodedLength(length: number): number {
  return Math.ceil((length * 8) / 5);
}

/** Number of bytes a base32 string of `chars` characters decodes to (upper bound). */
export function base32DecodedLength(chars: number): number {
  return Math.floor((chars * 5) / 8);
}

/**
 * Encode bytes as an unpadded uppercase base32 string.
 *
 * Unpadded is deliberate: '=' is not in QR's alphanumeric set, so padding would
 * force the whole symbol back into byte mode and throw away the 10% advantage.
 */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * Decode a base32 string. Ignores whitespace and padding, and tolerates
 * lowercase. Throws on characters outside the alphabet so that a misdecoded
 * symbol fails loudly rather than producing plausible-looking bytes.
 */
export function base32Decode(text: string): Uint8Array {
  const out = new Uint8Array(base32DecodedLength(text.length) + 1);
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 61 /* '=' */ || code === 32 || code === 10 || code === 13 || code === 9) continue;
    if (code > 127) throw new RangeError(`Non-ASCII character in base32 payload at index ${i}`);
    const value = DECODE[code];
    if (value < 0) throw new RangeError(`Invalid base32 character "${text[i]}" at index ${i}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >>> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** True if every character is inside QR's alphanumeric set (so alnum mode applies). */
export function isBase32(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const value = DECODE[text.charCodeAt(i)];
    if (value < 0) return false;
  }
  return true;
}

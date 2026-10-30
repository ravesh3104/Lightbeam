/**
 * segments.ts - QR Code data segment construction (ISO/IEC 18004 section 7.4).
 *
 * A QR symbol stores a *sequence of segments*, each in one of four encoding
 * modes. Each mode packs data at a different density:
 *
 *   Mode          Alphabet                     Bits per unit
 *   ------------  ---------------------------  ----------------------------
 *   Numeric       0-9                          10 bits / 3 digits
 *   Alphanumeric  0-9 A-Z space $%*+-./:        11 bits / 2 characters
 *   Byte          arbitrary 8-bit (UTF-8 here)   8 bits / byte
 *   Kanji         Shift-JIS double byte         13 bits / character (unused)
 *
 * A segment costs 4 bits of mode indicator + C bits of character-count
 * indicator (C depends on mode AND version group) + the payload bits.
 *
 * LightBeam sends mostly binary, but text mode ("send a password / URL") is
 * dramatically smaller when the text qualifies for numeric or alphanumeric
 * mode - roughly 2.4x denser for alphanumeric, 3x for digits. Because this is
 * an optical channel where every bit costs screen time, we run a small dynamic
 * program that finds the cheapest segmentation of the text.
 */

import { BitWriter } from '../util/bits.js';

export const enum QrMode {
  Numeric = 1,
  Alphanumeric = 2,
  Byte = 4,
  Kanji = 8,
}

/** The 45-character alphanumeric alphabet, index === encoded value. */
export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const ALNUM_INDEX = (() => {
  const map = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHANUMERIC_CHARSET.length; i++) {
    map[ALPHANUMERIC_CHARSET.charCodeAt(i)] = i;
  }
  return map;
})();

/** Version groups differ in character-count-indicator widths. */
export function versionGroup(version: number): 0 | 1 | 2 {
  if (version <= 9) return 0;
  if (version <= 26) return 1;
  return 2;
}

/** Bit width of the character count indicator for (mode, version). */
export function charCountBits(mode: QrMode, version: number): number {
  const g = versionGroup(version);
  switch (mode) {
    case QrMode.Numeric:
      return [10, 12, 14][g];
    case QrMode.Alphanumeric:
      return [9, 11, 13][g];
    case QrMode.Byte:
      return [8, 16, 16][g];
    case QrMode.Kanji:
      return [8, 10, 12][g];
    default:
      throw new RangeError(`Unknown QR mode ${mode}`);
  }
}

export interface QrSegment {
  mode: QrMode;
  /** Number of characters (not bytes) in the original data. */
  numChars: number;
  /** Payload bits, MSB-first. */
  bits: Uint8Array;
  bitLength: number;
}

/** Bits of payload for `n` numeric characters: 10 bits per triple, 4/7 for 1/2. */
export function numericBitLength(n: number): number {
  return Math.floor(n / 3) * 10 + [0, 4, 7][n % 3];
}

/** Bits of payload for `n` alphanumeric characters: 11 per pair, 6 for a lone char. */
export function alphanumericBitLength(n: number): number {
  return Math.floor(n / 2) * 11 + (n % 2) * 6;
}

export function makeNumericSegment(digits: string): QrSegment {
  const w = new BitWriter(Math.ceil(numericBitLength(digits.length) / 8) + 4);
  for (let i = 0; i < digits.length; i += 3) {
    const chunk = digits.slice(i, i + 3);
    if (chunk.length === 3) w.write(parseInt(chunk, 10), 10);
    else if (chunk.length === 2) w.write(parseInt(chunk, 10), 7);
    else w.write(parseInt(chunk, 10), 4);
  }
  return { mode: QrMode.Numeric, numChars: digits.length, bits: w.toUint8Array(), bitLength: w.length };
}

export function makeAlphanumericSegment(text: string): QrSegment {
  const w = new BitWriter(Math.ceil(alphanumericBitLength(text.length) / 8) + 4);
  let i = 0;
  for (; i + 1 < text.length; i += 2) {
    const hi = ALNUM_INDEX[text.charCodeAt(i)];
    const lo = ALNUM_INDEX[text.charCodeAt(i + 1)];
    if (hi < 0 || lo < 0) throw new RangeError(`Character "${text[i]}"/"${text[i + 1]}" is not alphanumeric`);
    w.write(hi * 45 + lo, 11);
  }
  if (i < text.length) {
    const hi = ALNUM_INDEX[text.charCodeAt(i)];
    if (hi < 0) throw new RangeError(`Character "${text[i]}" is not alphanumeric`);
    w.write(hi, 6);
  }
  return { mode: QrMode.Alphanumeric, numChars: text.length, bits: w.toUint8Array(), bitLength: w.length };
}

const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** UTF-8 encode without assuming global TextEncoder exists in stripped sandboxes. */
export function utf8Encode(text: string): Uint8Array {
  if (utf8Encoder) return utf8Encoder.encode(text);
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/** Byte-mode segment from raw bytes (used for binary payload frames). */
export function makeByteSegmentFromBytes(bytes: Uint8Array): QrSegment {
  return {
    mode: QrMode.Byte,
    numChars: bytes.length,
    bits: bytes,
    bitLength: bytes.length * 8,
  };
}

export function makeByteSegment(text: string): QrSegment {
  return makeByteSegmentFromBytes(utf8Encode(text));
}

function isNumericCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function alnumIndex(code: number): number {
  return code < 128 ? ALNUM_INDEX[code] : -1;
}

/** True if the whole string can be encoded in numeric mode. */
export function isAllNumeric(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isNumericCode(text.charCodeAt(i))) return false;
  return text.length > 0;
}

/** True if the whole string can be encoded in alphanumeric mode. */
export function isAllAlphanumeric(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (alnumIndex(text.charCodeAt(i)) < 0) return false;
  return text.length > 0;
}

/**
 * Cost, in bits, of a segment covering text[start..end) in the given mode,
 * including the 4-bit mode indicator and the version-dependent count indicator.
 */
function segmentCost(mode: QrMode, length: number, version: number): number {
  switch (mode) {
    case QrMode.Numeric:
      return 4 + charCountBits(mode, version) + numericBitLength(length);
    case QrMode.Alphanumeric:
      return 4 + charCountBits(mode, version) + alphanumericBitLength(length);
    default:
      // Byte mode cost depends on the UTF-8 length, not the JS string length;
      // the caller passes the pre-computed byte length via `length`.
      return 4 + charCountBits(mode, version) + length * 8;
  }
}

/**
 * Optimal (minimum total bits) segmentation of `text` for a given version.
 *
 * This is a shortest-path problem over string positions. From position i we may
 * emit a numeric run, an alphanumeric run, or a byte chunk of any length, so a
 * naive DP is O(n^2) in the chunk-length dimension. We cap chunk length
 * (MAX_CHUNK) purely to keep the DP fast; for the short text payloads LightBeam
 * transmits this has no effect on the optimum.
 *
 * Returns the segment list. Byte lengths are measured in UTF-8 bytes, computed
 * incrementally so the DP never re-encodes substrings.
 */
export function splitIntoSegments(text: string, version: number): QrSegment[] {
  const MAX_CHUNK = 1024;
  const n = text.length;

  if (n === 0) return [];
  if (n > 4096) {
    // Pathological input: skip the DP and emit a single byte segment.
    return [makeByteSegment(text)];
  }

  // The DP runs over *code points*, never over UTF-16 code units: a segment
  // boundary inside a surrogate pair would produce a lone surrogate and an
  // invalid UTF-8 sequence on the wire.
  const points: string[] = [];
  const pointBytes: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    points.push(ch);
    pointBytes.push(cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
    i += ch.length;
  }
  const m = points.length;

  const INF = Number.MAX_SAFE_INTEGER / 4;
  const cost = new Float64Array(m + 1).fill(INF);
  const from = new Int32Array(m + 1).fill(-1);
  const via = new Uint8Array(m + 1);
  cost[0] = 0;

  for (let i = 0; i < m; i++) {
    if (cost[i] >= INF) continue;
    const base = cost[i];

    // --- byte chunk: always possible, length measured in UTF-8 bytes -------
    let bytes = 0;
    for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
      bytes += pointBytes[j];
      const total = base + segmentCost(QrMode.Byte, bytes, version);
      if (total < cost[j + 1]) {
        cost[j + 1] = total;
        from[j + 1] = i;
        via[j + 1] = QrMode.Byte;
      }
    }

    // --- numeric run -------------------------------------------------------
    let digits = 0;
    for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
      const code = points[j].charCodeAt(0);
      if (!isNumericCode(code)) break;
      digits++;
      const total = base + segmentCost(QrMode.Numeric, digits, version);
      if (total < cost[j + 1]) {
        cost[j + 1] = total;
        from[j + 1] = i;
        via[j + 1] = QrMode.Numeric;
      }
    }

    // --- alphanumeric run --------------------------------------------------
    let alnum = 0;
    for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
      if (alnumIndex(points[j].charCodeAt(0)) < 0) break;
      alnum++;
      const total = base + segmentCost(QrMode.Alphanumeric, alnum, version);
      if (total < cost[j + 1]) {
        cost[j + 1] = total;
        from[j + 1] = i;
        via[j + 1] = QrMode.Alphanumeric;
      }
    }
  }

  // Backtrack to recover the segmentation.
  const parts: Array<{ start: number; end: number; mode: QrMode }> = [];
  for (let pos = m; pos > 0; pos = from[pos]) {
    if (from[pos] < 0) throw new Error('QR segmentation failed');
    parts.push({ start: from[pos], end: pos, mode: via[pos] as QrMode });
  }
  parts.reverse();

  // Materialise each part with the cheapest *matching* mode. A part the DP
  // routed through the alphanumeric table whose slice happens to be all digits
  // is cheaper still as numeric, so prefer numeric when it is valid.
  return parts.map(({ start, end, mode }) => {
    const slice = points.slice(start, end).join('');
    if (mode === QrMode.Byte) return makeByteSegment(slice);
    if (mode === QrMode.Numeric || isAllNumeric(slice)) return makeNumericSegment(slice);
    return makeAlphanumericSegment(slice);
  });
}

/**
 * Total bit length of a segment list including mode and count indicators,
 * for a given version. Byte-mode segments already carry their byte count in
 * \`numChars\` (see makeByteSegmentFromBytes).
 */
export function segmentsBitLength(segments: QrSegment[], version: number): number {
  let total = 0;
  for (const seg of segments) total += 4 + charCountBits(seg.mode, version) + seg.bitLength;
  return total;
}

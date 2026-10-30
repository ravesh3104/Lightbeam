/**
 * encoder.ts - full QR Code encoder (ISO/IEC 18004), tuned for optics.
 *
 * Pipeline:
 *   1. split the input into optimally segmented data segments
 *      (numeric / alphanumeric / byte, cheapest segmentation per version group)
 *   2. pick the smallest version whose capacity fits, optionally *boosting* the
 *      EC level when the symbol has slack - a bigger error-correction budget is
 *      free robustness for a camera-based channel
 *   3. build the bit stream: segments + terminator + byte padding + 0xEC/0x11 pad
 *   4. split data codewords into Reed-Solomon blocks, add parity, interleave
 *   5. draw function patterns, place interleaved codewords, pick the best of the
 *      eight data masks by penalty score, write format and version information
 *
 * Result: a flat module grid, `modules[y * size + x]`, plus two companion
 * arrays (bitMask, isFunction) that let a renderer recolour a symbol without
 * re-running any of the above.
 *
 * Streaming fast path: a LightBeam transfer renders thousands of symbols that
 * all share one geometry (version, EC level, mask). `lock` in EncodeOptions
 * skips the eight-way mask search, which is more than half of the encoder cost.
 */

import { BitWriter } from '../util/bits.js';
import {
  BYTE_MODE_CAPACITY,
  EC_BLOCKS,
  SYMBOL_TOTAL_CODEWORDS,
  type EcLevel,
} from './tables.js';
import { rsEncode } from './reed-solomon.js';
import {
  charCountBits,
  makeByteSegmentFromBytes,
  splitIntoSegments,
  type QrSegment,
} from './segments.js';
import {
  applyFunctionLayer,
  applyMask,
  buildFunctionLayer,
  drawFormatInfo,
  drawVersionInfo,
  emptyMatrix,
  maskPenalty,
  placeData,
  type QrMatrix,
} from './matrix.js';

export interface EncodeOptions {
  /** Error correction level used for version selection. Default 'L'. */
  ecLevel?: EcLevel;
  /** Smallest version to consider (also the version used when fitting a frame). */
  minVersion?: number;
  maxVersion?: number;
  /** Force a mask pattern 0..7 and skip the 8-way penalty search. */
  mask?: number;
  /**
   * Raise the EC level to the highest one that still fits in the chosen
   * version. Free robustness for a camera channel; on by default.
   */
  boostEcLevel?: boolean;
}

export interface EncodedSymbol {
  version: number;
  size: number;
  ecLevel: EcLevel;
  mask: number;
  /** 1 = dark module, 0 = light. Row-major, length size * size. */
  modules: Uint8Array;
  /** Data bit carried by each module (meangful only where isFunction === 0). */
  bitMask: Uint8Array;
  /** 1 where the module is a function pattern or format/version information. */
  isFunction: Uint8Array;
  /** Human-readable label of the payload (diagnostics only). */
  text: string;
  /** Payload bits actually used, and the symbol's data capacity, in bits. */
  bitLength: number;
  capacityBits: number;
  /** Total interleaved codewords placed in the symbol. */
  totalCodewords: number;
}

/** Data codewords available for (version, level). */
export function dataCodewordCount(version: number, level: EcLevel): number {
  const groups = EC_BLOCKS[level][version];
  return SYMBOL_TOTAL_CODEWORDS[version] - groups.blocks * groups.ecPerBlock;
}

/** Highest EC level (H > Q > M > L) whose data capacity still fits `bitLength`. */
function bestEcLevelForBits(version: number, bitLength: number): EcLevel {
  const order: EcLevel[] = ['H', 'Q', 'M', 'L'];
  for (const level of order) {
    if (dataCodewordCount(version, level) * 8 >= bitLength) return level;
  }
  return 'L';
}

function segmentsBitLength(segments: QrSegment[], version: number): number {
  let total = 0;
  for (const seg of segments) total += 4 + charCountBits(seg.mode, version) + seg.bitLength;
  return total;
}

function utf8ByteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Byte-mode bit cost for `bytes` at a version (mode + count indicator + data). */
function byteModeBitCost(bytes: number, version: number): number {
  return 4 + charCountBits(4, version) + bytes * 8;
}

/**
 * Encode UTF-8 text, segmenting for density.
 *
 * The segmentation optimum depends on the character-count indicator width, which
 * changes at versions 10 and 27. We therefore segment once for the minimum
 * version, find the fitting version, and re-segment if that landed in a later
 * group.
 */
export function encodeText(text: string, options: EncodeOptions = {}): EncodedSymbol {
  const ecLevel = options.ecLevel ?? 'L';
  const minVersion = Math.max(1, options.minVersion ?? 1);
  const maxVersion = Math.min(40, options.maxVersion ?? 40);
  const bytes = utf8ByteLength(text);

  let segments = splitIntoSegments(text, minVersion);
  let version = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    if (segmentsBitLength(segments, v) <= dataCodewordCount(v, ecLevel) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new RangeError(`Text payload of ${bytes} bytes does not fit in any QR version`);
  if ((version <= 9 ? 0 : version <= 26 ? 1 : 2) !== (minVersion <= 9 ? 0 : minVersion <= 26 ? 1 : 2)) {
    segments = splitIntoSegments(text, version);
  }
  return assemble(text, segments, version, ecLevel, options);
}

/**
 * Encode raw bytes. Always byte mode: binary payloads must round-trip exactly,
 * so no numeric/alphanumeric re-encoding is attempted.
 */
export function encodeBinary(bytes: Uint8Array, options: EncodeOptions = {}): EncodedSymbol {
  const ecLevel = options.ecLevel ?? 'L';
  const minVersion = Math.max(1, options.minVersion ?? 1);
  const maxVersion = Math.min(40, options.maxVersion ?? 40);
  let version = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    if (byteModeBitCost(bytes.length, v) <= dataCodewordCount(v, ecLevel) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new RangeError(`Binary payload of ${bytes.length} bytes does not fit in a version ${minVersion}-${maxVersion} symbol at EC level ${ecLevel}`);
  }
  return assemble(latin1Label(bytes), [makeByteSegmentFromBytes(bytes)], version, ecLevel, options);
}

/** Text-mode label for binary payloads (diagnostics; not part of the wire format). */
function latin1Label(bytes: Uint8Array): string {
  let out = '';
  const limit = Math.min(bytes.length, 32);
  for (let i = 0; i < limit; i++) out += String.fromCharCode(bytes[i]);
  return out + (bytes.length > limit ? '...' : '');
}

/** Largest byte-mode payload that fits (version, level) - used for planning. */
export function maxBytePayload(version: number, level: EcLevel): number {
  const bits = dataCodewordCount(version, level) * 8 - 4 - charCountBits(4, version);
  return Math.max(0, Math.floor(bits / 8));
}

/** Raw byte-mode capacity table straight from ISO 18004 (no header overhead). */
export { BYTE_MODE_CAPACITY };

/**
 * Encode an explicit list of segments.
 *
 * This is the entry point for mixed-mode frames: a LightBeam base32 frame is a
 * binary 13-byte header followed by an alphanumeric payload, and encoding that as
 * two segments (byte + alphanumeric) is measurably denser than pushing the whole
 * thing through byte mode - 5.5 bits per transmitted character instead of 8.
 */
export function encodeSegments(segments: QrSegment[], options: EncodeOptions = {}): EncodedSymbol {
  const ecLevel = options.ecLevel ?? 'L';
  const minVersion = Math.max(1, options.minVersion ?? 1);
  const maxVersion = Math.min(40, options.maxVersion ?? 40);
  let version = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    if (segmentsBitLength(segments, v) <= dataCodewordCount(v, ecLevel) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    const cost = segmentsBitLength(segments, maxVersion);
    throw new RangeError(
      `Segments need ${cost} bits, which does not fit a version ${minVersion}-${maxVersion} symbol at EC level ${ecLevel}`,
    );
  }
  let label = '';
  for (const segment of segments) {
    if (segment.mode === 4 && segment.bits.length <= 32) {
      label += String.fromCharCode(...Array.from(segment.bits.subarray(0, 16)));
    }
  }
  return assemble(label.slice(0, 32), segments, version, ecLevel, options);
}

/** Steps 3-5, shared by the text and binary entry points. */
function assemble(
  label: string,
  segments: QrSegment[],
  version: number,
  baseLevel: EcLevel,
  options: EncodeOptions,
): EncodedSymbol {
  const payloadBits = segmentsBitLength(segments, version);
  const ecLevel = options.boostEcLevel === false ? baseLevel : bestEcLevelForBits(version, payloadBits);
  const capacityBits = dataCodewordCount(version, ecLevel) * 8;
  if (payloadBits > capacityBits) {
    throw new RangeError(`Payload needs ${payloadBits} bits; version ${version}-${ecLevel} holds ${capacityBits}`);
  }

  // --- step 3: bit stream ---------------------------------------------------
  const writer = new BitWriter((capacityBits >>> 3) + 8);
  for (const seg of segments) {
    writer.write(seg.mode, 4);
    writer.write(seg.numChars, charCountBits(seg.mode, version));
    for (let i = 0; i < seg.bitLength; i++) {
      writer.writeBit((seg.bits[i >>> 3] >>> (7 - (i & 7))) & 1);
    }
  }
  writer.write(0, Math.min(4, capacityBits - writer.length)); // terminator
  writer.padToByte(0);
  const padded = new Uint8Array(capacityBits >>> 3);
  const used = writer.toUint8Array();
  padded.set(used);
  let toggle = true;
  for (let i = used.length; i < padded.length; i++) {
    padded[i] = toggle ? 0xec : 0x11;
    toggle = !toggle;
  }

  // --- step 4: Reed-Solomon blocks + interleaving --------------------------
  const { blocks, ecPerBlock } = EC_BLOCKS[ecLevel][version];
  const totalCodewords = SYMBOL_TOTAL_CODEWORDS[version];
  const dataTotal = totalCodewords - blocks * ecPerBlock;
  const shortLen = Math.floor(dataTotal / blocks);
  const longCount = dataTotal % blocks; // this many blocks carry one extra codeword

  const dataBlocks: Uint8Array[] = [];
  const parityBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    // ISO/IEC 18004 7.6: group 1 (the shorter blocks) comes FIRST, then group 2
    // (the blocks with one extra codeword). Getting this order wrong only shows
    // up once the two groups have different sizes, i.e. from version 10 onwards.
    const len = shortLen + (b >= blocks - longCount ? 1 : 0);
    const block = padded.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    parityBlocks.push(rsEncode(block, ecPerBlock));
  }

  const interleaved = new Uint8Array(totalCodewords);
  let out = 0;
  const longest = shortLen + (longCount > 0 ? 1 : 0);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i < dataBlocks[b].length) interleaved[out++] = dataBlocks[b][i];
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocks; b++) interleaved[out++] = parityBlocks[b][i];
  }

  // --- step 5: matrix ------------------------------------------------------
  const matrix = emptyMatrix(version);
  buildFunctionLayer(matrix);
  placeData(matrix, interleaved, totalCodewords * 8);
  drawVersionInfo(matrix);

  let mask = options.mask;
  if (mask === undefined) {
    // Evaluate all eight masks. Applying a mask twice restores the matrix, so
    // we never need eight copies of it.
    let bestScore = Infinity;
    for (let pattern = 0; pattern < 8; pattern++) {
      applyMask(matrix, pattern);
      drawFormatInfo(matrix, ecLevel, pattern);
      const score = maskPenalty(matrix);
      if (score < bestScore) {
        bestScore = score;
        mask = pattern;
      }
      applyMask(matrix, pattern);
    }
  }
  applyMask(matrix, mask!);
  drawFormatInfo(matrix, ecLevel, mask!);
  applyFunctionLayer(matrix);

  return {
    version,
    size: matrix.size,
    ecLevel,
    mask: mask!,
    modules: matrix.modules,
    bitMask: matrix.bitMask,
    isFunction: matrix.isFunction,
    text: label,
    bitLength: payloadBits,
    capacityBits,
    totalCodewords,
  };
}

/**
 * Memoising wrapper for repeated identical payloads.
 *
 * Used for the frames a sender repeats when a receiver asks for help (session
 * header frames, pre-generated frames placed before the payload bits, and the
 * zero-padded tail frames), and by the browser preview which re-renders the
 * same symbol every frame it is on screen.
 */
export class SymbolCache {
  private readonly entries = new Map<string, EncodedSymbol>();
  private readonly keys: string[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = maxEntries;
  }

  /**
   * Fetch or build a symbol. `key` must uniquely identify the payload *and* the
   * encoding options that affect geometry (version/EC/mask).
   */
  get(key: string, build: () => EncodedSymbol): EncodedSymbol {
    const hit = this.entries.get(key);
    if (hit) return hit;
    const built = build();
    this.entries.set(key, built);
    this.keys.push(key);
    while (this.keys.length > this.maxEntries) {
      const oldest = this.keys.shift()!;
      this.entries.delete(oldest);
    }
    return built;
  }

  clear(): void {
    this.entries.clear();
    this.keys.length = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}

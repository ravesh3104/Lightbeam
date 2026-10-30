/**
 * frame.ts - the on-screen frame format.
 *
 * One displayed QR symbol carries exactly one frame: a 13-byte header followed by
 * the payload (either an LT block or a manifest fragment).
 *
 *   offset  size  field
 *   ------  ----  -------------------------------------------------------------
 *    0       1    magic 0x4C ('L') - lets a receiver reject foreign QR codes
 *    1       1    protocol version (high nibble) | flags (low nibble)
 *    2       1    frame type: 0 = data block, 1 = manifest fragment
 *    3       4    session id (uint32, big-endian)
 *    7       4    data frames: LT frame seed (uint32, big-endian)
 *                 manifest frames: (fragment index << 16) | fragment count
 *   11       2    CRC-16/CCITT over header bytes 0..10
 *
 * Design notes
 * ------------
 * - FIXED SIZE HEADER. The header length never changes, so the receiver knows how
 *   many payload bytes follow before it parses anything, and the symbol geometry
 *   stays constant for the whole session - which lets both sides cache encoded
 *   symbols and keeps the camera's autofocus from chasing size changes.
 * - BIG-ENDIAN. Matches how QR byte-mode stores text, so a hex dump of a captured
 *   frame reads in the same order as the field list above.
 * - SESSION ID IN EVERY FRAME. This is what makes multi-sender capture work: a
 *   receiver pointed at a wall of screens drops frames from foreign sessions
 *   instead of corrupting its own decode.
 * - CRC-16 OVER THE HEADER ONLY. The header is the dangerous part to get wrong
 *   (a flipped bit there means the wrong session, or a seed that poisons the
 *   fountain decoder). The payload already has Reed-Solomon protection from the
 *   QR symbol and a whole-payload SHA-256 at the end, so a per-frame payload CRC
 *   would cost screen time for very little.
 * - NO EXPLICIT BLOCK INDEX. The seed *is* the index: both sides derive the
 *   neighbour set from it (fountain/lt.ts). That is where fountain coding earns
 *   its place on an optical channel - a lost frame costs only time.
 */

import { crc16 } from '../crypto/crc.js';
import { concatBytes } from '../util/bytes.js';

export const FRAME_MAGIC = 0x4c; // 'L'
export const PROTOCOL_VERSION = 1;
/** magic + version/flags + type + sessionId + word + crc16 */
export const FRAME_HEADER_BYTES = 13;

export const enum FrameType {
  Data = 0,
  Manifest = 1,
}

export const enum FrameFlag {
  None = 0,
  /** Payload is encrypted (the manifest explains how to derive the key). */
  Encrypted = 1 << 0,
  /** Payload was compressed before transmission. */
  Compressed = 1 << 1,
  /** Padded/short last frame indicator (reserved for future use). */
  Reserved1 = 1 << 2,
  /**
   * The frame payload is Base32 text rather than raw bytes.
   *
   * Set by default because native camera APIs return a *string* for every symbol
   * and mangle arbitrary bytes (see util/base32.ts). Costs ~10% of throughput and
   * buys universal compatibility, including with third-party scanner apps.
   */
  Base32 = 1 << 3,
}

export interface FrameHeader {
  version: number;
  flags: number;
  type: FrameType;
  sessionId: number;
  seed: number;
  /** Manifest frames only. */
  fragmentIndex: number;
  fragmentCount: number;
}

export interface ParsedFrame extends FrameHeader {
  /** Payload bytes following the header. */
  payload: Uint8Array;
}

function writeHeader(options: {
  type: FrameType;
  sessionId: number;
  word: number;
  flags: number;
}): Uint8Array {
  const header = new Uint8Array(FRAME_HEADER_BYTES);
  header[0] = FRAME_MAGIC;
  header[1] = ((PROTOCOL_VERSION & 0x0f) << 4) | (options.flags & 0x0f);
  header[2] = options.type & 0xff;
  header[3] = (options.sessionId >>> 24) & 0xff;
  header[4] = (options.sessionId >>> 16) & 0xff;
  header[5] = (options.sessionId >>> 8) & 0xff;
  header[6] = options.sessionId & 0xff;
  header[7] = (options.word >>> 24) & 0xff;
  header[8] = (options.word >>> 16) & 0xff;
  header[9] = (options.word >>> 8) & 0xff;
  header[10] = options.word & 0xff;
  const checksum = crc16(header.subarray(0, 11));
  header[11] = (checksum >>> 8) & 0xff;
  header[12] = checksum & 0xff;
  return header;
}

/**
 * Build just the 13-byte header of a data frame.
 *
 * Exposed separately because a base32 frame is built as "header bytes + base32
 * text" (two QR segments), not as one concatenated byte string.
 */
export function dataFrameHeader(options: { sessionId: number; seed: number; flags?: number }): Uint8Array {
  return writeHeader({
    type: FrameType.Data,
    sessionId: options.sessionId,
    word: options.seed,
    flags: options.flags ?? FrameFlag.None,
  });
}

/** Build just the 13-byte header of a manifest frame. */
export function manifestFrameHeader(options: {
  sessionId: number;
  fragmentIndex: number;
  fragmentCount: number;
  flags?: number;
}): Uint8Array {
  if (options.fragmentIndex > 0xffff || options.fragmentCount > 0xffff) {
    throw new RangeError('Manifest fragment index/count must fit in 16 bits');
  }
  return writeHeader({
    type: FrameType.Manifest,
    sessionId: options.sessionId,
    word: ((options.fragmentIndex << 16) | options.fragmentCount) >>> 0,
    flags: options.flags ?? FrameFlag.None,
  });
}

/** Serialise a data frame: header + one LT block. */
export function encodeDataFrame(options: {
  sessionId: number;
  seed: number;
  payload: Uint8Array;
  flags?: number;
}): Uint8Array {
  const header = writeHeader({
    type: FrameType.Data,
    sessionId: options.sessionId,
    word: options.seed,
    flags: options.flags ?? FrameFlag.None,
  });
  return concatBytes(header, options.payload);
}

/** Serialise a manifest fragment frame. */
export function encodeManifestFrame(options: {
  sessionId: number;
  fragmentIndex: number;
  fragmentCount: number;
  payload: Uint8Array;
  flags?: number;
}): Uint8Array {
  if (options.fragmentIndex > 0xffff || options.fragmentCount > 0xffff) {
    throw new RangeError('Manifest fragment index/count must fit in 16 bits');
  }
  const word = ((options.fragmentIndex << 16) | options.fragmentCount) >>> 0;
  const header = writeHeader({
    type: FrameType.Manifest,
    sessionId: options.sessionId,
    word,
    flags: options.flags ?? FrameFlag.None,
  });
  return concatBytes(header, options.payload);
}

export interface ParseResult {
  frame: ParsedFrame;
  /** False when the header CRC did not match (a corrupt or foreign symbol). */
  headerValid: boolean;
}

/**
 * Parse a decoded symbol payload into a frame.
 *
 * Returns null (never throws) for anything that is not a LightBeam frame, because
 * this runs on every camera frame and non-LightBeam input (a random QR code, a
 * misdecoded blurry symbol) is the normal case.
 *
 * `headerValid === false` does not discard the frame: the payload may still be
 * intact, and a fountain decoder can often use it. Callers that care about
 * strictness can drop those (the default receiver policy counts them as
 * "suspect" and only uses them when the strict path stalls).
 */
export function parseFrameDetailed(bytes: Uint8Array): ParseResult | null {
  if (bytes.length < FRAME_HEADER_BYTES) return null;
  if (bytes[0] !== FRAME_MAGIC) return null;

  const version = bytes[1] >>> 4;
  const flags = bytes[1] & 0x0f;
  if (version !== PROTOCOL_VERSION) return null;

  const type = bytes[2] as FrameType;
  if (type !== FrameType.Data && type !== FrameType.Manifest) return null;

  const expectedCrc = ((bytes[11] << 8) | bytes[12]) & 0xffff;
  const actualCrc = crc16(bytes.subarray(0, 11));
  const headerValid = expectedCrc === actualCrc;

  const sessionId = ((bytes[3] << 24) | (bytes[4] << 16) | (bytes[5] << 8) | bytes[6]) >>> 0;
  const word = ((bytes[7] << 24) | (bytes[8] << 16) | (bytes[9] << 8) | bytes[10]) >>> 0;
  const payload = bytes.subarray(FRAME_HEADER_BYTES);

  const base = { version, flags, type, sessionId, payload, headerValid };
  if (type === FrameType.Manifest) {
    return {
      frame: {
        ...base,
        seed: 0,
        fragmentIndex: (word >>> 16) & 0xffff,
        fragmentCount: word & 0xffff,
      },
      headerValid,
    };
  }
  return {
    frame: { ...base, seed: word, fragmentIndex: 0, fragmentCount: 0 },
    headerValid,
  };
}

/** Convenience wrapper: the frame, or null if it is not a LightBeam frame. */
export function parseFrame(bytes: Uint8Array): ParsedFrame | null {
  return parseFrameDetailed(bytes)?.frame ?? null;
}

/** Compact one-line description of a frame, for the diagnostics log. */
export function describeFrame(frame: ParsedFrame): string {
  const id = frame.sessionId.toString(16).padStart(8, '0');
  if (frame.type === FrameType.Manifest) {
    return `manifest ${frame.fragmentIndex + 1}/${frame.fragmentCount} session=${id} bytes=${frame.payload.length}`;
  }
  return `data seed=${frame.seed} session=${id} bytes=${frame.payload.length} flags=${frame.flags}`;
}

/**
 * crc.ts - CRC-32 and CRC-16 checksums.
 *
 * Every LightBeam frame carries a CRC-16 over its 11-byte header. Why bother,
 * when QR Codes already have Reed-Solomon error correction?
 *
 *   Because Reed-Solomon protects the *symbol*, not the *meaning*. A camera
 *   pointed at a screen regularly produces a symbol that decodes to a valid but
 *   WRONG payload (motion blur across the finder patterns, a menu bar overlaying
 *   the code, an overlapping window). Adding a 16-bit checksum over the header
 *   makes the probability of accepting such a frame roughly 1 in 65536 instead
 *   of "whenever the RS decoder guesses wrong", and it is 40 arithmetic
 *   operations - free at 15 frames per second.
 *
 * CRC-32 is used once per session, over the reassembled payload: a second,
 * independent check alongside SHA-256 (see crypto/integrity.ts). Everything that
 * has to survive inside a single QR symbol - the 11-byte frame header, each
 * manifest fragment, and the manifest fragments envelope - uses the cheaper
 * CRC-16, because those checks run per frame rather than per transfer.
 *
 * Both implementations use a lazily built 256-entry lookup table.
 */

/** Polynomial for CRC-32 (reflected, as used by zlib/PNG/Ethernet). */
const CRC32_POLY = 0xedb88320;

/** CRC-16/CCITT-FALSE: polynomial 0x1021, init 0xFFFF, no reflection. */
const CRC16_POLY = 0x1021;

let crc32Table: Int32Array | null = null;

function getCrc32Table(): Int32Array {
  if (crc32Table) return crc32Table;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ CRC32_POLY : c >>> 1;
    table[n] = c;
  }
  crc32Table = table;
  return table;
}

/**
 * CRC-32 (IEEE 802.3 / zlib). Returns a signed 32-bit int, as zlib does.
 *
 * `seed` makes the checksum resumable - `crc32(chunk2, crc32(chunk1)) ===
 * crc32(whole)` - which is the conventional signature for the algorithm. LightBeam
 * itself always calls it once over a complete buffer (see sender.ts, integrity.ts),
 * so every call site uses the default.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  const table = getCrc32Table();
  let crc = ~seed;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return ~crc | 0;
}

/** CRC-32 as an unsigned value (nicer for display and comparison). */
export function crc32u(bytes: Uint8Array, seed = 0): number {
  return crc32(bytes, seed) >>> 0;
}

/** CRC-16/CCITT-FALSE. Returns a 16-bit unsigned value. */
export function crc16(bytes: Uint8Array, seed = 0xffff): number {
  let crc = seed & 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC16_POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

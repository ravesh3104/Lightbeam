/**
 * bits.ts - MSB-first bit-level reader/writer.
 *
 * QR Code payloads are bit-oriented: mode indicator (4 bits), character count
 * indicator (8..16 bits), then 8-bit data codewords and a terminator that is
 * not necessarily byte aligned. A byte-oriented buffer is not enough, so this
 * module provides a growable bit writer (encoder side) and a bounds-checked bit
 * reader (decoder/diagnostic side).
 *
 * Convention: every multi-bit value is written MSB-first, exactly as required by
 * ISO/IEC 18004 section 7.4.
 */

/** Growable, MSB-first bit writer backed by a Uint8Array. */
export class BitWriter {
  private buf: Uint8Array;
  private bitLen = 0;

  constructor(capacityBytes = 256) {
    this.buf = new Uint8Array(Math.max(8, capacityBytes));
  }

  /** Number of bits written so far. */
  get length(): number {
    return this.bitLen;
  }

  /** Number of whole bytes (rounded up) written so far. */
  get byteLength(): number {
    return (this.bitLen + 7) >>> 3;
  }

  private ensure(extraBits: number): void {
    const needed = (this.bitLen + extraBits + 7) >>> 3;
    if (needed <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
  }

  /** Append a single bit (0 or 1). */
  writeBit(bit: number): void {
    this.ensure(1);
    if (bit) this.buf[this.bitLen >>> 3] |= 0x80 >>> (this.bitLen & 7);
    this.bitLen++;
  }

  /**
   * Append the low `bits` bits of `value`, MSB-first.
   * `bits` may be up to 32. Values wider than 32 bits must be split by callers.
   */
  write(value: number, bits: number): void {
    if (bits <= 0) return;
    if (bits > 32) throw new RangeError(`BitWriter.write supports at most 32 bits, got ${bits}`);
    for (let i = bits - 1; i >= 0; i--) this.writeBit((value >>> i) & 1);
  }

  /**
   * Append a value up to 53 bits wide (i.e. safe-integer range), MSB-first.
   * Used for payload lengths that can exceed 2^32 on very large text payloads.
   */
  writeWide(value: number, bits: number): void {
    if (bits <= 32) return this.write(value >>> 0, bits);
    const high = Math.floor(value / 0x1_0000_0000);
    const low = value % 0x1_0000_0000;
    this.write(high, bits - 32);
    this.write(low, 32);
  }

  /** Append every bit of a byte array. */
  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length * 8);
    for (let i = 0; i < bytes.length; i++) this.write(bytes[i], 8);
  }

  /** Pad with `bit` (0 or 1) until the length is a multiple of 8. */
  padToByte(bit = 0): void {
    while ((this.bitLen & 7) !== 0) this.writeBit(bit);
  }

  /** Pad with the ISO 18004 alternating bytes 0xEC / 0x11 up to `totalBits`. */
  padWithAlternatingBytes(totalBits: number): void {
    let toggle = true;
    while (this.bitLen < totalBits) {
      this.write(toggle ? 0xec : 0x11, 8);
      toggle = !toggle;
    }
  }

  /** Copy of the written bytes (last partial byte is zero-filled). */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.byteLength);
  }
}

/** Bounds-checked, MSB-first bit reader. */
export class BitReader {
  readonly bytes: Uint8Array;
  private bitPos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get position(): number {
    return this.bitPos;
  }

  get remaining(): number {
    return this.bytes.length * 8 - this.bitPos;
  }

  readBit(): number {
    if (this.bitPos >= this.bytes.length * 8) throw new RangeError('BitReader exhausted');
    const b = (this.bytes[this.bitPos >>> 3] >>> (7 - (this.bitPos & 7))) & 1;
    this.bitPos++;
    return b;
  }

  /** Read `bits` (<= 32) MSB-first; returns an unsigned integer. */
  read(bits: number): number {
    if (bits > 32) throw new RangeError('BitReader.read supports at most 32 bits');
    let out = 0;
    for (let i = 0; i < bits; i++) out = (out << 1) | this.readBit();
    return out >>> 0;
  }

  skip(bits: number): void {
    this.bitPos += bits;
    if (this.bitPos > this.bytes.length * 8) throw new RangeError('BitReader skipped past end');
  }
}

/**
 * Pack a bit array (one bit per entry, index 0 = MSB) into bytes.
 * Used by the framing decoder to rebuild a bit field, and by unit tests.
 */
export function packBits(bits: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array((bits.length + 7) >>> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >>> 3] |= 0x80 >>> (i & 7);
  return out;
}

/** Expand bytes into a 0/1 array (MSB first). Inverse of `packBits`. */
export function unpackBits(bytes: Uint8Array, bitLength = bytes.length * 8): Uint8Array {
  const out = new Uint8Array(bitLength);
  for (let i = 0; i < bitLength; i++) out[i] = (bytes[i >>> 3] >>> (7 - (i & 7))) & 1;
  return out;
}

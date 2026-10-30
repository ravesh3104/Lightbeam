/**
 * bytes.ts - small byte-level helpers used across the engine and the apps.
 * Everything here is allocation-explicit and avoids the platform-specific
 * buffer APIs (Buffer / Uint8Array.prototype.toBase64) so the same code runs in
 * Node, browsers, and Web Workers.
 */

/** Concatenate byte arrays (and ArrayBuffers/arrays) into one Uint8Array. */
export function concatBytes(...parts: Array<Uint8Array | ArrayBuffer | number[]>): Uint8Array {
  let total = 0;
  const normalised: Uint8Array[] = [];
  for (const part of parts) {
    const view = part instanceof Uint8Array ? part : part instanceof ArrayBuffer ? new Uint8Array(part) : Uint8Array.from(part);
    normalised.push(view);
    total += view.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const view of normalised) {
    out.set(view, offset);
    offset += view.length;
  }
  return out;
}

/** Constant-time-ish byte comparison (no early exit on the first mismatch). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >>> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new RangeError('Hex string must have an even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new RangeError(`Invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** URL-safe base64 without padding (for manifest fields and QR-embedded codes). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64URL_ALPHABET[b0 >>> 2];
    out += BASE64URL_ALPHABET[((b0 & 3) << 4) | (b1 >>> 4)];
    if (i + 1 < bytes.length) out += BASE64URL_ALPHABET[((b1 & 15) << 2) | (b2 >>> 6)];
    if (i + 2 < bytes.length) out += BASE64URL_ALPHABET[b2 & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of clean) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value < 0) throw new RangeError(`Invalid base64url character "${char}"`);
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[index++] = (bits >>> bitCount) & 0xff;
    }
  }
  return out.subarray(0, index);
}

/** UTF-8 encode with a TextEncoder fast path and a correct pure-JS fallback. */
export function utf8Encode(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/** UTF-8 decode with a TextDecoder fast path and a pure-JS fallback. */
export function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp =
        ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/** Human-readable byte size ("1.44 MB"). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/**
 * Make a file name safe to write to disk.
 *
 * The name arrives from the SENDING DEVICE, which means it is attacker-controlled
 * data from this app's point of view: a hostile sender can call its file
 * "../../../Documents/important" and, without this function, a receiver that
 * joins the name onto a directory path would happily write outside its own inbox.
 * (The manifest validator rejects control characters, but it must not be the only
 * line of defence in front of a filesystem call.)
 *
 * Rules, in order:
 *   1. Take only the last path segment, so any directory component is discarded.
 *   2. Strip anything that is a path separator or a control character.
 *   3. Remove leading dots, so the result is never "." / ".." / a hidden file.
 *   4. Collapse runs of whitespace and trim.
 *   5. Fall back to "received.bin" if nothing usable is left.
 *   6. Cap the length (most Android filesystems allow 255 bytes per component).
 */
export function sanitiseFileName(name: string, fallback = 'received.bin'): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? '';
  const cleaned = lastSegment
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Uniform random bytes using the platform CSPRNG. Throws if unavailable. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(out);
    return out;
  }
  throw new Error('No CSPRNG available: run on a platform with crypto.getRandomValues');
}

/** Random 32-bit unsigned integer. */
export function randomUint32(): number {
  const bytes = randomBytes(4);
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

/**
 * Random session id. Session ids appear on screen as a 6-character code, so we
 * use the full 32-bit space to keep collisions improbable even in a room full of
 * simultaneous transfers.
 */
export function randomSessionId(): number {
  return randomUint32();
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

/**
 * Human-readable session code.
 *
 * Seven characters, not six: a 6-character base-32 string can only express
 * 2^30 values, so it would silently drop the top two bits of a 32-bit id and
 * "type the code to check you are on the right sender" would then be checking
 * only 30 of 32 bits. Seven characters give 35 bits, which is lossless and still
 * fits comfortably under a QR code on a phone screen.
 */
export const SESSION_CODE_LENGTH = 7;

/** Render a session id as a 7-character, look-alike-free code. */
export function sessionCode(sessionId: number): string {
  let value = sessionId >>> 0;
  let out = '';
  for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
    out = CODE_ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/** Parse a session code back to an id. Returns null for anything malformed. */
export function sessionCodeToId(code: string): number | null {
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== SESSION_CODE_LENGTH) return null;
  let value = 0;
  for (const char of clean) {
    const index = CODE_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = value * 32 + index;
  }
  // Reject codes that would overflow 32 bits (they are not valid session ids).
  if (value > 0xffffffff) return null;
  return value >>> 0;
}

/**
 * manifest.ts - the session manifest and how it reaches the receiver.
 *
 * The manifest is the metadata a receiver needs before it can do anything useful
 * with data frames:
 *
 *   - session id and a human-readable name/type for the file,
 *   - the payload length, block size and block count (so it knows what K is),
 *   - the codec used (store/deflate) and whether the payload is encrypted,
 *   - the KDF salt/parameters and the AEAD nonce if it is,
 *   - the SHA-256 and CRC-32 of the transmitted payload (integrity),
 *   - the original byte length and name (so the receiver can restore them).
 *
 * It travels as one or more MANIFEST frames repeated throughout the stream, so a
 * receiver that starts watching in the middle of a transfer is up to speed within
 * one repeat interval (about 2 seconds) instead of being permanently lost.
 *
 * IT IS NOT AUTHENTICATED BY ITSELF. An attacker who can replace the manifest
 * (e.g. by holding up their own screen) can substitute their own file. When
 * encryption is enabled the AEAD's associated data binds the manifest to the
 * ciphertext, so the real defence is: verify the passphrase fingerprint out of
 * band (the UI shows a 4+4 hex fingerprint on both screens), and for unencrypted
 * transfers, trust the physical proximity that made the transfer possible at all.
 */

import { crc16 } from '../crypto/crc.js';
import { utf8Decode, utf8Encode, fromBase64Url, toBase64Url, fromHex, toHex } from '../util/bytes.js';
import { FRAME_HEADER_BYTES, FrameType } from './frame.js';
import type { Codec } from '../transfer/compress.js';

export const MANIFEST_VERSION = 1;

export interface Manifest {
  /** Manifest schema version (for forward/backward compatibility). */
  v: number;
  /** Session id, must match the frame headers. */
  sid: number;
  /** Display name of the payload ("holiday.mp4", "clipboard.txt"). */
  name: string;
  /** MIME type, best effort. */
  mime: string;
  /** Length of the transmitted payload in bytes (after compress/encrypt). */
  len: number;
  /** Length of the original payload before compression/encryption. */
  olen: number;
  /** Bytes per LT block. */
  bs: number;
  /** Number of LT blocks (K). */
  k: number;
  /** Compression codec. */
  codec: Codec;
  /** 'none' or the AEAD algorithm identifier. */
  enc: 'none' | 'xchacha20poly1305';
  /** KDF salt (base64url) when encrypted. */
  salt?: string;
  /** KDF parameters when encrypted. */
  kdf?: { N: number; r: number; p: number };
  /** AEAD nonce (base64url) when encrypted. */
  nonce?: string;
  /** SHA-256 of the transmitted payload, hex. */
  sha: string;
  /** CRC-32 of the transmitted payload (fast partial-progress check). */
  crc: number;
  /** Wall-clock creation time (epoch ms) - for ordering and display only. */
  t: number;
  /** Free-form sender hints ("compressed 78%", "8 mm left"). */
  note?: string;
}

export interface ManifestOptions {
  sessionId: number;
  name: string;
  mime: string;
  payloadLength: number;
  originalLength: number;
  blockSize: number;
  k: number;
  codec: Codec;
  encryption:
    | { mode: 'none' }
    | { mode: 'xchacha20poly1305'; salt: Uint8Array; nonce: Uint8Array; kdf: { N: number; r: number; p: number } };
  sha256Hex: string;
  crc32: number;
  note?: string;
  now?: number;
}

/** Build a manifest object from sender-side facts. */
export function buildManifest(options: ManifestOptions): Manifest {
  const manifest: Manifest = {
    v: MANIFEST_VERSION,
    sid: options.sessionId,
    name: options.name,
    mime: options.mime,
    len: options.payloadLength,
    olen: options.originalLength,
    bs: options.blockSize,
    k: options.k,
    codec: options.codec,
    enc: options.encryption.mode,
    sha: options.sha256Hex,
    crc: options.crc32,
    t: options.now ?? Date.now(),
  };
  if (options.encryption.mode === 'xchacha20poly1305') {
    manifest.salt = toBase64Url(options.encryption.salt);
    manifest.nonce = toBase64Url(options.encryption.nonce);
    manifest.kdf = options.encryption.kdf;
  }
  if (options.note) manifest.note = options.note;
  return manifest;
}

/** Serialise a manifest to the compact JSON that goes on the wire. */
export function serializeManifest(manifest: Manifest): Uint8Array {
  return utf8Encode(JSON.stringify(manifest));
}

export function deserializeManifest(bytes: Uint8Array): Manifest {
  const text = utf8Decode(bytes);
  const parsed = JSON.parse(text) as Manifest;
  return validateManifest(parsed);
}

/**
 * Validate a decoded manifest.
 *
 * Every field is checked here rather than at the point of use, because the
 * manifest arrives in fragments from an untrusted optical channel: a truncated or
 * garbage fragment must fail loudly here instead of producing, say, a K of 4
 * million that makes the receiver allocate gigabytes.
 */
export function validateManifest(manifest: Manifest): Manifest {
  const require = (condition: boolean, message: string): void => {
    if (!condition) throw new RangeError(`Invalid manifest: ${message}`);
  };
  require(typeof manifest === 'object' && manifest !== null, 'not an object');
  require(manifest.v === MANIFEST_VERSION, `unsupported version ${manifest.v}`);
  require(Number.isInteger(manifest.sid), 'session id missing');
  require(typeof manifest.name === 'string' && manifest.name.length > 0, 'name missing');
  require(Number.isInteger(manifest.len) && manifest.len >= 0, 'length missing');
  require(Number.isInteger(manifest.bs) && manifest.bs > 0 && manifest.bs <= 1 << 20, 'block size out of range');
  require(Number.isInteger(manifest.k) && manifest.k > 0 && manifest.k <= 1_000_000, 'block count out of range');
  require(manifest.codec === 'store' || manifest.codec === 'deflate', 'unknown codec');
  require(manifest.enc === 'none' || manifest.enc === 'xchacha20poly1305', 'unknown encryption');
  require(/^[0-9a-f]{64}$/i.test(manifest.sha ?? ''), 'bad payload checksum');
  require(Number.isInteger(manifest.olen) && manifest.olen >= 0, 'original length missing');
  if (manifest.enc === 'xchacha20poly1305') {
    require(typeof manifest.salt === 'string' && manifest.salt.length >= 16, 'salt missing');
    require(typeof manifest.nonce === 'string' && manifest.nonce.length >= 16, 'nonce missing');
    require(manifest.kdf !== undefined && Number.isInteger(manifest.kdf.N), 'kdf parameters missing');
  }
  return manifest;
}

/** Associated data for the AEAD: the manifest's own identity fields. */
/**
 * The fields the AEAD authenticates.
 *
 * A structural subset of Manifest, so callers can pass either a real manifest or
 * the handful of fields they already know. That flexibility exists because of the
 * order of operations on the sending side:
 *
 *   the associated data must be fixed BEFORE encryption, but the SHA-256 in the
 *   manifest is computed OVER the ciphertext. So `sha` cannot be authenticated by
 *   the AEAD - it is the integrity check that comes after decryption, and it covers
 *   the whole payload anyway.
 *
 * `sha` is therefore deliberately absent here, and this is the ONE function that
 * builds associated data. There used to be three copies (here, in sender.ts and in
 * receiver.ts) and the exported one included `sha` while the other two did not -
 * meaning a third-party receiver built against the exported helper would have
 * produced undecryptable transfers. Nothing would have caught that until somebody
 * tried to interoperate.
 */
export interface AssociatedDataFields {
  sid: number;
  name: string;
  mime: string;
  len: number;
  olen: number;
  bs: number;
  k: number;
  codec: Codec;
  enc: 'none' | 'xchacha20poly1305';
}

export function manifestAssociatedData(manifest: AssociatedDataFields): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      sid: manifest.sid,
      name: manifest.name,
      mime: manifest.mime,
      len: manifest.len,
      olen: manifest.olen,
      bs: manifest.bs,
      k: manifest.k,
      codec: manifest.codec,
      enc: manifest.enc,
      // NB no `sha`: see the note on AssociatedDataFields above - it is computed
      // over the ciphertext and therefore cannot be part of the associated data.
    }),
  );
}

/**
 * Split a serialised manifest into fragments that each fit one frame.
 *
 * Each fragment carries a 2-byte index and a 2-byte checksum of its own so that a
 * receiver can tell "I got fragment 2, but garbled" from "I have not seen
 * fragment 2 yet" - without that, one corrupt fragment would stall the receiver
 * forever on a stream that is otherwise perfect.
 *
 * Fragment header (4 bytes): [index:1 or 2][count:1 or 2][crc16:2]
 * We use 2 bytes for index and count to allow manifests larger than 255
 * fragments (a very long filename plus a note), and keep the total overhead at
 * 4 bytes x fragment count.
 */
/**
 * Overhead kept in every fragment: 2 bytes index, 2 bytes count, 2 bytes CRC-16.
 * The CRC is what lets a receiver distinguish "this fragment arrived garbled"
 * from "this fragment has not arrived yet" - without it, a single corrupt
 * fragment would stall an otherwise perfect transfer forever.
 */
export const FRAGMENT_HEADER_BYTES = 6;

export interface ManifestFragments {
  fragments: Uint8Array[];
  /** CRC-16 of the whole serialised manifest (diagnostics). */
  crc: number;
  count: number;
}

export function splitManifest(serialized: Uint8Array, fragmentPayloadBytes: number): ManifestFragments {
  if (fragmentPayloadBytes <= FRAGMENT_HEADER_BYTES) {
    throw new RangeError('Fragment size must exceed the fragment header');
  }
  const chunkBytes = fragmentPayloadBytes - FRAGMENT_HEADER_BYTES;
  const count = Math.max(1, Math.ceil(serialized.length / chunkBytes));
  if (count > 0xffff) {
    throw new RangeError('Manifest too large to fragment (more than 65535 fragments needed)');
  }
  const fragments: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const start = index * chunkBytes;
    const body = serialized.subarray(start, Math.min(serialized.length, start + chunkBytes));
    const checksum = crc16(body);
    const fragment = new Uint8Array(FRAGMENT_HEADER_BYTES + body.length);
    fragment[0] = (index >>> 8) & 0xff;
    fragment[1] = index & 0xff;
    fragment[2] = (count >>> 8) & 0xff;
    fragment[3] = count & 0xff;
    fragment[4] = (checksum >>> 8) & 0xff;
    fragment[5] = checksum & 0xff;
    fragment.set(body, FRAGMENT_HEADER_BYTES);
    fragments.push(fragment);
  }
  return { fragments, crc: crc16(serialized), count };
}

/** Reassembles manifest fragments arriving out of order and with duplicates. */
export class ManifestAssembler {
  private parts: Array<Uint8Array | null> = [];
  private expected = -1;
  private received = 0;

  /** Feed one manifest frame payload. Returns the manifest once complete. */
  accept(fragment: Uint8Array): Manifest | null {
    if (fragment.length < FRAGMENT_HEADER_BYTES) return null;
    const index = (fragment[0] << 8) | fragment[1];
    const count = (fragment[2] << 8) | fragment[3];
    const checksum = (fragment[4] << 8) | fragment[5];
    if (count === 0 || count > 0xffff || index >= count) return null;
    const body = fragment.subarray(FRAGMENT_HEADER_BYTES);
    if (crc16(body) !== checksum) return null; // a garbled fragment is not a missing one

    if (this.expected === -1) {
      this.expected = count;
      this.parts = new Array(count).fill(null);
    } else if (this.expected !== count) {
      // A different manifest layout: start over with the new one.
      this.expected = count;
      this.parts = new Array(count).fill(null);
      this.received = 0;
    }

    if (this.parts[index] === null) {
      this.parts[index] = body;
      this.received++;
    }
    if (this.received < this.expected) return null;

    // Reassemble, preserving order.
    let total = 0;
    for (const part of this.parts) total += part ? part.length : 0;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      if (!part) return null;
      merged.set(part, offset);
      offset += part.length;
    }
    this.reset();
    return deserializeManifest(merged);
  }

  get progress(): number {
    if (this.expected <= 0) return 0;
    return this.received / this.expected;
  }

  get complete(): boolean {
    return this.expected > 0 && this.received >= this.expected;
  }

  reset(): void {
    this.parts = [];
    this.expected = -1;
    this.received = 0;
  }
}

/**
 * Number of manifest frames that fit in one data frame's payload, given the
 * session's frame capacity. Manifests are placed in `FrameType.Manifest` frames,
 * whose payload budget is the same as a data frame's, so the caller passes the
 * frame payload size.
 */
export function manifestFragmentSize(framePayloadBytes: number): number {
  return framePayloadBytes;
}

/** Extract AEAD parameters from a validated manifest. */
export function manifestEncryptionParams(manifest: Manifest): {
  salt: Uint8Array;
  nonce: Uint8Array;
  kdf: { N: number; r: number; p: number };
} | null {
  if (manifest.enc !== 'xchacha20poly1305' || !manifest.salt || !manifest.nonce || !manifest.kdf) return null;
  return { salt: fromBase64Url(manifest.salt), nonce: fromBase64Url(manifest.nonce), kdf: manifest.kdf };
}

/** Short display form of a manifest, used by the UI and logs. */
export function describeManifest(manifest: Manifest): string {
  const flags: string[] = [manifest.codec === 'deflate' ? 'deflate' : 'raw'];
  if (manifest.enc !== 'none') flags.push('encrypted');
  return `${manifest.name} (${manifest.len} B, ${manifest.k} blocks x ${manifest.bs} B, ${flags.join(', ')}) sha=${manifest.sha.slice(0, 12)}...`;
}

// Re-exported so callers do not need to import from two modules.
export { FRAME_HEADER_BYTES, FrameType, toBase64Url, fromBase64Url, fromHex, toHex };

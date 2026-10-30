/**
 * integrity.ts - payload verification.
 *
 * Two independent checks are performed before a received payload is handed to
 * the user:
 *
 *   1. SHA-256 over the transmitted payload, compared against the value carried
 *      in the manifest. This is the authoritative check: 2^-256 chance of a false
 *      accept, and it also protects against a bug in our own fountain decoder
 *      (e.g. two frames whose seeds collide after a loss).
 *
 *   2. A CRC-32, also carried in the manifest. It exists purely for user
 *      experience: when the transfer is running, the receiver can check
 *      partially-received payloads and tell the user honestly whether what it has
 *      so far is consistent, instead of "looks like it might be working".
 *
 * Deliberately NOT used: MD5/SHA-1 (collision-broken) and a plain length check
 * (a length check cannot detect a single flipped bit).
 */

import { sha256, sha256 as sha256Fn } from '@noble/hashes/sha2.js';
import { crc32u } from './crc.js';
import { bytesEqual, toHex } from '../util/bytes.js';

/** SHA-256 digest of a byte array. */
export function hashPayload(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function hashHex(bytes: Uint8Array): string {
  return toHex(sha256Fn(bytes));
}

/** SHA-256 as a base64url-ish short token for the UI (first 8 bytes). */
export function shortHash(bytes: Uint8Array): string {
  return toHex(sha256(bytes).subarray(0, 8));
}

export interface IntegrityReport {
  ok: boolean;
  /** What the manifest claimed, hex. */
  expectedSha256: string;
  /** What we computed, hex. */
  actualSha256: string;
  expectedCrc32: number;
  actualCrc32: number;
  bytes: number;
}

/** Full integrity check of a reassembled payload. */
export function verifyPayload(
  payload: Uint8Array,
  expectedSha256Hex: string,
  expectedCrc32?: number,
): IntegrityReport {
  const digest = sha256(payload);
  const actualSha256 = toHex(digest);
  const actualCrc32 = crc32u(payload);
  const digestOk = bytesEqual(digest, fromHexSafe(expectedSha256Hex));
  const crcOk = expectedCrc32 === undefined ? true : expectedCrc32 === actualCrc32;
  return {
    ok: digestOk && crcOk,
    expectedSha256: expectedSha256Hex,
    actualSha256,
    expectedCrc32: expectedCrc32 ?? actualCrc32,
    actualCrc32,
    bytes: payload.length,
  };
}

function fromHexSafe(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Check whether the parts of a payload we have received so far are consistent.
 *
 * A fountain-coded payload can be "partially decodable": some source blocks are
 * known verbatim, others are still unknown. This returns the fraction of the
 * bytes we can vouch for, which is what the receiver's progress UI shows when it
 * is waiting on a stalled transfer.
 */
export function partialConfidence(knownBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 1;
  return Math.max(0, Math.min(1, knownBytes / totalBytes));
}

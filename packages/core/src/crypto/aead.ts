/**
 * aead.ts - optional end-to-end encryption for LightBeam transfers.
 *
 * THREAT MODEL (this is the important part)
 * -----------------------------------------
 * A LightBeam transfer is visible to *any* camera that can see the screen, and
 * the sender cannot detect that camera. Without encryption:
 *   - a bystander's phone can record your file,
 *   - a screen recording of the sender captures the whole transfer.
 * Note that the *network isolation* is real (there is no path between the
 * devices) but it provides no confidentiality at all.
 *
 * So encryption is offered, with a deliberate design choice:
 *
 *   The key is NOT in the QR stream. The receiver must be given the passphrase
 *   out of band (typed, spoken, or sent over a messenger). Embedding the key in
 *   the manifest - which is displayed on the same screen as the data - would
 *   look reassuring and provide no protection whatsoever.
 *
 * CONSTRUCTION
 * ------------
 *   passphrase --scrypt--> 32-byte key
 *   key + 24-byte random nonce --XChaCha20-Poly1305--> AEAD over the whole payload
 *
 * Why these primitives:
 *   - XChaCha20-Poly1305 (`@noble/ciphers`): 192-bit nonce, so a random nonce per
 *     transfer has negligible collision probability with no counter state; no
 *     AES-NI/timing-attack concerns; pure JS, so identical behaviour across Chromium,
 *     V8 and Node.
 *   - scrypt (`@noble/hashes`): memory-hard, unlike PBKDF2. N = 2^15, r = 8,
 *     p = 1 costs about 32 MB and ~300 ms on a mid-range phone - enough to make
 *     offline guessing of a 6+ word passphrase expensive while staying usable.
 *   - AEAD over the whole payload (not per-block): the fountain layer reorders
 *     and drops blocks, so per-block AEAD would turn every lost frame into a
 *     decryption failure and - worse - a nonce-reuse hazard. One ciphertext, one
 *     nonce, one tag is both simpler and safer.
 *
 * The AEAD covers the manifest as associated data, so tampering with the
 * filename, the sizes or the codec fields invalidates the transfer.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, fromHex, toHex } from '../util/bytes.js';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SALT_BYTES = 16;
export const TAG_BYTES = 16;

/** scrypt cost parameters. Documented in the manifest so old receivers still work. */
export interface KdfParams {
  /** CPU/memory cost: 2^15 = 32768. */
  N: number;
  /** Block size: 8. */
  r: number;
  /** Parallelism: 1. */
  p: number;
}

/** Default parameters: ~32 MB and ~0.3 s on a 2023-era mid-range phone. */
export const DEFAULT_KDF: KdfParams = { N: 1 << 15, r: 8, p: 1 };

/**
 * Lower-cost parameters for constrained devices (older phones, smart TVs).
 * Selecting these is a deliberate, visible downgrade: the UI says
 * "reduced-strength key derivation" rather than silently weakening the file.
 */
export const FAST_KDF: KdfParams = { N: 1 << 12, r: 8, p: 1 };

/** Derive the 32-byte key from a passphrase and salt. */
export function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Uint8Array {
  if (passphrase.length === 0) throw new RangeError('Passphrase must not be empty');
  if (salt.length !== SALT_BYTES) throw new RangeError(`Salt must be ${SALT_BYTES} bytes`);
  return scrypt(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: KEY_BYTES,
  });
}

export interface EncryptedPayload {
  /** Ciphertext followed by the 16-byte Poly1305 tag. */
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  salt: Uint8Array;
  params: KdfParams;
  /** SHA-256 of the ciphertext (what the transfer integrity check covers). */
  checksum: Uint8Array;
}

/**
 * Encrypt a payload with a passphrase.
 *
 * @param payload        plaintext (already compressed if the caller wants)
 * @param passphrase     user-supplied secret, transferred out of band
 * @param associatedData extra data bound to the ciphertext (the manifest)
 */
export function encryptPayload(
  payload: Uint8Array,
  passphrase: string,
  associatedData: Uint8Array = new Uint8Array(0),
  salt?: Uint8Array,
  nonce?: Uint8Array,
  params: KdfParams = DEFAULT_KDF,
): EncryptedPayload {
  const saltBytes = salt ?? randomBytes(SALT_BYTES);
  const nonceBytes = nonce ?? randomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, saltBytes, params);
  const cipher = xchacha20poly1305(key, nonceBytes, associatedData);
  const sealed = cipher.encrypt(payload);
  return {
    ciphertext: sealed,
    nonce: nonceBytes,
    salt: saltBytes,
    params,
    checksum: sha256(sealed),
  };
}

/**
 * Decrypt a payload. Throws if the passphrase is wrong or the ciphertext or
 * associated data was modified - the Poly1305 tag makes this a hard failure,
 * which is exactly what we want: the UI can say "wrong passphrase" with
 * certainty instead of showing the user garbage bytes.
 */
export function decryptPayload(
  ciphertext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  associatedData: Uint8Array = new Uint8Array(0),
  params: KdfParams = DEFAULT_KDF,
): Uint8Array {
  const key = deriveKey(passphrase, salt, params);
  const cipher = xchacha20poly1305(key, nonce, associatedData);
  return cipher.decrypt(ciphertext);
}

/**
 * Short, human-comparable fingerprint of a passphrase + salt.
 *
 * Purpose: let two people verify out of band that they typed the same secret
 * ("the sender's screen says 4F2A-91C7; your phone says 4F2A-91C7") before a
 * multi-minute optical transfer starts. This is the same idea as the safety
 * numbers in Signal, reduced to what fits on a screen next to a QR code.
 */
export function passphraseFingerprint(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): string {
  const key = deriveKey(passphrase, salt, params);
  const digest = sha256(concatBytes(new TextEncoder().encode('lightbeam-fingerprint'), salt, key));
  return toHex(digest.subarray(0, 4)).toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');
}

/** Parse a hex fingerprint back to bytes (used by tests). */
export function parseFingerprint(text: string): Uint8Array {
  return fromHex(text.replace(/[^0-9a-fA-F]/g, ''));
}

// Local CSPRNG helper (kept here so crypto/ has no dependency on util/bytes'
// randomBytes signature changes).
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('Encryption requires a platform CSPRNG (crypto.getRandomValues)');
  }
  cryptoObj.getRandomValues(out);
  return out;
}

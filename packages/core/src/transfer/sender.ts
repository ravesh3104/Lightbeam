/**
 * sender.ts - the sending side of a LightBeam transfer.
 *
 * The sender is a *pure frame producer*: it owns the payload, the manifest, the
 * fountain encoder and the display schedule, and it hands out one QR symbol at a
 * time. It deliberately does not know about canvases, cameras, timers or React -
 * the browser UI and synthetic loopback harnesses drive it with their own frame loops, and
 * so can the test suite and the CLI.
 *
 * DISPLAY SCHEDULE
 * ----------------
 * Slot t of what appears on screen is:
 *
 *     t in [0, M)                      manifest fragment t                (M = fragment count)
 *     t >= M, (t - M) mod 24 == 0      manifest fragment ((t - M) / 24) mod M
 *     t >= M, (t - M) mod 24 != 0      data frame number (t - M - floor((t - M) / 24))
 *
 * In words: the metadata is sent M times up front, and thereafter one manifest
 * fragment is slipped in every 24th frame. A receiver that starts in the middle -
 * which is the normal case, because people point a camera at a screen whenever
 * they happen to - therefore has the full metadata within about a second, instead
 * of never.
 *
 * Data frames alternate: the first K frames are the *systematic* prefix (one
 * source block each), then the LT stream runs forever. If the operator sees that
 * the receiver is struggling (the sender has no back channel, so this is a human
 * decision), `restartSystematic()` replays the prefix - useful when the beginning
 * of the transfer was missed entirely.
 */

import { LTEncoder, deriveMaskBlock, expectedFramesFor } from '../fountain/lt.js';
import { buildDegreeDistribution, type DegreeOptions } from '../fountain/degree.js';
import { dataFrameHeader, manifestFrameHeader, FrameFlag, FRAME_HEADER_BYTES } from '../protocol/frame.js';
import {
  buildManifest,
  manifestAssociatedData,
  serializeManifest,
  splitManifest,
  type Manifest,
  type ManifestFragments,
} from '../protocol/manifest.js';
import { planSession, wireFlags, type DensityProfile, type SessionPlan } from '../protocol/planner.js';
import { compressPayload, looksCompressible, type Codec } from './compress.js';
import { hashHex } from '../crypto/integrity.js';
import { crc32u } from '../crypto/crc.js';
import { encryptPayload, DEFAULT_KDF, type KdfParams } from '../crypto/aead.js';
import { concatBytes, randomBytes, randomSessionId, sessionCode, utf8Encode } from '../util/bytes.js';
import { base32Encode } from '../util/base32.js';
import { encodeBinary, encodeText, SymbolCache, type EncodedSymbol, type EncodeOptions } from '../qr/encoder.js';

/** How often a manifest fragment is repeated in the data stream. */
export const MANIFEST_REPEAT = 24;

export interface SenderOptions {
  /** Payload bytes (the file or the UTF-8 text). */
  data: Uint8Array;
  /** Display name, e.g. "notes.txt". */
  name: string;
  /** MIME type, best effort. */
  mime?: string;
  /** Session id; random when omitted. */
  sessionId?: number;
  /** Density profile (or its id). */
  profile?: DensityProfile | DensityProfile['id'];
  /** Force an EC level for the QR symbols. */
  ecLevel?: EncodeOptions['ecLevel'];
  /** Compress with deflate when it helps (default true). */
  compress?: boolean;
  /** Encrypt with a passphrase (default: no encryption). */
  passphrase?: string;
  /** KDF parameters for encryption. */
  kdf?: KdfParams;
  /** Degree distribution tuning for the fountain code. */
  degree?: DegreeOptions;
  /**
   * How the frame is written onto the wire.
   *
   * 'base32' (default) survives every platform barcode decoder, because those
   * return a STRING and base32 is pure ASCII - see util/base32.ts.
   *
   * 'raw' puts the frame bytes directly into the symbol and is about 10% faster,
   * but only a decoder that hands back real bytes can read it (jsQR in a browser).
   * Use it deliberately for browser-to-browser transfers; a native receiver will
   * silently fail to parse the frames.
   */
  wireEncoding?: 'base32' | 'raw';
  /** Extra note shown to the receiver. */
  note?: string;
}

export interface SenderStats {
  framesShown: number;
  /** Frames shown with a data payload (excludes manifest/interleave frames). */
  dataFramesShown: number;
  manifestFramesShown: number;
  /** Highest LT seed emitted so far. */
  lastSeed: number;
  /** Expected frames for a clean decode, from the fountain model. */
  expectedFrames: number;
  elapsedMs: number;
  fps: number;
}

/**
 * A prepared transfer: everything needed to start showing frames.
 *
 * Built by `prepareTransfer` (which is async only because key derivation is).
 */
export interface PreparedTransfer {
  sessionId: number;
  /** Human-readable 6-character session code shown under the QR code. */
  code: string;
  manifest: Manifest;
  fragments: ManifestFragments;
  plan: SessionPlan;
  /** The payload actually transmitted (compressed/encrypted as configured). */
  wirePayload: Uint8Array;
  /** The original payload, kept for the "original size" display. */
  originalPayload: Uint8Array;
  flags: number;
  compression: { codec: Codec; saved: number; ratio: number };
  encryption: 'none' | 'xchacha20poly1305';
  /** Convenience: passphrase fingerprint is computed by the caller (crypto/aead). */
}

/** Everything the sender needs to build frames: computed once, reused thousands of times. */
export class TransferSender {
  readonly sessionId: number;
  readonly code: string;
  readonly manifest: Manifest;
  readonly fragments: ManifestFragments;
  readonly plan: SessionPlan;
  readonly flags: number;

  private readonly encoder: LTEncoder;
  private readonly symbolCache = new SymbolCache(16);
  private readonly dataFrameOptions: EncodeOptions;
  private manifestFrameOptions: EncodeOptions;
  private framesShown = 0;
  private dataFramesShown = 0;
  private manifestFramesShown = 0;
  private lastSeed = -1;
  private startedAt = 0;
  private systematicRestartSeed = -1;

  /** Mask enforced after the first frame, so geometry never changes mid-stream. */
  private lockedOptions: EncodeOptions = {};

  constructor(
    private readonly prepared: PreparedTransfer,
    options: { degree?: DegreeOptions } = {},
  ) {
    this.sessionId = prepared.sessionId;
    this.code = prepared.code;
    this.manifest = prepared.manifest;
    this.fragments = prepared.fragments;
    this.plan = prepared.plan;
    this.flags = prepared.flags;

    const blockSize = prepared.manifest.bs;
    const k = prepared.manifest.k;
    this.encoder = new LTEncoder(prepared.wirePayload, {
      k,
      blockSize,
      sessionId: prepared.sessionId,
      degree: options.degree,
      payloadLength: prepared.wirePayload.length,
    });

    const geometry: EncodeOptions = {
      ecLevel: prepared.plan.ecLevel,
      minVersion: prepared.plan.version,
      maxVersion: prepared.plan.version,
      boostEcLevel: true,
    };
    this.dataFrameOptions = geometry;
    this.manifestFrameOptions = geometry;
    // Warm the symbol cache with the first data frame: its geometry (mask,
    // version, EC level) is then reused for every subsequent frame.
    const firstSymbol = this.encodeFrameBytes(
      dataFrameHeader({ sessionId: this.sessionId, seed: 0, flags: this.flags }),
      this.encoder.encode(0),
    );
    this.lockedOptions = { ...geometry, mask: firstSymbol.mask };
    this.manifestFrameOptions = this.lockedOptions;
    this.dataFrameOptions.mask = firstSymbol.mask;
    this.symbolCache.get('warmup', () => firstSymbol);
  }

  get blockSize(): number {
    return this.manifest.bs;
  }

  get k(): number {
    return this.manifest.k;
  }

  /** Bytes carried per data frame (the LT block size). */
  get bytesPerFrame(): number {
    return this.manifest.bs;
  }

  get payloadLength(): number {
    return this.prepared.wirePayload.length;
  }

  /** Total data frames a clean receiver needs (K + fountain overhead). */
  get expectedFrames(): number {
    return expectedFramesFor(this.k);
  }

  /** Deterministic description of what to display at slot `t`. */
  scheduleAt(t: number): { kind: 'manifest'; fragmentIndex: number } | { kind: 'data'; seed: number } {
    const m = this.fragments.fragments.length;
    if (t < m) return { kind: 'manifest', fragmentIndex: t };
    const u = t - m;
    const period = MANIFEST_REPEAT;
    const block = Math.floor(u / period);
    const offset = u % period;
    if (offset === 0) return { kind: 'manifest', fragmentIndex: block % m };
    // Data slot index across the whole stream:
    const dataIndex = block * (period - 1) + (offset - 1);
    return { kind: 'data', seed: this.seedForDataIndex(dataIndex) };
  }

  /**
   * Map a data-slot index to an LT seed.
   *
   * Normally seed === dataIndex (systematic prefix first, then the fountain
   * stream). After a systematic restart, seeds are offset so the prefix is
   * replayed once and the stream continues with fresh seeds that the receiver has
   * not already seen - re-sending old seeds would be pure waste.
   */
  private seedForDataIndex(dataIndex: number): number {
    if (this.systematicRestartSeed < 0) return dataIndex;
    if (dataIndex < this.k) return dataIndex; // replay the systematic prefix
    return this.systematicRestartSeed + (dataIndex - this.k);
  }

  /**
   * Produce the QR symbol for display slot `t`.
   *
   * Hot path: called once per displayed frame (10-20 times per second). The
   * manifest frames are memoised via SymbolCache because they repeat verbatim for
   * the whole session; data frames are encoded fresh but with the geometry locked
   * (fixed version, EC level and mask) so there is no mask search per frame.
   */
  symbolAt(t: number): EncodedSymbol {
    const slot = this.scheduleAt(t);
    if (slot.kind === 'manifest') {
      const fragment = this.fragments.fragments[slot.fragmentIndex];
      const header = manifestFrameHeader({
        sessionId: this.sessionId,
        fragmentIndex: slot.fragmentIndex,
        fragmentCount: this.fragments.fragments.length,
        flags: this.flags,
      });
      // Manifest frames repeat verbatim for the whole session, so memoise them.
      const key = `m:${slot.fragmentIndex}:${this.plan.wireEncoding}:${fragment.length}`;
      return this.symbolCache.get(key, () => this.encodeFrameBytes(header, fragment));
    }

    const block = this.encoder.encode(slot.seed);
    this.lastSeed = Math.max(this.lastSeed, slot.seed);
    return this.encodeFrameBytes(
      dataFrameHeader({ sessionId: this.sessionId, seed: slot.seed, flags: this.flags }),
      block,
    );
  }

  /**
   * Turn "13 header bytes + payload" into a QR symbol.
   *
   * base32 mode (the default) encodes the ENTIRE frame - header included - as
   * base32 text, so the symbol's content is pure ASCII.
   *
   * Encoding only the payload would not be enough: the header contains the session
   * id, the seed and the CRC, all of which have bytes above 0x7F. A native camera
   * API returns a decoded *string*, so those bytes come back replaced and the
   * header is destroyed before it can even be validated. (A test that fed jsQR's
   * text output into the receiver is what surfaced this.)
   *
   * Because the alphabet is exactly QR's alphanumeric set, the segmenter puts the
   * whole thing in alphanumeric mode: 5.5 bits per character instead of 8.
   */
  private encodeFrameBytes(header: Uint8Array, payload: Uint8Array | string): EncodedSymbol {
    if (this.plan.wireEncoding === 'base32') {
      const body = typeof payload === 'string' ? utf8Encode(payload) : payload;
      const text = base32Encode(concatBytes(header, body));
      return encodeText(text, this.dataFrameOptions);
    }
    const bytes = concatBytes(header, typeof payload === 'string' ? utf8Encode(payload) : payload);
    return encodeBinary(bytes, this.dataFrameOptions);
  }

  /** Record that slot `t` was actually displayed (drives the UI's stats). */
  markShown(t: number): void {
    if (this.startedAt === 0) this.startedAt = Date.now();
    this.framesShown++;
    const slot = this.scheduleAt(t);
    if (slot.kind === 'manifest') this.manifestFramesShown++;
    else this.dataFramesShown++;
  }

  /**
   * Replay the systematic prefix. Call this when the receiver clearly missed the
   * beginning of the transfer (its progress bar is stuck low while the camera is
   * clearly locked on).
   */
  restartSystematic(): void {
    // Jump ahead of every seed already emitted so no frame is repeated.
    this.systematicRestartSeed = Math.max(this.lastSeed + 1, this.k + 1);
  }

  get isSystematicRestarted(): boolean {
    return this.systematicRestartSeed >= 0;
  }

  getStats(): SenderStats {
    const elapsedMs = this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
    return {
      framesShown: this.framesShown,
      dataFramesShown: this.dataFramesShown,
      manifestFramesShown: this.manifestFramesShown,
      lastSeed: this.lastSeed,
      expectedFrames: this.expectedFrames,
      elapsedMs,
      fps: elapsedMs > 0 ? (this.framesShown / elapsedMs) * 1000 : 0,
    };
  }

  /** The plain-text payload (used to show text transfers in a copy box). */
  get textPayload(): string | null {
    if (!this.manifest.mime.startsWith('text/')) return null;
    try {
      return new TextDecoder().decode(this.prepared.originalPayload);
    } catch {
      return null;
    }
  }
}

/**
 * Prepare a transfer: compress, hash, optionally encrypt, then plan the session.
 *
 * Order matters and is visible in the manifest:
 *   original --deflate--> codec payload --AEAD--> wire payload
 * The SHA-256 and CRC-32 in the manifest describe the *wire* payload, so a
 * receiver can verify integrity before spending CPU on key derivation or
 * decompression.
 */
export async function prepareTransfer(options: SenderOptions): Promise<PreparedTransfer> {
  const original = options.data;
  if (original.length === 0) throw new RangeError('Nothing to send: the payload is empty');

  // 1. Compression -----------------------------------------------------------
  const compressEnabled = options.compress ?? true;
  const compression = compressEnabled ? compressPayload(original) : { codec: 'store' as Codec, bytes: original, saved: 0, ratio: 1 };
  let codec: Codec = compression.codec;
  let staged = compression.bytes;

  // 2. Encryption ------------------------------------------------------------
  const passphrase = options.passphrase?.trim();
  const encryptionMode: 'none' | 'xchacha20poly1305' = passphrase ? 'xchacha20poly1305' : 'none';
  let salt: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  const kdf = options.kdf ?? DEFAULT_KDF;

  // The manifest itself is the AEAD associated data, so we must know the final
  // manifest fields BEFORE encrypting. The chicken-and-egg is resolved by
  // building the manifest with a placeholder checksum, using it as associated
  // data, then re-deriving the manifest with the real checksum - the fields that
  // matter (name, lengths, codec) are already final at that point.
  const sessionId = options.sessionId ?? randomSessionId();
  const name = options.name || 'lightbeam.bin';
  const mime = options.mime ?? guessMimeType(name);

  if (passphrase) {
    salt = randomBytes(16);
    nonce = randomBytes(24);
  }

  // 3. Plan, once -------------------------------------------------------------
  //
  // The plan must be computed against the EXACT wire length, because the block
  // size and count it produces are authenticated by the AEAD (through the
  // associated data below) and carried in the manifest. If the sender planned
  // against a guess and then re-planned after encrypting, the associated data
  // would describe one plan while the manifest described another and every
  // encrypted transfer would fail to decrypt.
  //
  // XChaCha20-Poly1305 makes the wire length exactly predictable: ciphertext =
  // plaintext + 16-byte tag. That is asserted below rather than assumed, so a
  // future change to the AEAD fails loudly here instead of producing transfers
  // that cannot be opened.
  const AEAD_TAG_BYTES = 16;
  const willEncrypt = Boolean(passphrase && salt && nonce);
  const wireLength = staged.length + (willEncrypt ? AEAD_TAG_BYTES : 0);
  const plan = planSession(wireLength, options.profile ?? 'balanced', {
    ecLevelOverride: options.ecLevel,
    wireEncoding: options.wireEncoding ?? 'base32',
  });
  const k = Math.max(1, Math.ceil(wireLength / plan.blockSize));

  // 4. Encrypt ----------------------------------------------------------------
  // The associated data binds the ciphertext to its metadata, so nobody can relabel
  // an encrypted blob with a different name or claim a different size. It is built
  // by the same function the RECEIVER uses (protocol/manifest.ts), which is the
  // only reliable way to be sure both sides cover the same fields.
  if (willEncrypt && salt && nonce) {
    const associatedData = manifestAssociatedData({
      sid: sessionId,
      name,
      mime,
      len: wireLength,
      olen: original.length,
      bs: plan.blockSize,
      k,
      codec,
      enc: encryptionMode,
    });
    const sealed = encryptPayload(staged, passphrase!, associatedData, salt, nonce, kdf);
    if (sealed.ciphertext.length !== wireLength) {
      throw new Error(
        `AEAD produced ${sealed.ciphertext.length} bytes where ${wireLength} were planned; ` +
          'the session was sized from the wrong length and would not decrypt.',
      );
    }
    staged = sealed.ciphertext;
  }

  const wirePayload = staged;
  const sha256Hex = hashHex(wirePayload);
  const crc32 = crc32u(wirePayload);

  // 5. Manifest ---------------------------------------------------------------
  const manifest = buildManifest({
    sessionId,
    name,
    mime,
    payloadLength: wirePayload.length,
    originalLength: original.length,
    blockSize: plan.blockSize,
    k,
    codec,
    encryption:
      willEncrypt && salt && nonce
        ? { mode: 'xchacha20poly1305', salt, nonce, kdf: { N: kdf.N, r: kdf.r, p: kdf.p } }
        : { mode: 'none' },
    sha256Hex,
    crc32,
    note: options.note,
  });

  const serialized = serializeManifest(manifest);
  // Fragment payload budget = the same as a data block, so one manifest fragment
  // fills one frame exactly under either wire encoding.
  const fragments = splitManifest(serialized, Math.max(1, plan.blockSize));

  // wireFlags() derives the Base32 flag from the plan, so the header always
  // agrees with how the frame was actually written. Hard-coding it here once
  // produced frames that claimed raw encoding while carrying base32 text.
  const flags = FrameFlag.None | wireFlags(plan) |
    (willEncrypt ? FrameFlag.Encrypted : FrameFlag.None) |
    (codec === 'deflate' ? FrameFlag.Compressed : FrameFlag.None);

  // "Saved by compression" must compare like with like: the payload BEFORE
  // encryption, because the AEAD tag is framing overhead, not something
  // compression failed to remove. Getting this wrong made a compressed encrypted
  // transfer report 16 bytes less saving than it achieved.
  const preEncryptionLength = wirePayload.length - (willEncrypt ? AEAD_TAG_BYTES : 0);
  const saved = original.length - preEncryptionLength;

  return {
    sessionId,
    code: sessionCode(sessionId),
    manifest,
    fragments,
    plan,
    wirePayload,
    originalPayload: original,
    flags,
    compression: {
      codec,
      saved,
      // >1 means compression helped ("2.4x smaller"); exactly 1 means it was not
      // worth doing and the payload was stored as-is.
      ratio: preEncryptionLength > 0 ? original.length / preEncryptionLength : 1,
    },
    encryption: encryptionMode,
  };
}

/**
 * Best-effort MIME type from a filename, for the receiver's preview.
 * Deliberately small: the receiver never trusts it beyond choosing a preview
 * widget, and never executes anything based on it.
 */
export function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const table: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    js: 'text/javascript',
    ts: 'text/plain',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    zip: 'application/zip',
    gz: 'application/gzip',
    '7z': 'application/x-7z-compressed',
    apk: 'application/vnd.android.package-archive',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    vcf: 'text/vcard',
    ics: 'text/calendar',
  };
  return table[ext] ?? 'application/octet-stream';
}

/** Text payload helper: wrap a string with a sensible filename and MIME type. */
export function textToSenderOptions(text: string): { data: Uint8Array; name: string; mime: string } {
  const data = new TextEncoder().encode(text);
  return { data, name: 'clipboard.txt', mime: 'text/plain' };
}

/** Diagnostics: does compression have a chance on this payload? */
export function compressionWorthTrying(data: Uint8Array): boolean {
  return looksCompressible(data);
}

export { FRAME_HEADER_BYTES, deriveMaskBlock, buildDegreeDistribution };

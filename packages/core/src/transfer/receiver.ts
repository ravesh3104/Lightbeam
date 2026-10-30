/**
 * receiver.ts - the receiving side of a LightBeam transfer.
 *
 * The receiver is a *state machine fed by decoded symbols*. The camera pipeline
 * (browser camera scanner or loopback harness) hands it the text/bytes of every decoded
 * QR symbol, plus a timestamp and a quality metric; the receiver does the rest:
 *
 *   idle -> reading metadata -> collecting blocks -> verifying -> done
 *
 * It is deliberately free of camera code so the exact same logic runs behind a
 * browser `getUserMedia` scanner, the in-browser loopback workbench, and the
 * test suite (which feeds it pre-encoded symbols).
 *
 * THREE THINGS MAKE THIS MORE THAN A LOOP
 * ---------------------------------------
 * 1. PROBLEM FRAMES ARE NORMAL. A camera pointed at a screen decodes garbage
 *    regularly. Every frame therefore goes through, in order: magic/version check,
 *    header CRC-16, session match, and (for data frames) a length check. Frames
 *    that fail are counted in `suspect` rather than discarded silently, because
 *    the ratio of suspect to good frames is the single most useful diagnostic on
 *    the receiver screen ("hold steadier", "too far", "screen too dim").
 *
 * 2. METADATA ARRIVES LATE. The manifest is repeated through the stream so a
 *    receiver that starts mid-transfer still learns K and the block size within a
 *    second. Until then, data frames cannot be used (they need K and blockSize to
 *    be interpreted at all), so they are counted as `orphan` and dropped. Once the
 *    manifest lands, decoding proceeds from the frames that follow.
 *
 * 3. VERIFICATION IS MANDATORY. The payload is only handed to the caller after
 *    SHA-256 matches the manifest. Decrypt and decompress happen only after that,
 *    so a wrong passphrase or a truncated payload is reported precisely instead of
 *    producing a corrupt file.
 */

import { LTDecoder, type DecoderStats } from '../fountain/lt.js';
import type { DegreeOptions } from '../fountain/degree.js';
import {
  ManifestAssembler,
  manifestAssociatedData,
  manifestEncryptionParams,
  type Manifest,
} from '../protocol/manifest.js';
import { FRAME_MAGIC, FrameFlag, FrameType, parseFrameDetailed, type ParsedFrame } from '../protocol/frame.js';
import { base32Decode } from '../util/base32.js';
import { verifyPayload, type IntegrityReport } from '../crypto/integrity.js';
import { decryptPayload } from '../crypto/aead.js';
import { decompressPayload } from './compress.js';

export type ReceiverPhase =
  | 'waiting-for-manifest' // camera running, no manifest fragment yet
  | 'collecting' // decoding blocks
  | 'decrypting' // payload complete, key derivation running
  | 'verifying' // checking SHA-256
  | 'complete' // payload verified and ready
  | 'failed'; // unrecoverable (integrity failure, wrong passphrase, bad manifest)

export interface ReceiverOptions {
  /** Passphrase if the sender encrypted the payload (may be supplied later). */
  passphrase?: string;
  /** Degree distribution must match the sender's (default matches the sender). */
  degree?: DegreeOptions;
  /** Largest residual the dense solver will attempt. */
  denseLimit?: number;
  /** Frames without progress before a dense solve is attempted. */
  stallThreshold?: number;
  /**
   * Accept frames whose header CRC failed. Off by default: a bad header means the
   * session or seed is untrustworthy, and using it can poison the decoder. It is
   * offered because some cameras produce systematically mismatched CRCs on an
   * otherwise perfectly readable stream (a firmware quirk), and in that case
   * rejecting every frame would make the app unusable.
   */
  acceptSuspectHeaders?: boolean;
}

export interface ReceiverProgress {
  phase: ReceiverPhase;
  /** 0..1 - fraction of source blocks recovered. */
  progress: number;
  blocksSolved: number;
  blocksTotal: number;
  framesAccepted: number;
  framesDuplicate: number;
  framesRedundant: number;
  framesSuspect: number;
  framesOrphan: number;
  framesForeign: number;
  /** Frames per second accepted over the last few seconds. */
  goodputFps: number;
  /** Effective payload throughput in bytes/second. */
  goodputBytesPerSecond: number;
  /** Seconds remaining, estimated from the current goodput. */
  etaSeconds: number;
  manifest: Manifest | null;
  integrity: IntegrityReport | null;
  /** Set when encryption is expected but no passphrase has been supplied. */
  awaitingPassphrase: boolean;
  error?: string;
  stats: DecoderStats | null;
}

export interface ReceiverResult {
  /** Verified, decrypted, decompressed payload. */
  payload: Uint8Array;
  manifest: Manifest;
  integrity: IntegrityReport;
  /** Convenience copy for text transfers. */
  text?: string;
}

const GOODPUT_WINDOW_MS = 4000;

export class TransferReceiver {
  private phase: ReceiverPhase = 'waiting-for-manifest';
  private manifest: Manifest | null = null;
  private decoder: LTDecoder | null = null;
  private opId = -1;
  private assembler = new ManifestAssembler();
  private passphrase: string | undefined;
  private readonly degree?: DegreeOptions;
  private readonly denseLimit: number;
  private readonly stallThreshold: number;
  private readonly acceptSuspectHeaders: boolean;

  private framesAccepted = 0;
  private framesDuplicate = 0;
  private framesRedundant = 0;
  private framesSuspect = 0;
  private framesOrphan = 0;
  private framesForeign = 0;
  private integrity: IntegrityReport | null = null;
  private error: string | undefined;
  private result: ReceiverResult | null = null;
  /** Timestamps of recently accepted frames, for the goodput window. */
  private readonly recentFrames: number[] = [];
  private startedAt = 0;
  /** True once the first frame of any kind is seen, for the elapsed clock. */
  private firstFrameAt = 0;

  constructor(options: ReceiverOptions = {}) {
    this.passphrase = options.passphrase?.trim() || undefined;
    this.degree = options.degree;
    this.denseLimit = options.denseLimit ?? 256;
    this.stallThreshold = options.stallThreshold ?? 32;
    this.acceptSuspectHeaders = options.acceptSuspectHeaders ?? false;
  }

  /**
   * Supply or replace the passphrase (the UI does this after the manifest arrives).
   *
   * The common case this exists for: the sender encrypted the file, the receiver
   * had no passphrase, collected every block, and failed at the decryption step.
   * The user then types the passphrase. Waiting for the *next* frame to retry
   * would work only while the sender is still transmitting - and the sender may
   * well have been stopped, because from its side the transfer is done. So if the
   * blocks are all present, retry the finish step immediately.
   */
  setPassphrase(passphrase: string, now = Date.now()): ReceiverPhase {
    this.passphrase = passphrase.trim() || undefined;
    // If the payload was already complete and waiting on a key, retry now.
    if (this.phase === 'failed' && this.error?.includes('passphrase')) {
      this.error = undefined;
      this.phase = 'verifying';
      if (this.decoder?.isComplete) this.finish(now);
      else this.phase = 'collecting';
    }
    return this.phase;
  }

  get isComplete(): boolean {
    return this.phase === 'complete';
  }

  get currentManifest(): Manifest | null {
    return this.manifest;
  }

  /**
   * Feed one decoded symbol.
   *
   * Accepts either form a platform decoder can produce:
   *   - a STRING, which is what iOS Vision, Android ML Kit and most third-party
   *     scanner apps return. Our default base32 wire encoding makes the whole
   *     frame ASCII, so this is lossless (util/base32.ts explains why the frame
   *     is encoded as text at all).
   *   - RAW BYTES, which is what a browser decoder (jsQR) can hand back for a
   *     byte-mode frame; used by the 'raw' wire encoding.
   *
   * @param symbol decoded symbol content
   * @param now    optional timestamp (ms); injectable so tests do not need a clock
   */
  accept(symbol: string | Uint8Array, now = Date.now()): ReceiverPhase {
    if (this.phase === 'complete' || this.phase === 'failed') return this.phase;
    if (this.firstFrameAt === 0) this.firstFrameAt = now;

    const bytes = toFrameBytes(symbol);
    if (!bytes) {
      this.framesForeign++;
      return this.phase;
    }

    const parsed = parseFrameDetailed(bytes);
    if (!parsed) {
      // Not a LightBeam frame at all: a random QR code, or a misdecode.
      this.framesForeign++;
      return this.phase;
    }
    if (!parsed.headerValid && !this.acceptSuspectHeaders) {
      this.framesSuspect++;
      return this.phase;
    }
    if (!parsed.headerValid) this.framesSuspect++;

    const frame = parsed.frame;

    // Session filtering.
    //
    // Once a manifest is locked in, every frame must belong to it - the session id
    // travels in every frame precisely so this is decidable.
    //
    // BEFORE that, we deliberately do NOT lock onto the first frame we happen to
    // see: a camera pointed at a wall of screens (or at a screen showing a QR
    // code unrelated to the transfer) would otherwise latch onto a stray session
    // and refuse the real manifest that arrives a moment later. Manifest frames
    // are self-identifying (fragment index/count plus the manifest's own sid,
    // which must equal the frame header), so they are the safe thing to lock on.
    if (this.manifest) {
      if (frame.sessionId !== this.manifest.sid) {
        this.framesForeign++;
        return this.phase;
      }
    } else if (frame.type !== FrameType.Manifest) {
      // A data frame before any manifest: unusable (K and blockSize unknown).
      this.framesOrphan++;
      return this.phase;
    }

    if (frame.type === FrameType.Manifest) {
      return this.acceptManifestFrame(frame, now);
    }

    // Data frames need the manifest before they can be interpreted (K and
    // blockSize are unknown until then).
    if (!this.manifest || !this.decoder) {
      this.framesOrphan++;
      return this.phase;
    }
    if (frame.payload.length !== this.manifest.bs) {
      // Wrong block size: a manifest mismatch, or a frame from another profile.
      this.framesSuspect++;
      return this.phase;
    }

    const outcome = this.decoder.addFrame(frame.seed, frame.payload);
    if (outcome === 'duplicate') this.framesDuplicate++;
    else if (outcome === 'redundant') this.framesRedundant++;
    else {
      this.framesAccepted++;
      this.recentFrames.push(now);
    }

    if (this.decoder.isComplete) {
      this.phase = 'verifying';
      this.finish(now);
    } else {
      this.phase = 'collecting';
    }
    return this.phase;
  }

  private acceptManifestFrame(frame: ParsedFrame, now: number): ReceiverPhase {
    let manifest: Manifest | null;
    try {
      manifest = this.assembler.accept(frame.payload);
    } catch {
      // A structurally invalid manifest is noise, not a fatal error.
      this.framesSuspect++;
      return this.phase;
    }
    if (!manifest) return this.phase;
    if (manifest.sid !== frame.sessionId) {
      // The manifest must agree with the frame header it arrived in.
      this.framesSuspect++;
      return this.phase;
    }
    if (this.manifest && this.manifest.sid === manifest.sid) return this.phase; // already have it

    this.manifest = manifest;
    this.opId = manifest.sid;
    this.decoder = new LTDecoder({
      k: manifest.k,
      blockSize: manifest.bs,
      sessionId: manifest.sid,
      degree: this.degree,
      payloadLength: manifest.len,
      denseLimit: this.denseLimit,
      stallThreshold: this.stallThreshold,
    });
    this.startedAt = now;
    if (this.phase === 'waiting-for-manifest') this.phase = 'collecting';
    return this.phase;
  }

  /** Verify, decrypt and decompress the completed payload. */
  private finish(now: number): void {
    const manifest = this.manifest!;
    const decoder = this.decoder!;
    const raw = decoder.reconstruct();

    // 1. Integrity first: never spend CPU on scrypt for a payload that is broken.
    const report = verifyPayload(raw, manifest.sha, manifest.crc);
    this.integrity = report;
    if (!report.ok) {
      this.phase = 'failed';
      this.error = `Integrity check failed (received ${report.bytes} bytes, sha256 ${report.actualSha256.slice(0, 12)}... != ${report.expectedSha256.slice(0, 12)}...)`;
      return;
    }

    // 2. Decryption.
    let payload = raw;
    if (manifest.enc !== 'none') {
      const params = manifestEncryptionParams(manifest);
      if (!params) {
        this.phase = 'failed';
        this.error = 'Encrypted transfer is missing its key parameters';
        return;
      }
      if (!this.passphrase) {
        this.phase = 'failed';
        this.error = 'This transfer is encrypted: enter the passphrase shown by the sender';
        return;
      }
      this.phase = 'decrypting';
      try {
        payload = decryptPayload(
          raw,
          this.passphrase,
          params.salt,
          params.nonce,
          manifestAssociatedData(manifest),
          params.kdf,
        );
      } catch {
        this.phase = 'failed';
        this.error = 'Wrong passphrase, or the payload was modified in transit';
        return;
      }
    }

    // 3. Decompression.
    let decoded: Uint8Array;
    try {
      decoded = decompressPayload(payload, manifest.codec);
    } catch (cause) {
      this.phase = 'failed';
      this.error = `Could not decompress the payload: ${(cause as Error).message}`;
      return;
    }

    if (decoded.length !== manifest.olen) {
      this.phase = 'failed';
      this.error = `Payload length mismatch after decompression (${decoded.length} != ${manifest.olen})`;
      return;
    }

    const text = manifest.mime.startsWith('text/') ? safeDecodeText(decoded) : undefined;
    this.result = { payload: decoded, manifest, integrity: report, text };
    this.phase = 'complete';
    void now;
  }

  /** Verified result, or null while the transfer is still running. */
  getResult(): ReceiverResult | null {
    return this.result;
  }

  /** Snapshot of everything the receiver UI shows. */
  getProgress(now = Date.now()): ReceiverProgress {
    const decoder = this.decoder;
    const stats = decoder?.getStats() ?? null;
    const blocksSolved = stats?.solved ?? 0;
    const blocksTotal = this.manifest?.k ?? 0;

    // Goodput over a trailing window, so a temporary stall does not permanently
    // poison the ETA.
    while (this.recentFrames.length > 0 && now - this.recentFrames[0] > GOODPUT_WINDOW_MS) {
      this.recentFrames.shift();
    }
    const windowMs = this.recentFrames.length > 1 ? now - this.recentFrames[0] : 0;
    const goodputFps = windowMs > 0 ? (this.recentFrames.length / windowMs) * 1000 : 0;
    const bytesPerFrame = this.manifest?.bs ?? 0;
    const goodputBytesPerSecond = goodputFps * bytesPerFrame;
    const remainingBlocks = Math.max(0, blocksTotal - blocksSolved);
    const etaSeconds =
      goodputFps > 0.1 && remainingBlocks > 0 ? remainingBlocks / goodputFps : remainingBlocks > 0 ? Infinity : 0;

    return {
      phase: this.phase,
      progress: blocksTotal > 0 ? blocksSolved / blocksTotal : 0,
      blocksSolved,
      blocksTotal,
      framesAccepted: this.framesAccepted,
      framesDuplicate: this.framesDuplicate,
      framesRedundant: this.framesRedundant,
      framesSuspect: this.framesSuspect,
      framesOrphan: this.framesOrphan,
      framesForeign: this.framesForeign,
      goodputFps,
      goodputBytesPerSecond,
      etaSeconds,
      manifest: this.manifest,
      integrity: this.integrity,
      awaitingPassphrase:
        this.phase === 'failed' && !!this.error?.includes('passphrase') && this.manifest?.enc !== 'none',
      error: this.error,
      stats,
    };
  }

  /**
   * Partially received data, when the transfer is incomplete.
   *
   * Used by the UI to render a blurred/partial preview so the operator can see
   * that the link is working - and, for images, whether the framing is correct -
   * long before the last block arrives.
   */
  partial(): { data: Uint8Array; complete: boolean; knownBytes: number; totalBytes: number } | null {
    if (!this.decoder || !this.manifest || this.isComplete) return null;
    const best = this.decoder.bestEffort();
    let knownBytes = 0;
    for (const range of best.missingRanges) knownBytes += range.end - range.start;
    return {
      data: best.data,
      complete: best.complete,
      knownBytes: this.manifest.len - knownBytes,
      totalBytes: this.manifest.len,
    };
  }

  /** Elapsed milliseconds since the first frame or the manifest, whichever is later. */
  elapsedMs(now = Date.now()): number {
    const start = this.startedAt || this.firstFrameAt;
    return start === 0 ? 0 : now - start;
  }

  reset(): void {
    this.phase = 'waiting-for-manifest';
    this.manifest = null;
    this.decoder = null;
    this.opId = -1;
    this.assembler = new ManifestAssembler();
    this.framesAccepted = 0;
    this.framesDuplicate = 0;
    this.framesRedundant = 0;
    this.framesSuspect = 0;
    this.framesOrphan = 0;
    this.framesForeign = 0;
    this.integrity = null;
    this.error = undefined;
    this.result = null;
    this.recentFrames.length = 0;
    this.startedAt = 0;
    this.firstFrameAt = 0;
  }
}

/**
 * Normalise whatever the platform's QR decoder produced into frame bytes.
 *
 * Detection order matters and is cheap:
 *   1. a string that is valid base32 and decodes to a frame magic -> base32 frame,
 *   2. a string that is byte-mode content -> its char codes, if the magic matches,
 *   3. raw bytes starting with the magic -> a raw frame.
 * Anything else is not ours; the caller counts it as a foreign symbol.
 */
function toFrameBytes(symbol: string | Uint8Array): Uint8Array | null {
  if (typeof symbol === 'string') {
    if (symbol.length === 0) return null;
    try {
      const decoded = base32Decode(symbol);
      if (decoded.length > 0 && decoded[0] === FRAME_MAGIC) return decoded;
    } catch {
      // Not base32 text; fall through to the byte-mode interpretation.
    }
    const bytes = new Uint8Array(symbol.length);
    for (let i = 0; i < symbol.length; i++) {
      const code = symbol.charCodeAt(i);
      if (code > 255) return null;
      bytes[i] = code;
    }
    return bytes.length > 0 && bytes[0] === FRAME_MAGIC ? bytes : null;
  }
  return symbol.length > 0 && symbol[0] === FRAME_MAGIC ? symbol : null;
}

/**
 * Associated data used by the AEAD, recomputed on the receiver from the manifest
 * it received. Must match sender.buildAssociatedData byte for byte.
 */
/*
 * Note: there is deliberately no local associated-data builder here. It used to
 * exist, as a copy of the sender's - and a copy is exactly how the two sides drift
 * apart until encrypted transfers stop working. Both now call
 * `manifestAssociatedData` from protocol/manifest.ts.
 */

function safeDecodeText(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export { FrameFlag, FrameType };

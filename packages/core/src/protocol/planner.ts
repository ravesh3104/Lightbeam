/**
 * planner.ts - choosing the symbol geometry for a session.
 *
 * The central trade-off of an optical transfer is:
 *
 *   bigger symbol  =  more bytes per frame  =  fewer frames to show
 *                   but more modules per symbol, so each module is physically
 *                   smaller on screen and harder for a camera to resolve.
 *
 * Resolving a QR module needs roughly 3+ camera pixels across it (Nyquist plus
 * the decoder's margin), and a phone held 20-40 cm away from a phone screen
 * covers maybe 700-900 px across the display. That puts a comfortable ceiling at
 * about 60-100 modules, i.e. QR versions 8-16. Beyond that, capture success
 * collapses (the decoder still *works* when it works, but the probability of a
 * clean decode per frame drops, which costs more in retries than the larger
 * payload saves).
 *
 * So the planner picks a target version from a *density profile* rather than
 * maximising capacity, and sizes the LT blocks to fill exactly one frame:
 *
 *     blockSize = maxBytePayload(version, ecLevel) - FRAME_HEADER_BYTES
 *
 * A note on EC level: for a screen-to-camera channel, QR error correction is
 * useful but not the dominant factor - blur and geometry are. Level L with a
 * perfect screen is typically the best throughput choice; level M is a good
 * compromise for phones held by hand. The planner exposes both and lets the UI
 * offer "balanced" vs "robust".
 */

import { BYTE_MODE_CAPACITY, type EcLevel } from '../qr/tables.js';
import { maxBytePayload } from '../qr/encoder.js';
import { FRAME_HEADER_BYTES, FrameFlag } from './frame.js';
import { base32DecodedLength } from '../util/base32.js';

export interface DensityProfile {
  id: 'phone' | 'balanced' | 'dense' | 'tablet';
  label: string;
  description: string;
  /** QR version to target (1..40). */
  version: number;
  /** Error correction level for the target version. */
  ecLevel: EcLevel;
}

/**
 * The profiles offered in the UI. Sizes: version v -> (17 + 4v) modules.
 *   version  8 ->  49 x 49 modules
 *   version 10 ->  57 x 57
 *   version 15 ->  77 x 77
 *   version 20 ->  97 x 97
 *   version 27 -> 125 x 125
 */
export const DENSITY_PROFILES: DensityProfile[] = [
  {
    id: 'phone',
    label: 'Phones, close up',
    description: 'Smallest symbols, easiest to scan. Best when both devices are in your hands.',
    version: 10,
    ecLevel: 'L',
  },
  {
    id: 'balanced',
    label: 'Balanced (recommended)',
    description: 'Good throughput and reliable capture on a phone screen at 20-40 cm.',
    version: 15,
    ecLevel: 'L',
  },
  {
    id: 'dense',
    label: 'Fast (dense)',
    description: 'Bigger symbols, more bytes per frame. Needs a steady camera and a bright screen.',
    version: 20,
    ecLevel: 'L',
  },
  {
    id: 'tablet',
    label: 'Laptop / tablet screen',
    description: 'Widest symbols. Use when the sender is a computer display and the receiver is a phone.',
    version: 27,
    ecLevel: 'L',
  },
];

export function profileById(id: DensityProfile['id']): DensityProfile {
  return DENSITY_PROFILES.find((profile) => profile.id === id) ?? DENSITY_PROFILES[1];
}

/**
 * Wire encoding of frame payloads.
 *
 * 'base32' is the default: universal compatibility with native camera APIs and
 * third-party scanners, at a ~10% throughput cost. 'raw' uses QR byte mode and is
 * only safe when BOTH ends are ours (web-to-web, or a custom native decoder).
 */
export type WireEncoding = 'raw' | 'base32';

export interface SessionPlan {
  profile: DensityProfile;
  version: number;
  ecLevel: EcLevel;
  /** How frame payloads are encoded on the wire. */
  wireEncoding: WireEncoding;
  /** Modules per axis of the QR symbol (17 + 4 * version). */
  modules: number;
  /** Bytes available in one frame's QR payload. */
  framePayloadBytes: number;
  /** Bytes of LT block per frame (frame payload minus the 13-byte header). */
  blockSize: number;
  /** Number of LT blocks (K) for this payload. */
  k: number;
  /** Nominal payload bytes carried per frame (payload, not including headers). */
  bytesPerFrame: number;
  /**
   * Estimated frames needed to move `payloadLength` bytes, including the
   * expected fountain overhead (see estimateOverhead).
   */
  estimatedFrames: number;
  /** Estimated seconds on screen at a given frame rate. */
  estimatedSeconds: (fps: number) => number;
}

/** Maximum QR byte-mode capacity for (version, level) - ISO 18004 table 7. */
export function byteCapacity(version: number, level: EcLevel): number {
  return BYTE_MODE_CAPACITY[level][version] ?? 0;
}

/**
 * Frame payload budget: the largest byte-mode payload that fits the symbol,
 * minus the frame header. `maxBytePayload` accounts for the mode indicator and
 * the version-dependent character-count indicator, so this is exact.
 */
export function framePayloadBytes(version: number, level: EcLevel): number {
  return Math.max(0, maxBytePayload(version, level) - FRAME_HEADER_BYTES);
}

/**
 * Expected fountain overhead as a fraction of K.
 *
 * Empirically (see docs/degree-experiment-output.txt) robust-soliton LT with our
 * systematic prefix decodes at about 1.06-1.12x K on a clean channel, rising to
 * ~1.2-1.35x when a third of the frames are missed. We use a conservative
 * constant for planning and let the live UI replace it with the measured value.
 */
export function estimateOverhead(framesMissedFraction = 0): number {
  // Overhead grows with the square root of the loss rate in practice: the
  // decoder needs K + O(sqrt(K)) independent frames, and loss only increases the
  // variance of "how many distinct frames we saw".
  const base = 1.06;
  const lossPenalty = 0.45 * Math.sqrt(Math.max(0, Math.min(0.9, framesMissedFraction)));
  return base + lossPenalty;
}

/** Plan a session for a payload of `payloadLength` bytes. */
export function planSession(
  payloadLength: number,
  profileInput: DensityProfile | DensityProfile['id'] = 'balanced',
  options: {
    ecLevelOverride?: EcLevel;
    maxK?: number;
    expectedLoss?: number;
    wireEncoding?: WireEncoding;
  } = {},
): SessionPlan {
  const profile = typeof profileInput === 'string' ? profileById(profileInput) : profileInput;
  const version = profile.version;
  const ecLevel = options.ecLevelOverride ?? profile.ecLevel;
  const wireEncoding = options.wireEncoding ?? 'base32';
  const budget = framePayloadBytes(version, ecLevel);
  if (budget <= 0) {
    throw new RangeError(`Profile version ${version} has no usable payload at EC level ${ecLevel}`);
  }

  // Blocks are sized to exactly fill a frame. (A smaller block would waste screen
  // time; a larger one would need a bigger symbol.)
  //
  // With base32 the symbol holds `budget` characters but fewer *data* bytes:
  // 8 characters carry 5 bytes. Sizing the LT block in data bytes keeps the
  // fountain layer, the manifest and the progress maths all in real byte units.
  //
  // base32 mode wraps the WHOLE frame (header included) as text, because a native
  // scanner hands back a decoded string - a binary header would be mangled just as
  // badly as a binary payload. So the budget must cover base32(header + block):
  //   base32DecodedLength(budget) is how many bytes fit in `budget` characters,
  //   and the 13-byte frame header comes out of that.
  let blockSize =
    wireEncoding === 'base32'
      ? Math.max(1, base32DecodedLength(budget) - FRAME_HEADER_BYTES)
      : Math.max(1, budget - FRAME_HEADER_BYTES);
  let k = Math.max(1, Math.ceil(payloadLength / blockSize));

  // Very large files would need an unwieldy number of blocks. Cap K by growing
  // the block size (which requires a denser symbol at the END of the range) or,
  // if the profile cannot express it, report the mismatch to the caller.
  const maxK = options.maxK ?? 20_000;
  if (k > maxK) {
    throw new RangeError(
      `Payload needs ${k} blocks, above the ${maxK}-block session limit. Use a denser profile or a smaller file.`,
    );
  }

  // Tiny payloads should not waste a whole block: reduce K for payloads smaller
  // than one frame so the progress UI is meaningful.
  if (k === 1) {
    blockSize = Math.max(1, Math.min(blockSize, payloadLength || 1));
    k = 1;
  }

  const overhead = estimateOverhead(options.expectedLoss ?? 0);
  const estimatedFrames = Math.ceil(k * overhead) + 4; // +4 for manifest frames

  return {
    profile,
    version,
    ecLevel,
    wireEncoding,
    modules: 17 + version * 4,
    framePayloadBytes: budget,
    blockSize,
    k,
    bytesPerFrame: blockSize,
    estimatedFrames,
    estimatedSeconds: (fps: number) => (fps > 0 ? estimatedFrames / fps : Infinity),
  };
}

/**
 * Effective throughput in bytes/second for a session at a given display frame
 * rate. This is the number the UI shows ("about 12 kB/s") and it is optimistic by
 * design: it is what a *perfect* receiver would get. The receiver's own measured
 * goodput is what actually matters, and the receiver screen displays that.
 */
export function nominalThroughput(plan: SessionPlan, fps: number): number {
  return plan.bytesPerFrame * fps;
}

/** Frame header flags implied by a plan (Base32 flag when applicable). */
export function wireFlags(plan: SessionPlan): number {
  return plan.wireEncoding === 'base32' ? FrameFlag.Base32 : FrameFlag.None;
}

/** Frames per second that a sender should aim for, per browser form factor and profile. */
export function recommendedFps(
  platform: 'web' | 'desktop-web' | 'mobile-web',
  profileId: DensityProfile['id'],
): number {
  // Rendering cost is dominated by the symbol size (module count squared), and
  // capture cost on the receiving side by the camera's exposure time.
  const byProfile: Record<DensityProfile['id'], number> = {
    phone: 15,
    balanced: 15,
    dense: 12,
    tablet: 10,
  };
  const base = byProfile[profileId] ?? 15;
  // Desktop displays comfortably hold the base rate; mobile browsers share CPU
  // and thermal headroom with the page compositor, so we shave 2 fps there.
  if (platform === 'mobile-web') return Math.max(8, base - 2);
  return base;
}

/**
 * Sanity-check a plan against a payload, used by the sender before it starts and
 * by tests. Returns human-readable warnings rather than throwing, because the UI
 * wants to warn ("this will take about 4 minutes") without blocking.
 */
export function planWarnings(plan: SessionPlan, payloadLength: number, fps: number): string[] {
  const warnings: string[] = [];
  const seconds = plan.estimatedSeconds(fps);
  if (seconds > 300) {
    warnings.push(
      `Estimated ${Math.round(seconds / 60)} minutes on screen at ${fps} fps. Consider a denser profile, or copy the file over a cable.`,
    );
  }
  if (plan.modules > 110) {
    warnings.push('Symbols are very dense; hold the camera steady and fill the viewfinder with the code.');
  }
  if (payloadLength > 16 * 1024 * 1024) {
    warnings.push('Large payload: expect several minutes and keep both screens awake.');
  }
  return warnings;
}

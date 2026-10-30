/**
 * @lightbeam/core - public API.
 *
 * Everything below is platform-agnostic: no DOM, no framework, no Node
 * built-ins. The same package powers the React web app, the Node server, the
 * tests and the CLI tools.
 *
 * A MINIMAL TRANSFER
 * ------------------
 * Sender:
 *   const prepared = await prepareTransfer({ data, name, mime });
 *   const sender = new TransferSender(prepared);
 *   const symbol = sender.symbolAt(slot);          // draw this every frame
 *
 * Receiver (fed by the camera pipeline):
 *   const receiver = new TransferReceiver({ passphrase });
 *   receiver.accept(decodedQrBytes);                // every decoded symbol
 *   receiver.getProgress();                         // progress, ETA, diagnostics
 *   const result = receiver.getResult();            // verified payload
 */

// ---------------------------------------------------------------------------
// QR symbol generation
// ---------------------------------------------------------------------------
export {
  encodeBinary,
  encodeText,
  maxBytePayload,
  dataCodewordCount,
  SymbolCache,
  type EncodedSymbol,
  type EncodeOptions,
} from './qr/encoder.js';
export {
  rasterizeRgba,
  rasterizeMono,
  toSvg,
  toSvgPath,
  moduleCountWithQuietZone,
  imageDataBytes,
  inkCoverage,
  WHITE,
  BLACK,
  type Rgba,
  type RgbaImage,
  type MonoBitmap,
  type RenderOptions,
} from './qr/render.js';
export { BYTE_MODE_CAPACITY, type EcLevel } from './qr/tables.js';
export { QrMode, splitIntoSegments, type QrSegment } from './qr/segments.js';
export { maskPenalty, maskBit, type QrMatrix } from './qr/matrix.js';
export { rsEncode, rsVerify, generatorPolynomial } from './qr/reed-solomon.js';

// ---------------------------------------------------------------------------
// Fountain coding
// ---------------------------------------------------------------------------
export {
  LTEncoder,
  LTDecoder,
  frameNeighbours,
  deriveMaskBlock,
  expectedFramesFor,
  defaultSystematicPrefix,
  xorInto,
  SYSTEMATIC_PREFIX_FRACTION,
  type DecoderStats,
  type FrameOutcome,
  type LTSessionOptions,
} from './fountain/lt.js';
export {
  buildDegreeDistribution,
  idealSolitonPmf,
  robustSolitonPmf,
  sampleDegree,
  describeDistribution,
  toCdf,
  type DegreeDistribution,
  type DegreeOptions,
} from './fountain/degree.js';

// ---------------------------------------------------------------------------
// Frame protocol
// ---------------------------------------------------------------------------
export {
  FRAME_MAGIC,
  FRAME_HEADER_BYTES,
  PROTOCOL_VERSION,
  FrameFlag,
  FrameType,
  encodeDataFrame,
  encodeManifestFrame,
  parseFrame,
  parseFrameDetailed,
  describeFrame,
  type FrameHeader,
  type ParsedFrame,
} from './protocol/frame.js';

export {
  MANIFEST_VERSION,
  FRAGMENT_HEADER_BYTES,
  buildManifest,
  serializeManifest,
  deserializeManifest,
  validateManifest,
  manifestAssociatedData,
  manifestEncryptionParams,
  manifestFragmentSize,
  splitManifest,
  describeManifest,
  ManifestAssembler,
  type Manifest,
  type ManifestFragments,
  type ManifestOptions,
} from './protocol/manifest.js';

export {
  DENSITY_PROFILES,
  profileById,
  byteCapacity,
  framePayloadBytes,
  estimateOverhead,
  planSession,
  nominalThroughput,
  recommendedFps,
  planWarnings,
  type DensityProfile,
  type SessionPlan,
  type WireEncoding,
} from './protocol/planner.js';

// ---------------------------------------------------------------------------
// Transfer state machines
// ---------------------------------------------------------------------------
export {
  TransferSender,
  prepareTransfer,
  guessMimeType,
  textToSenderOptions,
  compressionWorthTrying,
  MANIFEST_REPEAT,
  type PreparedTransfer,
  type SenderOptions,
  type SenderStats,
} from './transfer/sender.js';

export {
  TransferReceiver,
  type ReceiverOptions,
  type ReceiverPhase,
  type ReceiverProgress,
  type ReceiverResult,
} from './transfer/receiver.js';

export {
  compressPayload,
  decompressPayload,
  looksCompressible,
  MIN_GAIN,
  MAX_COMPRESS_BYTES,
  type Codec,
  type CompressResult,
} from './transfer/compress.js';

// ---------------------------------------------------------------------------
// Crypto and integrity
// ---------------------------------------------------------------------------
export {
  encryptPayload,
  decryptPayload,
  deriveKey,
  passphraseFingerprint,
  parseFingerprint,
  DEFAULT_KDF,
  FAST_KDF,
  KEY_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  TAG_BYTES,
  type EncryptedPayload,
  type KdfParams,
} from './crypto/aead.js';

export {
  hashPayload,
  hashHex,
  shortHash,
  verifyPayload,
  partialConfidence,
  type IntegrityReport,
} from './crypto/integrity.js';

export { crc16, crc32, crc32u } from './crypto/crc.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export {
  concatBytes,
  bytesEqual,
  toHex,
  fromHex,
  toBase64Url,
  fromBase64Url,
  utf8Encode,
  utf8Decode,
  formatBytes,
  randomBytes,
  randomUint32,
  sanitiseFileName,
  randomSessionId,
  sessionCode,
  sessionCodeToId,
} from './util/bytes.js';
export { Rng, mix32, deriveSeed } from './util/rng.js';
export {
  Utf8Encoder,
  Utf8Decoder,
  installWebTextCodecs,
  hasNativeTextCodecs,
  utf8EncodeWithFallback,
  utf8DecodeWithFallback,
} from './util/utf8.js';
export {
  base32Encode,
  base32Decode,
  base32EncodedLength,
  base32DecodedLength,
  isBase32,
} from './util/base32.js';
export { BitWriter, BitReader, packBits, unpackBits } from './util/bits.js';

/** Library version, reported to the backend and shown in the about screen. */
export const VERSION = '1.0.0';

/**
 * Hard protocol limits. Documented because they are user-visible:
 * the app refuses (with a clear message) rather than failing halfway.
 */
export const LIMITS = {
  /** Largest payload the app will send in one session. */
  maxPayloadBytes: 64 * 1024 * 1024,
  /** Largest text snippet (a shorter limit: text is usually pasted by hand). */
  maxTextBytes: 4 * 1024 * 1024,
  /** Largest number of LT blocks in a session. */
  maxBlocks: 20_000,
  /** Smallest and largest QR symbol the app will display. */
  minVersion: 5,
  maxVersion: 40,
} as const;

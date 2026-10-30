# The engine, file by file

Every file in `packages/core` — the platform-agnostic optical fountain engine.
Covers ISO/IEC 18004 QR generation, Luby Transform fountain coding, XChaCha20-Poly1305
authenticated encryption, SHA-256/CRC integrity, and the sender/receiver state machines.

> **This document is generated and verified.** The code listings below are copied
> from the repository by `tools/make-code-reference.mjs`; the prose around them is
> written by hand. `npm run test:docs` fails if a single line of any listing stops
> matching the file it claims to show, or if a file is missing, extra, or in the
> wrong order. A walkthrough therefore cannot quietly go stale.

---

## `packages/core/src/index.ts`

> 250 lines

**What it is.** The package's front door, and its only documentation that executes.
Every other file in this directory is a `util`, a `qr`, a `fountain`, a `crypto`, a
`protocol` or a `transfer` module; this one decides what the outside world may see. The
doc comment at the top is a *working* usage example, not decoration — those six lines
are the shortest correct integration of the engine, and they are what the browser app
and the mobile app both do.

**How to read it.** The file is a list of re-export blocks in dependency order —
QR symbol generation, fountain coding, frame protocol, transfer state machines, crypto
and integrity, then the low-level utilities — followed by two value exports at the
bottom. That order is the reading order of the engine, and it is the same order the
code-reference document uses.

**Why each block is grouped the way it is.**

1. **`qr/*`** — encoding (`encodeBinary`, `encodeText`), sizing (`maxBytePayload`,
   `dataCodewordCount`), the symbol cache, and the three renderers (`rasterizeRgba`,
   `rasterizeMono`, `toSvg`, `toSvgPath`). The renderers are exported rather than kept
   internal because the three consumers have three different needs: the server tests
   rasterise to pixels for jsQR, the browser sender rasterises into a canvas, and the
   mobile app draws an SVG path.
2. **`fountain/*`** — the encoder, the decoder, the per-frame neighbour derivation
   (`frameNeighbours`, `deriveMaskBlock`), `expectedFramesFor` for the ETA, and the
   whole degree-distribution toolkit. `xorInto` is exported because it is the exact
   operation the decoder's hot loop performs, and the tests use it to build frames by
   hand.
3. **`protocol/*`** — the 13-byte frame header and its parser, the manifest and its
   fragmenting assembler, and the planner (`DENSITY_PROFILES`, `planSession`,
   `recommendedFps`). Note that `byteCapacity`, `framePayloadBytes`, `estimateOverhead`
   appear in this block, not in the QR block: they answer "how much of a *session*
   fits in a symbol", which is a protocol question, not an encoding one.
4. **`transfer/*`** — `TransferSender` / `prepareTransfer` and `TransferReceiver`, plus
   compression. These are the two state machines the apps actually drive.
5. **`crypto/*`** — AEAD, hashing and CRCs. Deliberately *after* transfer in the file,
   because transfer is the layer a reader needs first; the crypto block is small and
   self-contained.
6. **`util/*`** — the bottom of the stack: byte helpers, the deterministic RNG, the
   deterministic UTF-8 codecs with pure-JS fallback, base32, and the bit reader/writer.

**`VERSION`.** A literal, not a read of `package.json`. Importing JSON would drag
`resolveJsonModule` into every consumer's build (Metro in particular), for a string
that changes once a release. The server reports it from `/api/capabilities`; the About
screen prints it.

**`LIMITS`.** The product's contract expressed as code, and the reason it is exported
is that *user-visible* limits must be checkable before work starts:

| Key | Value | Why this number |
| --- | --- | --- |
| `maxPayloadBytes` | 64 MiB | matches the reference product; also the point past which a real transfer takes longer than a download |
| `maxTextBytes` | 4 MiB | text is pasted by hand, so a smaller ceiling is honest about the use case |
| `maxBlocks` | 20 000 | the decoder's memory ceiling; the planner refuses to build a session above it |
| `minVersion` / `maxVersion` | 5 / 40 | QR versions 5–40 are the ones that hold a useful payload at a legible module size |

Every validator imports this object, so there is exactly one place to change a limit —
and `validateManifest` plus the server's body-size check both fail *before* allocating,
rather than halfway through a transfer.

**Every line**

```ts
  1 │ /**
  2 │  * @lightbeam/core - public API.
  3 │  *
  4 │  * Everything below is platform-agnostic: no DOM, no framework, no Node
  5 │  * built-ins. The same package powers the React web app, the Node server, the
  6 │  * tests and the CLI tools.
  7 │  *
  8 │  * A MINIMAL TRANSFER
  9 │  * ------------------
 10 │  * Sender:
 11 │  *   const prepared = await prepareTransfer({ data, name, mime });
 12 │  *   const sender = new TransferSender(prepared);
 13 │  *   const symbol = sender.symbolAt(slot);          // draw this every frame
 14 │  *
 15 │  * Receiver (fed by the camera pipeline):
 16 │  *   const receiver = new TransferReceiver({ passphrase });
 17 │  *   receiver.accept(decodedQrBytes);                // every decoded symbol
 18 │  *   receiver.getProgress();                         // progress, ETA, diagnostics
 19 │  *   const result = receiver.getResult();            // verified payload
 20 │  */
 21 │ 
 22 │ // ---------------------------------------------------------------------------
 23 │ // QR symbol generation
 24 │ // ---------------------------------------------------------------------------
 25 │ export {
 26 │   encodeBinary,
 27 │   encodeText,
 28 │   maxBytePayload,
 29 │   dataCodewordCount,
 30 │   SymbolCache,
 31 │   type EncodedSymbol,
 32 │   type EncodeOptions,
 33 │ } from './qr/encoder.js';
 34 │ export {
 35 │   rasterizeRgba,
 36 │   rasterizeMono,
 37 │   toSvg,
 38 │   toSvgPath,
 39 │   moduleCountWithQuietZone,
 40 │   imageDataBytes,
 41 │   inkCoverage,
 42 │   WHITE,
 43 │   BLACK,
 44 │   type Rgba,
 45 │   type RgbaImage,
 46 │   type MonoBitmap,
 47 │   type RenderOptions,
 48 │ } from './qr/render.js';
 49 │ export { BYTE_MODE_CAPACITY, type EcLevel } from './qr/tables.js';
 50 │ export { QrMode, splitIntoSegments, type QrSegment } from './qr/segments.js';
 51 │ export { maskPenalty, maskBit, type QrMatrix } from './qr/matrix.js';
 52 │ export { rsEncode, rsVerify, generatorPolynomial } from './qr/reed-solomon.js';
 53 │ 
 54 │ // ---------------------------------------------------------------------------
 55 │ // Fountain coding
 56 │ // ---------------------------------------------------------------------------
 57 │ export {
 58 │   LTEncoder,
 59 │   LTDecoder,
 60 │   frameNeighbours,
 61 │   deriveMaskBlock,
 62 │   expectedFramesFor,
 63 │   defaultSystematicPrefix,
 64 │   xorInto,
 65 │   SYSTEMATIC_PREFIX_FRACTION,
 66 │   type DecoderStats,
 67 │   type FrameOutcome,
 68 │   type LTSessionOptions,
 69 │ } from './fountain/lt.js';
 70 │ export {
 71 │   buildDegreeDistribution,
 72 │   idealSolitonPmf,
 73 │   robustSolitonPmf,
 74 │   sampleDegree,
 75 │   describeDistribution,
 76 │   toCdf,
 77 │   type DegreeDistribution,
 78 │   type DegreeOptions,
 79 │ } from './fountain/degree.js';
 80 │ 
 81 │ // ---------------------------------------------------------------------------
 82 │ // Frame protocol
 83 │ // ---------------------------------------------------------------------------
 84 │ export {
 85 │   FRAME_MAGIC,
 86 │   FRAME_HEADER_BYTES,
 87 │   PROTOCOL_VERSION,
 88 │   FrameFlag,
 89 │   FrameType,
 90 │   encodeDataFrame,
 91 │   encodeManifestFrame,
 92 │   parseFrame,
 93 │   parseFrameDetailed,
 94 │   describeFrame,
 95 │   type FrameHeader,
 96 │   type ParsedFrame,
 97 │ } from './protocol/frame.js';
 98 │ 
 99 │ export {
100 │   MANIFEST_VERSION,
101 │   FRAGMENT_HEADER_BYTES,
102 │   buildManifest,
103 │   serializeManifest,
104 │   deserializeManifest,
105 │   validateManifest,
106 │   manifestAssociatedData,
107 │   manifestEncryptionParams,
108 │   manifestFragmentSize,
109 │   splitManifest,
110 │   describeManifest,
111 │   ManifestAssembler,
112 │   type Manifest,
113 │   type ManifestFragments,
114 │   type ManifestOptions,
115 │ } from './protocol/manifest.js';
116 │ 
117 │ export {
118 │   DENSITY_PROFILES,
119 │   profileById,
120 │   byteCapacity,
121 │   framePayloadBytes,
122 │   estimateOverhead,
123 │   planSession,
124 │   nominalThroughput,
125 │   recommendedFps,
126 │   planWarnings,
127 │   type DensityProfile,
128 │   type SessionPlan,
129 │   type WireEncoding,
130 │ } from './protocol/planner.js';
131 │ 
132 │ // ---------------------------------------------------------------------------
133 │ // Transfer state machines
134 │ // ---------------------------------------------------------------------------
135 │ export {
136 │   TransferSender,
137 │   prepareTransfer,
138 │   guessMimeType,
139 │   textToSenderOptions,
140 │   compressionWorthTrying,
141 │   MANIFEST_REPEAT,
142 │   type PreparedTransfer,
143 │   type SenderOptions,
144 │   type SenderStats,
145 │ } from './transfer/sender.js';
146 │ 
147 │ export {
148 │   TransferReceiver,
149 │   type ReceiverOptions,
150 │   type ReceiverPhase,
151 │   type ReceiverProgress,
152 │   type ReceiverResult,
153 │ } from './transfer/receiver.js';
154 │ 
155 │ export {
156 │   compressPayload,
157 │   decompressPayload,
158 │   looksCompressible,
159 │   MIN_GAIN,
160 │   MAX_COMPRESS_BYTES,
161 │   type Codec,
162 │   type CompressResult,
163 │ } from './transfer/compress.js';
164 │ 
165 │ // ---------------------------------------------------------------------------
166 │ // Crypto and integrity
167 │ // ---------------------------------------------------------------------------
168 │ export {
169 │   encryptPayload,
170 │   decryptPayload,
171 │   deriveKey,
172 │   passphraseFingerprint,
173 │   parseFingerprint,
174 │   DEFAULT_KDF,
175 │   FAST_KDF,
176 │   KEY_BYTES,
177 │   NONCE_BYTES,
178 │   SALT_BYTES,
179 │   TAG_BYTES,
180 │   type EncryptedPayload,
181 │   type KdfParams,
182 │ } from './crypto/aead.js';
183 │ 
184 │ export {
185 │   hashPayload,
186 │   hashHex,
187 │   shortHash,
188 │   verifyPayload,
189 │   partialConfidence,
190 │   type IntegrityReport,
191 │ } from './crypto/integrity.js';
192 │ 
193 │ export { crc16, crc32, crc32u } from './crypto/crc.js';
194 │ 
195 │ // ---------------------------------------------------------------------------
196 │ // Utilities
197 │ // ---------------------------------------------------------------------------
198 │ export {
199 │   concatBytes,
200 │   bytesEqual,
201 │   toHex,
202 │   fromHex,
203 │   toBase64Url,
204 │   fromBase64Url,
205 │   utf8Encode,
206 │   utf8Decode,
207 │   formatBytes,
208 │   randomBytes,
209 │   randomUint32,
210 │   sanitiseFileName,
211 │   randomSessionId,
212 │   sessionCode,
213 │   sessionCodeToId,
214 │ } from './util/bytes.js';
215 │ export { Rng, mix32, deriveSeed } from './util/rng.js';
216 │ export {
217 │   Utf8Encoder,
218 │   Utf8Decoder,
219 │   installWebTextCodecs,
220 │   hasNativeTextCodecs,
221 │   utf8EncodeWithFallback,
222 │   utf8DecodeWithFallback,
223 │ } from './util/utf8.js';
224 │ export {
225 │   base32Encode,
226 │   base32Decode,
227 │   base32EncodedLength,
228 │   base32DecodedLength,
229 │   isBase32,
230 │ } from './util/base32.js';
231 │ export { BitWriter, BitReader, packBits, unpackBits } from './util/bits.js';
232 │ 
233 │ /** Library version, reported to the backend and shown in the about screen. */
234 │ export const VERSION = '1.0.0';
235 │ 
236 │ /**
237 │  * Hard protocol limits. Documented because they are user-visible:
238 │  * the app refuses (with a clear message) rather than failing halfway.
239 │  */
240 │ export const LIMITS = {
241 │   /** Largest payload the app will send in one session. */
242 │   maxPayloadBytes: 64 * 1024 * 1024,
243 │   /** Largest text snippet (a shorter limit: text is usually pasted by hand). */
244 │   maxTextBytes: 4 * 1024 * 1024,
245 │   /** Largest number of LT blocks in a session. */
246 │   maxBlocks: 20_000,
247 │   /** Smallest and largest QR symbol the app will display. */
248 │   minVersion: 5,
249 │   maxVersion: 40,
250 │ } as const;
```

---

## `packages/core/src/util/bits.ts`

> 151 lines

**What it is.** MSB-first bit plumbing. QR payloads are not byte-aligned: a symbol is a
mode indicator (4 bits), a character-count indicator (8–16 bits), the data codewords,
a terminator of 0–7 bits, and then padding. Every one of those fields has to be written
in the order ISO/IEC 18004 specifies, so this module exists rather than sprinkling shift
arithmetic through the encoder.

**`BitWriter`.**

- Backed by a `Uint8Array` that **doubles** when it fills (`ensure`). No allocation
  churn, and the growth policy is amortised O(1) — this runs once per symbol, but the
  encoder re-uses a `SymbolCache` keyed by symbol contents, so it is called far more
  often than "once per frame" suggests.
- `writeBit` sets bit `0x80 >>> (bitLen & 7)` — the "& 7" is why the *bit* index and
  not the byte index picks the mask, and the `>>>` gives MSB-first order.
- `write(value, bits)` loops one bit at a time and **refuses more than 32 bits**. That
  refusal is load-bearing: JavaScript's bitwise operators are 32-bit, so `value >>> i`
  silently wraps above 32. Any wider value must go through `writeWide`.
- `writeWide` handles 33–53 bits by splitting into `high` (via division, not shifting —
  divisions are exact for safe integers) and a 32-bit low word. Used for the character
  count of a payload above 4 GiB, which cannot occur in this app but *can* occur in the
  encoder's own tests, and a silent truncation there would be a miserable bug to find.
- `padToByte` and `padWithAlternatingBytes` implement the two different paddings QR
  needs: bit-level alignment (zeros), then byte-level filling with the alternating
  `0xEC`/`0x11` pair. Using the wrong one produces a symbol that looks perfect and
  decodes to nonsense — which is exactly the class of bug the jsQR differential tests
  were written to catch.
- `toUint8Array` returns a `slice`, i.e. a **copy**. Callers mutate the result
  (the masker XORs in place), so handing out a view of the internal buffer would corrupt
  the writer's state.

**`BitReader`.**

- Bounds-checked on every access, and it throws rather than returning zeros. A decoder
  that reads past the end of a short symbol should fail loudly; returning `0` would
  make a truncated frame look like a valid one with a run of zero bytes.
- `read(bits)` is capped at 32 bits for the same reason as `write`, and returns
  `>>> 0` so callers get an unsigned value.
- `position` and `remaining` exist for diagnostics: `parseFrameDetailed` reports how
  many bits it consumed so a framing bug can be localised to a byte offset.

**`packBits` / `unpackBits`.** Straight inverses, used by the framing code (which has
to rebuild a bit field from a decoded byte array) and by tests (which assert on
individual bits rather than on opaque bytes). `unpackBits` takes an explicit
`bitLength` so it can expand a partial final byte, which `packBits` then zero-fills —
the round trip is deliberately lossy above `bitLength`, not accidentally so.

**Every line**

```ts
  1 │ /**
  2 │  * bits.ts - MSB-first bit-level reader/writer.
  3 │  *
  4 │  * QR Code payloads are bit-oriented: mode indicator (4 bits), character count
  5 │  * indicator (8..16 bits), then 8-bit data codewords and a terminator that is
  6 │  * not necessarily byte aligned. A byte-oriented buffer is not enough, so this
  7 │  * module provides a growable bit writer (encoder side) and a bounds-checked bit
  8 │  * reader (decoder/diagnostic side).
  9 │  *
 10 │  * Convention: every multi-bit value is written MSB-first, exactly as required by
 11 │  * ISO/IEC 18004 section 7.4.
 12 │  */
 13 │ 
 14 │ /** Growable, MSB-first bit writer backed by a Uint8Array. */
 15 │ export class BitWriter {
 16 │   private buf: Uint8Array;
 17 │   private bitLen = 0;
 18 │ 
 19 │   constructor(capacityBytes = 256) {
 20 │     this.buf = new Uint8Array(Math.max(8, capacityBytes));
 21 │   }
 22 │ 
 23 │   /** Number of bits written so far. */
 24 │   get length(): number {
 25 │     return this.bitLen;
 26 │   }
 27 │ 
 28 │   /** Number of whole bytes (rounded up) written so far. */
 29 │   get byteLength(): number {
 30 │     return (this.bitLen + 7) >>> 3;
 31 │   }
 32 │ 
 33 │   private ensure(extraBits: number): void {
 34 │     const needed = (this.bitLen + extraBits + 7) >>> 3;
 35 │     if (needed <= this.buf.length) return;
 36 │     let size = this.buf.length * 2;
 37 │     while (size < needed) size *= 2;
 38 │     const next = new Uint8Array(size);
 39 │     next.set(this.buf);
 40 │     this.buf = next;
 41 │   }
 42 │ 
 43 │   /** Append a single bit (0 or 1). */
 44 │   writeBit(bit: number): void {
 45 │     this.ensure(1);
 46 │     if (bit) this.buf[this.bitLen >>> 3] |= 0x80 >>> (this.bitLen & 7);
 47 │     this.bitLen++;
 48 │   }
 49 │ 
 50 │   /**
 51 │    * Append the low `bits` bits of `value`, MSB-first.
 52 │    * `bits` may be up to 32. Values wider than 32 bits must be split by callers.
 53 │    */
 54 │   write(value: number, bits: number): void {
 55 │     if (bits <= 0) return;
 56 │     if (bits > 32) throw new RangeError(`BitWriter.write supports at most 32 bits, got ${bits}`);
 57 │     for (let i = bits - 1; i >= 0; i--) this.writeBit((value >>> i) & 1);
 58 │   }
 59 │ 
 60 │   /**
 61 │    * Append a value up to 53 bits wide (i.e. safe-integer range), MSB-first.
 62 │    * Used for payload lengths that can exceed 2^32 on very large text payloads.
 63 │    */
 64 │   writeWide(value: number, bits: number): void {
 65 │     if (bits <= 32) return this.write(value >>> 0, bits);
 66 │     const high = Math.floor(value / 0x1_0000_0000);
 67 │     const low = value % 0x1_0000_0000;
 68 │     this.write(high, bits - 32);
 69 │     this.write(low, 32);
 70 │   }
 71 │ 
 72 │   /** Append every bit of a byte array. */
 73 │   writeBytes(bytes: Uint8Array): void {
 74 │     this.ensure(bytes.length * 8);
 75 │     for (let i = 0; i < bytes.length; i++) this.write(bytes[i], 8);
 76 │   }
 77 │ 
 78 │   /** Pad with `bit` (0 or 1) until the length is a multiple of 8. */
 79 │   padToByte(bit = 0): void {
 80 │     while ((this.bitLen & 7) !== 0) this.writeBit(bit);
 81 │   }
 82 │ 
 83 │   /** Pad with the ISO 18004 alternating bytes 0xEC / 0x11 up to `totalBits`. */
 84 │   padWithAlternatingBytes(totalBits: number): void {
 85 │     let toggle = true;
 86 │     while (this.bitLen < totalBits) {
 87 │       this.write(toggle ? 0xec : 0x11, 8);
 88 │       toggle = !toggle;
 89 │     }
 90 │   }
 91 │ 
 92 │   /** Copy of the written bytes (last partial byte is zero-filled). */
 93 │   toUint8Array(): Uint8Array {
 94 │     return this.buf.slice(0, this.byteLength);
 95 │   }
 96 │ }
 97 │ 
 98 │ /** Bounds-checked, MSB-first bit reader. */
 99 │ export class BitReader {
100 │   readonly bytes: Uint8Array;
101 │   private bitPos = 0;
102 │ 
103 │   constructor(bytes: Uint8Array) {
104 │     this.bytes = bytes;
105 │   }
106 │ 
107 │   get position(): number {
108 │     return this.bitPos;
109 │   }
110 │ 
111 │   get remaining(): number {
112 │     return this.bytes.length * 8 - this.bitPos;
113 │   }
114 │ 
115 │   readBit(): number {
116 │     if (this.bitPos >= this.bytes.length * 8) throw new RangeError('BitReader exhausted');
117 │     const b = (this.bytes[this.bitPos >>> 3] >>> (7 - (this.bitPos & 7))) & 1;
118 │     this.bitPos++;
119 │     return b;
120 │   }
121 │ 
122 │   /** Read `bits` (<= 32) MSB-first; returns an unsigned integer. */
123 │   read(bits: number): number {
124 │     if (bits > 32) throw new RangeError('BitReader.read supports at most 32 bits');
125 │     let out = 0;
126 │     for (let i = 0; i < bits; i++) out = (out << 1) | this.readBit();
127 │     return out >>> 0;
128 │   }
129 │ 
130 │   skip(bits: number): void {
131 │     this.bitPos += bits;
132 │     if (this.bitPos > this.bytes.length * 8) throw new RangeError('BitReader skipped past end');
133 │   }
134 │ }
135 │ 
136 │ /**
137 │  * Pack a bit array (one bit per entry, index 0 = MSB) into bytes.
138 │  * Used by the framing decoder to rebuild a bit field, and by unit tests.
139 │  */
140 │ export function packBits(bits: ArrayLike<number>): Uint8Array {
141 │   const out = new Uint8Array((bits.length + 7) >>> 3);
142 │   for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >>> 3] |= 0x80 >>> (i & 7);
143 │   return out;
144 │ }
145 │ 
146 │ /** Expand bytes into a 0/1 array (MSB first). Inverse of `packBits`. */
147 │ export function unpackBits(bytes: Uint8Array, bitLength = bytes.length * 8): Uint8Array {
148 │   const out = new Uint8Array(bitLength);
149 │   for (let i = 0; i < bitLength; i++) out[i] = (bytes[i >>> 3] >>> (7 - (i & 7))) & 1;
150 │   return out;
151 │ }
```

---

## `packages/core/src/util/bytes.ts`

> 236 lines

**What it is.** The byte-level toolbox. Every function here is written to run unchanged
identically in browsers, Web Workers, and Node, which rules out the platform conveniences:
`Buffer`, `Uint8Array.prototype.toBase64`, `structuredClone`, `TextEncoder` without a
guard. Where this file re-implements something the platform already has, the reason is
in a comment.

**The pieces, and the one fact about each that is easy to get wrong.**

| Function | The detail worth knowing |
| --- | --- |
| `concatBytes` | Accepts `Uint8Array`, `ArrayBuffer` *and* `number[]`, because callers differ: the protocol layer has typed arrays, the web layer sometimes has arrays from a canvas API. Normalising in one place is cheaper than three call-site conversions. |
| `bytesEqual` | **No early exit.** It XOR-accumulates the whole array before deciding. That makes it constant-time-ish, which matters because this compares AEAD tags and payload hashes on the receive path. Length mismatch still returns immediately (length is not secret). |
| `toHex` / `fromHex` | Hand-rolled rather than `toString(16)` per byte: one table lookup per nibble, no intermediate strings. `fromHex` rejects odd lengths and non-hex digits instead of producing half-garbage. |
| `toBase64Url` / `fromBase64Url` | URL-safe, **unpadded**. Padding is omitted so the output is safe to embed in a manifest field or a URL fragment without escaping. `fromBase64Url` also strips stray separators, because these strings travel through QR text and QR text travels through copy-paste. |
| `utf8Encode` / `utf8Decode` | A one-line platform fast path, then a correct pure-JS fallback. Note that `utf8Decode`'s fallback is the simple version — the *rigorous* decoder (WHATWG maximal subpart, exact ICU U+FFFD placement) lives in `util/utf8.ts` and is what the mobile app installs. This pair exists for the case where the platform has no codecs at all. |
| `formatBytes` | **Decimal** units (1000-based), matching what the operating systems show for file sizes. Displaying `1.05 MB` where the user's file manager says `1.00 MB` generates support questions. |
| `sanitiseFileName` | The name arrives from *another device* — it is untrusted input. The five rules are ordered: take the last path segment (kills `../../etc/passwd`), strip control characters and the Windows-reserved set `<>:"\|?*`, collapse whitespace, remove leading dots (kills `.`, `..`, and hidden files), then cap at 200 characters. Falls back to `received.bin` if nothing survives. |
| `randomBytes` | Uses `globalThis.crypto.getRandomValues` and **throws** if there is none. It deliberately does not fall back to `Math.random()`: silently weak randomness in a key or nonce is worse than a crash. The mobile app installs a CSPRNG shim in `index.ts` before any of this can run. |
| `randomSessionId` | 32 random bits. See below for why the on-screen code is 7 characters, not 6. |
| `sessionCode` / `sessionCodeToId` | Base-32 over an alphabet with `I`, `O`, `0`, `1` removed, so a code read off a screen and typed by a human cannot be misread. |

**Why the session code is seven characters.** A 6-character base-32 string carries 30
bits. Truncating a 32-bit session id into it would leave the top two bits unchecked —
the code would *look* like a session identifier while silently verifying only three
quarters of it. Seven characters carry 35 bits, so the mapping is lossless. This was a
real change during development (the first version was 6 characters), and the
`SESSION_CODE_LENGTH` constant exists so the encoder and the decoder cannot disagree
about it.

**`sessionCodeToId` is defensive by design.** It upper-cases, strips anything
non-alphanumeric (people type spaces and dashes), rejects wrong lengths, rejects
characters outside the alphabet, and rejects values above `0xFFFFFFFF` — a 7-character
code starting with a high letter can express more than 32 bits, and such a code cannot
have come from a real session id. Returning `null` instead of a wrong number means the
caller must decide what to do, and the two callers (the receiver's "check the code"
display and the backend's `GET /api/sessions/:code`) both treat `null` as "no such
session".

**Every line**

```ts
  1 │ /**
  2 │  * bytes.ts - small byte-level helpers used across the engine and the apps.
  3 │  * Everything here is allocation-explicit and avoids the platform-specific
  4 │  * buffer APIs (Buffer / Uint8Array.prototype.toBase64) so the same code runs in
  5 │  * Node, browsers, and Web Workers.
  6 │  */
  7 │ 
  8 │ /** Concatenate byte arrays (and ArrayBuffers/arrays) into one Uint8Array. */
  9 │ export function concatBytes(...parts: Array<Uint8Array | ArrayBuffer | number[]>): Uint8Array {
 10 │   let total = 0;
 11 │   const normalised: Uint8Array[] = [];
 12 │   for (const part of parts) {
 13 │     const view = part instanceof Uint8Array ? part : part instanceof ArrayBuffer ? new Uint8Array(part) : Uint8Array.from(part);
 14 │     normalised.push(view);
 15 │     total += view.length;
 16 │   }
 17 │   const out = new Uint8Array(total);
 18 │   let offset = 0;
 19 │   for (const view of normalised) {
 20 │     out.set(view, offset);
 21 │     offset += view.length;
 22 │   }
 23 │   return out;
 24 │ }
 25 │ 
 26 │ /** Constant-time-ish byte comparison (no early exit on the first mismatch). */
 27 │ export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
 28 │   if (a.length !== b.length) return false;
 29 │   let diff = 0;
 30 │   for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
 31 │   return diff === 0;
 32 │ }
 33 │ 
 34 │ const HEX = '0123456789abcdef';
 35 │ 
 36 │ export function toHex(bytes: Uint8Array): string {
 37 │   let out = '';
 38 │   for (let i = 0; i < bytes.length; i++) {
 39 │     out += HEX[bytes[i] >>> 4] + HEX[bytes[i] & 15];
 40 │   }
 41 │   return out;
 42 │ }
 43 │ 
 44 │ export function fromHex(hex: string): Uint8Array {
 45 │   const clean = hex.trim().toLowerCase();
 46 │   if (clean.length % 2 !== 0) throw new RangeError('Hex string must have an even length');
 47 │   const out = new Uint8Array(clean.length / 2);
 48 │   for (let i = 0; i < out.length; i++) {
 49 │     const byte = Number.parseInt(clean.substr(i * 2, 2), 16);
 50 │     if (Number.isNaN(byte)) throw new RangeError(`Invalid hex at offset ${i * 2}`);
 51 │     out[i] = byte;
 52 │   }
 53 │   return out;
 54 │ }
 55 │ 
 56 │ const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 57 │ 
 58 │ /** URL-safe base64 without padding (for manifest fields and QR-embedded codes). */
 59 │ export function toBase64Url(bytes: Uint8Array): string {
 60 │   let out = '';
 61 │   for (let i = 0; i < bytes.length; i += 3) {
 62 │     const b0 = bytes[i];
 63 │     const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
 64 │     const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
 65 │     out += BASE64URL_ALPHABET[b0 >>> 2];
 66 │     out += BASE64URL_ALPHABET[((b0 & 3) << 4) | (b1 >>> 4)];
 67 │     if (i + 1 < bytes.length) out += BASE64URL_ALPHABET[((b1 & 15) << 2) | (b2 >>> 6)];
 68 │     if (i + 2 < bytes.length) out += BASE64URL_ALPHABET[b2 & 63];
 69 │   }
 70 │   return out;
 71 │ }
 72 │ 
 73 │ export function fromBase64Url(text: string): Uint8Array {
 74 │   const clean = text.replace(/[^A-Za-z0-9\-_]/g, '');
 75 │   const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
 76 │   let bits = 0;
 77 │   let bitCount = 0;
 78 │   let index = 0;
 79 │   for (const char of clean) {
 80 │     const value = BASE64URL_ALPHABET.indexOf(char);
 81 │     if (value < 0) throw new RangeError(`Invalid base64url character "${char}"`);
 82 │     bits = (bits << 6) | value;
 83 │     bitCount += 6;
 84 │     if (bitCount >= 8) {
 85 │       bitCount -= 8;
 86 │       out[index++] = (bits >>> bitCount) & 0xff;
 87 │     }
 88 │   }
 89 │   return out.subarray(0, index);
 90 │ }
 91 │ 
 92 │ /** UTF-8 encode with a TextEncoder fast path and a correct pure-JS fallback. */
 93 │ export function utf8Encode(text: string): Uint8Array {
 94 │   if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
 95 │   const out: number[] = [];
 96 │   for (const char of text) {
 97 │     const cp = char.codePointAt(0)!;
 98 │     if (cp < 0x80) out.push(cp);
 99 │     else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
100 │     else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
101 │     else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
102 │   }
103 │   return new Uint8Array(out);
104 │ }
105 │ 
106 │ /** UTF-8 decode with a TextDecoder fast path and a pure-JS fallback. */
107 │ export function utf8Decode(bytes: Uint8Array): string {
108 │   if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
109 │   let out = '';
110 │   for (let i = 0; i < bytes.length; ) {
111 │     const b0 = bytes[i++];
112 │     if (b0 < 0x80) {
113 │       out += String.fromCharCode(b0);
114 │     } else if (b0 < 0xe0) {
115 │       out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
116 │     } else if (b0 < 0xf0) {
117 │       out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
118 │     } else {
119 │       const cp =
120 │         ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
121 │       out += String.fromCodePoint(cp);
122 │     }
123 │   }
124 │   return out;
125 │ }
126 │ 
127 │ /** Human-readable byte size ("1.44 MB"). */
128 │ export function formatBytes(bytes: number, decimals = 1): string {
129 │   if (!Number.isFinite(bytes) || bytes < 0) return '?';
130 │   if (bytes < 1000) return `${bytes} B`;
131 │   const units = ['kB', 'MB', 'GB'];
132 │   let value = bytes / 1000;
133 │   let unit = 0;
134 │   while (value >= 1000 && unit < units.length - 1) {
135 │     value /= 1000;
136 │     unit++;
137 │   }
138 │   return `${value.toFixed(decimals)} ${units[unit]}`;
139 │ }
140 │ 
141 │ /**
142 │  * Make a file name safe to write to disk.
143 │  *
144 │  * The name arrives from the SENDING DEVICE, which means it is attacker-controlled
145 │  * data from this app's point of view: a hostile sender can call its file
146 │  * "../../../Documents/important" and, without this function, a receiver that
147 │  * joins the name onto a directory path would happily write outside its own inbox.
148 │  * (The manifest validator rejects control characters, but it must not be the only
149 │  * line of defence in front of a filesystem call.)
150 │  *
151 │  * Rules, in order:
152 │  *   1. Take only the last path segment, so any directory component is discarded.
153 │  *   2. Strip anything that is a path separator or a control character.
154 │  *   3. Remove leading dots, so the result is never "." / ".." / a hidden file.
155 │  *   4. Collapse runs of whitespace and trim.
156 │  *   5. Fall back to "received.bin" if nothing usable is left.
157 │  *   6. Cap the length (most Android filesystems allow 255 bytes per component).
158 │  */
159 │ export function sanitiseFileName(name: string, fallback = 'received.bin'): string {
160 │   const lastSegment = name.split(/[\\/]/).pop() ?? '';
161 │   const cleaned = lastSegment
162 │     // eslint-disable-next-line no-control-regex
163 │     .replace(/[\u0000-\u001f\u007f]/g, '')
164 │     .replace(/[<>:"|?*]/g, '_')
165 │     .replace(/\s+/g, ' ')
166 │     .trim()
167 │     .replace(/^\.+/, '')
168 │     .slice(0, 200);
169 │   return cleaned.length > 0 ? cleaned : fallback;
170 │ }
171 │ 
172 │ /** Uniform random bytes using the platform CSPRNG. Throws if unavailable. */
173 │ export function randomBytes(length: number): Uint8Array {
174 │   const out = new Uint8Array(length);
175 │   const cryptoObj: Crypto | undefined =
176 │     typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
177 │   if (cryptoObj?.getRandomValues) {
178 │     cryptoObj.getRandomValues(out);
179 │     return out;
180 │   }
181 │   throw new Error('No CSPRNG available: run on a platform with crypto.getRandomValues');
182 │ }
183 │ 
184 │ /** Random 32-bit unsigned integer. */
185 │ export function randomUint32(): number {
186 │   const bytes = randomBytes(4);
187 │   return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
188 │ }
189 │ 
190 │ /**
191 │  * Random session id. Session ids appear on screen as a 6-character code, so we
192 │  * use the full 32-bit space to keep collisions improbable even in a room full of
193 │  * simultaneous transfers.
194 │  */
195 │ export function randomSessionId(): number {
196 │   return randomUint32();
197 │ }
198 │ 
199 │ const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
200 │ 
201 │ /**
202 │  * Human-readable session code.
203 │  *
204 │  * Seven characters, not six: a 6-character base-32 string can only express
205 │  * 2^30 values, so it would silently drop the top two bits of a 32-bit id and
206 │  * "type the code to check you are on the right sender" would then be checking
207 │  * only 30 of 32 bits. Seven characters give 35 bits, which is lossless and still
208 │  * fits comfortably under a QR code on a phone screen.
209 │  */
210 │ export const SESSION_CODE_LENGTH = 7;
211 │ 
212 │ /** Render a session id as a 7-character, look-alike-free code. */
213 │ export function sessionCode(sessionId: number): string {
214 │   let value = sessionId >>> 0;
215 │   let out = '';
216 │   for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
217 │     out = CODE_ALPHABET[value % 32] + out;
218 │     value = Math.floor(value / 32);
219 │   }
220 │   return out;
221 │ }
222 │ 
223 │ /** Parse a session code back to an id. Returns null for anything malformed. */
224 │ export function sessionCodeToId(code: string): number | null {
225 │   const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
226 │   if (clean.length !== SESSION_CODE_LENGTH) return null;
227 │   let value = 0;
228 │   for (const char of clean) {
229 │     const index = CODE_ALPHABET.indexOf(char);
230 │     if (index < 0) return null;
231 │     value = value * 32 + index;
232 │   }
233 │   // Reject codes that would overflow 32 bits (they are not valid session ids).
234 │   if (value > 0xffffffff) return null;
235 │   return value >>> 0;
236 │ }
```

---

## `packages/core/src/util/base32.ts`

> 113 lines

**What it is.** RFC 4648 base32, the default wire encoding for QR frames. The header
comment is the design rationale in full, so this walkthrough adds only the details a
reader would otherwise have to reconstruct from the code.

**The incompatibility it exists to solve.** On iOS and Android the camera APIs do not
give you the symbol's bytes: iOS Vision yields a Swift `String`, Android ML Kit yields a
`String` decoded as UTF-8 with invalid sequences replaced by U+FFFD. Send a file whose
bytes are not valid UTF-8 through that pipeline and the payload comes back *changed*,
the SHA-256 check fails, and there is no error to point at the cause. Base32 makes every
frame valid UTF-8 by construction.

**The cost, and why it is smaller than it looks.** Base32 expands bytes by 8/5 = 1.6×,
but its alphabet (`A–Z`, `2–7`) is a subset of QR's *alphanumeric* mode, which packs two
characters into 11 bits. So the real cost is 8.80 bits per payload byte against 8.00 for
raw byte mode — 10%, not 60%. The comparison table in the header (base32 8.80, base64
10.67, hex 16.5) is the reason base32 wins despite looking like the dumbest of the three
choices.

**Unpadded on purpose.** `base32EncodedLength` is `ceil(8n/5)`, **not** the familiar
"8 characters per 5 bytes". That rule describes the *padded* convention: `=` is not in
QR's alphanumeric set, so adding it would push the entire symbol into byte mode and cost
about 30% — more than the encoding saves. `base32Decode` still accepts `=` and
whitespace on input for robustness, and tolerates lowercase because some scanners
normalise case.

**The decode path is strict on purpose.** Anything above code point 127 throws
(`Non-ASCII character in base32 payload`), and so does any character outside the
alphabet. The alternative — skipping unknown characters — would turn a misread symbol
into plausible-looking but wrong bytes, which then fails the CRC 13 bytes later with a
message that says nothing about the real cause. Note the asymmetry: the *decoder* is
forgiving about whitespace and padding (both harmless), and rigid about content (which
is not).

**The `subarray` at the end is not a copy.** `base32Decode` over-allocates by one byte
(to absorb a partial 5-bit group) and returns a view. Every caller treats the result as
read-only — `parseFrame` slices out of it immediately — so the view is safe, and cutting
it avoids a copy on the hot path where a receiver handles 15–30 symbols per second.

**Every line**

```ts
  1 │ /**
  2 │  * base32.ts - RFC 4648 base32, the text-safe wire encoding for QR frames.
  3 │  *
  4 │  * WHY THIS EXISTS
  5 │  * ---------------
  6 │  * A QR symbol can carry arbitrary bytes (ISO 18004 "byte mode"), and a pure-JS
  7 │  * decoder like jsQR can return those bytes. However, hardware-accelerated browser
  8 │  * barcode APIs (`window.BarcodeDetector`, backed by OS vision engines) return
  9 │  * `DetectedBarcode.rawValue` as a UTF-16 DOMString, not raw bytes — any byte
 10 │  * sequence that is not valid UTF-8 is replaced with U+FFFD at that boundary.
 11 │  *
 12 │  * So a file containing arbitrary bytes cannot survive a native scan: a 0x80 byte
 13 │  * comes back mangled, and the SHA-256 check fails with no clue why. Encoding the
 14 │  * frame payload as Base32 fixes this at a cost of only ~10% - and it costs even
 15 │  * less than it looks, because Base32's alphabet (A-Z, 2-7) is a *subset of QR's
 16 │  * alphanumeric mode*, which packs 2 characters into 11 bits instead of 16:
 17 │  *
 18 │  *   raw byte mode        8.00 bits per payload byte
 19 │  *   base64 in byte mode  10.67 bits per payload byte   (+33%)
 20 │  *   base32 in alnum mode  8.80 bits per payload byte   (+10%)   <-- used here
 21 │  *
 22 │  * Base32 is therefore both the most compatible AND (behind raw bytes) the
 23 │  * cheapest text-safe option. Hex would cost 16.5 bits/byte (+106%).
 24 │  *
 25 │  * The encoding is signalled per frame in the header flags, so a web-to-web
 26 │  * transfer can still opt into raw byte mode for the extra 10%.
 27 │  */
 28 │ 
 29 │ const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 30 │ 
 31 │ /** Reverse lookup table (-1 = not a base32 character). */
 32 │ const DECODE = (() => {
 33 │   const table = new Int8Array(128).fill(-1);
 34 │   for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
 35 │   // Accept lowercase input: some scanners normalise case.
 36 │   for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET[i].toLowerCase().charCodeAt(0)] = i;
 37 │   return table;
 38 │ })();
 39 │ 
 40 │ /**
 41 │  * Number of base32 characters needed to encode `length` bytes.
 42 │  *
 43 │  * Note this is ceil(8n/5), NOT the "8 characters per 5 bytes" rule of thumb: that
 44 │  * rule describes the *padded* RFC 4648 convention, and we deliberately emit no
 45 │  * padding (the '=' character is not in QR's alphanumeric set, so padding would
 46 │  * force the whole symbol back into byte mode and cost ~30% more).
 47 │  */
 48 │ export function base32EncodedLength(length: number): number {
 49 │   return Math.ceil((length * 8) / 5);
 50 │ }
 51 │ 
 52 │ /** Number of bytes a base32 string of `chars` characters decodes to (upper bound). */
 53 │ export function base32DecodedLength(chars: number): number {
 54 │   return Math.floor((chars * 5) / 8);
 55 │ }
 56 │ 
 57 │ /**
 58 │  * Encode bytes as an unpadded uppercase base32 string.
 59 │  *
 60 │  * Unpadded is deliberate: '=' is not in QR's alphanumeric set, so padding would
 61 │  * force the whole symbol back into byte mode and throw away the 10% advantage.
 62 │  */
 63 │ export function base32Encode(bytes: Uint8Array): string {
 64 │   let out = '';
 65 │   let buffer = 0;
 66 │   let bits = 0;
 67 │   for (let i = 0; i < bytes.length; i++) {
 68 │     buffer = (buffer << 8) | bytes[i];
 69 │     bits += 8;
 70 │     while (bits >= 5) {
 71 │       bits -= 5;
 72 │       out += ALPHABET[(buffer >>> bits) & 31];
 73 │     }
 74 │   }
 75 │   if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
 76 │   return out;
 77 │ }
 78 │ 
 79 │ /**
 80 │  * Decode a base32 string. Ignores whitespace and padding, and tolerates
 81 │  * lowercase. Throws on characters outside the alphabet so that a misdecoded
 82 │  * symbol fails loudly rather than producing plausible-looking bytes.
 83 │  */
 84 │ export function base32Decode(text: string): Uint8Array {
 85 │   const out = new Uint8Array(base32DecodedLength(text.length) + 1);
 86 │   let written = 0;
 87 │   let buffer = 0;
 88 │   let bits = 0;
 89 │   for (let i = 0; i < text.length; i++) {
 90 │     const code = text.charCodeAt(i);
 91 │     if (code === 61 /* '=' */ || code === 32 || code === 10 || code === 13 || code === 9) continue;
 92 │     if (code > 127) throw new RangeError(`Non-ASCII character in base32 payload at index ${i}`);
 93 │     const value = DECODE[code];
 94 │     if (value < 0) throw new RangeError(`Invalid base32 character "${text[i]}" at index ${i}`);
 95 │     buffer = (buffer << 5) | value;
 96 │     bits += 5;
 97 │     if (bits >= 8) {
 98 │       bits -= 8;
 99 │       out[written++] = (buffer >>> bits) & 0xff;
100 │     }
101 │   }
102 │   return out.subarray(0, written);
103 │ }
104 │ 
105 │ /** True if every character is inside QR's alphanumeric set (so alnum mode applies). */
106 │ export function isBase32(text: string): boolean {
107 │   if (text.length === 0) return false;
108 │   for (let i = 0; i < text.length; i++) {
109 │     const value = DECODE[text.charCodeAt(i)];
110 │     if (value < 0) return false;
111 │   }
112 │   return true;
113 │ }
```

---

## `packages/core/src/util/rng.ts`

> 93 lines

**What it is.** A deterministic, seedable PRNG — and the word *deterministic* is the
entire point. Fountain coding requires that the sender and the receiver derive the
**same set of source-block indices from the same frame seed**. The seed travels in the
frame header (4 bytes); everything else about a frame's contents follows from it
locally. If the two sides disagreed about even one index, the frame would be XORed into
the wrong equation.

That constraint rules out every convenient option:

- `Math.random()` — not seedable at all.
- A platform PRNG — V8, SpiderMonkey, and JavaScriptCore across browsers do not promise the same
  stream from the same seed, and neither does Chrome against Node.

So the protocol's randomness comes exclusively from this file. The only place real
randomness is needed is where it is genuinely secret: key material, the AEAD nonce, the
salt and the session id, all of which come from `crypto.getRandomValues`
(`util/bytes.ts`). Those choices are *not* part of the protocol's deterministic state,
which is exactly why the separation works.

**The algorithm is mulberry32** (`nextUint32`): one 32-bit add of a golden-ratio
constant into a counter, then a three-step multiplication/xor avalanche. The header
records the properties that matter here: period 2³², good statistical behaviour, and
extremely cheap. "Good statistical behaviour" is a softer bar than "cryptographically
secure", and deliberately so — confidentiality is provided by XChaCha20-Poly1305 in
`crypto/aead.ts`, and a frame's index set is *public information* anyway (it can be
derived by anyone holding the seed, which is in the clear in the header). Using a
cryptographic PRNG here would cost speed for no security.

**The three details that took tuning.**

1. **`mix32` on the seed** (splitmix32's finalizer). Frame seeds are *consecutive*
   integers — slot 5, slot 6, slot 7 — so the constructor mixes the seed before use.
   Without it, neighbouring seeds produce correlated first outputs, and the histogram of
   the first frame's degrees was visibly wrong during the degree-distribution
   experiments.
2. **Discarding the first output.** mulberry32's first value for tiny seeds (0, 1, 2) is
   slightly biased toward small integers. One discarded call removes a warm-up artefact
   that only showed up for the smallest k values.
3. **Rejection sampling in `nextInt`.** `nextUint32() % bound` favours low values, and
   here "low values" means low *block indices*: some source blocks would be covered by
   systematically fewer frames than others, which shows up as a transfer that stalls on
   its last few blocks. `limit = 2³² − (2³² mod bound)` and a re-draw loop cost nothing
   measurable and remove the bias entirely. `nextInt` also validates its bound and
   short-circuits `bound === 1`.

**`shuffle`.** A Fisher–Yates using this stream, present because the sender's systematic
prefix and the sampler both need a deterministic permutation of block indices. Note that
`lt.ts` deliberately does **not** use `shuffle` for its per-frame neighbour selection: it
uses a sparse partial Fisher–Yates with a guard (documented in that file) because
shuffling the full index array once per frame was O(k) work per frame and dominated the
encoder at k = 1024.

**`deriveSeed(seed, label)`.** Expands one seed into independent child streams — used to
separate the "which blocks does this frame cover" stream from the "which frames does
this sender emit" stream, so that adding a feature to one cannot shift the other.

**Every line**

```ts
 1 │ /**
 2 │  * rng.ts - deterministic, seedable pseudo-random number generator.
 3 │  *
 4 │  * Why not Math.random()?
 5 │  *   Fountain codes require that sender and receiver derive the *same* set of
 6 │  *   source-block indices from the same frame seed. If the generator were not
 7 │  *   reproducible (or differed between a Safari JavaScriptCore build and
 8 │  *   V8 in Chrome), frames would decode to garbage. So every random decision in
 9 │  *   the protocol comes from this class, seeded from a 32-bit frame seed that is
10 │  *   printed in the frame header.
11 │  *
12 │  * Algorithm: mulberry32 - a 32-bit counter-based PRNG with a 2^32 period,
13 │  * excellent statistical behaviour for this use case (it passes the standard
14 │  * smallcrush-style batteries), and extremely cheap: one 32-bit multiply chain
15 │  * per output word. Crypto-grade randomness is explicitly NOT required here;
16 │  * confidentiality is provided by a real AEAD in crypto/aead.ts.
17 │  */
18 │ 
19 │ const GOLDEN_GAMMA = 0x6d2b79f5;
20 │ 
21 │ /** 32-bit avalanche mixer used to expand seeds into state (splitmix32 finalizer). */
22 │ export function mix32(seed: number): number {
23 │   let z = (seed + GOLDEN_GAMMA) | 0;
24 │   z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
25 │   z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
26 │   return (z ^ (z >>> 15)) >>> 0;
27 │ }
28 │ 
29 │ /** Derive a 32-bit child seed from a parent seed and a 32-bit label. */
30 │ export function deriveSeed(seed: number, label: number): number {
31 │   return mix32((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ label) | 0);
32 │ }
33 │ 
34 │ export class Rng {
35 │   private state: number;
36 │ 
37 │   /**
38 │    * @param seed any 32-bit integer; seeds are mixed so that neighbouring values
39 │    *             (e.g. frame seeds 1000 and 1001) produce uncorrelated streams.
40 │    */
41 │   constructor(seed: number) {
42 │     this.state = mix32(seed | 0);
43 │     // Discard the first output so that low-entropy seeds (0, 1, 2 ...) do not
44 │     // show a warm-up bias in the very first generated value.
45 │     this.nextUint32();
46 │   }
47 │ 
48 │   /** Uniform 32-bit unsigned integer in [0, 2^32). */
49 │   nextUint32(): number {
50 │     let a = (this.state + GOLDEN_GAMMA) | 0;
51 │     this.state = a;
52 │     let t = a;
53 │     t = Math.imul(t ^ (t >>> 15), 1 | t);
54 │     t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
55 │     return (t ^ (t >>> 14)) >>> 0;
56 │   }
57 │ 
58 │   /** Uniform float in [0, 1). */
59 │   nextFloat(): number {
60 │     return this.nextUint32() / 4294967296;
61 │   }
62 │ 
63 │   /**
64 │    * Uniform integer in [0, bound) with rejection sampling.
65 │    *
66 │    * Rejection sampling matters: a naive `nextUint32() % bound` slightly favours
67 │    * low values, which biases which source blocks a frame covers and measurably
68 │    * slows LT decoding (some blocks get covered less often than others).
69 │    */
70 │   nextInt(bound: number): number {
71 │     if (!Number.isInteger(bound) || bound <= 0) {
72 │       throw new RangeError(`nextInt bound must be a positive integer, got ${bound}`);
73 │     }
74 │     if (bound === 1) return 0;
75 │     if (bound > 0x1_0000_0000) throw new RangeError('nextInt bound must be <= 2^32');
76 │     // Largest multiple of `bound` that fits in 32 bits: 2^32 - (2^32 mod bound).
77 │     const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
78 │     let value = this.nextUint32();
79 │     while (value >= limit) value = this.nextUint32();
80 │     return value % bound;
81 │   }
82 │ 
83 │   /** Fisher-Yates shuffle of a Uint32Array in place, using this stream. */
84 │   shuffle(arr: Uint32Array): Uint32Array {
85 │     for (let i = arr.length - 1; i > 0; i--) {
86 │       const j = this.nextInt(i + 1);
87 │       const tmp = arr[i];
88 │       arr[i] = arr[j];
89 │       arr[j] = tmp;
90 │     }
91 │     return arr;
92 │   }
93 │ }
```

---

## `packages/core/src/util/utf8.ts`

> 300 lines

Pure-TypeScript UTF-8 encoder and decoder fallback, plus an optional global polyfill installer (`installUtf8Polyfill`). Modern browsers and Node 20+ provide native `TextEncoder` and `TextDecoder`, which `utf8Encode` and `utf8Decode` prefer whenever present. Keeping a deterministic RFC 3629 implementation in `@lightbeam/core` guarantees identical byte-for-byte behavior in stripped-down JS sandboxes, embedded webviews, and headless test runners — including strict surrogate-pair handling and U+FFFD replacement on malformed byte sequences.

**Every line**

```ts
  1 │ /**
  2 │  * utf8.ts - UTF-8 codecs, and a way to install them where the platform forgot to.
  3 │  *
  4 │  * THE PROBLEM THIS SOLVES
  5 │  * -----------------------
  6 │  * The engine encodes text, decodes manifest JSON, derives keys from a passphrase
  7 │  * and reads the sender's name out of a QR frame - all of which needs UTF-8. On
  8 │  * Node and modern browsers, `TextEncoder`/`TextDecoder` are built in; constrained
  9 │  * embedded JS sandboxes and stripped worker runtimes sometimes omit one or both.
 10 │  *
 11 │  * Implementing deterministic WHATWG-conformant codecs here, tested byte-for-byte
 12 │  * against Node's built-ins (see test/utf8.test.ts), guarantees identical string
 13 │  * handling across every browser, worker and test runtime.
 14 │  *
 15 │  * Correctness notes, because "just encode the code units" is not correct:
 16 │  *   - code points above U+FFFF (emoji, rare CJK) are surrogate PAIRS in
 17 │  *     JavaScript and must become one 4-byte sequence, not two 3-byte ones;
 18 │  *   - a lone surrogate is not encodable; WHATWG mandates U+FFFD, and Node does
 19 │  *     the same, so the tests pin that behaviour;
 20 │  *   - the decoder must reject overlong encodings, surrogates and out-of-range
 21 │  *     code points, replacing each bad sequence with exactly one U+FFFD - a
 22 │  *     decoder that "repairs" silently would turn a corrupted manifest into a
 23 │  *     plausible-but-wrong one.
 24 │  */
 25 │ 
 26 │ const REPLACEMENT = 0xfffd;
 27 │ 
 28 │ /** WHATWG-conformant UTF-8 encoder. */
 29 │ export class Utf8Encoder {
 30 │   /**
 31 │    * Encode a string to UTF-8 bytes.
 32 │    *
 33 │    * The output is sized exactly: the string is measured in a first pass (one
 34 │    * arithmetic branch per code unit, no allocation) and the array is allocated
 35 │    * once at the final length. The alternative - allocate 3x, encode, then slice -
 36 │    * is the same number of passes plus a copy.
 37 │    *
 38 │    * @param input anything; non-strings are coerced with String(), matching
 39 │    *              TextEncoder.encode, which the tests compare against.
 40 │    */
 41 │   encode(input = ''): Uint8Array {
 42 │     const text = String(input);
 43 │     // Worst case is 3 bytes per UTF-16 code unit + 1; measure first so the
 44 │     // result is exactly sized rather than over-allocated and sliced.
 45 │     let size = 0;
 46 │     for (let i = 0; i < text.length; i++) {
 47 │       const code = text.charCodeAt(i);
 48 │       if (code < 0x80) size += 1;
 49 │       else if (code < 0x800) size += 2;
 50 │       else if (code >= 0xd800 && code <= 0xdbff) {
 51 │         // High surrogate: 4 bytes if a valid low surrogate follows, else U+FFFD.
 52 │         const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
 53 │         if (next >= 0xdc00 && next <= 0xdfff) {
 54 │           size += 4;
 55 │           i++;
 56 │         } else size += 3;
 57 │       } else if (code >= 0xdc00 && code <= 0xdfff) {
 58 │         size += 3; // lone low surrogate -> U+FFFD
 59 │       } else size += 3;
 60 │     }
 61 │ 
 62 │     const out = new Uint8Array(size);
 63 │     let offset = 0;
 64 │     for (let i = 0; i < text.length; i++) {
 65 │       let code = text.charCodeAt(i);
 66 │       if (code >= 0xd800 && code <= 0xdbff) {
 67 │         const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
 68 │         if (next >= 0xdc00 && next <= 0xdfff) {
 69 │           code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
 70 │           i++;
 71 │         } else {
 72 │           code = REPLACEMENT;
 73 │         }
 74 │       } else if (code >= 0xdc00 && code <= 0xdfff) {
 75 │         code = REPLACEMENT;
 76 │       }
 77 │ 
 78 │       if (code < 0x80) {
 79 │         out[offset++] = code;
 80 │       } else if (code < 0x800) {
 81 │         out[offset++] = 0xc0 | (code >> 6);
 82 │         out[offset++] = 0x80 | (code & 0x3f);
 83 │       } else if (code < 0x10000) {
 84 │         out[offset++] = 0xe0 | (code >> 12);
 85 │         out[offset++] = 0x80 | ((code >> 6) & 0x3f);
 86 │         out[offset++] = 0x80 | (code & 0x3f);
 87 │       } else {
 88 │         out[offset++] = 0xf0 | (code >> 18);
 89 │         out[offset++] = 0x80 | ((code >> 12) & 0x3f);
 90 │         out[offset++] = 0x80 | ((code >> 6) & 0x3f);
 91 │         out[offset++] = 0x80 | (code & 0x3f);
 92 │       }
 93 │     }
 94 │     return out;
 95 │   }
 96 │ }
 97 │ 
 98 │ /** WHATWG-conformant UTF-8 decoder (non-streaming use, which is all we need). */
 99 │ export class Utf8Decoder {
100 │   readonly encoding = 'utf-8';
101 │   readonly fatal = false;
102 │   readonly ignoreBOM: boolean;
103 │ 
104 │   constructor(label = 'utf-8', options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
105 │     void label;
106 │     this.ignoreBOM = options.ignoreBOM ?? false;
107 │     if (options.fatal) {
108 │       // The engine never asks for fatal mode; failing loudly would turn a single
109 │       // damaged byte into a dead session, and the integrity check downstream is
110 │       // what actually decides whether data is good.
111 │       throw new RangeError('Utf8Decoder fallback does not implement fatal decoding');
112 │     }
113 │   }
114 │ 
115 │   decode(input?: Uint8Array | ArrayBuffer | ArrayBufferView): string {
116 │     if (input === undefined) return '';
117 │     const bytes =
118 │       input instanceof Uint8Array
119 │         ? input
120 │         : input instanceof ArrayBuffer
121 │           ? new Uint8Array(input)
122 │           : new Uint8Array((input as ArrayBufferView).buffer, (input as ArrayBufferView).byteOffset, (input as ArrayBufferView).byteLength);
123 │ 
124 │     let out = '';
125 │     let i = 0;
126 │ 
127 │     // A leading BOM is stripped unless ignoreBOM is set, matching TextDecoder.
128 │     if (!this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
129 │       i = 3;
130 │     }
131 │ 
132 │     while (i < bytes.length) {
133 │       const lead = bytes[i];
134 │ 
135 │       if (lead < 0x80) {
136 │         out += String.fromCharCode(lead);
137 │         i++;
138 │         continue;
139 │       }
140 │ 
141 │       /*
142 │        * Work out what this lead byte promises.
143 │        *
144 │        * The `second` range is the part that makes this a *maximal subpart*
145 │        * decoder rather than an approximate one: each of the four special lead
146 │        * bytes (E0, ED, F0, F4) narrows the legal second byte, and that narrowing
147 │        * is exactly what rejects overlong encodings (E0 80 ...), UTF-8 encoded
148 │        * surrogates (ED A0 ...), and code points beyond U+10FFFF (F4 90 ...).
149 │        *
150 │        * Matching the platform decoders here is not pedantry. Node's TextDecoder
151 │        * (via ICU) emits one U+FFFD per ill-formed maximal subpart, and so does
152 │        * the browser. A decoder that emits a different number of replacement
153 │        * characters would produce different strings for the same damaged input -
154 │        * and the fallback runs on iOS and Android, where nothing else would catch
155 │        * the discrepancy (see test/utf8.test.ts, which compares against Node).
156 │        */
157 │       let needed: number;
158 │       let codePoint: number;
159 │       let secondMin: number;
160 │       let secondMax: number;
161 │ 
162 │       if (lead >= 0xc2 && lead <= 0xdf) {
163 │         needed = 1;
164 │         codePoint = lead & 0x1f;
165 │         secondMin = 0x80;
166 │         secondMax = 0xbf;
167 │       } else if (lead === 0xe0) {
168 │         needed = 2;
169 │         codePoint = lead & 0x0f;
170 │         secondMin = 0xa0;
171 │         secondMax = 0xbf;
172 │       } else if ((lead >= 0xe1 && lead <= 0xec) || lead === 0xee || lead === 0xef) {
173 │         needed = 2;
174 │         codePoint = lead & 0x0f;
175 │         secondMin = 0x80;
176 │         secondMax = 0xbf;
177 │       } else if (lead === 0xed) {
178 │         needed = 2;
179 │         codePoint = lead & 0x0f;
180 │         secondMin = 0x80;
181 │         secondMax = 0x9f; // excludes surrogates U+D800..U+DFFF
182 │       } else if (lead === 0xf0) {
183 │         needed = 3;
184 │         codePoint = lead & 0x07;
185 │         secondMin = 0x90;
186 │         secondMax = 0xbf;
187 │       } else if (lead >= 0xf1 && lead <= 0xf3) {
188 │         needed = 3;
189 │         codePoint = lead & 0x07;
190 │         secondMin = 0x80;
191 │         secondMax = 0xbf;
192 │       } else if (lead === 0xf4) {
193 │         needed = 3;
194 │         codePoint = lead & 0x07;
195 │         secondMin = 0x80;
196 │         secondMax = 0x8f; // excludes anything above U+10FFFF
197 │       } else {
198 │         // 0x80-0xC1 (continuation bytes and overlong leads) and 0xF5-0xFF can
199 │         // never begin a sequence: each is its own maximal subpart.
200 │         out += String.fromCharCode(REPLACEMENT);
201 │         i++;
202 │         continue;
203 │       }
204 │ 
205 │       const sequenceStart = i;
206 │       i++;
207 │ 
208 │       // First continuation byte: the special range applies.
209 │       if (i >= bytes.length) {
210 │         out += String.fromCharCode(REPLACEMENT); // truncated at end of input
211 │         break;
212 │       }
213 │       const second = bytes[i];
214 │       if (second < secondMin || second > secondMax) {
215 │         // Only the lead byte is ill-formed; do not consume the byte that failed.
216 │         out += String.fromCharCode(REPLACEMENT);
217 │         i = sequenceStart + 1;
218 │         continue;
219 │       }
220 │       codePoint = (codePoint << 6) | (second & 0x3f);
221 │       needed--;
222 │       i++;
223 │ 
224 │       // Remaining continuation bytes: plain 0x80-0xBF range.
225 │       let truncated = false;
226 │       while (needed > 0) {
227 │         if (i >= bytes.length) {
228 │           truncated = true;
229 │           break;
230 │         }
231 │         const continuation = bytes[i];
232 │         if (continuation < 0x80 || continuation > 0xbf) break;
233 │         codePoint = (codePoint << 6) | (continuation & 0x3f);
234 │         needed--;
235 │         i++;
236 │       }
237 │ 
238 │       if (truncated) {
239 │         out += String.fromCharCode(REPLACEMENT);
240 │         break;
241 │       }
242 │       if (needed > 0) {
243 │         // The prefix was well-formed but the next byte cannot continue it: one
244 │         // U+FFFD for the prefix, and the offending byte is reconsidered.
245 │         out += String.fromCharCode(REPLACEMENT);
246 │         continue;
247 │       }
248 │ 
249 │       if (codePoint <= 0xffff) {
250 │         out += String.fromCharCode(codePoint);
251 │       } else {
252 │         const adjusted = codePoint - 0x10000;
253 │         out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
254 │       }
255 │     }
256 │ 
257 │     return out;
258 │   }
259 │ }
260 │ 
261 │ /**
262 │  * Install the codecs as globals if the runtime is missing them.
263 │  *
264 │  * Returns a description of what was installed, which the mobile app shows in the
265 │  * About screen's diagnostics - so "why does this build think it needs a
266 │  * polyfill?" is answerable from a screenshot.
267 │  */
268 │ export function installWebTextCodecs(): { textEncoder: boolean; textDecoder: boolean } {
269 │   const target = globalThis as unknown as {
270 │     TextEncoder?: unknown;
271 │     TextDecoder?: unknown;
272 │   };
273 │   const installed = { textEncoder: false, textDecoder: false };
274 │   if (typeof target.TextEncoder === 'undefined') {
275 │     target.TextEncoder = Utf8Encoder;
276 │     installed.textEncoder = true;
277 │   }
278 │   if (typeof target.TextDecoder === 'undefined') {
279 │     target.TextDecoder = Utf8Decoder;
280 │     installed.textDecoder = true;
281 │   }
282 │   return installed;
283 │ }
284 │ 
285 │ /** True when the runtime provides UTF-8 codecs natively (Node, browsers, Deno). */
286 │ export function hasNativeTextCodecs(): boolean {
287 │   return typeof (globalThis as { TextEncoder?: unknown }).TextEncoder !== 'undefined';
288 │ }
289 │ 
290 │ /** UTF-8 encode using whatever is available. */
291 │ export function utf8EncodeWithFallback(text: string): Uint8Array {
292 │   const Ctor = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
293 │   return Ctor ? new Ctor().encode(text) : new Utf8Encoder().encode(text);
294 │ }
295 │ 
296 │ /** UTF-8 decode using whatever is available. */
297 │ export function utf8DecodeWithFallback(bytes: Uint8Array): string {
298 │   const Ctor = (globalThis as { TextDecoder?: new () => { decode(input: Uint8Array): string } }).TextDecoder;
299 │   return Ctor ? new Ctor().decode(bytes) : new Utf8Decoder().decode(bytes);
300 │ }
```

---

## `packages/core/src/qr/tables.ts`

> 482 lines

**What it is.** The static data ISO/IEC 18004 defines for QR versions 1–40: total codewords,
Reed–Solomon block layout, alignment-pattern positions, and byte-mode capacity, for each of
the four error-correction levels. Around 480 lines of numbers that no human should type by
hand — and nobody did.

**It is generated.** `tools/gen-qr-tables.mjs` writes this file; `npm run gen:qrtables`
regenerates it; `node tools/gen-qr-tables.mjs --check` fails if the file on disk differs
from what the generator would produce, which is how a hand-edit gets caught. The header's
"do not edit by hand" is enforced, not requested.

**Why generate rather than trust a copy-paste.** These tables are where a QR implementation
goes quietly wrong: a single wrong entry in `EC_BLOCKS` produces symbols that decode
correctly for versions 1–9 and fail from version 10 onward, which is exactly the kind of
bug that survives a casual test. The generator derives what can be derived (total codewords
from the module count and the function-pattern areas) and carries only the values that are
genuinely arbitrary in the standard; `--check` then pins the result so the derivation can be
re-run at any time.

**The indexing convention.** Arrays are **1-based by version** — index 0 is a placeholder.
`SYMBOL_TOTAL_CODEWORDS[7]` is version 7. This is stated at the top of the file because it
is the first thing a reader will get wrong when scanning the arrays: they look like ordinary
zero-based lookups.

**What lives here.**

| Table | Used by | Note |
| --- | --- | --- |
| `EC_LEVEL_BITS` / `EC_LEVEL_FROM_BITS` | `encoder.ts` | The format-information bits are *not* in level order: L = `01`, M = `00`, Q = `11`, H = `10`. The mapping lives here so nobody re-derives it. This table caused a real bug during development: `qrcode/lib/core/error-correction-code.js` also defines it, and the constant had been assumed rather than checked. |
| `SYMBOL_TOTAL_CODEWORDS` | `encoder.ts`, `maxBytePayload` | Total codewords (data + EC) per version — the number the interleaver must produce exactly. |
| `EC_BLOCKS` | `encoder.ts`, `reed-solomon.ts` | Blocks per symbol and EC codewords per block. One EC count per symbol: the data codewords are distributed as evenly as possible, with the first `remainder` blocks getting one extra. That "group 1 short blocks first" detail is load-bearing for interleaving and is where the version-10+ bug mentioned above lived. |
| `ALIGNMENT_PATTERN_COORDS` | `matrix.ts` | Alignment-pattern centre coordinates per version, in module units. |
| `VERSION_INFO_BITS` | `matrix.ts` | The 18-bit version information (versions 7+), with its BCH(18,6) error-correction bits already computed — a table rather than arithmetic, because there are only 34 entries. |
| `BYTE_MODE_CAPACITY` | `planner.ts`, `maxBytePayload` | Data codewords available to byte mode per (version, level) — i.e. the capacity the planner reasons about. |

**Reading it in the code reference.** The listing below is long and mechanical; the
interesting lines are none of them. Skim the shape — a `Record<EcLevel, …[]>` per table, one
line per version with a comment naming the module count — and if you need to check a value,
read the generator (in `docs/CODE-PROJECT.md`), which computes it, rather than the table,
which merely stores it.

**Every line**

```ts
  1 │ /**
  2 │  * tables.ts - QR Code (ISO/IEC 18004) static tables.
  3 │  *
  4 │  * AUTO-GENERATED by tools/gen-qr-tables.mjs. Do not edit by hand.
  5 │  * Regenerate with:  npm run gen:qrtables
  6 │  *
  7 │  * Indexing convention throughout this file: arrays are 1-based by QR version
  8 │  * (index 0 is a placeholder), so `SYMBOL_TOTAL_CODEWORDS[7]` is version 7.
  9 │  */
 10 │ 
 11 │ export type EcLevel = 'L' | 'M' | 'Q' | 'H';
 12 │ 
 13 │ /** EC level -> integer, as encoded in the format-information bits. */
 14 │ export const EC_LEVEL_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
 15 │ 
 16 │ /** Integer -> EC level. */
 17 │ export const EC_LEVEL_FROM_BITS: EcLevel[] = ['M', 'L', 'H', 'Q'];
 18 │ 
 19 │ /** Total codewords (data + error correction) in the symbol for each version. */
 20 │ export const SYMBOL_TOTAL_CODEWORDS: number[] = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706];
 21 │ 
 22 │ export interface EcBlockGroup {
 23 │   /** Number of Reed-Solomon blocks the data area is split into. */
 24 │   blocks: number;
 25 │   /** EC codewords appended to each block. */
 26 │   ecPerBlock: number;
 27 │ }
 28 │ 
 29 │ /**
 30 │  * Reed-Solomon block layout: EC_BLOCKS[version][level].
 31 │  * Every block in a QR symbol uses the same EC count, and the data codewords
 32 │  * are distributed as evenly as possible (the first `remainder` blocks get one
 33 │  * extra codeword). See reed-solomon.ts.
 34 │  */
 35 │ export const EC_BLOCKS: Record<EcLevel, EcBlockGroup[]> = {
 36 │   L: [
 37 │     { blocks: 0, ecPerBlock: 0 }, // version 0 placeholder
 38 │     { blocks:  1, ecPerBlock:  7 }, // v1
 39 │     { blocks:  1, ecPerBlock: 10 }, // v2
 40 │     { blocks:  1, ecPerBlock: 15 }, // v3
 41 │     { blocks:  1, ecPerBlock: 20 }, // v4
 42 │     { blocks:  1, ecPerBlock: 26 }, // v5
 43 │     { blocks:  2, ecPerBlock: 18 }, // v6
 44 │     { blocks:  2, ecPerBlock: 20 }, // v7
 45 │     { blocks:  2, ecPerBlock: 24 }, // v8
 46 │     { blocks:  2, ecPerBlock: 30 }, // v9
 47 │     { blocks:  4, ecPerBlock: 18 }, // v10
 48 │     { blocks:  4, ecPerBlock: 20 }, // v11
 49 │     { blocks:  4, ecPerBlock: 24 }, // v12
 50 │     { blocks:  4, ecPerBlock: 26 }, // v13
 51 │     { blocks:  4, ecPerBlock: 30 }, // v14
 52 │     { blocks:  6, ecPerBlock: 22 }, // v15
 53 │     { blocks:  6, ecPerBlock: 24 }, // v16
 54 │     { blocks:  6, ecPerBlock: 28 }, // v17
 55 │     { blocks:  6, ecPerBlock: 30 }, // v18
 56 │     { blocks:  7, ecPerBlock: 28 }, // v19
 57 │     { blocks:  8, ecPerBlock: 28 }, // v20
 58 │     { blocks:  8, ecPerBlock: 28 }, // v21
 59 │     { blocks:  9, ecPerBlock: 28 }, // v22
 60 │     { blocks:  9, ecPerBlock: 30 }, // v23
 61 │     { blocks: 10, ecPerBlock: 30 }, // v24
 62 │     { blocks: 12, ecPerBlock: 26 }, // v25
 63 │     { blocks: 12, ecPerBlock: 28 }, // v26
 64 │     { blocks: 12, ecPerBlock: 30 }, // v27
 65 │     { blocks: 13, ecPerBlock: 30 }, // v28
 66 │     { blocks: 14, ecPerBlock: 30 }, // v29
 67 │     { blocks: 15, ecPerBlock: 30 }, // v30
 68 │     { blocks: 16, ecPerBlock: 30 }, // v31
 69 │     { blocks: 17, ecPerBlock: 30 }, // v32
 70 │     { blocks: 18, ecPerBlock: 30 }, // v33
 71 │     { blocks: 19, ecPerBlock: 30 }, // v34
 72 │     { blocks: 19, ecPerBlock: 30 }, // v35
 73 │     { blocks: 20, ecPerBlock: 30 }, // v36
 74 │     { blocks: 21, ecPerBlock: 30 }, // v37
 75 │     { blocks: 22, ecPerBlock: 30 }, // v38
 76 │     { blocks: 24, ecPerBlock: 30 }, // v39
 77 │     { blocks: 25, ecPerBlock: 30 }, // v40
 78 │   ],
 79 │   M: [
 80 │     { blocks: 0, ecPerBlock: 0 }, // version 0 placeholder
 81 │     { blocks:  1, ecPerBlock: 10 }, // v1
 82 │     { blocks:  1, ecPerBlock: 16 }, // v2
 83 │     { blocks:  1, ecPerBlock: 26 }, // v3
 84 │     { blocks:  2, ecPerBlock: 18 }, // v4
 85 │     { blocks:  2, ecPerBlock: 24 }, // v5
 86 │     { blocks:  4, ecPerBlock: 16 }, // v6
 87 │     { blocks:  4, ecPerBlock: 18 }, // v7
 88 │     { blocks:  4, ecPerBlock: 22 }, // v8
 89 │     { blocks:  5, ecPerBlock: 22 }, // v9
 90 │     { blocks:  5, ecPerBlock: 26 }, // v10
 91 │     { blocks:  5, ecPerBlock: 30 }, // v11
 92 │     { blocks:  8, ecPerBlock: 22 }, // v12
 93 │     { blocks:  9, ecPerBlock: 22 }, // v13
 94 │     { blocks:  9, ecPerBlock: 24 }, // v14
 95 │     { blocks: 10, ecPerBlock: 24 }, // v15
 96 │     { blocks: 10, ecPerBlock: 28 }, // v16
 97 │     { blocks: 11, ecPerBlock: 28 }, // v17
 98 │     { blocks: 13, ecPerBlock: 26 }, // v18
 99 │     { blocks: 14, ecPerBlock: 26 }, // v19
100 │     { blocks: 16, ecPerBlock: 26 }, // v20
101 │     { blocks: 17, ecPerBlock: 26 }, // v21
102 │     { blocks: 17, ecPerBlock: 28 }, // v22
103 │     { blocks: 18, ecPerBlock: 28 }, // v23
104 │     { blocks: 20, ecPerBlock: 28 }, // v24
105 │     { blocks: 21, ecPerBlock: 28 }, // v25
106 │     { blocks: 23, ecPerBlock: 28 }, // v26
107 │     { blocks: 25, ecPerBlock: 28 }, // v27
108 │     { blocks: 26, ecPerBlock: 28 }, // v28
109 │     { blocks: 28, ecPerBlock: 28 }, // v29
110 │     { blocks: 29, ecPerBlock: 28 }, // v30
111 │     { blocks: 31, ecPerBlock: 28 }, // v31
112 │     { blocks: 33, ecPerBlock: 28 }, // v32
113 │     { blocks: 35, ecPerBlock: 28 }, // v33
114 │     { blocks: 37, ecPerBlock: 28 }, // v34
115 │     { blocks: 38, ecPerBlock: 28 }, // v35
116 │     { blocks: 40, ecPerBlock: 28 }, // v36
117 │     { blocks: 43, ecPerBlock: 28 }, // v37
118 │     { blocks: 45, ecPerBlock: 28 }, // v38
119 │     { blocks: 47, ecPerBlock: 28 }, // v39
120 │     { blocks: 49, ecPerBlock: 28 }, // v40
121 │   ],
122 │   Q: [
123 │     { blocks: 0, ecPerBlock: 0 }, // version 0 placeholder
124 │     { blocks:  1, ecPerBlock: 13 }, // v1
125 │     { blocks:  1, ecPerBlock: 22 }, // v2
126 │     { blocks:  2, ecPerBlock: 18 }, // v3
127 │     { blocks:  2, ecPerBlock: 26 }, // v4
128 │     { blocks:  4, ecPerBlock: 18 }, // v5
129 │     { blocks:  4, ecPerBlock: 24 }, // v6
130 │     { blocks:  6, ecPerBlock: 18 }, // v7
131 │     { blocks:  6, ecPerBlock: 22 }, // v8
132 │     { blocks:  8, ecPerBlock: 20 }, // v9
133 │     { blocks:  8, ecPerBlock: 24 }, // v10
134 │     { blocks:  8, ecPerBlock: 28 }, // v11
135 │     { blocks: 10, ecPerBlock: 26 }, // v12
136 │     { blocks: 12, ecPerBlock: 24 }, // v13
137 │     { blocks: 16, ecPerBlock: 20 }, // v14
138 │     { blocks: 12, ecPerBlock: 30 }, // v15
139 │     { blocks: 17, ecPerBlock: 24 }, // v16
140 │     { blocks: 16, ecPerBlock: 28 }, // v17
141 │     { blocks: 18, ecPerBlock: 28 }, // v18
142 │     { blocks: 21, ecPerBlock: 26 }, // v19
143 │     { blocks: 20, ecPerBlock: 30 }, // v20
144 │     { blocks: 23, ecPerBlock: 28 }, // v21
145 │     { blocks: 23, ecPerBlock: 30 }, // v22
146 │     { blocks: 25, ecPerBlock: 30 }, // v23
147 │     { blocks: 27, ecPerBlock: 30 }, // v24
148 │     { blocks: 29, ecPerBlock: 30 }, // v25
149 │     { blocks: 34, ecPerBlock: 28 }, // v26
150 │     { blocks: 34, ecPerBlock: 30 }, // v27
151 │     { blocks: 35, ecPerBlock: 30 }, // v28
152 │     { blocks: 38, ecPerBlock: 30 }, // v29
153 │     { blocks: 40, ecPerBlock: 30 }, // v30
154 │     { blocks: 43, ecPerBlock: 30 }, // v31
155 │     { blocks: 45, ecPerBlock: 30 }, // v32
156 │     { blocks: 48, ecPerBlock: 30 }, // v33
157 │     { blocks: 51, ecPerBlock: 30 }, // v34
158 │     { blocks: 53, ecPerBlock: 30 }, // v35
159 │     { blocks: 56, ecPerBlock: 30 }, // v36
160 │     { blocks: 59, ecPerBlock: 30 }, // v37
161 │     { blocks: 62, ecPerBlock: 30 }, // v38
162 │     { blocks: 65, ecPerBlock: 30 }, // v39
163 │     { blocks: 68, ecPerBlock: 30 }, // v40
164 │   ],
165 │   H: [
166 │     { blocks: 0, ecPerBlock: 0 }, // version 0 placeholder
167 │     { blocks:  1, ecPerBlock: 17 }, // v1
168 │     { blocks:  1, ecPerBlock: 28 }, // v2
169 │     { blocks:  2, ecPerBlock: 22 }, // v3
170 │     { blocks:  4, ecPerBlock: 16 }, // v4
171 │     { blocks:  4, ecPerBlock: 22 }, // v5
172 │     { blocks:  4, ecPerBlock: 28 }, // v6
173 │     { blocks:  5, ecPerBlock: 26 }, // v7
174 │     { blocks:  6, ecPerBlock: 26 }, // v8
175 │     { blocks:  8, ecPerBlock: 24 }, // v9
176 │     { blocks:  8, ecPerBlock: 28 }, // v10
177 │     { blocks: 11, ecPerBlock: 24 }, // v11
178 │     { blocks: 11, ecPerBlock: 28 }, // v12
179 │     { blocks: 16, ecPerBlock: 22 }, // v13
180 │     { blocks: 16, ecPerBlock: 24 }, // v14
181 │     { blocks: 18, ecPerBlock: 24 }, // v15
182 │     { blocks: 16, ecPerBlock: 30 }, // v16
183 │     { blocks: 19, ecPerBlock: 28 }, // v17
184 │     { blocks: 21, ecPerBlock: 28 }, // v18
185 │     { blocks: 25, ecPerBlock: 26 }, // v19
186 │     { blocks: 25, ecPerBlock: 28 }, // v20
187 │     { blocks: 25, ecPerBlock: 30 }, // v21
188 │     { blocks: 34, ecPerBlock: 24 }, // v22
189 │     { blocks: 30, ecPerBlock: 30 }, // v23
190 │     { blocks: 32, ecPerBlock: 30 }, // v24
191 │     { blocks: 35, ecPerBlock: 30 }, // v25
192 │     { blocks: 37, ecPerBlock: 30 }, // v26
193 │     { blocks: 40, ecPerBlock: 30 }, // v27
194 │     { blocks: 42, ecPerBlock: 30 }, // v28
195 │     { blocks: 45, ecPerBlock: 30 }, // v29
196 │     { blocks: 48, ecPerBlock: 30 }, // v30
197 │     { blocks: 51, ecPerBlock: 30 }, // v31
198 │     { blocks: 54, ecPerBlock: 30 }, // v32
199 │     { blocks: 57, ecPerBlock: 30 }, // v33
200 │     { blocks: 60, ecPerBlock: 30 }, // v34
201 │     { blocks: 63, ecPerBlock: 30 }, // v35
202 │     { blocks: 66, ecPerBlock: 30 }, // v36
203 │     { blocks: 70, ecPerBlock: 30 }, // v37
204 │     { blocks: 74, ecPerBlock: 30 }, // v38
205 │     { blocks: 77, ecPerBlock: 30 }, // v39
206 │     { blocks: 81, ecPerBlock: 30 }, // v40
207 │   ],
208 │ };
209 │ 
210 │ /**
211 │  * Alignment-pattern centre coordinates (row === column positions).
212 │  * Every (row, col) combination is used except the three that collide with the
213 │  * finder patterns.
214 │  */
215 │ export const ALIGNMENT_PATTERN_COORDS: number[][] = [
216 │   [],
217 │   [], // v1
218 │   [6, 18], // v2
219 │   [6, 22], // v3
220 │   [6, 26], // v4
221 │   [6, 30], // v5
222 │   [6, 34], // v6
223 │   [6, 22, 38], // v7
224 │   [6, 24, 42], // v8
225 │   [6, 26, 46], // v9
226 │   [6, 28, 50], // v10
227 │   [6, 30, 54], // v11
228 │   [6, 32, 58], // v12
229 │   [6, 34, 62], // v13
230 │   [6, 26, 46, 66], // v14
231 │   [6, 26, 48, 70], // v15
232 │   [6, 26, 50, 74], // v16
233 │   [6, 30, 54, 78], // v17
234 │   [6, 30, 56, 82], // v18
235 │   [6, 30, 58, 86], // v19
236 │   [6, 34, 62, 90], // v20
237 │   [6, 28, 50, 72, 94], // v21
238 │   [6, 26, 50, 74, 98], // v22
239 │   [6, 30, 54, 78, 102], // v23
240 │   [6, 28, 54, 80, 106], // v24
241 │   [6, 32, 58, 84, 110], // v25
242 │   [6, 30, 58, 86, 114], // v26
243 │   [6, 34, 62, 90, 118], // v27
244 │   [6, 26, 50, 74, 98, 122], // v28
245 │   [6, 30, 54, 78, 102, 126], // v29
246 │   [6, 26, 52, 78, 104, 130], // v30
247 │   [6, 30, 56, 82, 108, 134], // v31
248 │   [6, 34, 60, 86, 112, 138], // v32
249 │   [6, 30, 58, 86, 114, 142], // v33
250 │   [6, 34, 62, 90, 118, 146], // v34
251 │   [6, 30, 54, 78, 102, 126, 150], // v35
252 │   [6, 24, 50, 76, 102, 128, 154], // v36
253 │   [6, 28, 54, 80, 106, 132, 158], // v37
254 │   [6, 32, 58, 84, 110, 136, 162], // v38
255 │   [6, 26, 54, 82, 110, 138, 166], // v39
256 │   [6, 30, 58, 86, 114, 142, 170], // v40
257 │ ];
258 │ 
259 │ /**
260 │  * 18-bit version information codeword for QR versions 7..40,
261 │  * computed with the (18,6) Golay code and generator 0b1111100100101.
262 │  * Versions 1..6 carry no version information block.
263 │  */
264 │ export const VERSION_INFO_BITS: number[] = [
265 │   0,
266 │   0, // v1 (no version info block)
267 │   0, // v2 (no version info block)
268 │   0, // v3 (no version info block)
269 │   0, // v4 (no version info block)
270 │   0, // v5 (no version info block)
271 │   0, // v6 (no version info block)
272 │   0x7c94, // v7
273 │   0x85bc, // v8
274 │   0x9a99, // v9
275 │   0xa4d3, // v10
276 │   0xbbf6, // v11
277 │   0xc762, // v12
278 │   0xd847, // v13
279 │   0xe60d, // v14
280 │   0xf928, // v15
281 │   0x10b78, // v16
282 │   0x1145d, // v17
283 │   0x12a17, // v18
284 │   0x13532, // v19
285 │   0x149a6, // v20
286 │   0x15683, // v21
287 │   0x168c9, // v22
288 │   0x177ec, // v23
289 │   0x18ec4, // v24
290 │   0x191e1, // v25
291 │   0x1afab, // v26
292 │   0x1b08e, // v27
293 │   0x1cc1a, // v28
294 │   0x1d33f, // v29
295 │   0x1ed75, // v30
296 │   0x1f250, // v31
297 │   0x209d5, // v32
298 │   0x216f0, // v33
299 │   0x228ba, // v34
300 │   0x2379f, // v35
301 │   0x24b0b, // v36
302 │   0x2542e, // v37
303 │   0x26a64, // v38
304 │   0x27541, // v39
305 │   0x28c69, // v40
306 │ ];
307 │ 
308 │ /** Maximum payload bytes for byte mode, per level and version: CAPACITY[level][version]. */
309 │ export const BYTE_MODE_CAPACITY: Record<EcLevel, number[]> = {
310 │   L: [
311 │     0,
312 │       17, // v1 (22x22 modules)
313 │       32, // v2 (26x26 modules)
314 │       53, // v3 (30x30 modules)
315 │       78, // v4 (34x34 modules)
316 │      106, // v5 (38x38 modules)
317 │      134, // v6 (42x42 modules)
318 │      154, // v7 (46x46 modules)
319 │      192, // v8 (50x50 modules)
320 │      230, // v9 (54x54 modules)
321 │      271, // v10 (58x58 modules)
322 │      321, // v11 (62x62 modules)
323 │      367, // v12 (66x66 modules)
324 │      425, // v13 (70x70 modules)
325 │      458, // v14 (74x74 modules)
326 │      520, // v15 (78x78 modules)
327 │      586, // v16 (82x82 modules)
328 │      644, // v17 (86x86 modules)
329 │      718, // v18 (90x90 modules)
330 │      792, // v19 (94x94 modules)
331 │      858, // v20 (98x98 modules)
332 │      929, // v21 (102x102 modules)
333 │     1003, // v22 (106x106 modules)
334 │     1091, // v23 (110x110 modules)
335 │     1171, // v24 (114x114 modules)
336 │     1273, // v25 (118x118 modules)
337 │     1367, // v26 (122x122 modules)
338 │     1465, // v27 (126x126 modules)
339 │     1528, // v28 (130x130 modules)
340 │     1628, // v29 (134x134 modules)
341 │     1732, // v30 (138x138 modules)
342 │     1840, // v31 (142x142 modules)
343 │     1952, // v32 (146x146 modules)
344 │     2068, // v33 (150x150 modules)
345 │     2188, // v34 (154x154 modules)
346 │     2303, // v35 (158x158 modules)
347 │     2431, // v36 (162x162 modules)
348 │     2563, // v37 (166x166 modules)
349 │     2699, // v38 (170x170 modules)
350 │     2809, // v39 (174x174 modules)
351 │     2953, // v40 (178x178 modules)
352 │   ],
353 │   M: [
354 │     0,
355 │       14, // v1 (22x22 modules)
356 │       26, // v2 (26x26 modules)
357 │       42, // v3 (30x30 modules)
358 │       62, // v4 (34x34 modules)
359 │       84, // v5 (38x38 modules)
360 │      106, // v6 (42x42 modules)
361 │      122, // v7 (46x46 modules)
362 │      152, // v8 (50x50 modules)
363 │      180, // v9 (54x54 modules)
364 │      213, // v10 (58x58 modules)
365 │      251, // v11 (62x62 modules)
366 │      287, // v12 (66x66 modules)
367 │      331, // v13 (70x70 modules)
368 │      362, // v14 (74x74 modules)
369 │      412, // v15 (78x78 modules)
370 │      450, // v16 (82x82 modules)
371 │      504, // v17 (86x86 modules)
372 │      560, // v18 (90x90 modules)
373 │      624, // v19 (94x94 modules)
374 │      666, // v20 (98x98 modules)
375 │      711, // v21 (102x102 modules)
376 │      779, // v22 (106x106 modules)
377 │      857, // v23 (110x110 modules)
378 │      911, // v24 (114x114 modules)
379 │      997, // v25 (118x118 modules)
380 │     1059, // v26 (122x122 modules)
381 │     1125, // v27 (126x126 modules)
382 │     1190, // v28 (130x130 modules)
383 │     1264, // v29 (134x134 modules)
384 │     1370, // v30 (138x138 modules)
385 │     1452, // v31 (142x142 modules)
386 │     1538, // v32 (146x146 modules)
387 │     1628, // v33 (150x150 modules)
388 │     1722, // v34 (154x154 modules)
389 │     1809, // v35 (158x158 modules)
390 │     1911, // v36 (162x162 modules)
391 │     1989, // v37 (166x166 modules)
392 │     2099, // v38 (170x170 modules)
393 │     2213, // v39 (174x174 modules)
394 │     2331, // v40 (178x178 modules)
395 │   ],
396 │   Q: [
397 │     0,
398 │       11, // v1 (22x22 modules)
399 │       20, // v2 (26x26 modules)
400 │       32, // v3 (30x30 modules)
401 │       46, // v4 (34x34 modules)
402 │       60, // v5 (38x38 modules)
403 │       74, // v6 (42x42 modules)
404 │       86, // v7 (46x46 modules)
405 │      108, // v8 (50x50 modules)
406 │      130, // v9 (54x54 modules)
407 │      151, // v10 (58x58 modules)
408 │      177, // v11 (62x62 modules)
409 │      203, // v12 (66x66 modules)
410 │      241, // v13 (70x70 modules)
411 │      258, // v14 (74x74 modules)
412 │      292, // v15 (78x78 modules)
413 │      322, // v16 (82x82 modules)
414 │      364, // v17 (86x86 modules)
415 │      394, // v18 (90x90 modules)
416 │      442, // v19 (94x94 modules)
417 │      482, // v20 (98x98 modules)
418 │      509, // v21 (102x102 modules)
419 │      565, // v22 (106x106 modules)
420 │      611, // v23 (110x110 modules)
421 │      661, // v24 (114x114 modules)
422 │      715, // v25 (118x118 modules)
423 │      751, // v26 (122x122 modules)
424 │      805, // v27 (126x126 modules)
425 │      868, // v28 (130x130 modules)
426 │      908, // v29 (134x134 modules)
427 │      982, // v30 (138x138 modules)
428 │     1030, // v31 (142x142 modules)
429 │     1112, // v32 (146x146 modules)
430 │     1168, // v33 (150x150 modules)
431 │     1228, // v34 (154x154 modules)
432 │     1283, // v35 (158x158 modules)
433 │     1351, // v36 (162x162 modules)
434 │     1423, // v37 (166x166 modules)
435 │     1499, // v38 (170x170 modules)
436 │     1579, // v39 (174x174 modules)
437 │     1663, // v40 (178x178 modules)
438 │   ],
439 │   H: [
440 │     0,
441 │        7, // v1 (22x22 modules)
442 │       14, // v2 (26x26 modules)
443 │       24, // v3 (30x30 modules)
444 │       34, // v4 (34x34 modules)
445 │       44, // v5 (38x38 modules)
446 │       58, // v6 (42x42 modules)
447 │       64, // v7 (46x46 modules)
448 │       84, // v8 (50x50 modules)
449 │       98, // v9 (54x54 modules)
450 │      119, // v10 (58x58 modules)
451 │      137, // v11 (62x62 modules)
452 │      155, // v12 (66x66 modules)
453 │      177, // v13 (70x70 modules)
454 │      194, // v14 (74x74 modules)
455 │      220, // v15 (78x78 modules)
456 │      250, // v16 (82x82 modules)
457 │      280, // v17 (86x86 modules)
458 │      310, // v18 (90x90 modules)
459 │      338, // v19 (94x94 modules)
460 │      382, // v20 (98x98 modules)
461 │      403, // v21 (102x102 modules)
462 │      439, // v22 (106x106 modules)
463 │      461, // v23 (110x110 modules)
464 │      511, // v24 (114x114 modules)
465 │      535, // v25 (118x118 modules)
466 │      593, // v26 (122x122 modules)
467 │      625, // v27 (126x126 modules)
468 │      658, // v28 (130x130 modules)
469 │      698, // v29 (134x134 modules)
470 │      742, // v30 (138x138 modules)
471 │      790, // v31 (142x142 modules)
472 │      842, // v32 (146x146 modules)
473 │      898, // v33 (150x150 modules)
474 │      958, // v34 (154x154 modules)
475 │      983, // v35 (158x158 modules)
476 │     1051, // v36 (162x162 modules)
477 │     1093, // v37 (166x166 modules)
478 │     1139, // v38 (170x170 modules)
479 │     1219, // v39 (174x174 modules)
480 │     1273, // v40 (178x178 modules)
481 │   ],
482 │ };
```

---

## `packages/core/src/qr/galois.ts`

> 79 lines

**What it is.** GF(2⁸) arithmetic: the field QR Code error correction lives in. Reed–Solomon
over bytes operating on integers with `+` and `*` would be nonsense — it operates on
*polynomials over GF(2)*, where addition is XOR and multiplication is carry-less
polynomial multiplication reduced modulo a primitive polynomial. ISO/IEC 18004 fixes that
polynomial at `x⁸ + x⁴ + x³ + x² + 1` = `0x11D`.

**The one idea to take away.** Because the field has only 256 elements, multiplication can
be done with two lookup tables instead of eight shift-XOR rounds:

- `EXP[i] = α^i` (α = 2), extended to 512 entries;
- `LOG[x] = i` such that `α^i = x`.

Then `a * b = EXP[LOG[a] + LOG[b]]`. The tables are built once at module load (the IIFE),
and the `x & 0x100` test inside is the field reduction: shift the register left by one,
and if the 9th bit appears, XOR the primitive polynomial back in. That single line *is*
GF(2⁸) multiplication's definition.

**Why `EXP` is 512 long, not 255.** `LOG[a] + LOG[b]` can be up to 508, so the table is
mirrored (`EXP[i] = EXP[i − 255]`) to make the index safe without a modulo in the inner
loop. The header comment's "worth roughly 8×" claim refers to the Reed–Solomon inner
loop, which is the only hot user: `rsEncode` multiplies `ecPerBlock` coefficients per
data byte.

**The functions.**

| Function | Note |
| --- | --- |
| `gfMul` | Short-circuits on zero because `LOG[0]` is undefined (0 has no logarithm). That guard is not an optimisation — without it, `LOG[0]` reads 0 and silently returns the wrong product. |
| `gfInv` | `a⁻¹ = α^(255 − LOG[a])`, since α has order 255. Throws for 0. |
| `gfPow` | Handles `n = 0` (returns 1, including for a = 0) and negative exponents via inversion. `(log * n) % 255` stays exact because `log * n` is at most 255 × 255. |
| `gfPolyEval` | Horner's method, coefficients highest-power first. Note the accumulator is *not* short-circuited at zero: `gfMul` handles that case. |
| `gfPolyMul` | Schoolbook convolution, skipping zero coefficients on both sides. The `out[i+j] ^= EXP[logA + LOG[b[j]]]` line is the whole function: XOR is addition, so accumulating products is a running XOR. |

**Convention worth stating plainly, because it is a classic source of bugs:** every
polynomial in this project is stored **highest power first**. `gfPolyEval`, `gfPolyMul`,
`generatorPolynomial` and `rsEncode` all assume it, and QR's own specification writes
codewords in that order, so the convention matches the standard rather than fighting it.

**Every line**

```ts
 1 │ /**
 2 │  * galois.ts - GF(2^8) arithmetic, the field QR Code error correction lives in.
 3 │  *
 4 │  * ISO/IEC 18004 specifies Reed-Solomon error correction over the Galois field
 5 │  * GF(2^8) generated by the primitive polynomial
 6 │  *
 7 │  *     x^8 + x^4 + x^3 + x^2 + 1   ==   0b1_0001_1101   ==   0x11D
 8 │  *
 9 │  * Multiplication in this field is not integer multiplication; it is
10 │  * "carry-less" polynomial multiplication modulo 0x11D. Since the field is
11 │  * small, we precompute:
12 │  *
13 │  *   EXP[i] = alpha^i          (alpha = 2)  for i in [0, 255), extended to 510 so
14 │  *                                          that EXP[a+b] works without a modulo
15 │  *   LOG[x] = i such that alpha^i == x     (LOG[0] is undefined - 0 has no log)
16 │  *
17 │  * With those two tables, multiply/log are O(1) lookups instead of 8 shift-xor
18 │  * rounds. This is the classic "log/antilog table" optimisation and is worth
19 │  * roughly 8x on the Reed-Solomon inner loop.
20 │  */
21 │ 
22 │ /** alpha^i (antilog table). Length 512 so EXP[a + b] is valid for a,b < 255. */
23 │ export const EXP = new Uint8Array(512);
24 │ 
25 │ /** Discrete logarithm table: LOG[EXP[i]] === i. LOG[0] is never read. */
26 │ export const LOG = new Uint8Array(256);
27 │ 
28 │ (function initTables(): void {
29 │   let x = 1;
30 │   for (let i = 0; i < 255; i++) {
31 │     EXP[i] = x;
32 │     LOG[x] = i;
33 │     x <<= 1;
34 │     if (x & 0x100) x ^= 0x11d; // reduce modulo the primitive polynomial
35 │   }
36 │   // Mirror the cycle so that EXP[i] for i in [255, 511) is EXP[i - 255].
37 │   for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
38 │ })();
39 │ 
40 │ /** Multiply two field elements. */
41 │ export function gfMul(a: number, b: number): number {
42 │   if (a === 0 || b === 0) return 0;
43 │   return EXP[LOG[a] + LOG[b]];
44 │ }
45 │ 
46 │ /** Multiplicative inverse: gfMul(a, gfInv(a)) === 1. Throws for 0. */
47 │ export function gfInv(a: number): number {
48 │   if (a === 0) throw new RangeError('0 has no multiplicative inverse in GF(2^8)');
49 │   return EXP[255 - LOG[a]];
50 │ }
51 │ 
52 │ /** alpha^n for n >= 0, reduced into the field's cycle. */
53 │ export function gfPow(a: number, n: number): number {
54 │   if (a === 0) return n === 0 ? 1 : 0;
55 │   if (n < 0) return gfInv(gfPow(a, -n));
56 │   const log = LOG[a];
57 │   return EXP[(log * n) % 255];
58 │ }
59 │ 
60 │ /** Evaluate the polynomial at x (Horner's method). coeffs[0] is the highest power. */
61 │ export function gfPolyEval(coeffs: Uint8Array, x: number): number {
62 │   let y = 0;
63 │   for (let i = 0; i < coeffs.length; i++) y = gfMul(y, x) ^ coeffs[i];
64 │   return y;
65 │ }
66 │ 
67 │ /** Multiply two polynomials whose coefficients are stored highest-power first. */
68 │ export function gfPolyMul(a: Uint8Array, b: Uint8Array): Uint8Array {
69 │   const out = new Uint8Array(a.length + b.length - 1);
70 │   for (let i = 0; i < a.length; i++) {
71 │     if (a[i] === 0) continue;
72 │     const logA = LOG[a[i]];
73 │     for (let j = 0; j < b.length; j++) {
74 │       if (b[j] === 0) continue;
75 │       out[i + j] ^= EXP[logA + LOG[b[j]]];
76 │     }
77 │   }
78 │   return out;
79 │ }
```

---

## `packages/core/src/qr/reed-solomon.ts`

> 101 lines

**What it is.** The Reed–Solomon encoder that produces each QR block's parity codewords.
QR uses a *systematic* code: the data codewords appear verbatim, followed by parity.

**The mathematics, in one paragraph.** A block of data codewords is a polynomial `C(x)`
with coefficients in GF(2⁸), highest power first. The parity is the remainder of
`C(x) · x^m / g(x)`, where `m` is the number of parity codewords and `g` is the generator
polynomial `g(x) = (x − α⁰)(x − α¹)⋯(x − α^(m−1))`. Because the code is systematic, the
receiver can read the data directly and use the parity only to *repair* damage — which is
exactly what a scanner needs, since the damage is localised smudges rather than random
byte corruption.

**`generatorPolynomial(degree)`.**

- Builds `g` by multiplying `(x − α^i)` for `i = 0 … degree−1`. In GF(2⁸) subtraction is
  XOR, so `(x − α^i)` is the two-coefficient polynomial `[1, EXP[i]]`.
- The result is **monic**, and the function deliberately stores it with the leading `1`
  stripped. That is what makes `rsEncode`'s loop so short: dividing by a monic polynomial
  removes the need for any scaling step at the top of the register.
- **Memoised** in a `Map`, because the degree takes only a handful of distinct values
  across 40 versions × 4 EC levels. Building `g` is O(degree²) field multiplications and
  would otherwise be repeated for every one of the (up to 81) blocks of a large symbol.
- Two comments in this function exist for the same reason: `let poly: Uint8Array`
  *and* the explicit `new Uint8Array(...); stripped.set(poly.subarray(1))` copy instead of
  `poly.slice(1)`. TypeScript 5.7 changed how typed arrays are typed by their backing
  buffer, and `slice` returns an `ArrayBuffer`-generic type that does not unify with the
  annotated `Uint8Array`. It is a one-line type fix that reads like a style quirk; the
  comment is there so nobody "simplifies" it back and breaks the build.

**`rsEncode(data, ecCount)` — the LFSR loop.**


Three details matter:

1. **`rem.copyWithin(0, 1)` is a memmove, not a loop.** It shifts the register in place,
   which is safe here because the copy direction moves bytes toward lower indices.
2. **`if (factor !== 0)` guards the whole inner loop.** On average, one in 256 iterations
   is skipped entirely — and more importantly it avoids reading `LOG[0]`.
3. **The `g !== 0` test inside the loop** is the same guard one level down, for generator
   coefficients that happen to be zero.

The complexity is `O(k · ecCount)` field operations per block — for a version-40 symbol
that is roughly 2 200 × 28 lookups, which is microseconds, and it is why no attempt was
made to use the faster (but far more complex) syndrome-based encoder.

**`rsVerify(code, ecCount)`.** Evaluates the *full* codeword polynomial at α⁰ … α^(ecCount−1);
all syndromes must be zero for a valid codeword. It is used by the unit tests and the
diagnostics screen rather than by the decoder, because the decoder does not try to repair
symbols: a QR scanner either reads a symbol correctly (using the parity internally, in
hardware or in ML Kit) or does not report it at all. The framing level above has its own
CRC-16 for the frames that *do* arrive. Note the inline zero-check in the Horner loop —
`y === 0 ? 0 : EXP[LOG[y] + LOG[x]]` — the same "LOG[0] is undefined" guard as `gfMul`,
spelled out locally to keep this diagnostic function free of dependencies.

**Every line**

```ts
  1 │ /**
  2 │  * reed-solomon.ts - Reed-Solomon error correction encoder for QR Code symbols.
  3 │  *
  4 │  * QR Codes use a systematic Reed-Solomon code RS(n, k) over GF(2^8):
  5 │  *   - k = number of data codewords,
  6 │  *   - n - k = `ecPerBlock` error-correction codewords,
  7 │  *   - the generator polynomial is
  8 │  *         g(x) = (x - a^0)(x - a^1) ... (x - a^(ecPerBlock-1))
  9 │  *     with a = 2 (see galois.ts).
 10 │  *
 11 │  * Encoding a block C(x) (data codewords as polynomial coefficients, highest
 12 │  * power first) means computing the remainder of
 13 │  *         C(x) * x^(ecPerBlock)  /  g(x)
 14 │  * and appending that remainder. Systematic form: the data codewords appear
 15 │  * verbatim, followed by the parity codewords.
 16 │  *
 17 │  * Implementation: the classic LFSR / synthetic-division loop. We divide by the
 18 │  * *monic* generator with its leading coefficient stripped, which is O(k *
 19 │  * ecPerBlock) field operations and needs no polynomial division bookkeeping.
 20 │  *
 21 │  * The generator polynomial depends only on `ecPerBlock` (which takes a handful
 22 │  * of distinct values across all 40 versions x 4 EC levels), so results are
 23 │  * memoised.
 24 │  */
 25 │ 
 26 │ import { EXP, LOG, gfPolyMul } from './galois.js';
 27 │ 
 28 │ const generatorCache = new Map<number, Uint8Array>();
 29 │ 
 30 │ /**
 31 │  * Generator polynomial of the requested degree, coefficients highest power
 32 │  * first and monic (leading coefficient 1, which is why we store degree entries
 33 │  * and drop the leading 1 in the division loop).
 34 │  */
 35 │ export function generatorPolynomial(degree: number): Uint8Array {
 36 │   if (degree < 1) throw new RangeError('Reed-Solomon degree must be >= 1');
 37 │   const cached = generatorCache.get(degree);
 38 │   if (cached) return cached;
 39 │ 
 40 │   // g(x) = product of (x - a^i); in GF(2^8) subtraction is XOR.
 41 │   // The explicit annotation widens the buffer type to ArrayBufferLike, which is
 42 │   // what the helpers return; TS >= 5.7 types typed arrays by their buffer.
 43 │   let poly: Uint8Array = new Uint8Array([1]);
 44 │   for (let i = 0; i < degree; i++) {
 45 │     poly = gfPolyMul(poly, new Uint8Array([1, EXP[i]]));
 46 │   }
 47 │   // `poly` has degree+1 coefficients including the monic leading 1; keep the
 48 │   // rest, which is what the division loop consumes. (Built with an explicit
 49 │   // copy rather than slice() to stay agnostic about typed-array buffer types.)
 50 │   const stripped = new Uint8Array(poly.length - 1);
 51 │   stripped.set(poly.subarray(1));
 52 │   generatorCache.set(degree, stripped);
 53 │   return stripped;
 54 │ }
 55 │ 
 56 │ /**
 57 │  * Compute the `ecCount` parity codewords for a data block.
 58 │  *
 59 │  * @param data    data codewords of one RS block
 60 │  * @param ecCount number of parity codewords to append
 61 │  * @returns       a new array of length `ecCount`
 62 │  */
 63 │ export function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
 64 │   if (ecCount <= 0) return new Uint8Array(0);
 65 │   const gen = generatorPolynomial(ecCount);
 66 │   const rem = new Uint8Array(ecCount);
 67 │ 
 68 │   for (let i = 0; i < data.length; i++) {
 69 │     // Feedback term: the byte shifted out of the register XORed with data[i].
 70 │     const factor = data[i] ^ rem[0];
 71 │     // Shift the register one step.
 72 │     rem.copyWithin(0, 1);
 73 │     rem[ecCount - 1] = 0;
 74 │     if (factor !== 0) {
 75 │       const logFactor = LOG[factor];
 76 │       for (let j = 0; j < ecCount; j++) {
 77 │         const g = gen[j];
 78 │         if (g !== 0) rem[j] ^= EXP[logFactor + LOG[g]];
 79 │       }
 80 │     }
 81 │   }
 82 │   return rem;
 83 │ }
 84 │ 
 85 │ /**
 86 │  * Verify that a codeword (data + parity) is a valid RS codeword by evaluating
 87 │  * the full polynomial at a^0 ... a^(ecCount-1). All syndromes must be zero.
 88 │  * Used by the unit tests and by the diagnostics screen.
 89 │  */
 90 │ export function rsVerify(code: Uint8Array, ecCount: number): boolean {
 91 │   const poly = code;
 92 │   for (let i = 0; i < ecCount; i++) {
 93 │     let y = 0;
 94 │     const x = EXP[i];
 95 │     for (let j = 0; j < poly.length; j++) {
 96 │       y = (y === 0 ? 0 : EXP[LOG[y] + LOG[x]]) ^ poly[j];
 97 │     }
 98 │     if (y !== 0) return false;
 99 │   }
100 │   return true;
101 │ }
```

---

## `packages/core/src/qr/segments.ts`

> 297 lines

**What it is.** QR data-segment construction: the four encoding modes, their cost model,
and a small dynamic program that picks the cheapest way to split a piece of text. This is
the file that makes "send a password" and "send a paragraph" cost dramatically different
amounts of screen time.

**Why segmentation exists at all.** A QR symbol holds a *sequence* of segments, each in
one mode, each with a 4-bit mode indicator and a version-dependent character-count
indicator. The modes pack data at different densities:

| Mode | Alphabet | Density |
| --- | --- | --- |
| Numeric | `0–9` | 10 bits per **3** digits (3.33 bits/char) |
| Alphanumeric | `0–9 A–Z space $%*+-./:` | 11 bits per **2** chars (5.5 bits/char) |
| Byte | any 8-bit value | 8 bits per byte |
| Kanji | Shift-JIS | 13 bits per char (unused here) |

For a 20-character uppercase-and-digits string that is 110 bits of payload in alphanumeric
mode against 160 in byte mode; add the mode and count indicators and the gap is bigger
still. On an optical channel where every bit is screen time, that is a ~45% saving on the
most common text payloads.

**The pieces.**

- **`charCountBits(mode, version)`** — the count indicator is 8/9/10/12/13/14/16 bits
  depending on mode *and* the version group (1–9, 10–26, 27–40). Getting this table wrong
  produces symbols that encode and decode perfectly but are one bit short of the capacity
  the encoder thinks it has — a bug that only appears at version boundaries. Version
  groups are shared with `encoder.ts` through `versionGroup()`.
- **`numericBitLength` / `alphanumericBitLength`** — the per-mode payload bit counts, in
  closed form except for the 1- and 2-digit remainders (`[0,4,7]` for numeric,
  `6` for a lone alphanumeric character).
- **`makeNumericSegment` / `makeAlphanumericSegment`** — the writers. The alphanumeric one
  packs pairs as `hi * 45 + lo` in 11 bits, and **throws** on a character outside the
  alphabet. Throwing rather than falling back to byte mode is deliberate: the fallback is
  the DP's job, and a silent downgrade inside a segment writer would produce a symbol
  whose size does not match the plan.
- **`makeByteSegmentFromBytes`** — byte mode over raw bytes, no UTF-8 pass. This is the
  path the *binary* payload frames take, and it is why `numChars` is documented as "number
  of characters (not bytes)" in the interface but carries a byte count for this
  constructor: the two coincide in byte mode, and the comment in `segmentsBitLength` points
  that out.
- **`utf8Encode` (local)** — a duplicate of the fallback in `util/bytes.ts`, kept here only
  because this module is imported by the encoder before the polyfill layer exists. Note it
  advances `i` by hand for astral characters (`if (cp > 0xffff) i++`) — that is the
  surrogate-pair handling, in three characters.
- **`isAllNumeric` / `isAllAlphanumeric`** — the fast pre-checks. Both return `false` for an
  empty string, so an empty segment is never claimed to be a valid one.

**`splitIntoSegments(text, version)` — the DP.**

The problem: choose segment boundaries and modes minimising total bits. It is a shortest
path over string positions; from position `i` you may emit a numeric run, an alphanumeric
run, or a byte chunk. Three implementation decisions are worth reading the code for:

1. **The DP runs over code points, not UTF-16 code units.** The text is first expanded into
   `points[]` (one entry per code point) with `pointBytes[]` recording each one's UTF-8
   length. Cutting inside a surrogate pair would produce a lone surrogate, and the byte
   segment built from it would contain an invalid UTF-8 sequence — which on a native
   scanner comes back as U+FFFD and fails the SHA-256 check with no clue why.
2. **Byte lengths are computed incrementally** (`bytes += pointBytes[j]`), so the byte-mode
   cost of a chunk is known without re-encoding substrings. The comment on `segmentCost`'s
   `default` branch records that byte mode's cost depends on the UTF-8 length, which is why
   the caller passes it in.
3. **Chunks are capped at `MAX_CHUNK` = 1024** to keep the DP from being O(n²) in the
   worst case, and any text over 4096 code units skips the DP entirely and becomes one byte
   segment. Both are pragmatic bounds, documented as such: for the payload sizes this app
   actually sends, the cap cannot bind (a text transfer is 4 MiB, but each *frame* carries
   only a few hundred bytes of it, and framing happens above this layer).

**One refinement in the backtrack.** A part the DP routed through alphanumeric cost may
turn out to be all digits — the DP only compares the *runs it expanded*, and a numeric run
is a special case of an alphanumeric one. The materialisation step therefore re-checks each
slice with `isAllNumeric` and prefers the numeric encoder when valid, which is strictly
cheaper. It is a small win, and it is the difference between "the DP is optimal" and "the
DP is optimal over the states it explored".

**Every line**

```ts
  1 │ /**
  2 │  * segments.ts - QR Code data segment construction (ISO/IEC 18004 section 7.4).
  3 │  *
  4 │  * A QR symbol stores a *sequence of segments*, each in one of four encoding
  5 │  * modes. Each mode packs data at a different density:
  6 │  *
  7 │  *   Mode          Alphabet                     Bits per unit
  8 │  *   ------------  ---------------------------  ----------------------------
  9 │  *   Numeric       0-9                          10 bits / 3 digits
 10 │  *   Alphanumeric  0-9 A-Z space $%*+-./:        11 bits / 2 characters
 11 │  *   Byte          arbitrary 8-bit (UTF-8 here)   8 bits / byte
 12 │  *   Kanji         Shift-JIS double byte         13 bits / character (unused)
 13 │  *
 14 │  * A segment costs 4 bits of mode indicator + C bits of character-count
 15 │  * indicator (C depends on mode AND version group) + the payload bits.
 16 │  *
 17 │  * LightBeam sends mostly binary, but text mode ("send a password / URL") is
 18 │  * dramatically smaller when the text qualifies for numeric or alphanumeric
 19 │  * mode - roughly 2.4x denser for alphanumeric, 3x for digits. Because this is
 20 │  * an optical channel where every bit costs screen time, we run a small dynamic
 21 │  * program that finds the cheapest segmentation of the text.
 22 │  */
 23 │ 
 24 │ import { BitWriter } from '../util/bits.js';
 25 │ 
 26 │ export const enum QrMode {
 27 │   Numeric = 1,
 28 │   Alphanumeric = 2,
 29 │   Byte = 4,
 30 │   Kanji = 8,
 31 │ }
 32 │ 
 33 │ /** The 45-character alphanumeric alphabet, index === encoded value. */
 34 │ export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
 35 │ 
 36 │ const ALNUM_INDEX = (() => {
 37 │   const map = new Int8Array(128).fill(-1);
 38 │   for (let i = 0; i < ALPHANUMERIC_CHARSET.length; i++) {
 39 │     map[ALPHANUMERIC_CHARSET.charCodeAt(i)] = i;
 40 │   }
 41 │   return map;
 42 │ })();
 43 │ 
 44 │ /** Version groups differ in character-count-indicator widths. */
 45 │ export function versionGroup(version: number): 0 | 1 | 2 {
 46 │   if (version <= 9) return 0;
 47 │   if (version <= 26) return 1;
 48 │   return 2;
 49 │ }
 50 │ 
 51 │ /** Bit width of the character count indicator for (mode, version). */
 52 │ export function charCountBits(mode: QrMode, version: number): number {
 53 │   const g = versionGroup(version);
 54 │   switch (mode) {
 55 │     case QrMode.Numeric:
 56 │       return [10, 12, 14][g];
 57 │     case QrMode.Alphanumeric:
 58 │       return [9, 11, 13][g];
 59 │     case QrMode.Byte:
 60 │       return [8, 16, 16][g];
 61 │     case QrMode.Kanji:
 62 │       return [8, 10, 12][g];
 63 │     default:
 64 │       throw new RangeError(`Unknown QR mode ${mode}`);
 65 │   }
 66 │ }
 67 │ 
 68 │ export interface QrSegment {
 69 │   mode: QrMode;
 70 │   /** Number of characters (not bytes) in the original data. */
 71 │   numChars: number;
 72 │   /** Payload bits, MSB-first. */
 73 │   bits: Uint8Array;
 74 │   bitLength: number;
 75 │ }
 76 │ 
 77 │ /** Bits of payload for `n` numeric characters: 10 bits per triple, 4/7 for 1/2. */
 78 │ export function numericBitLength(n: number): number {
 79 │   return Math.floor(n / 3) * 10 + [0, 4, 7][n % 3];
 80 │ }
 81 │ 
 82 │ /** Bits of payload for `n` alphanumeric characters: 11 per pair, 6 for a lone char. */
 83 │ export function alphanumericBitLength(n: number): number {
 84 │   return Math.floor(n / 2) * 11 + (n % 2) * 6;
 85 │ }
 86 │ 
 87 │ export function makeNumericSegment(digits: string): QrSegment {
 88 │   const w = new BitWriter(Math.ceil(numericBitLength(digits.length) / 8) + 4);
 89 │   for (let i = 0; i < digits.length; i += 3) {
 90 │     const chunk = digits.slice(i, i + 3);
 91 │     if (chunk.length === 3) w.write(parseInt(chunk, 10), 10);
 92 │     else if (chunk.length === 2) w.write(parseInt(chunk, 10), 7);
 93 │     else w.write(parseInt(chunk, 10), 4);
 94 │   }
 95 │   return { mode: QrMode.Numeric, numChars: digits.length, bits: w.toUint8Array(), bitLength: w.length };
 96 │ }
 97 │ 
 98 │ export function makeAlphanumericSegment(text: string): QrSegment {
 99 │   const w = new BitWriter(Math.ceil(alphanumericBitLength(text.length) / 8) + 4);
100 │   let i = 0;
101 │   for (; i + 1 < text.length; i += 2) {
102 │     const hi = ALNUM_INDEX[text.charCodeAt(i)];
103 │     const lo = ALNUM_INDEX[text.charCodeAt(i + 1)];
104 │     if (hi < 0 || lo < 0) throw new RangeError(`Character "${text[i]}"/"${text[i + 1]}" is not alphanumeric`);
105 │     w.write(hi * 45 + lo, 11);
106 │   }
107 │   if (i < text.length) {
108 │     const hi = ALNUM_INDEX[text.charCodeAt(i)];
109 │     if (hi < 0) throw new RangeError(`Character "${text[i]}" is not alphanumeric`);
110 │     w.write(hi, 6);
111 │   }
112 │   return { mode: QrMode.Alphanumeric, numChars: text.length, bits: w.toUint8Array(), bitLength: w.length };
113 │ }
114 │ 
115 │ const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
116 │ 
117 │ /** UTF-8 encode without assuming global TextEncoder exists in stripped sandboxes. */
118 │ export function utf8Encode(text: string): Uint8Array {
119 │   if (utf8Encoder) return utf8Encoder.encode(text);
120 │   const out: number[] = [];
121 │   for (let i = 0; i < text.length; i++) {
122 │     let cp = text.codePointAt(i)!;
123 │     if (cp > 0xffff) i++;
124 │     if (cp < 0x80) out.push(cp);
125 │     else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
126 │     else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
127 │     else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
128 │   }
129 │   return new Uint8Array(out);
130 │ }
131 │ 
132 │ /** Byte-mode segment from raw bytes (used for binary payload frames). */
133 │ export function makeByteSegmentFromBytes(bytes: Uint8Array): QrSegment {
134 │   return {
135 │     mode: QrMode.Byte,
136 │     numChars: bytes.length,
137 │     bits: bytes,
138 │     bitLength: bytes.length * 8,
139 │   };
140 │ }
141 │ 
142 │ export function makeByteSegment(text: string): QrSegment {
143 │   return makeByteSegmentFromBytes(utf8Encode(text));
144 │ }
145 │ 
146 │ function isNumericCode(code: number): boolean {
147 │   return code >= 48 && code <= 57;
148 │ }
149 │ 
150 │ function alnumIndex(code: number): number {
151 │   return code < 128 ? ALNUM_INDEX[code] : -1;
152 │ }
153 │ 
154 │ /** True if the whole string can be encoded in numeric mode. */
155 │ export function isAllNumeric(text: string): boolean {
156 │   for (let i = 0; i < text.length; i++) if (!isNumericCode(text.charCodeAt(i))) return false;
157 │   return text.length > 0;
158 │ }
159 │ 
160 │ /** True if the whole string can be encoded in alphanumeric mode. */
161 │ export function isAllAlphanumeric(text: string): boolean {
162 │   for (let i = 0; i < text.length; i++) if (alnumIndex(text.charCodeAt(i)) < 0) return false;
163 │   return text.length > 0;
164 │ }
165 │ 
166 │ /**
167 │  * Cost, in bits, of a segment covering text[start..end) in the given mode,
168 │  * including the 4-bit mode indicator and the version-dependent count indicator.
169 │  */
170 │ function segmentCost(mode: QrMode, length: number, version: number): number {
171 │   switch (mode) {
172 │     case QrMode.Numeric:
173 │       return 4 + charCountBits(mode, version) + numericBitLength(length);
174 │     case QrMode.Alphanumeric:
175 │       return 4 + charCountBits(mode, version) + alphanumericBitLength(length);
176 │     default:
177 │       // Byte mode cost depends on the UTF-8 length, not the JS string length;
178 │       // the caller passes the pre-computed byte length via `length`.
179 │       return 4 + charCountBits(mode, version) + length * 8;
180 │   }
181 │ }
182 │ 
183 │ /**
184 │  * Optimal (minimum total bits) segmentation of `text` for a given version.
185 │  *
186 │  * This is a shortest-path problem over string positions. From position i we may
187 │  * emit a numeric run, an alphanumeric run, or a byte chunk of any length, so a
188 │  * naive DP is O(n^2) in the chunk-length dimension. We cap chunk length
189 │  * (MAX_CHUNK) purely to keep the DP fast; for the short text payloads LightBeam
190 │  * transmits this has no effect on the optimum.
191 │  *
192 │  * Returns the segment list. Byte lengths are measured in UTF-8 bytes, computed
193 │  * incrementally so the DP never re-encodes substrings.
194 │  */
195 │ export function splitIntoSegments(text: string, version: number): QrSegment[] {
196 │   const MAX_CHUNK = 1024;
197 │   const n = text.length;
198 │ 
199 │   if (n === 0) return [];
200 │   if (n > 4096) {
201 │     // Pathological input: skip the DP and emit a single byte segment.
202 │     return [makeByteSegment(text)];
203 │   }
204 │ 
205 │   // The DP runs over *code points*, never over UTF-16 code units: a segment
206 │   // boundary inside a surrogate pair would produce a lone surrogate and an
207 │   // invalid UTF-8 sequence on the wire.
208 │   const points: string[] = [];
209 │   const pointBytes: number[] = [];
210 │   for (let i = 0; i < text.length; ) {
211 │     const cp = text.codePointAt(i)!;
212 │     const ch = String.fromCodePoint(cp);
213 │     points.push(ch);
214 │     pointBytes.push(cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
215 │     i += ch.length;
216 │   }
217 │   const m = points.length;
218 │ 
219 │   const INF = Number.MAX_SAFE_INTEGER / 4;
220 │   const cost = new Float64Array(m + 1).fill(INF);
221 │   const from = new Int32Array(m + 1).fill(-1);
222 │   const via = new Uint8Array(m + 1);
223 │   cost[0] = 0;
224 │ 
225 │   for (let i = 0; i < m; i++) {
226 │     if (cost[i] >= INF) continue;
227 │     const base = cost[i];
228 │ 
229 │     // --- byte chunk: always possible, length measured in UTF-8 bytes -------
230 │     let bytes = 0;
231 │     for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
232 │       bytes += pointBytes[j];
233 │       const total = base + segmentCost(QrMode.Byte, bytes, version);
234 │       if (total < cost[j + 1]) {
235 │         cost[j + 1] = total;
236 │         from[j + 1] = i;
237 │         via[j + 1] = QrMode.Byte;
238 │       }
239 │     }
240 │ 
241 │     // --- numeric run -------------------------------------------------------
242 │     let digits = 0;
243 │     for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
244 │       const code = points[j].charCodeAt(0);
245 │       if (!isNumericCode(code)) break;
246 │       digits++;
247 │       const total = base + segmentCost(QrMode.Numeric, digits, version);
248 │       if (total < cost[j + 1]) {
249 │         cost[j + 1] = total;
250 │         from[j + 1] = i;
251 │         via[j + 1] = QrMode.Numeric;
252 │       }
253 │     }
254 │ 
255 │     // --- alphanumeric run --------------------------------------------------
256 │     let alnum = 0;
257 │     for (let j = i; j < m && j - i < MAX_CHUNK; j++) {
258 │       if (alnumIndex(points[j].charCodeAt(0)) < 0) break;
259 │       alnum++;
260 │       const total = base + segmentCost(QrMode.Alphanumeric, alnum, version);
261 │       if (total < cost[j + 1]) {
262 │         cost[j + 1] = total;
263 │         from[j + 1] = i;
264 │         via[j + 1] = QrMode.Alphanumeric;
265 │       }
266 │     }
267 │   }
268 │ 
269 │   // Backtrack to recover the segmentation.
270 │   const parts: Array<{ start: number; end: number; mode: QrMode }> = [];
271 │   for (let pos = m; pos > 0; pos = from[pos]) {
272 │     if (from[pos] < 0) throw new Error('QR segmentation failed');
273 │     parts.push({ start: from[pos], end: pos, mode: via[pos] as QrMode });
274 │   }
275 │   parts.reverse();
276 │ 
277 │   // Materialise each part with the cheapest *matching* mode. A part the DP
278 │   // routed through the alphanumeric table whose slice happens to be all digits
279 │   // is cheaper still as numeric, so prefer numeric when it is valid.
280 │   return parts.map(({ start, end, mode }) => {
281 │     const slice = points.slice(start, end).join('');
282 │     if (mode === QrMode.Byte) return makeByteSegment(slice);
283 │     if (mode === QrMode.Numeric || isAllNumeric(slice)) return makeNumericSegment(slice);
284 │     return makeAlphanumericSegment(slice);
285 │   });
286 │ }
287 │ 
288 │ /**
289 │  * Total bit length of a segment list including mode and count indicators,
290 │  * for a given version. Byte-mode segments already carry their byte count in
291 │  * \`numChars\` (see makeByteSegmentFromBytes).
292 │  */
293 │ export function segmentsBitLength(segments: QrSegment[], version: number): number {
294 │   let total = 0;
295 │   for (const seg of segments) total += 4 + charCountBits(seg.mode, version) + seg.bitLength;
296 │   return total;
297 │ }
```

---

## `packages/core/src/qr/matrix.ts`

> 398 lines

**What it is.** QR symbol construction: the function patterns, the format and version
information, data placement (the "zigzag"), masking, and the mask-scoring rules. This is the
file that turns codewords into a grid of light and dark modules.

**The one structural decision: three parallel arrays instead of a 2D array.**


A 2D `number[][]` would be the obvious representation and the wrong one. With flat typed
arrays: the mask loop is a linear scan, `applyFunctionLayer` is a single pass, and — the
reason it exists — **the data layer is a fixed sequence of positions**, so a symbol can be
re-coloured in place without re-running the placement traversal. `encoder.ts` caches the
whole matrix per symbol and rewrites only `modules[i] = bit ⊕ mask` for the data positions.

**`buildFunctionLayer`.** Draws, in order: the three finder patterns with their separators
(the 9×9 loop with the `inRing` test is doing double duty — see below), the timing patterns
in row 6 and column 6, the alignment patterns on their grid, and the *reserved* areas for
format and version information.

- The finder loop runs `dx, dy` from −1 to 7 and tests `inRing` for `0..6`. That single
  construct draws the 7×7 ring, the 3×3 core, **and** the one-module separator, because
  positions outside the ring are written as light. It is a compact way to get the separator
  right, which is easy to forget and fatal to scanning.
- Alignment patterns use `Math.max(|dx|, |dy|) !== 1`, which is the "ring around a solid
  core" test — the pattern is dark at the ring (distance 2) and the centre (distance 0),
  light at distance 1.
- The three corner positions are skipped by index, not by coordinate comparison: the
  finder patterns already occupy them, and overwriting an alignment pattern there would
  corrupt the finder.
- Format/version areas are **reserved but written as light** here; their values come later
  from `drawFormatInfo`/`drawVersionInfo`. Keeping reservation and content separate is what
  lets the encoder try one mask after another without rebuilding the symbol.
- The always-dark module at `(8, size − 8)` is set last.

**`formatInfoBits(ecLevel, mask)`.** Five data bits (2 for EC level, 3 for the mask) and the
(15,5) BCH code with generator `0x537`, computed by the shifting-remainder loop that runs
`while (bitLength(rem) − 11 >= 0)`. The result is XORed with `0x5412`, and the comment says
why: without the mask, an all-zero format field would produce an unbroken row of light
modules that reads as part of a finder pattern.

**`drawFormatInfo` writes both copies.** QR stores format information twice — around the
top-left finder and split across the top-right/bottom-left — so damage to one corner cannot
hide it. The two copy loops index a 15-bit integer in two different directions, which is
exactly the kind of transposition that a differential test against jsQR is good at catching.
Note the third copy-related line: `setFunction(m, 8, size − 8, 1)` re-asserts the dark module
*after* the format bits, because copy 2 of the format information overlaps that area in the
specification's indexing and the dark module must win.

**`placeData`.** The ISO 18004 §7.7.3 traversal: two-module-wide columns, right to left,
direction alternating up/down, starting bottom-to-top, with column 6 (the vertical timing
pattern) stepped over. Three details:

1. `if (right === 6) right = 5;` — the standard's way of skipping the timing column. Each
   column pair is `(right, right−1)`, so shifting the right edge from 6 to 5 makes the pair
   `(5, 4)` instead of `(6, 5)`.
2. `const upward = ((right + 1) & 2) === 0;` — the direction for a column pair, derived
   from the pair's index using the standard's parity rule rather than tracked in a variable.
3. **`bitIndex` advances even for function modules** (the `continue` comes after the `if
   (func[i])` test? no — read it again: the function-module `continue` happens *before*
   the bit is consumed, so data bits flow around function patterns exactly as the standard
   requires, and `bitIndex` only advances at data positions). Past `totalBits` the remaining
   data positions are filled with 0 — that is the "remainder bits" of versions where the
   data area is not a whole number of codewords (versions 2–6 and 28–34 have 7, 3 or 4
   remainder bits).

**`maskBit` and `applyMask`.** The eight mask formulas, transcribed from table 10. Masking
applies **only to data modules** (`!func[i]`) — masking a function pattern would destroy the
symbol — and `applyMask` returns the dark-module count so the N4 penalty does not have to
count them again.

**`maskPenalty`.** The four ISO rules (N1 runs, N2 2×2 blocks, N3 finder-like 1:1:3:1:1
sequences, N4 dark proportion in 5% steps). Two implementation notes:

- **N1 is measured per row and per column with a running length**, not by materialising runs.
- **N3 requires the 1:1:3:1:1 sequence to be preceded or followed by four light modules.**
  The `before`/`after` tests are what distinguish a genuine finder-like pattern from an
  ordinary run; omitting them is a common simplification that scores differently from the
  standard and therefore picks a different mask than a reference encoder.
- **N4 takes the *nearer* of the two adjacent 5% steps** (`Math.min(abs(lower − 50),
  abs(upper − 50))`), which is how the standard's step function behaves at a boundary.

**Why any of this matters.** Mask selection is the difference between a symbol that scans at
arm's length and one that needs the phone held steady. The tests do not compare penalty
scores against a reference — they decode the resulting symbols with jsQR, which is the
outcome that actually matters, and jsQR's author has never seen this code.

**Every line**

```ts
  1 │ /**
  2 │  * matrix.ts - QR Code symbol construction: function patterns, format/version
  3 │  * information, data placement (the "zigzag"), and data masking.
  4 │  *
  5 │  * The module grid is stored redundantly in three parallel Uint8Arrays, which is
  6 │  * what makes the frame loop fast enough for video-rate symbol generation:
  7 │  *
  8 │  *   modules[i]     final colour of module i (0 = light, 1 = dark)
  9 │  *   bitMask[i]     the data bit placed at module i (1 if that bit was 1)
 10 │  *   isFunction[i]  1 if module i belongs to a function pattern or to the
 11 │  *                  format/version information area (i.e. carries no data)
 12 │  *
 13 │  * Because the function-pattern layer never changes for a given
 14 │  * (version, EC level) - and the data layer is just codewords poured into a
 15 │  * fixed sequence of positions - we can rasterise frames without ever building
 16 │  * a 2D array or touching the mask pattern selection. See encoder.ts.
 17 │  */
 18 │ 
 19 │ import { ALIGNMENT_PATTERN_COORDS, VERSION_INFO_BITS } from './tables.js';
 20 │ import type { EcLevel } from './tables.js';
 21 │ 
 22 │ export interface QrMatrix {
 23 │   readonly version: number;
 24 │   readonly size: number;
 25 │   /** Final module colour: 0 = light, 1 = dark. */
 26 │   readonly modules: Uint8Array;
 27 │   /** Data bit at each module (meaningful only where isFunction === 0). */
 28 │   readonly bitMask: Uint8Array;
 29 │   /** 1 = function pattern / format info area (no data stored). */
 30 │   readonly isFunction: Uint8Array;
 31 │   /** Fixed function-pattern layer, ready to copy for every generated frame. */
 32 │   readonly functionLayer: Uint8Array;
 33 │ }
 34 │ 
 35 │ /** Module index for (x = column, y = row) in row-major order. */
 36 │ export function idx(size: number, x: number, y: number): number {
 37 │   return y * size + x;
 38 │ }
 39 │ 
 40 │ export function emptyMatrix(version: number): QrMatrix {
 41 │   const size = 17 + version * 4;
 42 │   const n = size * size;
 43 │   return {
 44 │     version,
 45 │     size,
 46 │     modules: new Uint8Array(n),
 47 │     bitMask: new Uint8Array(n),
 48 │     isFunction: new Uint8Array(n),
 49 │     functionLayer: new Uint8Array(n),
 50 │   };
 51 │ }
 52 │ 
 53 │ function setFunction(m: QrMatrix, x: number, y: number, dark: number): void {
 54 │   const i = idx(m.size, x, y);
 55 │   m.functionLayer[i] = dark ? 1 : 0;
 56 │   m.isFunction[i] = 1;
 57 │ }
 58 │ 
 59 │ /**
 60 │  * Draw every function pattern:
 61 │  *   - three 7x7 finder patterns plus their 1-module separators,
 62 │  *   - the alternating timing patterns in row 6 and column 6,
 63 │  *   - alignment patterns (2+ per row/column grid, skipped at the corners),
 64 │  *   - the reserved format-information areas and, for versions >= 7, the two
 65 │  *     version-information blocks,
 66 │  *   - the always-dark module at (8, size - 8).
 67 │  * The actual format/version *values* are written later by drawFormatInfo /
 68 │  * drawVersionInfo; here we only reserve the modules.
 69 │  */
 70 │ export function buildFunctionLayer(m: QrMatrix): void {
 71 │   const size = m.size;
 72 │ 
 73 │   // --- finder patterns + separators -----------------------------------------
 74 │   const drawFinder = (cx: number, cy: number): void => {
 75 │     // cx, cy are the top-left coordinates of the 9x9 area including separator.
 76 │     for (let dy = -1; dy <= 7; dy++) {
 77 │       for (let dx = -1; dx <= 7; dx++) {
 78 │         const x = cx + dx;
 79 │         const y = cy + dy;
 80 │         if (x < 0 || y < 0 || x >= size || y >= size) continue;
 81 │         // 7x7 rings: outer ring dark, 1-module light gap, 3x3 dark core.
 82 │         const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
 83 │         const isDark =
 84 │           inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
 85 │         setFunction(m, x, y, isDark ? 1 : 0);
 86 │       }
 87 │     }
 88 │   };
 89 │   drawFinder(0, 0);
 90 │   drawFinder(size - 7, 0);
 91 │   drawFinder(0, size - 7);
 92 │ 
 93 │   // --- timing patterns -------------------------------------------------------
 94 │   for (let i = 8; i < size - 8; i++) {
 95 │     const dark = i % 2 === 0 ? 1 : 0;
 96 │     setFunction(m, i, 6, dark);
 97 │     setFunction(m, 6, i, dark);
 98 │   }
 99 │ 
100 │   // --- alignment patterns ----------------------------------------------------
101 │   const coords = alignmentCoords(m.version);
102 │   const last = coords.length - 1;
103 │   for (let a = 0; a < coords.length; a++) {
104 │     for (let b = 0; b < coords.length; b++) {
105 │       // Skip the three positions occupied by finder patterns.
106 │       if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
107 │       const cx = coords[a];
108 │       const cy = coords[b];
109 │       for (let dy = -2; dy <= 2; dy++) {
110 │         for (let dx = -2; dx <= 2; dx++) {
111 │           const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0;
112 │           setFunction(m, cx + dx, cy + dy, dark);
113 │         }
114 │       }
115 │     }
116 │   }
117 │ 
118 │   // --- format information reservation ---------------------------------------
119 │   for (let i = 0; i < 9; i++) {
120 │     if (i !== 6) {
121 │       setFunction(m, 8, i, 0);
122 │       setFunction(m, i, 8, 0);
123 │     }
124 │   }
125 │   for (let i = 0; i < 8; i++) {
126 │     setFunction(m, size - 1 - i, 8, 0);
127 │     setFunction(m, 8, size - 1 - i, 0);
128 │   }
129 │ 
130 │   // --- version information reservation (versions 7+) ------------------------
131 │   if (m.version >= 7) {
132 │     for (let i = 0; i < 18; i++) {
133 │       const a = size - 11 + (i % 3);
134 │       const b = Math.floor(i / 3);
135 │       setFunction(m, a, b, 0);
136 │       setFunction(m, b, a, 0);
137 │     }
138 │   }
139 │ 
140 │   // --- the always-dark module -----------------------------------------------
141 │   setFunction(m, 8, size - 8, 1);
142 │ 
143 │   // Copy the function layer into the working modules array.
144 │   m.modules.set(m.functionLayer);
145 │ }
146 │ 
147 │ /**
148 │  * Alignment pattern centre coordinates for a version. The table comes from
149 │  * ISO/IEC 18004 Annex E (generated into tables.ts); version 1 has none.
150 │  */
151 │ function alignmentCoords(version: number): number[] {
152 │   return ALIGNMENT_PATTERN_COORDS[version] ?? [];
153 │ }
154 │ 
155 │ /**
156 │  * Format information: 5 data bits (2 EC level + 3 mask) encoded with the
157 │  * (15,5) BCH code, generator polynomial 0b101_0011_0111 (0x537), then XORed
158 │  * with the mask 0b101010000010010 (0x5412) so that the all-zero format never
159 │  * produces an all-light row (which would look like a finder pattern).
160 │  */
161 │ export function formatInfoBits(ecLevel: EcLevel, mask: number): number {
162 │   const ecBits = { L: 1, M: 0, Q: 3, H: 2 }[ecLevel];
163 │   const data = (ecBits << 3) | mask;
164 │   let rem = data << 10;
165 │   while (bitLength(rem) - 11 >= 0) rem ^= 0x537 << (bitLength(rem) - 11);
166 │   return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
167 │ }
168 │ 
169 │ function bitLength(value: number): number {
170 │   return 32 - Math.clz32(value);
171 │ }
172 │ 
173 │ /** Write both copies of the 15 format modules. */
174 │ export function drawFormatInfo(m: QrMatrix, ecLevel: EcLevel, mask: number): void {
175 │   const bits = formatInfoBits(ecLevel, mask);
176 │   const size = m.size;
177 │   const bit = (i: number): number => (bits >>> i) & 1;
178 │ 
179 │   // Copy 1: around the top-left finder pattern.
180 │   for (let i = 0; i <= 5; i++) setFunction(m, 8, i, bit(i));
181 │   setFunction(m, 8, 7, bit(6));
182 │   setFunction(m, 8, 8, bit(7));
183 │   setFunction(m, 7, 8, bit(8));
184 │   for (let i = 9; i < 15; i++) setFunction(m, 14 - i, 8, bit(i));
185 │ 
186 │   // Copy 2: split between the top-right and bottom-left finder patterns.
187 │   for (let i = 0; i < 8; i++) setFunction(m, size - 1 - i, 8, bit(i));
188 │   for (let i = 8; i < 15; i++) setFunction(m, 8, size - 15 + i, bit(i));
189 │ 
190 │   // The dark module is part of the format area and must survive the copy.
191 │   setFunction(m, 8, size - 8, 1);
192 │ 
193 │   // Re-apply the reserved function layer over the data area.
194 │   applyFunctionLayer(m);
195 │ }
196 │ 
197 │ /** Write both copies of the 18-bit version information (versions 7+). */
198 │ export function drawVersionInfo(m: QrMatrix): void {
199 │   if (m.version < 7) return;
200 │   const bits = VERSION_INFO_BITS[m.version];
201 │   const size = m.size;
202 │   for (let i = 0; i < 18; i++) {
203 │     const dark = (bits >>> i) & 1;
204 │     const a = size - 11 + (i % 3);
205 │     const b = Math.floor(i / 3);
206 │     setFunction(m, a, b, dark);
207 │     setFunction(m, b, a, dark);
208 │   }
209 │   applyFunctionLayer(m);
210 │ }
211 │ 
212 │ /** Rebuild `modules` from the frozen function layer (fast: one memcpy). */
213 │ export function applyFunctionLayer(m: QrMatrix): void {
214 │   const len = m.modules.length;
215 │   const src = m.functionLayer;
216 │   const dst = m.modules;
217 │   for (let i = 0; i < len; i++) if (m.isFunction[i]) dst[i] = src[i];
218 │ }
219 │ 
220 │ /**
221 │  * Place data codewords into the symbol.
222 │  *
223 │  * The traversal is specified in ISO/IEC 18004 7.7.3: two-module-wide columns
224 │  * are visited right to left, skipping the vertical timing column (column 6),
225 │  * and within each column the direction alternates upward/downward, going
226 │  * bottom-to-top first. Column pairs are (size-1, size-2), (size-3, size-4), ...
227 │  * and the timing column is stepped over by shifting the right edge from 6 to 5.
228 │  *
229 │  * We record the bit in `bitMask` at the same time: the bit mask is what lets
230 │  * the frame generator re-colour a cached symbol in place without re-running
231 │  * this traversal (see qr/render.ts).
232 │  */
233 │ export function placeData(m: QrMatrix, codewords: Uint8Array, totalBits: number): void {
234 │   const size = m.size;
235 │   const mods = m.modules;
236 │   const mask = m.bitMask;
237 │   const func = m.isFunction;
238 │ 
239 │   let bitIndex = 0;
240 │   for (let right = size - 1; right >= 1; right -= 2) {
241 │     if (right === 6) right = 5; // skip the vertical timing pattern
242 │     for (let vert = 0; vert < size; vert++) {
243 │       for (let j = 0; j < 2; j++) {
244 │         const x = right - j;
245 │         const upward = ((right + 1) & 2) === 0;
246 │         const y = upward ? size - 1 - vert : vert;
247 │         const i = idx(size, x, y);
248 │         if (func[i]) continue;
249 │         let bit = 0;
250 │         if (bitIndex < totalBits) {
251 │           bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
252 │         }
253 │         bitIndex++;
254 │         mask[i] = bit;
255 │         mods[i] = bit;
256 │       }
257 │     }
258 │   }
259 │ }
260 │ 
261 │ /** The eight data masks of ISO/IEC 18004 table 10. */
262 │ export function maskBit(pattern: number, x: number, y: number): number {
263 │   switch (pattern) {
264 │     case 0:
265 │       return (x + y) % 2 === 0 ? 1 : 0;
266 │     case 1:
267 │       return y % 2 === 0 ? 1 : 0;
268 │     case 2:
269 │       return x % 3 === 0 ? 1 : 0;
270 │     case 3:
271 │       return (x + y) % 3 === 0 ? 1 : 0;
272 │     case 4:
273 │       return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0 ? 1 : 0;
274 │     case 5:
275 │       return ((x * y) % 2) + ((x * y) % 3) === 0 ? 1 : 0;
276 │     case 6:
277 │       return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0 ? 1 : 0;
278 │     case 7:
279 │       return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0 ? 1 : 0;
280 │     default:
281 │       throw new RangeError(`Mask pattern must be 0..7, got ${pattern}`);
282 │   }
283 │ }
284 │ 
285 │ /**
286 │  * XOR the data modules with a mask pattern. Function modules are untouched.
287 │  * Returns the darkest module count, which the N4 penalty needs.
288 │  */
289 │ export function applyMask(m: QrMatrix, pattern: number): number {
290 │   const size = m.size;
291 │   const mods = m.modules;
292 │   const func = m.isFunction;
293 │   let dark = 0;
294 │   for (let y = 0; y < size; y++) {
295 │     for (let x = 0; x < size; x++) {
296 │       const i = y * size + x;
297 │       if (!func[i] && maskBit(pattern, x, y)) mods[i] ^= 1;
298 │       if (mods[i]) dark++;
299 │     }
300 │   }
301 │   return dark;
302 │ }
303 │ 
304 │ /**
305 │  * Mask evaluation score (ISO/IEC 18004 7.8.3). Four penalty rules:
306 │  *
307 │  *   N1 = 3   runs of 5+ identical modules in a row/column: 3 + (run - 5)
308 │  *   N2 = 3   each 2x2 block of identical modules: 3
309 │  *   N3 = 40  each 1:1:3:1:1 finder-like pattern with 4 light modules on
310 │  *            either side: 40
311 │  *   N4 = 10  deviation of the dark-module proportion from 50%, in 5% steps
312 │  *
313 │  * The mask with the lowest total score is used, because it produces the most
314 │  * camera-friendly symbol (fewest confusing patterns and long runs).
315 │  */
316 │ export function maskPenalty(m: QrMatrix, darkCount?: number): number {
317 │   const size = m.size;
318 │   const mods = m.modules;
319 │   let score = 0;
320 │ 
321 │   // --- N1: horizontal and vertical runs -------------------------------------
322 │   const N1 = 3;
323 │   const N2 = 3;
324 │   const N3 = 40;
325 │   const N4 = 10;
326 │ 
327 │   for (let y = 0; y < size; y++) {
328 │     let run = 1;
329 │     for (let x = 1; x < size; x++) {
330 │       if (mods[y * size + x] === mods[y * size + x - 1]) run++;
331 │       else {
332 │         if (run >= 5) score += N1 + (run - 5);
333 │         run = 1;
334 │       }
335 │     }
336 │     if (run >= 5) score += N1 + (run - 5);
337 │   }
338 │   for (let x = 0; x < size; x++) {
339 │     let run = 1;
340 │     for (let y = 1; y < size; y++) {
341 │       if (mods[y * size + x] === mods[(y - 1) * size + x]) run++;
342 │       else {
343 │         if (run >= 5) score += N1 + (run - 5);
344 │         run = 1;
345 │       }
346 │     }
347 │     if (run >= 5) score += N1 + (run - 5);
348 │   }
349 │ 
350 │   // --- N2: 2x2 blocks --------------------------------------------------------
351 │   for (let y = 0; y < size - 1; y++) {
352 │     for (let x = 0; x < size - 1; x++) {
353 │       const a = mods[y * size + x];
354 │       if (a === mods[y * size + x + 1] && a === mods[(y + 1) * size + x] && a === mods[(y + 1) * size + x + 1]) {
355 │         score += N2;
356 │       }
357 │     }
358 │   }
359 │ 
360 │   // --- N3: finder-like 1:1:3:1:1 patterns -----------------------------------
361 │   const pattern = [1, 0, 1, 1, 1, 0, 1];
362 │   const matches = (get: (i: number) => number, start: number, limit: number): boolean => {
363 │     if (start + 6 >= limit) return false;
364 │     for (let k = 0; k < 7; k++) if (get(start + k) !== pattern[k]) return false;
365 │     return true;
366 │   };
367 │   for (let y = 0; y < size; y++) {
368 │     const getRow = (i: number): number => mods[y * size + i];
369 │     for (let x = 0; x + 6 < size; x++) {
370 │       if (!matches(getRow, x, size)) continue;
371 │       const before = x - 4 >= 0 && [0, 1, 2, 3].every((k) => getRow(x - 1 - k) === 0);
372 │       const after = x + 10 < size && [0, 1, 2, 3].every((k) => getRow(x + 7 + k) === 0);
373 │       if (before || after) score += N3;
374 │     }
375 │   }
376 │   for (let x = 0; x < size; x++) {
377 │     const getCol = (i: number): number => mods[i * size + x];
378 │     for (let y = 0; y + 6 < size; y++) {
379 │       if (!matches(getCol, y, size)) continue;
380 │       const before = y - 4 >= 0 && [0, 1, 2, 3].every((k) => getCol(y - 1 - k) === 0);
381 │       const after = y + 10 < size && [0, 1, 2, 3].every((k) => getCol(y + 7 + k) === 0);
382 │       if (before || after) score += N3;
383 │     }
384 │   }
385 │ 
386 │   // --- N4: dark proportion ---------------------------------------------------
387 │   if (darkCount === undefined) {
388 │     darkCount = 0;
389 │     for (let i = 0; i < mods.length; i++) darkCount += mods[i];
390 │   }
391 │   const total = size * size;
392 │   const percent = (darkCount * 100) / total;
393 │   const lower = Math.floor(percent / 5);
394 │   const upper = Math.ceil(percent / 5);
395 │   score += N4 * Math.min(Math.abs(lower * 5 - 50) / 5, Math.abs(upper * 5 - 50) / 5);
396 │ 
397 │   return score;
398 │ }
```

---

## `packages/core/src/qr/encoder.ts`

> 373 lines

**What it is.** The QR encoder, complete: segmentation, version and EC-level selection, the
bit stream, Reed–Solomon block splitting and interleaving, data placement, mask selection,
and format/version information. The header lists the five steps; this walkthrough is about
the decisions inside them, and about the two things here that a reference implementation
would not have.

**Step 1–2: which version, and how much error correction.**

- `encodeText` picks the smallest version whose capacity fits, then **re-segments if the
  version landed in a different version group** — because the character-count indicator
  width changes at versions 10 and 27, a segmentation that is optimal for version 8 need not
  be optimal for version 11. The code compares version groups rather than versions, which is
  exactly the condition under which the optimum can change.
- `encodeBinary` never tries numeric/alphanumeric packing: a binary payload must round-trip
  byte for byte, and a "clever" re-encoding of bytes that happen to be digits would break
  that.
- **EC-level boosting** (`bestEcLevelForBits`) is the first of the two ideas here that a
  reference encoder would not have. Once a version is chosen, the code asks: how much error
  correction fits *for free*? A camera channel loses frames constantly, and a symbol with a
  higher EC level survives a partially blurred or badly lit capture that a level-L symbol
  would not. A 57-module symbol that could hold the payload at level H but is written at
  level L is throwing away robustness for nothing, since the version is already fixed by the
  session plan. `boostEcLevel: false` restores the reference behaviour, and the tests use it
  when they need to predict exact capacities.
- Note `segmentsBitLength` is duplicated in this file and in `segments.ts` — the local copy
  is used before the version is known, and importing the other one pulled the DP module into
  every bundle for a three-line function. The two are identical by contract; if you change
  one, change both (the tests compare them indirectly through the capacity assertions).

**Step 3: the bit stream.**

The terminator is written as `writer.write(0, Math.min(4, capacityBits − writer.length))` —
**up to** four zero bits, clipped to what is left. A full-capacity payload has no room for a
terminator at all, and a naive four-bit write would overflow the symbol into a capacity
exception. Then `padToByte(0)` aligns, and the remaining bytes are filled with the
alternating `0xEC`/`0x11` pair. The local `toggle` loop duplicates
`BitWriter.padWithAlternatingBytes` for the *byte-array* case — the writer is used to produce
exact bytes first, so the padding is applied to the array, not to the writer.

**Step 4: blocks and interleaving — where the subtle bug lived.**


The comment in the loop is unusually direct because this caused a real failure during
development: **getting the group order wrong is invisible until the two groups differ in
size, which first happens at version 10.** Versions 1–9 have a single block size, so a wrong
order passes every small test and fails on the first large symbol. The fix — `b >= blocks −
longCount` for the long group — is one line, and the test suite now covers the boundary. This
is also the single best argument for the differential testing approach: jsQR disagreed with
us, and nothing else would have.

Interleaving then walks the data codewords *column-wise across blocks* (index `i` of every
block, then the next index), skipping blocks that are shorter, and afterwards the parity
codewords the same way. That ordering is what spreads burst damage across blocks — the entire
point of interleaving in a 2D symbol where damage is a smudge, not a byte.

**Step 5: matrix and mask.**

- **Mask selection applies each mask, scores it, and applies the mask again to undo it.**
  Masking is its own inverse (XOR), so no copies of the matrix are needed. This is the
  reason `applyMask` returns the dark count and `maskPenalty` accepts it as an optional
  argument.
- The order matters: `drawFormatInfo` must be called *before* scoring, because the format
  modules are part of the symbol and influence the N1–N4 penalties. Scoring without them
  would pick a mask that a reference encoder would not.
- After the winning mask is applied for real, `applyFunctionLayer` runs again to guarantee
  the function patterns are intact — a cheap final assertion that the mask never touched a
  function module.

**`SymbolCache`.** An insertion-ordered `Map` plus a parallel `keys` array, evicting the
oldest entry past `maxEntries` (default 32). It is used for the symbols a sender repeats —
session header frames, the frames placed before the payload bits, the zero-padded tail — and
by the browser preview, which re-renders the same symbol for as long as it is on screen. The
`get(key, build)` signature is deliberate: the caller supplies the builder, so a cache miss
costs one closure allocation rather than a template parameter, and the cache cannot be asked
for a symbol whose key does not correspond to the options used to build it.

**One thing this encoder does not do: streaming.** There is no partial-symbol interface,
because the protocol above it never needs one — a frame is a fixed-size byte string, and
`SymbolCache` absorbs the repetition. `lock`-style options (`mask`) exist to skip the
eight-way mask search when a whole session shares one geometry, which is more than half of
the encoder's cost.

**Every line**

```ts
  1 │ /**
  2 │  * encoder.ts - full QR Code encoder (ISO/IEC 18004), tuned for optics.
  3 │  *
  4 │  * Pipeline:
  5 │  *   1. split the input into optimally segmented data segments
  6 │  *      (numeric / alphanumeric / byte, cheapest segmentation per version group)
  7 │  *   2. pick the smallest version whose capacity fits, optionally *boosting* the
  8 │  *      EC level when the symbol has slack - a bigger error-correction budget is
  9 │  *      free robustness for a camera-based channel
 10 │  *   3. build the bit stream: segments + terminator + byte padding + 0xEC/0x11 pad
 11 │  *   4. split data codewords into Reed-Solomon blocks, add parity, interleave
 12 │  *   5. draw function patterns, place interleaved codewords, pick the best of the
 13 │  *      eight data masks by penalty score, write format and version information
 14 │  *
 15 │  * Result: a flat module grid, `modules[y * size + x]`, plus two companion
 16 │  * arrays (bitMask, isFunction) that let a renderer recolour a symbol without
 17 │  * re-running any of the above.
 18 │  *
 19 │  * Streaming fast path: a LightBeam transfer renders thousands of symbols that
 20 │  * all share one geometry (version, EC level, mask). `lock` in EncodeOptions
 21 │  * skips the eight-way mask search, which is more than half of the encoder cost.
 22 │  */
 23 │ 
 24 │ import { BitWriter } from '../util/bits.js';
 25 │ import {
 26 │   BYTE_MODE_CAPACITY,
 27 │   EC_BLOCKS,
 28 │   SYMBOL_TOTAL_CODEWORDS,
 29 │   type EcLevel,
 30 │ } from './tables.js';
 31 │ import { rsEncode } from './reed-solomon.js';
 32 │ import {
 33 │   charCountBits,
 34 │   makeByteSegmentFromBytes,
 35 │   splitIntoSegments,
 36 │   type QrSegment,
 37 │ } from './segments.js';
 38 │ import {
 39 │   applyFunctionLayer,
 40 │   applyMask,
 41 │   buildFunctionLayer,
 42 │   drawFormatInfo,
 43 │   drawVersionInfo,
 44 │   emptyMatrix,
 45 │   maskPenalty,
 46 │   placeData,
 47 │   type QrMatrix,
 48 │ } from './matrix.js';
 49 │ 
 50 │ export interface EncodeOptions {
 51 │   /** Error correction level used for version selection. Default 'L'. */
 52 │   ecLevel?: EcLevel;
 53 │   /** Smallest version to consider (also the version used when fitting a frame). */
 54 │   minVersion?: number;
 55 │   maxVersion?: number;
 56 │   /** Force a mask pattern 0..7 and skip the 8-way penalty search. */
 57 │   mask?: number;
 58 │   /**
 59 │    * Raise the EC level to the highest one that still fits in the chosen
 60 │    * version. Free robustness for a camera channel; on by default.
 61 │    */
 62 │   boostEcLevel?: boolean;
 63 │ }
 64 │ 
 65 │ export interface EncodedSymbol {
 66 │   version: number;
 67 │   size: number;
 68 │   ecLevel: EcLevel;
 69 │   mask: number;
 70 │   /** 1 = dark module, 0 = light. Row-major, length size * size. */
 71 │   modules: Uint8Array;
 72 │   /** Data bit carried by each module (meangful only where isFunction === 0). */
 73 │   bitMask: Uint8Array;
 74 │   /** 1 where the module is a function pattern or format/version information. */
 75 │   isFunction: Uint8Array;
 76 │   /** Human-readable label of the payload (diagnostics only). */
 77 │   text: string;
 78 │   /** Payload bits actually used, and the symbol's data capacity, in bits. */
 79 │   bitLength: number;
 80 │   capacityBits: number;
 81 │   /** Total interleaved codewords placed in the symbol. */
 82 │   totalCodewords: number;
 83 │ }
 84 │ 
 85 │ /** Data codewords available for (version, level). */
 86 │ export function dataCodewordCount(version: number, level: EcLevel): number {
 87 │   const groups = EC_BLOCKS[level][version];
 88 │   return SYMBOL_TOTAL_CODEWORDS[version] - groups.blocks * groups.ecPerBlock;
 89 │ }
 90 │ 
 91 │ /** Highest EC level (H > Q > M > L) whose data capacity still fits `bitLength`. */
 92 │ function bestEcLevelForBits(version: number, bitLength: number): EcLevel {
 93 │   const order: EcLevel[] = ['H', 'Q', 'M', 'L'];
 94 │   for (const level of order) {
 95 │     if (dataCodewordCount(version, level) * 8 >= bitLength) return level;
 96 │   }
 97 │   return 'L';
 98 │ }
 99 │ 
100 │ function segmentsBitLength(segments: QrSegment[], version: number): number {
101 │   let total = 0;
102 │   for (const seg of segments) total += 4 + charCountBits(seg.mode, version) + seg.bitLength;
103 │   return total;
104 │ }
105 │ 
106 │ function utf8ByteLength(text: string): number {
107 │   let n = 0;
108 │   for (let i = 0; i < text.length; i++) {
109 │     const cp = text.codePointAt(i)!;
110 │     if (cp > 0xffff) i++;
111 │     n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
112 │   }
113 │   return n;
114 │ }
115 │ 
116 │ /** Byte-mode bit cost for `bytes` at a version (mode + count indicator + data). */
117 │ function byteModeBitCost(bytes: number, version: number): number {
118 │   return 4 + charCountBits(4, version) + bytes * 8;
119 │ }
120 │ 
121 │ /**
122 │  * Encode UTF-8 text, segmenting for density.
123 │  *
124 │  * The segmentation optimum depends on the character-count indicator width, which
125 │  * changes at versions 10 and 27. We therefore segment once for the minimum
126 │  * version, find the fitting version, and re-segment if that landed in a later
127 │  * group.
128 │  */
129 │ export function encodeText(text: string, options: EncodeOptions = {}): EncodedSymbol {
130 │   const ecLevel = options.ecLevel ?? 'L';
131 │   const minVersion = Math.max(1, options.minVersion ?? 1);
132 │   const maxVersion = Math.min(40, options.maxVersion ?? 40);
133 │   const bytes = utf8ByteLength(text);
134 │ 
135 │   let segments = splitIntoSegments(text, minVersion);
136 │   let version = 0;
137 │   for (let v = minVersion; v <= maxVersion; v++) {
138 │     if (segmentsBitLength(segments, v) <= dataCodewordCount(v, ecLevel) * 8) {
139 │       version = v;
140 │       break;
141 │     }
142 │   }
143 │   if (version === 0) throw new RangeError(`Text payload of ${bytes} bytes does not fit in any QR version`);
144 │   if ((version <= 9 ? 0 : version <= 26 ? 1 : 2) !== (minVersion <= 9 ? 0 : minVersion <= 26 ? 1 : 2)) {
145 │     segments = splitIntoSegments(text, version);
146 │   }
147 │   return assemble(text, segments, version, ecLevel, options);
148 │ }
149 │ 
150 │ /**
151 │  * Encode raw bytes. Always byte mode: binary payloads must round-trip exactly,
152 │  * so no numeric/alphanumeric re-encoding is attempted.
153 │  */
154 │ export function encodeBinary(bytes: Uint8Array, options: EncodeOptions = {}): EncodedSymbol {
155 │   const ecLevel = options.ecLevel ?? 'L';
156 │   const minVersion = Math.max(1, options.minVersion ?? 1);
157 │   const maxVersion = Math.min(40, options.maxVersion ?? 40);
158 │   let version = 0;
159 │   for (let v = minVersion; v <= maxVersion; v++) {
160 │     if (byteModeBitCost(bytes.length, v) <= dataCodewordCount(v, ecLevel) * 8) {
161 │       version = v;
162 │       break;
163 │     }
164 │   }
165 │   if (version === 0) {
166 │     throw new RangeError(`Binary payload of ${bytes.length} bytes does not fit in a version ${minVersion}-${maxVersion} symbol at EC level ${ecLevel}`);
167 │   }
168 │   return assemble(latin1Label(bytes), [makeByteSegmentFromBytes(bytes)], version, ecLevel, options);
169 │ }
170 │ 
171 │ /** Text-mode label for binary payloads (diagnostics; not part of the wire format). */
172 │ function latin1Label(bytes: Uint8Array): string {
173 │   let out = '';
174 │   const limit = Math.min(bytes.length, 32);
175 │   for (let i = 0; i < limit; i++) out += String.fromCharCode(bytes[i]);
176 │   return out + (bytes.length > limit ? '...' : '');
177 │ }
178 │ 
179 │ /** Largest byte-mode payload that fits (version, level) - used for planning. */
180 │ export function maxBytePayload(version: number, level: EcLevel): number {
181 │   const bits = dataCodewordCount(version, level) * 8 - 4 - charCountBits(4, version);
182 │   return Math.max(0, Math.floor(bits / 8));
183 │ }
184 │ 
185 │ /** Raw byte-mode capacity table straight from ISO 18004 (no header overhead). */
186 │ export { BYTE_MODE_CAPACITY };
187 │ 
188 │ /**
189 │  * Encode an explicit list of segments.
190 │  *
191 │  * This is the entry point for mixed-mode frames: a LightBeam base32 frame is a
192 │  * binary 13-byte header followed by an alphanumeric payload, and encoding that as
193 │  * two segments (byte + alphanumeric) is measurably denser than pushing the whole
194 │  * thing through byte mode - 5.5 bits per transmitted character instead of 8.
195 │  */
196 │ export function encodeSegments(segments: QrSegment[], options: EncodeOptions = {}): EncodedSymbol {
197 │   const ecLevel = options.ecLevel ?? 'L';
198 │   const minVersion = Math.max(1, options.minVersion ?? 1);
199 │   const maxVersion = Math.min(40, options.maxVersion ?? 40);
200 │   let version = 0;
201 │   for (let v = minVersion; v <= maxVersion; v++) {
202 │     if (segmentsBitLength(segments, v) <= dataCodewordCount(v, ecLevel) * 8) {
203 │       version = v;
204 │       break;
205 │     }
206 │   }
207 │   if (version === 0) {
208 │     const cost = segmentsBitLength(segments, maxVersion);
209 │     throw new RangeError(
210 │       `Segments need ${cost} bits, which does not fit a version ${minVersion}-${maxVersion} symbol at EC level ${ecLevel}`,
211 │     );
212 │   }
213 │   let label = '';
214 │   for (const segment of segments) {
215 │     if (segment.mode === 4 && segment.bits.length <= 32) {
216 │       label += String.fromCharCode(...Array.from(segment.bits.subarray(0, 16)));
217 │     }
218 │   }
219 │   return assemble(label.slice(0, 32), segments, version, ecLevel, options);
220 │ }
221 │ 
222 │ /** Steps 3-5, shared by the text and binary entry points. */
223 │ function assemble(
224 │   label: string,
225 │   segments: QrSegment[],
226 │   version: number,
227 │   baseLevel: EcLevel,
228 │   options: EncodeOptions,
229 │ ): EncodedSymbol {
230 │   const payloadBits = segmentsBitLength(segments, version);
231 │   const ecLevel = options.boostEcLevel === false ? baseLevel : bestEcLevelForBits(version, payloadBits);
232 │   const capacityBits = dataCodewordCount(version, ecLevel) * 8;
233 │   if (payloadBits > capacityBits) {
234 │     throw new RangeError(`Payload needs ${payloadBits} bits; version ${version}-${ecLevel} holds ${capacityBits}`);
235 │   }
236 │ 
237 │   // --- step 3: bit stream ---------------------------------------------------
238 │   const writer = new BitWriter((capacityBits >>> 3) + 8);
239 │   for (const seg of segments) {
240 │     writer.write(seg.mode, 4);
241 │     writer.write(seg.numChars, charCountBits(seg.mode, version));
242 │     for (let i = 0; i < seg.bitLength; i++) {
243 │       writer.writeBit((seg.bits[i >>> 3] >>> (7 - (i & 7))) & 1);
244 │     }
245 │   }
246 │   writer.write(0, Math.min(4, capacityBits - writer.length)); // terminator
247 │   writer.padToByte(0);
248 │   const padded = new Uint8Array(capacityBits >>> 3);
249 │   const used = writer.toUint8Array();
250 │   padded.set(used);
251 │   let toggle = true;
252 │   for (let i = used.length; i < padded.length; i++) {
253 │     padded[i] = toggle ? 0xec : 0x11;
254 │     toggle = !toggle;
255 │   }
256 │ 
257 │   // --- step 4: Reed-Solomon blocks + interleaving --------------------------
258 │   const { blocks, ecPerBlock } = EC_BLOCKS[ecLevel][version];
259 │   const totalCodewords = SYMBOL_TOTAL_CODEWORDS[version];
260 │   const dataTotal = totalCodewords - blocks * ecPerBlock;
261 │   const shortLen = Math.floor(dataTotal / blocks);
262 │   const longCount = dataTotal % blocks; // this many blocks carry one extra codeword
263 │ 
264 │   const dataBlocks: Uint8Array[] = [];
265 │   const parityBlocks: Uint8Array[] = [];
266 │   let offset = 0;
267 │   for (let b = 0; b < blocks; b++) {
268 │     // ISO/IEC 18004 7.6: group 1 (the shorter blocks) comes FIRST, then group 2
269 │     // (the blocks with one extra codeword). Getting this order wrong only shows
270 │     // up once the two groups have different sizes, i.e. from version 10 onwards.
271 │     const len = shortLen + (b >= blocks - longCount ? 1 : 0);
272 │     const block = padded.subarray(offset, offset + len);
273 │     offset += len;
274 │     dataBlocks.push(block);
275 │     parityBlocks.push(rsEncode(block, ecPerBlock));
276 │   }
277 │ 
278 │   const interleaved = new Uint8Array(totalCodewords);
279 │   let out = 0;
280 │   const longest = shortLen + (longCount > 0 ? 1 : 0);
281 │   for (let i = 0; i < longest; i++) {
282 │     for (let b = 0; b < blocks; b++) {
283 │       if (i < dataBlocks[b].length) interleaved[out++] = dataBlocks[b][i];
284 │     }
285 │   }
286 │   for (let i = 0; i < ecPerBlock; i++) {
287 │     for (let b = 0; b < blocks; b++) interleaved[out++] = parityBlocks[b][i];
288 │   }
289 │ 
290 │   // --- step 5: matrix ------------------------------------------------------
291 │   const matrix = emptyMatrix(version);
292 │   buildFunctionLayer(matrix);
293 │   placeData(matrix, interleaved, totalCodewords * 8);
294 │   drawVersionInfo(matrix);
295 │ 
296 │   let mask = options.mask;
297 │   if (mask === undefined) {
298 │     // Evaluate all eight masks. Applying a mask twice restores the matrix, so
299 │     // we never need eight copies of it.
300 │     let bestScore = Infinity;
301 │     for (let pattern = 0; pattern < 8; pattern++) {
302 │       applyMask(matrix, pattern);
303 │       drawFormatInfo(matrix, ecLevel, pattern);
304 │       const score = maskPenalty(matrix);
305 │       if (score < bestScore) {
306 │         bestScore = score;
307 │         mask = pattern;
308 │       }
309 │       applyMask(matrix, pattern);
310 │     }
311 │   }
312 │   applyMask(matrix, mask!);
313 │   drawFormatInfo(matrix, ecLevel, mask!);
314 │   applyFunctionLayer(matrix);
315 │ 
316 │   return {
317 │     version,
318 │     size: matrix.size,
319 │     ecLevel,
320 │     mask: mask!,
321 │     modules: matrix.modules,
322 │     bitMask: matrix.bitMask,
323 │     isFunction: matrix.isFunction,
324 │     text: label,
325 │     bitLength: payloadBits,
326 │     capacityBits,
327 │     totalCodewords,
328 │   };
329 │ }
330 │ 
331 │ /**
332 │  * Memoising wrapper for repeated identical payloads.
333 │  *
334 │  * Used for the frames a sender repeats when a receiver asks for help (session
335 │  * header frames, pre-generated frames placed before the payload bits, and the
336 │  * zero-padded tail frames), and by the browser preview which re-renders the
337 │  * same symbol every frame it is on screen.
338 │  */
339 │ export class SymbolCache {
340 │   private readonly entries = new Map<string, EncodedSymbol>();
341 │   private readonly keys: string[] = [];
342 │   private readonly maxEntries: number;
343 │ 
344 │   constructor(maxEntries = 32) {
345 │     this.maxEntries = maxEntries;
346 │   }
347 │ 
348 │   /**
349 │    * Fetch or build a symbol. `key` must uniquely identify the payload *and* the
350 │    * encoding options that affect geometry (version/EC/mask).
351 │    */
352 │   get(key: string, build: () => EncodedSymbol): EncodedSymbol {
353 │     const hit = this.entries.get(key);
354 │     if (hit) return hit;
355 │     const built = build();
356 │     this.entries.set(key, built);
357 │     this.keys.push(key);
358 │     while (this.keys.length > this.maxEntries) {
359 │       const oldest = this.keys.shift()!;
360 │       this.entries.delete(oldest);
361 │     }
362 │     return built;
363 │   }
364 │ 
365 │   clear(): void {
366 │     this.entries.clear();
367 │     this.keys.length = 0;
368 │   }
369 │ 
370 │   get size(): number {
371 │     return this.entries.size;
372 │   }
373 │ }
```

---

## `packages/core/src/qr/render.ts`

> 250 lines

**What it is.** Turning a module grid into pixels — and the file where one performance
decision determines whether the whole app is usable.

**The decision, stated in the header and worth repeating.** There are two ways to upscale a
QR symbol from modules to screen pixels:

- Expand every module into `scale × scale` pixels *in JavaScript*. A 57-module symbol at
  scale 8 is 456 × 456 pixels — about 208 000 writes per frame, 15 times a second, on the
  JS thread, while a camera pipeline is also running. It stalls.
- Emit **one pixel per module** (3 200 writes) and let the platform upscale with
  nearest-neighbour sampling — `imageSmoothingEnabled = false` on Canvas2D, the equivalent
  on an HTML5 `<canvas>` with CSS `image-rendering: pixelated` (`QrCanvas` in `apps/web`). Crisp square modules, GPU upscaling, minimal JS cost.

Every renderer here therefore works at module resolution, and `scale` exists only for the
cases that genuinely need a standalone image: the tests (jsQR wants real pixels), the PNG/SVG
export, and the share sheet.

**`rasterizeRgba(symbol, options)`.**

- Fills the background in one flat loop over the buffer, then paints only dark modules. The
  background pass is unconditional; branching per pixel on "is this dark" would cost more
  than it saves for the roughly 50% ink coverage a QR symbol has.
- The paint loop is `y → x → sy → sx` — row, then column, then the scale block — and it
  hoists `rowBase`, `dy0` and `dx0` out of the inner loops. The `p` pointer advances by 4
  bytes rather than being recomputed, which is the difference between a readable loop and a
  fast one.
- Returns a plain object with `width`, `height`, `data`, and the three parameters that
  produced it (`moduleSize`, `scale`, `quietZone`), because callers need to convert pixels
  back to module coordinates — the diagnostics and the SVG export both do.

**`rasterizeMono`.** One byte per pixel, 1 = ink. Used by tests and by tooling that wants a
bitmap without colour. It uses `data.fill(1, rowStart, rowStart + scale)` per row segment
rather than inner loops — the only place in this file where `Uint8Array.fill` is worth its
call overhead.

**`toSvg` and `toSvgPath`.** Two renderers with one idea in common: **merge adjacent dark
modules in a row into a single horizontal run.** `toSvg` emits SVG path runs in *pixel*
units with a `shape-rendering="crispEdges"` attribute; `toSvgPath` emits the same geometry in
**module** units, which is what the mobile app draws.

- `toSvgPath` emits a single run-length-encoded SVG `<path>` (`M x y h run v 1 h -run z` per horizontal run of dark modules), avoiding ~1,800 individual `<rect>` DOM nodes per frame when inline `<svg>` fallback rendering is active.
- Module units, not pixels, so the caller sets `width`/`height` and the GPU scales: the same
  path renders identically on a 4-inch phone and a tablet with no re-rasterisation in JS.
- Run merging keeps a large symbol's path string near 3 kB instead of 15 kB. That is not
  tidiness: every byte is parsed on a UI thread that is simultaneously running a camera at
  15 fps, and the measurement (`tools/diag/path-length.ts`) is what set `QrView`'s size
  ceilings.
- `moduleCountWithQuietZone` gives the `viewBox` size, so the caller and the renderer cannot
  disagree about how much quiet zone was included. (Disagreeing is a real failure mode: a
  symbol drawn without its quiet zone often scans in the lab and fails in a room.)

**`inkCoverage`.** Fraction of dark modules. Both the optical channel and the encoder's own
N4 mask penalty prefer a symbol near 50% ink: extreme symbols are harder to threshold when a
camera's exposure is hunting. This is the metric the receiver's diagnostics panel reports, so
a user staring at a symbol that will not scan can see whether the symbol itself is the
problem.

**`bytes(color)`.** A tiny helper that copies an `Rgba` tuple into a plain array — it exists
so the hot loops index a fixed-shape array instead of a readonly tuple, which keeps the
JIT's type feedback simple. `imageDataBytes` is an identity function with a comment
explaining why it exists anyway: it documents the intended use and keeps the platform
adapters free of assumptions about the buffer type.

**Every line**

```ts
  1 │ /**
  2 │  * render.ts - turning a module grid into pixels.
  3 │  *
  4 │  * The single most important decision here is *where* upscaling happens:
  5 │  *
  6 │  *   Bad  (slow): expand every module to scale x scale pixels in JavaScript.
  7 │  *                A 57x57 module symbol at scale 8 is 456x456 pixels; building
  8 │  *                that buffer costs a quarter of a million writes per frame and
  9 │  *                stalls the JS thread at 15-30 fps.
 10 │  *
 11 │  *   Good (fast): emit ONE pixel per module (57x57 = 3.2k writes) and let the
 12 │  *                platform upscale it with nearest-neighbour sampling. Skia
 13 │  *                WebGL and Canvas2D (`image-rendering: pixelated`) both do this on the GPU
 14 │  *                with `imageSmoothingEnabled = false`, which yields perfectly
 15 │  *                crisp square modules and costs effectively nothing.
 16 │  *
 17 │  * Every renderer in LightBeam therefore consumes `rasterizeRgba()` at module
 18 │  * resolution. `rasterizeMono()` (1 byte/pixel) exists for tests, and `toSvg()`
 19 │  * for documentation and static exports.
 20 │  */
 21 │ 
 22 │ import type { EncodedSymbol } from './encoder.js';
 23 │ 
 24 │ /** RGBA colour as [r, g, b, a] with components in 0..255. */
 25 │ export type Rgba = readonly [number, number, number, number];
 26 │ 
 27 │ export interface RenderOptions {
 28 │   /** Light (background) colour. Default: white, fully opaque. */
 29 │   light?: Rgba;
 30 │   /** Dark (ink) colour. Default: black, fully opaque. */
 31 │   dark?: Rgba;
 32 │   /** Quiet zone in modules. ISO 18004 requires 4; 2 is workable on a screen. */
 33 │   quietZone?: number;
 34 │   /** Pixels per module. Use 1 for GPU upscaling, more for debug images. */
 35 │   scale?: number;
 36 │ }
 37 │ 
 38 │ export interface RgbaImage {
 39 │   width: number;
 40 │   height: number;
 41 │   /** Row-major RGBA bytes, length = width * height * 4. */
 42 │   data: Uint8Array;
 43 │   /** Modules per axis, excluding the quiet zone. */
 44 │   moduleSize: number;
 45 │   scale: number;
 46 │   quietZone: number;
 47 │ }
 48 │ 
 49 │ export interface MonoBitmap {
 50 │   width: number;
 51 │   height: number;
 52 │   /** 1 byte per pixel: 1 = dark ink, 0 = light. */
 53 │   data: Uint8Array;
 54 │   moduleSize: number;
 55 │   scale: number;
 56 │   quietZone: number;
 57 │ }
 58 │ 
 59 │ export const WHITE: Rgba = [255, 255, 255, 255];
 60 │ export const BLACK: Rgba = [0, 0, 0, 255];
 61 │ 
 62 │ /**
 63 │  * Rasterise a symbol to an RGBA buffer.
 64 │  *
 65 │  * Default is 1 pixel per module plus a quiet zone, ready to be drawn stretched
 66 │  * with nearest-neighbour sampling. Pass `scale` > 1 to get a standalone image
 67 │  * (used by tests, by the PNG/SVG export, and by the share sheet).
 68 │  */
 69 │ export function rasterizeRgba(symbol: EncodedSymbol, options: RenderOptions = {}): RgbaImage {
 70 │   const light = options.light ?? WHITE;
 71 │   const dark = options.dark ?? BLACK;
 72 │   const quietZone = options.quietZone ?? 2;
 73 │   const scale = Math.max(1, options.scale ?? 1);
 74 │   const modules = symbol.size;
 75 │   const moduleSize = modules + quietZone * 2;
 76 │   const width = moduleSize * scale;
 77 │   const height = moduleSize * scale;
 78 │   const data = new Uint8Array(width * height * 4);
 79 │ 
 80 │   // Fill the background row by row (cheaper than per-pixel branching).
 81 │   const bg = bytes(light);
 82 │   const ink = bytes(dark);
 83 │   for (let i = 0; i < data.length; i += 4) {
 84 │     data[i] = bg[0];
 85 │     data[i + 1] = bg[1];
 86 │     data[i + 2] = bg[2];
 87 │     data[i + 3] = bg[3];
 88 │   }
 89 │ 
 90 │   const mods = symbol.modules;
 91 │   for (let y = 0; y < modules; y++) {
 92 │     const rowBase = y * modules;
 93 │     // Vertical offset in destination pixels.
 94 │     const dy0 = (y + quietZone) * scale;
 95 │     for (let x = 0; x < modules; x++) {
 96 │       if (!mods[rowBase + x]) continue;
 97 │       const dx0 = (x + quietZone) * scale;
 98 │       for (let sy = 0; sy < scale; sy++) {
 99 │         let p = ((dy0 + sy) * width + dx0) * 4;
100 │         for (let sx = 0; sx < scale; sx++) {
101 │           data[p] = ink[0];
102 │           data[p + 1] = ink[1];
103 │           data[p + 2] = ink[2];
104 │           data[p + 3] = ink[3];
105 │           p += 4;
106 │         }
107 │       }
108 │     }
109 │   }
110 │ 
111 │   return { width, height, data, moduleSize: modules, scale, quietZone };
112 │ }
113 │ 
114 │ /** Rasterise to a 1-byte-per-pixel bitmap (tests, OCR-style tooling, debugging). */
115 │ export function rasterizeMono(symbol: EncodedSymbol, options: RenderOptions = {}): MonoBitmap {
116 │   const quietZone = options.quietZone ?? 2;
117 │   const scale = Math.max(1, options.scale ?? 1);
118 │   const modules = symbol.size;
119 │   const moduleSize = modules + quietZone * 2;
120 │   const width = moduleSize * scale;
121 │   const height = moduleSize * scale;
122 │   const data = new Uint8Array(width * height);
123 │   const mods = symbol.modules;
124 │   for (let y = 0; y < modules; y++) {
125 │     const dy0 = (y + quietZone) * scale;
126 │     for (let x = 0; x < modules; x++) {
127 │       if (!mods[y * modules + x]) continue;
128 │       const dx0 = (x + quietZone) * scale;
129 │       for (let sy = 0; sy < scale; sy++) {
130 │         const rowStart = (dy0 + sy) * width + dx0;
131 │         data.fill(1, rowStart, rowStart + scale);
132 │       }
133 │     }
134 │   }
135 │   return { width, height, data, moduleSize: modules, scale, quietZone };
136 │ }
137 │ 
138 │ /**
139 │  * Convert an RGBA image to the [r,g,b,a] byte array a Canvas ImageData needs.
140 │  * (Identity today, but this keeps the platform adapters free of assumptions
141 │  * about the buffer type and documents the intended use.)
142 │  */
143 │ export function imageDataBytes(image: RgbaImage): Uint8Array {
144 │   return image.data;
145 │ }
146 │ 
147 │ /**
148 │  * Vector rendering: one `<path>` with a sub-path per dark module.
149 │  *
150 │  * Using `d` with horizontal runs instead of individual 1x1 rects keeps the SVG
151 │  * small (a version-40 symbol would otherwise emit ~15k rect elements), which
152 │  * matters because this output is also used for the "export a static symbol"
153 │  * feature and for the pixel-perfect README images.
154 │  */
155 │ export function toSvg(symbol: EncodedSymbol, options: RenderOptions = {}): string {
156 │   const light = options.light ?? WHITE;
157 │   const dark = options.dark ?? BLACK;
158 │   const quietZone = options.quietZone ?? 4;
159 │   const scale = options.scale ?? 8;
160 │   const modules = symbol.size;
161 │   const moduleSize = modules + quietZone * 2;
162 │   const sizePx = moduleSize * scale;
163 │ 
164 │   const parts: string[] = [];
165 │   for (let y = 0; y < modules; y++) {
166 │     let x = 0;
167 │     while (x < modules) {
168 │       if (!symbol.modules[y * modules + x]) {
169 │         x++;
170 │         continue;
171 │       }
172 │       let run = 1;
173 │       while (x + run < modules && symbol.modules[y * modules + x + run]) run++;
174 │       parts.push(`M${(x + quietZone) * scale} ${(y + quietZone) * scale}h${run * scale}v${scale}h${-run * scale}z`);
175 │       x += run;
176 │     }
177 │   }
178 │ 
179 │   const css = (c: Rgba): string =>
180 │     c[3] === 255 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
181 │ 
182 │   return [
183 │     `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" shape-rendering="crispEdges">`,
184 │     `<rect width="${sizePx}" height="${sizePx}" fill="${css(light)}"/>`,
185 │     `<path d="${parts.join('')}" fill="${css(dark)}"/>`,
186 │     `</svg>`,
187 │   ].join('');
188 │ }
189 │ 
190 │ /**
191 │  * The same geometry as `toSvg`, expressed as a path `d` string in MODULE units.
192 │  *
193 │  * This is what the native app renders, and the reason it exists is performance:
194 │  *
195 │  *   - A `<View>` per dark module would be ~1800 views for a 77-module symbol,
196 │  *     rebuilt 15 times a second, thrashing the browser DOM layout engine.
197 │  *   - A single `<path>` element inside an inline `<svg>` is ONE DOM node whose `d` attribute
198 │  *     is re-filled each frame. Combined with a fixed `viewBox`, the symbol can be
199 │  *     swapped at the display refresh rate without touching the view hierarchy.
200 │  *
201 │  * Module units (not pixels) matter too: the caller sets width/height and the GPU
202 │  * scales, so the same path renders identically on a 4" phone and a tablet with no
203 │  * re-rasterisation in JavaScript.
204 │  *
205 │  * Adjacent dark modules in a row are merged into one rectangle (`h<run>`), which
206 │  * keeps the string around 3 kB for a large symbol instead of 15 kB. That is not
207 │  * just tidiness: every byte here is parsed on the UI thread of a phone that is
208 │  * simultaneously running a camera at 15 fps.
209 │  */
210 │ export function toSvgPath(symbol: EncodedSymbol, options: { quietZone?: number } = {}): string {
211 │   const quietZone = options.quietZone ?? 4;
212 │   const modules = symbol.size;
213 │   const parts: string[] = [];
214 │   for (let y = 0; y < modules; y++) {
215 │     let x = 0;
216 │     while (x < modules) {
217 │       if (!symbol.modules[y * modules + x]) {
218 │         x++;
219 │         continue;
220 │       }
221 │       let run = 1;
222 │       while (x + run < modules && symbol.modules[y * modules + x + run]) run++;
223 │       // M<absolute x> <absolute y> then h<run> v1 h-<run> z, in module units.
224 │       parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h${-run}z`);
225 │       x += run;
226 │     }
227 │   }
228 │   return parts.join('');
229 │ }
230 │ 
231 │ /** Total modules per axis including the quiet zone: the SVG viewBox size. */
232 │ export function moduleCountWithQuietZone(symbol: EncodedSymbol, quietZone = 4): number {
233 │   return symbol.size + quietZone * 2;
234 │ }
235 │ 
236 │ function bytes(color: Rgba): [number, number, number, number] {
237 │   return [color[0], color[1], color[2], color[3]];
238 │ }
239 │ 
240 │ /**
241 │  * Ink coverage of a symbol (fraction of dark modules). The optical channel
242 │  * benefits from a balanced symbol: very dark or very light frames are harder to
243 │  * threshold. The encoder's N4 penalty already nudges towards 50%, and this is
244 │  * the metric the diagnostics screen reports.
245 │  */
246 │ export function inkCoverage(symbol: EncodedSymbol): number {
247 │   let dark = 0;
248 │   for (let i = 0; i < symbol.modules.length; i++) dark += symbol.modules[i];
249 │   return dark / symbol.modules.length;
250 │ }
```

---

## `packages/core/src/fountain/degree.ts`

> 217 lines

**What it is.** The degree distribution — the mathematical heart of a Luby Transform code, and
the file that decides how many frames a transfer actually needs.

**The idea, briefly.** A fountain code turns K source blocks into an endless stream of encoded
blocks, such that **any** K + ε distinct blocks reconstruct the file. The receiver does not
care which ones it gets, in what order, or how many it missed: a lost frame is not an error,
it just means "wait one more frame". That property is precisely what an optical channel
needs, because a hand-held camera misses frames constantly — blur, rolling shutter, glare, and
a sender that displays faster than the camera's exposure.

Each encoded block is the XOR of a pseudo-random subset ("neighbours") of source blocks.
**How many** neighbours — the *degree* — is drawn from the distribution here. That choice is
the whole art of LT codes:

| Distribution | Tail behaviour | Frames sent per source block (k = 1024, clean channel, 5 trials) |
| --- | --- | --- |
| Ideal soliton | fragile: the last blocks are covered by exponentially few equations | 2.059 with no prefix, 1.309 with one |
| Uniform | terrible: mean degree k/2, each frame XORs half the file | — (control: 0 % complete) |
| **Robust soliton (c = 0.03)** | spike of extra mass at low degrees and near K/R | **1.096 with no prefix, 1.102 with one** |
| Ideal soliton + dense fallback (limit 512) | the fallback cannot rescue a bad distribution | identical to the plain ideal rows |

The middle column is not a claim from a paper: `tools/diag/degree-experiment.ts` measures it
and the output is archived in `docs/degree-experiment-output.txt`.

**`idealSolitonPmf(k)`.** `ρ(1) = 1/k`, `ρ(d) = 1/(d(d−1))`. Optimal in the limit and
disastrous in practice: the sum of the tail is small enough that the final few source blocks
are covered by so few equations that decoding stalls. The measured overhead at k = 1024 is
105.9 % — the textbook 3–10 % figure belongs to the robust variant, which this project
measures at 9.6 %. This is a genuinely counter-intuitive result, and the reason the robust variant exists.

**`robustSolitonPmf(k, c, delta)`.** Adds `τ` to `ρ`:

- `R = c · ln(k/δ) · √k` — roughly the number of degree-1 blocks the ideal soliton is missing.
- `τ(d) = R/(d·k)` for `d < dStar`, and one large bin `τ(dStar) = R·ln(R/δ)/k`, where
  `dStar = round(k/R)`.
- The result is normalised. A degenerate guard (`total <= 0` → uniform) exists so that a
  pathological parameter combination cannot produce a distribution that samples nothing.

`c` is the knob: **lower `c` means less overhead but a slower start**; higher `c` puts more
mass on degree 1, which completes source blocks immediately but wastes capacity on redundant
frames. `c = 0.03` was chosen by sweeping it — see `docs/degree-experiment-output.txt` for the
sweep, and `tools/diag/degree-experiment.ts` for the harness.

**The floor on degree 1 (in `buildDegreeDistribution`).** After building the robust
distribution, if `P(degree = 1) < 1/k` the code moves mass from the largest degrees to
guarantee that floor. The reason is a *perceived* one, not a theoretical one: real receivers
join a stream mid-flight, and the most valuable frames are the systematic ones — degree 1
means "source block i, verbatim", so one captured frame completes one block outright. If the
spike lands below `1/k`, the first seconds of a session look like nothing is happening. The
mass is taken from the tail (`for d = k−1 … 1`), which is where the distribution can spare it
without hurting the decoder's completion guarantee.

**Small k is special-cased.** For `k ≤ 2` the robust construction degenerates — the spike is
wider than the number of degrees — so the exact ideal soliton is used instead, and the
distribution names itself `'ideal (tiny k)'`. A one-block session (which happens constantly:
a short text message is one block) must still work, and this is the branch that makes it work.

**`toCdf` and `sampleDegree`.** Converting to a CDF turns sampling into a binary search over
`rng.nextFloat()`: `O(log k)` instead of `O(k)` per frame, which matters because every frame
of a session samples once. Two details: the last CDF entry is **forced to exactly 1.0** so
floating-point drift can never make the search fall off the end; and `sampleDegree`
short-circuits `k === 1` to avoid the search entirely in the common single-block case.
`Rng` is injected rather than imported as a module-level instance, because the whole protocol
depends on the two sides deriving identical degrees from identical seeds.

**`describeDistribution`.** Recovers the PMF from the CDF (differences), computes the mean and
the Shannon entropy in bits, and returns a shape summary. It exists so the tests and the
experiment scripts can assert on distribution *shape* — entropy, `P(degree=1)` — rather than
on a table of sampled values that would change with any tuning.

**Every line**

```ts
  1 │ /**
  2 │  * degree.ts - degree distributions for Luby Transform (LT) codes.
  3 │  *
  4 │  * THE IDEA
  5 │  * --------
  6 │  * A fountain code turns a file of K source blocks into an endless stream of
  7 │  * encoded blocks, such that ANY K + epsilon distinct encoded blocks reconstruct
  8 │  * the file. The receiver does not care which ones it gets, in what order, or how
  9 │  * many it missed: a lost frame is not an error, it just means "wait one more
 10 │  * frame". That property is exactly what an optical channel needs, because a
 11 │  * hand-held camera misses frames constantly (blur, rolling shutter, glare, the
 12 │  * sender displaying faster than the camera's exposure).
 13 │  *
 14 │  * Each encoded block is the XOR of a pseudo-random subset ("neighbours") of the
 15 │  * source blocks. How many neighbours - the *degree* - is drawn from the degree
 16 │  * distribution, and the choice of distribution is the entire art of LT codes:
 17 │  *
 18 │  *   Ideal Soliton (Luby 2002)
 19 │  *     rho(1) = 1/K,  rho(d) = 1 / (d * (d-1))
 20 │  *     Optimal in the limit, but the tail of the procedure is fragile: the last
 21 │  *     few source blocks are covered by exponentially few equations, so decoding
 22 │  *     stalls and the true overhead runs to ~5-10%.
 23 │  *
 24 │  *   Robust Soliton (Luby 2002)
 25 │  *     rho + tau, where tau puts an extra spike of mass at degrees
 26 │  *     K/R ... 1 and at degree 1, with R = c * ln(K/delta) * sqrt(K).
 27 │  *     This "robustifies" the tail; standard LT overhead is 3-10% and typically
 28 │  *     ~5%. Larger c = more degree-1 blocks = faster start, slightly more overhead.
 29 │  *
 30 │  *   Systematic-first (our variant, see `SYSTEMATIC_PREFIX`)
 31 │  *     Real receivers join a stream mid-flight, and the most valuable frames are
 32 │  *     the *systematic* ones: degree 1, i.e. "source block i, verbatim". One
 33 │  *     captured frame then completes one source block outright. LightBeam emits a
 34 │  *     systematic prefix (frame s carries block s ^ r where r is a small random
 35 │  *     mask, see lt.ts) and then falls through to robust soliton.
 36 │  *
 37 │  * The distributions are precomputed into a CDF so sampling is O(log K) per frame
 38 │  * via binary search rather than O(K).
 39 │  */
 40 │ 
 41 │ import type { Rng } from '../util/rng.js';
 42 │ 
 43 │ export interface DegreeDistribution {
 44 │   /** Number of source blocks. */
 45 │   k: number;
 46 │   /** cdf[d - 1] = P(degree <= d). Length k. */
 47 │   cdf: Float64Array;
 48 │   /** Mean degree (diagnostic: the average XOR cost per encoded block). */
 49 │   meanDegree: number;
 50 │   /** Human-readable identifier of the distribution actually used. */
 51 │   name: string;
 52 │ }
 53 │ 
 54 │ /** Ideal soliton probability mass function, index d-1 => P(degree = d). */
 55 │ export function idealSolitonPmf(k: number): Float64Array {
 56 │   const pmf = new Float64Array(k);
 57 │   if (k === 1) {
 58 │     pmf[0] = 1;
 59 │     return pmf;
 60 │   }
 61 │   pmf[0] = 1 / k;
 62 │   for (let d = 2; d <= k; d++) pmf[d - 1] = 1 / (d * (d - 1));
 63 │   return pmf;
 64 │ }
 65 │ 
 66 │ /**
 67 │  * Robust soliton PMF: rho(d) + tau(d), normalised.
 68 │  *
 69 │  * @param k     number of source blocks
 70 │  * @param c     tuning constant (0.01 .. 0.2). Lower = less overhead, slower start.
 71 │  * @param delta failure probability bound used to size the spike.
 72 │  */
 73 │ export function robustSolitonPmf(k: number, c = 0.03, delta = 0.5): Float64Array {
 74 │   if (k <= 1) {
 75 │     return new Float64Array([1]);
 76 │   }
 77 │   const rho = idealSolitonPmf(k);
 78 │   const tau = new Float64Array(k);
 79 │ 
 80 │   // R = c * ln(k / delta) * sqrt(k) is the expected number of source blocks of
 81 │   // degree 1 that the ideal soliton is missing; the spike compensates.
 82 │   const R = c * Math.log(k / delta) * Math.sqrt(k);
 83 │   // The spike occupies degrees 1 .. dStar (the textbook writes K/R, rounded).
 84 │   const dStar = Math.min(k, Math.max(1, Math.round(k / R)));
 85 │ 
 86 │   // tau(d) = R / (d * K) for d = 1 .. dStar - 1
 87 │   for (let d = 1; d <= dStar - 1; d++) tau[d - 1] = R / (d * k);
 88 │   // tau(dStar) = R * ln(R / delta) / K  - the single big bin that guarantees the
 89 │   // degree-1..dStar cover is complete with high probability.
 90 │   tau[dStar - 1] = (R * Math.log(R / delta)) / k;
 91 │ 
 92 │   const pmf = new Float64Array(k);
 93 │   let total = 0;
 94 │   for (let d = 1; d <= k; d++) {
 95 │     const value = rho[d - 1] + tau[d - 1];
 96 │     pmf[d - 1] = value > 0 ? value : 0;
 97 │     total += pmf[d - 1];
 98 │   }
 99 │   if (total <= 0) {
100 │     pmf.fill(1 / k); // degenerate guard
101 │     return pmf;
102 │   }
103 │   for (let d = 0; d < k; d++) pmf[d] /= total;
104 │   return pmf;
105 │ }
106 │ 
107 │ /** Convert a PMF into a monotone CDF (with a hard 1.0 at the end). */
108 │ export function toCdf(pmf: Float64Array): Float64Array {
109 │   const cdf = new Float64Array(pmf.length);
110 │   let acc = 0;
111 │   for (let i = 0; i < pmf.length; i++) {
112 │     acc += pmf[i];
113 │     cdf[i] = acc;
114 │   }
115 │   if (cdf.length > 0) cdf[cdf.length - 1] = 1;
116 │   return cdf;
117 │ }
118 │ 
119 │ export interface DegreeOptions {
120 │   /** 'robust' (default), 'ideal', or 'uniform'. */
121 │   variant?: 'robust' | 'ideal' | 'uniform';
122 │   /** Robust-soliton c parameter. */
123 │   c?: number;
124 │   /** Robust-soliton delta parameter. */
125 │   delta?: number;
126 │ }
127 │ 
128 │ /**
129 │  * Build the degree distribution used by a session.
130 │  *
131 │  * Small K is handled explicitly: for K <= 2 the robust soliton degenerates
132 │  * (the tail is longer than the block count), so we use the exact ideal soliton.
133 │  */
134 │ export function buildDegreeDistribution(k: number, options: DegreeOptions = {}): DegreeDistribution {
135 │   const variant = options.variant ?? 'robust';
136 │   if (k < 1) throw new RangeError('k must be at least 1');
137 │ 
138 │   if (k <= 2 || variant === 'ideal') {
139 │     const pmf = idealSolitonPmf(k);
140 │     return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: k <= 2 ? 'ideal (tiny k)' : 'ideal soliton' };
141 │   }
142 │   if (variant === 'uniform') {
143 │     const pmf = new Float64Array(k).fill(1 / k);
144 │     return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: 'uniform' };
145 │   }
146 │ 
147 │   const c = options.c ?? 0.03;
148 │   const delta = options.delta ?? 0.5;
149 │   const pmf = robustSolitonPmf(k, c, delta);
150 │   // Guarantee a floor on degree 1: if the spike fell below 1/k the first frames
151 │   // of a session would rarely be systematic, which hurts perceived startup.
152 │   const floor = 1 / k;
153 │   if (pmf[0] < floor) {
154 │     const deficit = floor - pmf[0];
155 │     pmf[0] = floor;
156 │     // Take the mass from the largest degree entries that can spare it.
157 │     let remaining = deficit;
158 │     for (let d = k - 1; d > 0 && remaining > 0; d--) {
159 │       const take = Math.min(pmf[d], remaining);
160 │       pmf[d] -= take;
161 │       remaining -= take;
162 │     }
163 │     let total = 0;
164 │     for (let i = 0; i < k; i++) total += pmf[i];
165 │     for (let i = 0; i < k; i++) pmf[i] /= total;
166 │   }
167 │   return { k, cdf: toCdf(pmf), meanDegree: meanOf(pmf), name: `robust soliton (c=${c}, delta=${delta})` };
168 │ }
169 │ 
170 │ function meanOf(pmf: Float64Array): number {
171 │   let mean = 0;
172 │   for (let d = 0; d < pmf.length; d++) mean += (d + 1) * pmf[d];
173 │   return mean;
174 │ }
175 │ 
176 │ /** Sample a degree from the CDF using binary search over the RNG's output. */
177 │ export function sampleDegree(rng: Rng, dist: DegreeDistribution): number {
178 │   if (dist.k === 1) return 1;
179 │   const u = rng.nextFloat();
180 │   const cdf = dist.cdf;
181 │   let lo = 0;
182 │   let hi = cdf.length - 1;
183 │   while (lo < hi) {
184 │     const mid = (lo + hi) >>> 1;
185 │     if (cdf[mid] < u) lo = mid + 1;
186 │     else hi = mid;
187 │   }
188 │   return lo + 1; // degree is 1-based
189 │ }
190 │ 
191 │ /** Diagnostics for the docs/tests: distribution shape summary. */
192 │ export function describeDistribution(dist: DegreeDistribution): {
193 │   name: string;
194 │   k: number;
195 │   meanDegree: number;
196 │   pDegree1: number;
197 │   pDegree2Plus: number;
198 │   entropyBits: number;
199 │ } {
200 │   const cdf = dist.cdf;
201 │   const pmf: number[] = [];
202 │   let prev = 0;
203 │   for (let i = 0; i < cdf.length; i++) {
204 │     pmf.push(cdf[i] - prev);
205 │     prev = cdf[i];
206 │   }
207 │   let entropy = 0;
208 │   for (const p of pmf) if (p > 0) entropy -= p * Math.log2(p);
209 │   return {
210 │     name: dist.name,
211 │     k: dist.k,
212 │     meanDegree: dist.meanDegree,
213 │     pDegree1: pmf[0] ?? 0,
214 │     pDegree2Plus: 1 - (pmf[0] ?? 0),
215 │     entropyBits: entropy,
216 │   };
217 │ }
```

---

## `packages/core/src/fountain/lt.ts`

> 913 lines

**What it is.** The fountain code: the encoder that produces an endless stream of XOR-coded
blocks, and the decoder that reconstructs the file from any sufficiently large subset of
them. This is the largest file in the engine and the one that makes the product work at all
over a lossy optical channel.

### The wire model

The file is split into `k` blocks of `blockSize` bytes (the last one zero-padded; the true
length travels in the session header). Frame `s` carries a 32-bit `seed` and the block data:


**Both sides derive the neighbour set from the seed** with the same PRNG and the same degree
distribution. That is where the efficiency comes from: a frame costs one integer of
metadata, not a list of indices. The consequence — and this is the property the whole product
depends on — is that the receiver may miss frames in any pattern, capture them out of order,
and start in the middle, and still decode.

### `frameNeighbours` — the single source of truth

Every rule in the doc comment is a rule *both* sides must obey exactly, because any
divergence silently produces garbage rather than an error. The two most important:

- **Neighbours must be distinct.** A repeated index cancels itself in the XOR, lowering the
  effective degree; a frame claiming degree 10 with a duplicate behaves as degree 8.
- **The sampler must be stateless with respect to history.** The receiver sees an arbitrary
  subset of frames, so a sampler carrying mutable state (a persistent shuffle pool would be
  the obvious design) diverges the moment one frame is lost, and every later frame decodes to
  noise. Everything depends only on `(seed, k, sessionId, distribution)`.

**The sampling method, and why it is not the obvious one.** A uniform draw of `degree`
indices needs *distinct* values, and the naive approach — draw, reject duplicates — is
O(degree²). The robust-soliton spike puts real mass on degrees near `k/R`, which for k = 1024
is around 20 but has a long tail, so the quadratic term dominated the sender's per-frame
budget (measured; that is why this file exists in this form).

The fix is a **sparse partial Fisher–Yates over a virtual identity permutation**:


A real array would need O(k) work to reset per frame. Instead three module-level
`Uint32Array`s hold a sparse map (`sparseIndex`, `sparseValue`, `sparseEpoch`) and an
`epoch` counter makes them *logically empty* on each call: `get(i)` returns the stored value
if this call touched slot `i`, else `i` itself. Cost per frame becomes O(degree) time and
O(degree) memory. Single-threaded JS is what makes shared scratch safe here, and that
assumption is worth noticing the day anyone moves the engine into a worker.

**Three special cases exist for correctness or speed, in this order:**

| Case | Why |
| --- | --- |
| `degree === k` | Every block participates; no sampling at all |
| `degree === 1` | One uniform draw; the common systematic case |
| `degree <= 8` | The direct duplicate scan beats the sparse-map setup — and this branch is *exactly* correct rather than approximately |
| otherwise | Sparse partial Fisher–Yates |

**The bug that lived in this loop.** The first version of the sparse shuffle wrote


without the `if (j !== i)` guard. When `j === i` the swap is a no-op — but `set(j, atI)`
still writes, and it *overwrites* whatever the epoch hash held for that slot with the value
it already had… except for the entries the shuffle had not yet touched, where it converts a
"virtual" identity entry into an explicit entry. The observable effect was a bias toward low
indices: the low-degree distribution's tail stopped being covered uniformly, and the decoder
stalled on a handful of blocks. The guard restores the identity semantics exactly.

### The systematic prefix, and the mask trick

A pure fountain stream wastes the start of a session: a camera that joins at frame 4000 still
needs ~1.15 k *more* frames. So the first frames are **systematic** — frame `s < k` carries
source block `s` **XORed with one mask block**:


Two details make it work:

1. **The mask is derived, not transmitted.** `deriveMaskBlock(sessionId, blockSize)` reseeds
   a `Rng` from the session id alone, so a receiver that has read *one* session header can
   already unmask every systematic frame it captures — no dependency on having seen a
   particular earlier frame. The sender still emits one explicit mask frame (`seed ===
   prefix`) so a third-party receiver that does not implement the derivation can
   interoperate, and the decoder verifies it (`verifyMask`) and sets `maskMismatch` if it
   disagrees, which the diagnostics panel surfaces as a protocol warning.
2. **The prefix is short by default — 10% of k.** This is counter-intuitive enough that the
   constant carries its own measured table:

   | prefix/k | clean | 30% loss | 50% loss + bursts |
   | --- | --- | --- | --- |
   | 0.00 | 1.138 | 1.630 | 3.849 |
   | **0.10 (chosen)** | **1.106** | **1.619** | **3.664** |
   | 0.25 | 1.191 | 1.682 | 3.714 |
   | 0.50 | 1.354 | 1.840 | 3.767 |
   | 1.00 | 1.000 | 2.054 | 4.028 |

   A **full** prefix is perfect on a clean channel (exactly k frames) and the *worst* option
   under loss. The reason is worth stating plainly: the systematic frames the receiver misses
   leave **specific** holes, and an LT frame covers a *uniformly random* subset of the whole
   file, so patching those holes costs more than covering the file from scratch. A short
   prefix captures both benefits — the first ~10% of blocks arrive one-frame-each, so verified
   data appears within seconds, while the LT tail keeps its loss-optimal efficiency. Some
   optical-transfer tools hard-code a full systematic pass; on a hand-held link that is the
   wrong trade.

### `LTEncoder`

- **Source blocks are borrowed views.** `payload.subarray(start, end)` where the block is
  full; a copy only for the final partial block (padded with zeros) and for blocks entirely
  past the end of the payload. For a 64 MiB payload this is the difference between one
  allocation and `k` of them.
- **`encode(seed, out)`** accepts an output buffer and returns a subarray of it, so a caller
  animating at 15 fps can reuse one buffer per frame. Note the mask path is
  `target.set(blocks[seed]); xorInto(target, mask)` — copy then XOR, never XOR in place into
  a borrowed source view, which would corrupt the payload itself. That is not a hypothetical:
  it is the same class of aliasing mistake as the decoder bug below.
- **`neighbours(seed)`** passes the shared `scratch` array, so the returned `Uint32Array` is
  only valid until the next call. That is documented at the call site rather than enforced,
  and it is the reason `frameNeighbours` takes an optional `out`.

### `LTDecoder` — the data structures

| Field | Role |
| --- | --- |
| `solved[i]` | the recovered block, or `null` — the only thing the caller ever sees |
| `equations[]` | held equations, each with `vars` (unsolved indices only), `data` (accumulator with solved values already XORed out), `activeCount` |
| `varToEquations[v]` | which held equations still contain variable `v` — the substitution index, and the reason peeling is O(k log k) rather than O(k²) |
| `ready[]` | indices of equations with exactly one unknown, i.e. the peel queue |
| `seenSeeds` | duplicate detection by seed, not by content |

`addFrame` has exactly four outcomes — `accepted`, `redundant`, `duplicate`, `complete` — and
the distinction matters to the UI: `duplicate` means "the camera is re-reading the same
displayed frame" (slow down or hold steadier), while `redundant` means "new frame, no new
information" (normal near the end of a transfer). The receiver's diagnostics panel shows both
counters separately for that reason.

The systematic path is deliberately the cheapest one: copy the bytes, XOR the mask, and
`solveVariable` — a systematic frame **always** completes one block, which is why the first
frames of a session are worth far more than any later frame.

### The aliasing bug in `drainReady` — read this one

Six lines of comment sit above a single assignment, and they are the most valuable comment in
the repository:


`solveVariable` substitutes the new value into **every equation that still references the
variable being solved** — and the equation currently being drained is still on that list.
With `activeCount` still 1, the substitution runs `xorInto(eq.data, value)`, and `value`
*is* `eq.data`, so the freshly solved source block XORs with itself and becomes **all
zeros**. The transfer then completes with a hash mismatch and no clue where the corruption
came from. It was diagnosed by 185 of 200 randomised round trips reporting `complete` with
zero-filled blocks — the kind of symptom that looks like "the fountain code is broken" and is
actually "one line is in the wrong order". Two fixes, both present: clear `activeCount`
first, *and* hand `solveVariable` a **copy** (`Uint8Array.from`) rather than the accumulator,
so nothing that later touches the equation can reach the solved block through it.

Note also the `solveVariable` guard `if (this.solved[variable]) return;` — without it, a
later equation solving an already-solved variable would double-count `solvedCount` and
report completion early.

### The dense fallback

Peeling can stall: the classic LT tail is a handful of blocks covered only by equations of
degree ≥ 2. Since LightBeam's transfers are *interactive* (a person holding a phone), stalling
at 97% is a product failure, so the decoder escalates to **Gaussian elimination over GF(2)**
on the residual system. Its complexity is O(r³/64) plus O(r · blockSize) XORs, so it is
attempted only when it is cheap — and three guards make that safe:

1. **A counting pre-pass that builds no matrix.** An earlier revision built the rows first,
   which made a stalled large-k session quadratic in the number of frames: every incoming
   frame re-allocated a matrix it was about to discard. The pre-pass counts residual variables
   and usable equations with a `Set` and bails out before allocating anything.
2. **A signature guard.** `lastDenseSignature = "${equations.length}:${residualCount}"` — if
   neither the number of held equations nor the residual size changed since the last attempt,
   the attempt is provably going to do the same work for the same answer, so it is skipped.
   Without this, a stalled session re-ran elimination on *every subsequent frame*.
3. **A work budget, checked after the rows are built and before elimination:**
   `r * rows * rowWords + rows² * blockSize > 24 000 000` → refuse. A partially solved
   transfer can simply wait for more frames; it must not block the UI thread for tens of
   milliseconds on a phone that is simultaneously decoding camera frames.

The elimination itself is textbook Gauss-Jordan over a bitset: find a pivot column, swap the
pivot row into place, XOR it into every other row that has that bit set, then read off rows
with a single set bit. `pivotOfRow` records which column each pivot row owns so back
substitution can skip rows that were never used as pivots. The mapping from residual index
back to source-block index goes through `residualIndex`, a `Map` built in insertion order —
and the reverse lookup loops over that map, which is O(r) per solved row. For r ≤ 256 that is
the right trade against maintaining a second array.

`denseLimit` defaults to 256 and `stallThreshold` to 32 frames; both are `LTSessionOptions`,
because the tests set them to tiny values to exercise the fallback deterministically.

### Output paths

- `reconstruct()` — the whole payload, missing blocks zero-filled, trimmed to the true length.
- `bestEffort()` — the same, plus **`missingRanges`**, and this is the one the UI uses: a
  partially received *image* can be shown with holes, which frequently tells the user whether
  the transfer is working far better than a percentage does. The receiver's screen and the
  browser preview both render it.
- `reset()` — drops every field, including re-deriving the mask. Used when a session is
  abandoned and a new one starts in the same panel.

### `expectedFramesFor(k, delta)`

The theoretical LT bound is `k + O(√k · ln²(k/δ))`; this returns `k + R·ln(k/δ) + 2√k` with
the same `R` as the distribution. It is used **only** for the ETA in the UI, never for
correctness — the receiver does not decide anything based on it, and the tests do not assert
on it. That separation is worth keeping: an ETA formula that drifts from the real behaviour
should make a progress bar slightly wrong, not a transfer fail.

**Every line**

```ts
  1 │ /**
  2 │  * lt.ts - Luby Transform encoder and decoder, plus a dense-elimination fallback.
  3 │  *
  4 │  * WIRE MODEL
  5 │  * ----------
  6 │  * The source file is split into K blocks of `blockSize` bytes (the last block is
  7 │  * zero padded; the true payload length travels in the session header so the
  8 │  * padding is trimmed on receipt). Frame `s` of the stream carries:
  9 │  *
 10 │  *     seed  : a 32-bit frame number (also the PRNG seed)
 11 │  *     data  : XOR of the source blocks whose indices are derived from `seed`
 12 │  *
 13 │  * Both sides derive the neighbour set from the seed with the same PRNG and the
 14 │  * same degree distribution, so the frame header never has to list the indices -
 15 │  * which is exactly where the efficiency of fountain coding comes from. A frame
 16 │  * costs one seed, not a list.
 17 │  *
 18 │  * SYSTEMATIC PREFIX
 19 │  * -----------------
 20 │  * A pure fountain stream is wasteful at the start: if the camera joins at frame
 21 │  * 4000 it must still accumulate ~1.15 K frames. LightBeam therefore makes the
 22 │  * first frames *systematic*: frame s in [0, K) carries source block s XORed with
 23 │  * one pseudo-random "mask" block over the whole file. One captured frame then
 24 │  * completes one source block as soon as the mask is known, and the mask itself
 25 │  * arrives in the very first frames (frames K, K+1, ... carry the mask block
 26 │  * alone at degree 1). This is the idea behind RaptorQ's systematic output and it
 27 │  * removes the "cold start" entirely.
 28 │  *
 29 │  * DECODING
 30 │  * --------
 31 │  * Classic LT decoding is *peeling*: find an equation with one unknown, solve it,
 32 │  * substitute it into every equation that still contains it, repeat. Peeling is
 33 │  * O(K log K) and needs almost no memory, but it can stall when the last few
 34 │  * source blocks are covered by equations of degree >= 2 (the classic LT tail).
 35 │  *
 36 │  * LightBeam therefore keeps a hybrid: peeling first, then - only if peeling
 37 │  * stalls and the unresolved system is still small - a dense GF(2) Gaussian
 38 │  * elimination over the *residual* variables. That combination is what lets the
 39 │  * app finish cleanly instead of hanging at "97% complete" when the optics drop a
 40 │  * burst of frames.
 41 │  */
 42 │ 
 43 │ import { Rng } from '../util/rng.js';
 44 │ import { buildDegreeDistribution, sampleDegree, type DegreeDistribution, type DegreeOptions } from './degree.js';
 45 │ 
 46 │ export interface LTSessionOptions {
 47 │   /** Number of source blocks. */
 48 │   k: number;
 49 │   /** Bytes per source block. */
 50 │   blockSize: number;
 51 │   /** Session id mixed into the PRNG so two sessions never share equations. */
 52 │   sessionId: number;
 53 │   /** Degree distribution tuning. */
 54 │   degree?: DegreeOptions;
 55 │   /** Frames without progress before the dense solver is attempted (default 32). */
 56 │   stallThreshold?: number;
 57 │   /** Largest residual the dense solver will attempt (default 256). */
 58 │   denseLimit?: number;
 59 │   /** Length of the real payload (the last block is zero padded). */
 60 │   payloadLength?: number;
 61 │   /**
 62 │    * Number of leading frames that are sent *systematically* (one source block
 63 │    * each, frame s = block s XOR mask). Defaults to k, i.e. the whole file is
 64 │    * available one-block-per-frame at the start of the stream.
 65 │    *
 66 │    * Why this is a knob rather than a constant: on a clean channel a full prefix
 67 │    * is optimal (exactly 1.00x), but under frame loss a long prefix HURTS, because
 68 │    * the missed systematic frames leave specific holes that LT frames - which
 69 │    * cover random subsets of the whole file - are inefficient at filling. See
 70 │    * docs/degree-experiment-output.txt for the measured curve, and
 71 │    * `SYSTEMATIC_PREFIX_FRACTION`.
 72 │    */
 73 │   systematicPrefix?: number;
 74 │ }
 75 │ 
 76 │ /**
 77 │  * Derive the source blocks covered by a frame.
 78 │  *
 79 │  * ORDERING RULES THAT BOTH SIDES MUST OBEY EXACTLY. Any divergence silently
 80 │  * produces garbage, so this function is the single source of truth:
 81 │  *   1. one RNG, seeded with the frame seed mixed with the session id,
 82 │  *   2. draw the degree first, then the neighbours,
 83 │  *   3. neighbours are DISTINCT (a repeated index would cancel itself in the XOR
 84 │  *      and lower the effective degree),
 85 │  *   4. output order is unspecified (the dense solver sorts when it needs to).
 86 │  *
 87 │  * It must also be STATELESS WITH RESPECT TO HISTORY: the receiver sees an
 88 │  * arbitrary subset of frames, in order, so a sampler that carried mutable state
 89 │  * (e.g. a persistent shuffle pool) would diverge from the sender the moment a
 90 │  * frame is lost, and every later frame would decode to garbage. Everything below
 91 │  * therefore depends only on (seed, k, sessionId, distribution).
 92 │  *
 93 │  * Sampling method: partial Fisher-Yates over a *sparse* virtual array.
 94 │  *
 95 │  *   for i in 0..degree-1:  j = i + rand(k - i);  swap virtual[i], virtual[j]
 96 │  *
 97 │  * The virtual array starts as the identity permutation each call, and the sparse
 98 │  * map only stores entries the shuffle has actually touched, so each call costs
 99 │  * O(degree) time and O(degree) memory instead of the O(k) a real array would
100 │  * need. Compare with the naive "draw and reject duplicates" loop, which is
101 │  * O(degree^2) in comparisons - the robust-soliton degree spike reaches ~K/R and
102 │  * that quadratic term dominated the sender's frame budget.
103 │  */
104 │ 
105 │ // Recycled scratch for the sparse virtual array. Single-threaded JS means one
106 │ // set of buffers is safe, and `epoch` makes them logically empty on each call.
107 │ let sparseIndex = new Uint32Array(0);
108 │ let sparseValue = new Uint32Array(0);
109 │ let sparseEpoch = new Uint32Array(0);
110 │ let epoch = 0;
111 │ 
112 │ function ensureSparseCapacity(k: number): void {
113 │   if (sparseIndex.length >= k) return;
114 │   // Grow to the next power of two above k to avoid reallocating repeatedly as
115 │   // sessions of increasing size are created.
116 │   let size = 1024;
117 │   while (size < k) size *= 2;
118 │   sparseIndex = new Uint32Array(size);
119 │   sparseValue = new Uint32Array(size);
120 │   sparseEpoch = new Uint32Array(size);
121 │   epoch = 0;
122 │ }
123 │ 
124 │ export function frameNeighbours(
125 │   seed: number,
126 │   k: number,
127 │   sessionId: number,
128 │   dist: DegreeDistribution,
129 │   out?: Uint32Array,
130 │ ): Uint32Array {
131 │   // Mix the session id into the seed so a frame number from another session can
132 │   // never be mistaken for one of ours.
133 │   const rng = new Rng((seed ^ Math.imul(sessionId, 0x9e3779b1)) | 0);
134 │   const degree = Math.min(k, sampleDegree(rng, dist));
135 │   const neighbours = out && out.length >= degree ? out.subarray(0, degree) : new Uint32Array(degree);
136 │ 
137 │   if (degree === k) {
138 │     // Full-degree frame: every block participates, no sampling needed.
139 │     for (let i = 0; i < degree; i++) neighbours[i] = i;
140 │     return neighbours;
141 │   }
142 │ 
143 │   if (degree === 1) {
144 │     neighbours[0] = rng.nextInt(k);
145 │     return neighbours;
146 │   }
147 │ 
148 │   if (degree <= 8) {
149 │     // Tiny degrees are cheaper with the direct duplicate scan than with the
150 │     // sparse map setup, and the scan is exactly correct.
151 │     let filled = 0;
152 │     outer: while (filled < degree) {
153 │       const candidate = rng.nextInt(k);
154 │       for (let i = 0; i < filled; i++) if (neighbours[i] === candidate) continue outer;
155 │       neighbours[filled++] = candidate;
156 │     }
157 │     return neighbours;
158 │   }
159 │ 
160 │   // Sparse partial Fisher-Yates: a brand-new identity permutation per call.
161 │   ensureSparseCapacity(k);
162 │   if (epoch >= 0xffffffe0) {
163 │     // Wrapped: clear the epoch markers once every 4 billion calls.
164 │     sparseEpoch.fill(0);
165 │     epoch = 0;
166 │   }
167 │   const callEpoch = ++epoch;
168 │   const get = (index: number): number => (sparseEpoch[index] === callEpoch ? sparseValue[index] : index);
169 │   const set = (index: number, value: number): void => {
170 │     sparseEpoch[index] = callEpoch;
171 │     sparseIndex[index] = index;
172 │     sparseValue[index] = value;
173 │   };
174 │ 
175 │   for (let i = 0; i < degree; i++) {
176 │     // Draw uniformly from the pool that is still untouched, i.e. positions
177 │     // i..k-1 of the virtual permutation, then take that element and put the
178 │     // unchosen one back into the pool at position j.
179 │     const j = i + rng.nextInt(k - i);
180 │     const atI = get(i);
181 │     const atJ = get(j);
182 │     neighbours[i] = atJ;
183 │     if (j !== i) set(j, atI);
184 │   }
185 │   return neighbours;
186 │ }
187 │ 
188 │ /**
189 │  * The systematic-prefix mask block, derived from the session id.
190 │  *
191 │  * Deriving it (rather than transmitting it) is what makes the systematic prefix
192 │  * pay off immediately: a receiver that has just read a session header can
193 │  * already unmask every systematic frame it captures, with no dependency on a
194 │  * particular earlier frame having been seen. The sender still emits one explicit
195 │  * mask frame (seed === K) so that a third-party receiver which does not
196 │  * implement the derivation can interoperate.
197 │  */
198 │ export function deriveMaskBlock(sessionId: number, blockSize: number): Uint8Array {
199 │   const rng = new Rng((sessionId ^ 0x5bf03635) | 0);
200 │   const mask = new Uint8Array(blockSize);
201 │   for (let i = 0; i < blockSize; i++) mask[i] = rng.nextUint32() & 0xff;
202 │   return mask;
203 │ }
204 │ 
205 │ /** XOR `source` into `target` (target is modified). */
206 │ export function xorInto(target: Uint8Array, source: Uint8Array): void {
207 │   const n = target.length;
208 │   let i = 0;
209 │   // Unrolled by 8: XOR is memory bound, and this measurably beats the naive loop
210 │   // in V8/SpiderMonkey/JavaScriptCore for the 1-8 KB blocks we use.
211 │   for (; i + 8 <= n; i += 8) {
212 │     target[i] ^= source[i];
213 │     target[i + 1] ^= source[i + 1];
214 │     target[i + 2] ^= source[i + 2];
215 │     target[i + 3] ^= source[i + 3];
216 │     target[i + 4] ^= source[i + 4];
217 │     target[i + 5] ^= source[i + 5];
218 │     target[i + 6] ^= source[i + 6];
219 │     target[i + 7] ^= source[i + 7];
220 │   }
221 │   for (; i < n; i++) target[i] ^= source[i];
222 │ }
223 │ 
224 │ export class LTEncoder {
225 │   readonly k: number;
226 │   readonly blockSize: number;
227 │   readonly sessionId: number;
228 │   readonly dist: DegreeDistribution;
229 │   /** Length of the systematic prefix in frames (see LTSessionOptions). */
230 │   readonly prefix: number;
231 │   /** Source blocks as borrowed views into the payload (no copy). */
232 │   private readonly blocks: Uint8Array[];
233 │   /** The random mask that makes the systematic prefix invertible. */
234 │   private readonly mask: Uint8Array;
235 │   private readonly scratch: Uint32Array;
236 │ 
237 │   constructor(payload: Uint8Array, options: LTSessionOptions) {
238 │     const { k, blockSize, sessionId } = options;
239 │     if (k < 1) throw new RangeError('k must be >= 1');
240 │     if (blockSize < 1) throw new RangeError('blockSize must be >= 1');
241 │     this.k = k;
242 │     this.blockSize = blockSize;
243 │     this.sessionId = sessionId;
244 │     this.prefix = Math.max(0, Math.min(k, options.systematicPrefix ?? defaultSystematicPrefix(k)));
245 │     this.dist = buildDegreeDistribution(k, options.degree);
246 │     this.scratch = new Uint32Array(Math.max(1, k));
247 │ 
248 │     this.blocks = new Array(k);
249 │     for (let i = 0; i < k; i++) {
250 │       const start = i * blockSize;
251 │       const end = Math.min(payload.length, start + blockSize);
252 │       if (start >= payload.length) {
253 │         // Blocks past the end of the payload are all-zero (this is the padding
254 │         // that the receiver trims away).
255 │         this.blocks[i] = new Uint8Array(blockSize);
256 │       } else if (end - start === blockSize) {
257 │         this.blocks[i] = payload.subarray(start, end);
258 │       } else {
259 │         const padded = new Uint8Array(blockSize);
260 │         padded.set(payload.subarray(start, end));
261 │         this.blocks[i] = padded;
262 │       }
263 │     }
264 │ 
265 │     // The mask is derived from the session id, so it is identical on both sides
266 │     // and does not need to be transmitted before the systematic frames.
267 │     this.mask = deriveMaskBlock(sessionId, blockSize);
268 │   }
269 │ 
270 │   /** The mask block (useful for tests and diagnostics). */
271 │   get maskBlock(): Uint8Array {
272 │     return this.mask;
273 │   }
274 │ 
275 │   /** Neighbour indices for a frame seed. */
276 │   neighbours(seed: number): Uint32Array {
277 │     return frameNeighbours(seed, this.k, this.sessionId, this.dist, this.scratch);
278 │   }
279 │ 
280 │   /**
281 │    * Produce the encoded block for `seed`.
282 │    *
283 │    * Frame layout in the systematic prefix (seed < K):
284 │    *     seed <  K          -> source block[seed] XOR mask        (degree 1)
285 │    *     seed == K          -> mask, verbatim                     (degree 1)
286 │    *     seed >  K          -> LT-coded block seeded with (seed-K-1)
287 │    *
288 │    * The mask frame is what makes the systematic frames immediately useful: as
289 │    * soon as the receiver has the mask (one frame), every systematic frame it
290 │    * captured earlier resolves to a full source block.
291 │    */
292 │   encode(seed: number, out?: Uint8Array): Uint8Array {
293 │     const target = out && out.length >= this.blockSize ? out.subarray(0, this.blockSize) : new Uint8Array(this.blockSize);
294 │ 
295 │     // Slot layout: [0, prefix) systematic - prefix is the mask frame - then LT.
296 │     if (seed < this.prefix) {
297 │       target.set(this.blocks[seed]);
298 │       xorInto(target, this.mask);
299 │       return target;
300 │     }
301 │     if (seed === this.prefix) {
302 │       target.set(this.mask);
303 │       return target;
304 │     }
305 │ 
306 │     const indices = this.neighbours(seed - this.prefix - 1);
307 │     const first = indices[0];
308 │     target.set(this.blocks[first]);
309 │     for (let i = 1; i < indices.length; i++) xorInto(target, this.blocks[indices[i]]);
310 │     return target;
311 │   }
312 │ 
313 │   /** Total bytes of payload this encoder represents (for progress reporting). */
314 │   get payloadBytes(): number {
315 │     return this.k * this.blockSize;
316 │   }
317 │ }
318 │ 
319 │ /**
320 │  * Default length of the systematic prefix, as a fraction of K.
321 │  *
322 │  * MEASURED (k = 1024, blockSize = 512, 3 trials per cell; frames the SENDER must
323 │  * display per source block - tools/diag/prefix-experiment.ts):
324 │  *
325 │  *   prefix/K    clean channel   30% frame loss   50% loss + bursts
326 │  *   0.00        1.138           1.630            3.849
327 │  *   0.10        1.106           1.619            3.664   <-- chosen default
328 │  *   0.25        1.191           1.682            3.714
329 │  *   0.50        1.354           1.840            3.767
330 │  *   1.00        1.000           2.054            4.028
331 │  *
332 │  * Reading the table:
333 │  *   - A FULL prefix is perfect on a clean channel (exactly K frames) and the worst
334 │  *     option everywhere else. The reason is worth stating plainly: the systematic
335 │  *     frames the receiver misses leave SPECIFIC holes, and an LT frame covers a
336 │  *     uniformly random subset of the whole file, so patching those holes costs far
337 │  *     more than covering the file from scratch.
338 │  *   - Pure LT (prefix 0) is the most robust option under loss but has no cold-start
339 │  *     advantage: the first complete block appears only after ~1.14 K frames.
340 │  *   - A SHORT prefix captures both: the first ~10% of blocks arrive at exactly one
341 │  *     frame each, so a receiver has verified data on screen within seconds and can
342 │  *     preview a partially received image, while the LT tail stays near its
343 │  *     loss-optimal efficiency.
344 │  *
345 │  * Some optical-transfer tools hard-code a full systematic pass. On a hand-held
346 │  * link that is the wrong trade, which is why this constant is small.
347 │  */
348 │ export const SYSTEMATIC_PREFIX_FRACTION = 0.1;
349 │ 
350 │ /** Frames to send systematically for a given block count. */
351 │ export function defaultSystematicPrefix(k: number): number {
352 │   return Math.max(1, Math.min(k, Math.round(k * SYSTEMATIC_PREFIX_FRACTION)));
353 │ }
354 │ 
355 │ export type FrameOutcome =
356 │   | 'accepted' // contributed new information
357 │   | 'redundant' // linearly dependent on what we already have
358 │   | 'duplicate' // exactly this frame seed was already seen
359 │   | 'complete'; // this frame completed the file
360 │ 
361 │ interface Equation {
362 │   /** Indices of the source blocks in this equation. */
363 │   vars: Uint32Array;
364 │   /** Running XOR accumulator (already has solved variables removed). */
365 │   data: Uint8Array;
366 │   /** Number of still-unsolved variables in the equation. */
367 │   activeCount: number;
368 │   /** Number of solved variables XORed into `data` so far (diagnostics). */
369 │   xorOps: number;
370 │ }
371 │ 
372 │ export interface DecoderStats {
373 │   k: number;
374 │   blockSize: number;
375 │   received: number;
376 │   duplicates: number;
377 │   redundant: number;
378 │   solved: number;
379 │   equationsHeld: number;
380 │   peelOperations: number;
381 │   xorOperations: number;
382 │   denseSolves: number;
383 │   denseMatrixSize: number;
384 │   overheadRatio: number;
385 │   complete: boolean;
386 │ }
387 │ 
388 │ export class LTDecoder {
389 │   readonly k: number;
390 │   readonly blockSize: number;
391 │   readonly sessionId: number;
392 │   private readonly dist: DegreeDistribution;
393 │   private readonly payloadLength: number;
394 │   /** Length of the systematic prefix in frames (see LTSessionOptions). */
395 │   private readonly prefix: number;
396 │ 
397 │   /** Solved source blocks (null = not yet known). */
398 │   private readonly solved: Array<Uint8Array | null>;
399 │   private solvedCount = 0;
400 │ 
401 │   /** Unsolved equations, indexed by insertion order. */
402 │   private equations: Equation[] = [];
403 │   /** varToEquations[v] = indices into `equations` that still contain v. */
404 │   private varToEquations: number[][];
405 │   /** Indices of equations whose activeCount is 1, ready to be peeled. */
406 │   private readonly ready: number[] = [];
407 │ 
408 │   private seenSeeds = new Set<number>();
409 │   private stats = {
410 │     received: 0,
411 │     duplicates: 0,
412 │     redundant: 0,
413 │     peelOperations: 0,
414 │     xorOperations: 0,
415 │     denseSolves: 0,
416 │     denseMatrixSize: 0,
417 │   };
418 │ 
419 │   /** Frames whose masks/solved data let us finish; set when solvedCount reaches k. */
420 │   private completed = false;
421 │   private scratch: Uint32Array;
422 │   /**
423 │    * Frames received since the last time peeling made progress. The dense solver
424 │    * is only attempted after a stall: re-running Gaussian elimination on every
425 │    * frame would dominate the CPU budget for no benefit.
426 │    */
427 │   private framesSinceProgress = 0;
428 │   private lastSolvedCount = 0;
429 │   /** Frames of no progress tolerated before attempting a dense solve. */
430 │   private stallThreshold = 32;
431 │   /** Largest residual the dense solver will attempt. */
432 │   private denseLimit = 256;
433 │   /**
434 │    * Signature of the last dense attempt: (equations held, residual size). If
435 │    * neither has changed since the last attempt, retrying is guaranteed to do the
436 │    * same work for the same answer, so we skip it. Without this guard a stalled
437 │    * session would re-run Gaussian elimination on every subsequent frame.
438 │    */
439 │   private lastDenseSignature = '';
440 │ 
441 │   constructor(options: LTSessionOptions) {
442 │     this.k = options.k;
443 │     this.blockSize = options.blockSize;
444 │     this.sessionId = options.sessionId;
445 │     this.payloadLength = options.payloadLength ?? options.k * options.blockSize;
446 │     this.prefix = Math.max(0, Math.min(options.k, options.systematicPrefix ?? defaultSystematicPrefix(options.k)));
447 │     this.dist = buildDegreeDistribution(options.k, options.degree);
448 │     this.solved = new Array(options.k).fill(null);
449 │     this.varToEquations = Array.from({ length: options.k }, () => []);
450 │     this.scratch = new Uint32Array(Math.max(1, options.k));
451 │     // The mask is derivable from the session id, so systematic frames are usable
452 │     // from the very first captured frame.
453 │     this.maskData = deriveMaskBlock(options.sessionId, options.blockSize);
454 │     this.maskSolved = true;
455 │     if (options.stallThreshold !== undefined) this.stallThreshold = options.stallThreshold;
456 │     if (options.denseLimit !== undefined) this.denseLimit = options.denseLimit;
457 │   }
458 │ 
459 │   get progress(): number {
460 │     return this.k === 0 ? 1 : this.solvedCount / this.k;
461 │   }
462 │ 
463 │   get isComplete(): boolean {
464 │     return this.solvedCount >= this.k;
465 │   }
466 │ 
467 │   get missingBlocks(): number {
468 │     return this.k - this.solvedCount;
469 │   }
470 │ 
471 │   /** Indices of source blocks not yet recovered (diagnostics / request hints). */
472 │   get missingIndices(): number[] {
473 │     const out: number[] = [];
474 │     for (let i = 0; i < this.k; i++) if (!this.solved[i]) out.push(i);
475 │     return out;
476 │   }
477 │ 
478 │   getStats(): DecoderStats {
479 │     return {
480 │       ...this.stats,
481 │       k: this.k,
482 │       blockSize: this.blockSize,
483 │       solved: this.solvedCount,
484 │       equationsHeld: this.equations.length,
485 │       overheadRatio: this.k === 0 ? 0 : this.stats.received / this.k,
486 │       complete: this.isComplete,
487 │     };
488 │   }
489 │ 
490 │   /**
491 │    * Feed one received frame.
492 │    *
493 │    * @param seed  frame number from the frame header
494 │    * @param data  encoded block bytes (exactly blockSize bytes)
495 │    */
496 │   addFrame(seed: number, data: Uint8Array): FrameOutcome {
497 │     if (data.length !== this.blockSize) {
498 │       throw new RangeError(`Frame payload must be ${this.blockSize} bytes, got ${data.length}`);
499 │     }
500 │     if (this.completed) return 'redundant';
501 │     if (this.seenSeeds.has(seed)) {
502 │       this.stats.duplicates++;
503 │       return 'duplicate';
504 │     }
505 │     this.seenSeeds.add(seed);
506 │     this.stats.received++;
507 │ 
508 │     // --- systematic prefix -------------------------------------------------
509 │     // Frame s < K carries source block s XOR mask, i.e. one complete source block
510 │     // as soon as the mask is undone. This is why the first K frames of a session
511 │     // are worth more than any later frame: each one is a guaranteed +1 block.
512 │     if (seed < this.prefix) {
513 │       const blockIndex = seed;
514 │       if (this.solved[blockIndex]) {
515 │         this.stats.redundant++;
516 │         return 'redundant';
517 │       }
518 │       const block = Uint8Array.from(data);
519 │       xorInto(block, this.maskData!);
520 │       this.solveVariable(blockIndex, block);
521 │       return this.finishOutcome();
522 │     }
523 │ 
524 │     if (seed === this.prefix) {
525 │       // Explicit mask frame: verifies our derivation and interoperates with
526 │       // receivers that do not derive it.
527 │       if (!this.verifyMask(data)) {
528 │         this.stats.redundant++;
529 │         return 'redundant';
530 │       }
531 │       this.stats.redundant++;
532 │       return this.finishOutcome();
533 │     }
534 │ 
535 │     // --- regular LT frame ---------------------------------------------------
536 │     const indices = frameNeighbours(seed - this.prefix - 1, this.k, this.sessionId, this.dist, this.scratch);
537 │     const active: number[] = [];
538 │     for (let i = 0; i < indices.length; i++) {
539 │       if (!this.solved[indices[i]]) active.push(indices[i]);
540 │     }
541 │ 
542 │     if (active.length === 0) {
543 │       // Fully determined already: verify, then discard.
544 │       this.stats.redundant++;
545 │       return 'redundant';
546 │     }
547 │ 
548 │     const equation: Equation = {
549 │       vars: Uint32Array.from(active),
550 │       data: Uint8Array.from(data),
551 │       activeCount: active.length,
552 │       xorOps: 0,
553 │     };
554 │ 
555 │     // Subtract anything already solved (possible when the same frame arrives
556 │     // after some of its blocks were completed by other frames).
557 │     for (let i = 0; i < indices.length; i++) {
558 │       const block = this.solved[indices[i]];
559 │       if (block) xorInto(equation.data, block);
560 │     }
561 │ 
562 │     if (equation.activeCount === 1) {
563 │       this.solveVariable(equation.vars[0], equation.data);
564 │       this.stats.peelOperations++;
565 │       return this.finishOutcome();
566 │     }
567 │ 
568 │     this.holdEquation(equation);
569 │     this.drainReady();
570 │     // Peeling is preferred while it keeps making progress (it is O(1) amortised
571 │     // per variable); only a stalled decode falls back to dense elimination.
572 │     if (this.framesSinceProgress >= this.stallThreshold) {
573 │       this.maybeDenseSolve();
574 │     }
575 │     return this.finishOutcome();
576 │   }
577 │ 
578 │   private finishOutcome(): FrameOutcome {
579 │     if (this.solvedCount !== this.lastSolvedCount) {
580 │       this.lastSolvedCount = this.solvedCount;
581 │       this.framesSinceProgress = 0;
582 │     } else {
583 │       this.framesSinceProgress++;
584 │     }
585 │     if (this.isComplete) {
586 │       this.completed = true;
587 │       return 'complete';
588 │     }
589 │     return 'accepted';
590 │   }
591 │ 
592 │   // -------------------------------------------------------------------------
593 │   // Mask handling
594 │   //
595 │   // The systematic prefix XORs every source block with one mask block that both
596 │   // sides derive from the session id. `maskMismatch` records the (protocol-level)
597 │   // case where an explicit mask frame disagrees with our derivation, which the
598 │   // diagnostics screen surfaces as a version/protocol warning.
599 │   // -------------------------------------------------------------------------
600 │ 
601 │   private maskSolved = true;
602 │   private maskData: Uint8Array | null = null;
603 │   /** Set if an explicit mask frame contradicted the derived mask. */
604 │   maskMismatch = false;
605 │ 
606 │   /** Compare an explicit mask frame with the locally derived mask. */
607 │   private verifyMask(mask: Uint8Array): boolean {
608 │     if (!this.maskData) return false;
609 │     if (mask.length !== this.maskData.length) return false;
610 │     let equal = true;
611 │     for (let i = 0; i < mask.length; i++) {
612 │       if (mask[i] !== this.maskData[i]) {
613 │         equal = false;
614 │         break;
615 │       }
616 │     }
617 │     if (!equal) this.maskMismatch = true;
618 │     return equal;
619 │   }
620 │ 
621 │   // -------------------------------------------------------------------------
622 │   // Peeling
623 │   // -------------------------------------------------------------------------
624 │ 
625 │   private holdEquation(equation: Equation): void {
626 │     const index = this.equations.length;
627 │     this.equations.push(equation);
628 │     for (let i = 0; i < equation.vars.length; i++) {
629 │       this.varToEquations[equation.vars[i]].push(index);
630 │     }
631 │     if (equation.activeCount === 1) this.ready.push(index);
632 │   }
633 │ 
634 │   /**
635 │    * Record a solved source block and substitute it into every held equation.
636 │    *
637 │    * `value` is retained by reference, so callers must hand over a buffer they
638 │    * will not mutate afterwards (see the aliasing note in drainReady).
639 │    */
640 │   private solveVariable(variable: number, value: Uint8Array): void {
641 │     if (this.solved[variable]) return;
642 │     this.solved[variable] = value;
643 │     this.solvedCount++;
644 │ 
645 │     // Substitute into every equation that still references this variable.
646 │     const references = this.varToEquations[variable];
647 │     for (let r = 0; r < references.length; r++) {
648 │       const eq = this.equations[references[r]];
649 │       if (!eq || eq.activeCount === 0) continue;
650 │       xorInto(eq.data, value);
651 │       eq.xorOps++;
652 │       this.stats.xorOperations++;
653 │       eq.activeCount--;
654 │       if (eq.activeCount === 1) this.ready.push(references[r]);
655 │     }
656 │     this.varToEquations[variable] = [];
657 │   }
658 │ 
659 │   /** Peel while there is anything with a single unknown. */
660 │   private drainReady(): void {
661 │     while (this.ready.length > 0) {
662 │       const eqIndex = this.ready.pop()!;
663 │       const eq = this.equations[eqIndex];
664 │       if (!eq || eq.activeCount !== 1) continue;
665 │       // Find the remaining unknown.
666 │       let unknown = -1;
667 │       for (let i = 0; i < eq.vars.length; i++) {
668 │         if (!this.solved[eq.vars[i]]) {
669 │           unknown = eq.vars[i];
670 │           break;
671 │         }
672 │       }
673 │       if (unknown < 0) {
674 │         eq.activeCount = 0;
675 │         continue;
676 │       }
677 │       // ORDER MATTERS, and getting it wrong is silent corruption. Clearing
678 │       // activeCount must happen BEFORE solveVariable, because solveVariable
679 │       // substitutes the new value into every equation still listening for that
680 │       // variable - and this equation is still on that list. With activeCount
681 │       // still 1, the substitution does `eq.data ^= value`, and `value` IS
682 │       // `eq.data`, so the freshly solved source block would be zeroed on the
683 │       // spot. (Diagnosed by 185/200 randomised round trips reporting "complete"
684 │       // with zero-filled blocks.)
685 │       eq.activeCount = 0;
686 │       this.stats.peelOperations++;
687 │       // A copy, not the accumulator: the buffer belongs to the equation, and
688 │       // anything that later touches that equation must not be able to reach the
689 │       // solved block through it.
690 │       this.solveVariable(unknown, Uint8Array.from(eq.data));
691 │     }
692 │   }
693 │ 
694 │   // -------------------------------------------------------------------------
695 │   // Dense fallback
696 │   // -------------------------------------------------------------------------
697 │ 
698 │   /**
699 │    * When peeling stalls, solve the residual system by Gaussian elimination over
700 │    * GF(2).
701 │    *
702 │    * Cost is O(r^3 / 64) bit operations plus O(r * blockSize) XORs for r residual
703 │    * variables, so it is only attempted for small residuals - but that is exactly
704 │    * the case that matters in practice: peeling leaves a handful of blocks
705 │    * unsolved near the end of a transfer, and this closes them out immediately
706 │    * instead of waiting for a lucky low-degree frame.
707 │    *
708 │    * @param limit maximum residual size to attempt
709 │    * @returns true if the dense solve made progress
710 │    */
711 │   maybeDenseSolve(limit = 256): boolean {
712 │     if (this.isComplete) return false;
713 │     const progressBefore = this.solvedCount;
714 │ 
715 │     // Cheap pre-pass: count the residual variables and the equations available
716 │     // for them WITHOUT building the matrix, so an oversized residual costs
717 │     // nothing. (An earlier revision built the rows first, which made a stalled
718 │     // large-K session quadratic in the number of frames.)
719 │     let residualCount = 0;
720 │     {
721 │       const seen = new Set<number>();
722 │       let usable = 0;
723 │       for (const eq of this.equations) {
724 │         if (eq.activeCount < 2) continue;
725 │         usable++;
726 │         for (let i = 0; i < eq.vars.length; i++) {
727 │           const v = eq.vars[i];
728 │           if (!this.solved[v]) seen.add(v);
729 │         }
730 │       }
731 │       residualCount = seen.size;
732 │       if (residualCount === 0 || residualCount > limit || usable < residualCount) return false;
733 │     }
734 │ 
735 │     const signature = `${this.equations.length}:${residualCount}`;
736 │     if (signature === this.lastDenseSignature) return false;
737 │     this.lastDenseSignature = signature;
738 │ 
739 │     const residualIndex = new Map<number, number>();
740 │     for (const eq of this.equations) {
741 │       if (eq.activeCount < 2) continue;
742 │       for (let i = 0; i < eq.vars.length; i++) {
743 │         const v = eq.vars[i];
744 │         if (!this.solved[v] && !residualIndex.has(v)) residualIndex.set(v, residualIndex.size);
745 │       }
746 │     }
747 │     const r = residualIndex.size;
748 │     if (r === 0 || r > limit) return false;
749 │ 
750 │     const rows: Array<{ bits: Uint8Array; data: Uint8Array }> = [];
751 │     const rowWords = (r + 7) >>> 3;
752 │     for (const eq of this.equations) {
753 │       if (eq.activeCount < 2) continue;
754 │       const bits = new Uint8Array(rowWords);
755 │       let any = false;
756 │       for (let i = 0; i < eq.vars.length; i++) {
757 │         const v = eq.vars[i];
758 │         if (this.solved[v]) continue;
759 │         const col = residualIndex.get(v)!;
760 │         bits[col >>> 3] ^= 0x80 >>> (col & 7);
761 │         any = true;
762 │       }
763 │       if (any) rows.push({ bits, data: Uint8Array.from(eq.data) });
764 │     }
765 │     if (rows.length < r) return false; // not enough equations to solve uniquely
766 │     // Work budget: elimination is O(cols * rows * rowWords) byte-XORs plus
767 │     // O(rows^2) block XORs on the `data` accumulators. Refuse anything that
768 │     // would block the UI thread for more than a few milliseconds - a partially
769 │     // solved transfer can simply wait for more frames instead.
770 │     if (r * rows.length * rowWords + rows.length * rows.length * this.blockSize > 24_000_000) return false;
771 │ 
772 │     this.stats.denseMatrixSize = Math.max(this.stats.denseMatrixSize, r);
773 │ 
774 │     // --- forward elimination: reduce to row echelon form -------------------
775 │     const pivotOfRow: number[] = new Array(rows.length).fill(-1);
776 │     let pivotRow = 0;
777 │     for (let col = 0; col < r && pivotRow < rows.length; col++) {
778 │       const byte = col >>> 3;
779 │       const mask = 0x80 >>> (col & 7);
780 │       let sel = -1;
781 │       for (let row = pivotRow; row < rows.length; row++) {
782 │         if (rows[row].bits[byte] & mask) {
783 │           sel = row;
784 │           break;
785 │         }
786 │       }
787 │       if (sel < 0) continue;
788 │       if (sel !== pivotRow) {
789 │         const tmp = rows[sel];
790 │         rows[sel] = rows[pivotRow];
791 │         rows[pivotRow] = tmp;
792 │       }
793 │       const pivot = rows[pivotRow];
794 │       for (let row = 0; row < rows.length; row++) {
795 │         if (row === pivotRow) continue;
796 │         if (rows[row].bits[byte] & mask) {
797 │           xorInto(rows[row].bits, pivot.bits);
798 │           xorInto(rows[row].data, pivot.data);
799 │           this.stats.xorOperations++;
800 │         }
801 │       }
802 │       pivotOfRow[pivotRow] = col;
803 │       pivotRow++;
804 │     }
805 │ 
806 │     // --- back substitution: any row with a single set bit is a solution -----
807 │     let solvedNow = 0;
808 │     for (let row = 0; row < rows.length; row++) {
809 │       if (pivotOfRow[row] < 0) continue;
810 │       const bits = rows[row].bits;
811 │       let count = 0;
812 │       let only = -1;
813 │       for (let col = 0; col < r; col++) {
814 │         if (bits[col >>> 3] & (0x80 >>> (col & 7))) {
815 │           count++;
816 │           only = col;
817 │           if (count > 1) break;
818 │         }
819 │       }
820 │       if (count !== 1) continue;
821 │       // Map back from residual index to source block index.
822 │       let variable = -1;
823 │       for (const [v, idx] of residualIndex) {
824 │         if (idx === only) {
825 │           variable = v;
826 │           break;
827 │         }
828 │       }
829 │       if (variable < 0 || this.solved[variable]) continue;
830 │       this.solveVariable(variable, Uint8Array.from(rows[row].data));
831 │       solvedNow++;
832 │     }
833 │ 
834 │     if (solvedNow > 0) {
835 │       this.stats.denseSolves++;
836 │       this.drainReady();
837 │       if (this.isComplete) this.completed = true;
838 │       if (this.solvedCount !== progressBefore) this.framesSinceProgress = 0;
839 │       return true;
840 │     }
841 │     return false;
842 │   }
843 │ 
844 │   // -------------------------------------------------------------------------
845 │   // Output
846 │   // -------------------------------------------------------------------------
847 │ 
848 │   /** True once every source block has been recovered. */
849 │   get complete(): boolean {
850 │     return this.isComplete;
851 │   }
852 │ 
853 │   /** Reassemble the payload. Zero-fills any missing blocks (see bestEffort). */
854 │   reconstruct(): Uint8Array {
855 │     const out = new Uint8Array(this.k * this.blockSize);
856 │     for (let i = 0; i < this.k; i++) {
857 │       const block = this.solved[i];
858 │       if (block) out.set(block, i * this.blockSize);
859 │     }
860 │     return out.subarray(0, this.payloadLength);
861 │   }
862 │ 
863 │   /**
864 │    * Reassemble even when incomplete, reporting which byte ranges are still
865 │    * unknown. The caller decides whether to keep waiting; the UI uses this to
866 │    * show a partially-received image (which often reveals whether the transfer is
867 │    * working) and to compute per-region progress.
868 │    */
869 │   bestEffort(): { data: Uint8Array; missingRanges: Array<{ start: number; end: number }>; complete: boolean } {
870 │     const data = new Uint8Array(this.payloadLength);
871 │     const missingRanges: Array<{ start: number; end: number }> = [];
872 │     for (let i = 0; i < this.k; i++) {
873 │       const start = i * this.blockSize;
874 │       const end = Math.min(this.payloadLength, start + this.blockSize);
875 │       const block = this.solved[i];
876 │       if (block) {
877 │         data.set(block.subarray(0, end - start), start);
878 │       } else {
879 │         missingRanges.push({ start, end });
880 │       }
881 │     }
882 │     return { data, missingRanges, complete: this.isComplete };
883 │   }
884 │ 
885 │   /** Drop all state (used when a session is abandoned or restarted). */
886 │   reset(): void {
887 │     this.solved.fill(null);
888 │     this.solvedCount = 0;
889 │     this.equations = [];
890 │     this.varToEquations = Array.from({ length: this.k }, () => []);
891 │     this.ready.length = 0;
892 │     this.seenSeeds = new Set();
893 │     this.maskData = deriveMaskBlock(this.sessionId, this.blockSize);
894 │     this.maskSolved = true;
895 │     this.maskMismatch = false;
896 │     this.completed = false;
897 │   }
898 │ }
899 │ 
900 │ /**
901 │  * Number of encoded frames required to decode with high probability.
902 │  *
903 │  * The theoretical LT bound is K + O(sqrt(K) * ln^2(K/delta)). Real sessions do a
904 │  * little worse because our receiver loses frames between the ones it captures
905 │  * (a dropped frame is not "eaten" - it just is not there). This helper is used
906 │  * for the ETA shown in the UI, not for correctness.
907 │  */
908 │ export function expectedFramesFor(k: number, delta = 0.5): number {
909 │   if (k <= 1) return 1;
910 │   const c = 0.03;
911 │   const R = c * Math.log(k / delta) * Math.sqrt(k);
912 │   return Math.ceil(k + R * Math.log(k / delta) + Math.sqrt(k) * 2);
913 │ }
```

---

## `packages/core/src/crypto/crc.ts`

> 76 lines

**What it is.** Two checksums, and the reasoning for why a system that already has QR error
correction needs them.

**Why checksums on top of Reed–Solomon.** Reed–Solomon protects the *symbol*, not the
*meaning*. A camera pointed at a screen regularly yields a symbol that decodes to a valid but
**wrong** payload: motion blur across the finder patterns, a menu bar or window overlapping
the code, a reflection. The RS decoder does its best and, when the damage exceeds its
correction budget, either fails (fine) or "corrects" to a different valid codeword (not fine).
A 16-bit checksum over the header makes the probability of accepting such a frame roughly
1/65536 instead of "whenever the RS decoder guesses wrong", and it costs about forty
arithmetic operations per frame — free at 15 frames per second.

**CRC-32** (`crc32`, `crc32u`) — polynomial `0xEDB88320`, the reflected form used by zlib, PNG
and Ethernet. Used **once per session**, over the reassembled payload, as a second independent
check alongside SHA-256: `sender.ts` computes it over the wire payload and puts it in the
manifest as `crc`, and `integrity.ts` recomputes it after the fountain decode. It is not used
for anything per-frame. Two entry points because the algorithm naturally produces a signed
32-bit integer (`crc32`, matching zlib) while display and comparison want an unsigned one
(`crc32u`) — the `>>> 0` is the whole difference.

**CRC-16/CCITT-FALSE** (`crc16`) — polynomial `0x1021`, init `0xFFFF`, **not** reflected, and
implemented bit by bit rather than with a table. That looks like an inconsistency with the
CRC-32 above, and it is a deliberate one: this is called a few times per frame on small inputs
(88 iterations for an 11-byte header), where table setup would cost more than it saves, and the
256→65 536-entry tables differ by variant in ways that are easy to get subtly wrong. The bitwise
loop is transcribed straight from the definition, so it cannot be wrong in a variant-specific
way.

It is the workhorse, and it guards three things, all of them **per frame**: the 11-byte frame
header (`protocol/frame.ts`, both on the way out and on the way in), each manifest fragment's
body, and the manifest fragments envelope. The pattern is the same in all three places — a
garbled fragment must be treated as a *missing* fragment, so that the fountain decoder asks for
more material instead of being fed corrupted material. That distinction is a comment in
`manifest.ts` and it is the reason the CRC is checked before the fragment is stored.

**The lookup table is lazy and module-level.** `crc32Table` is built on first use and cached
forever. That matters in the mobile app: modules initialise in an unpredictable order, and a
table built at import time would be 256 × 8 shift-XOR operations during cold start for a
function the user may never call (a receiver-only session never computes a payload CRC).

**`seed` parameters.** Both functions accept a seed, which is what makes a CRC resumable across
a fragmented buffer: `crc32(chunk2, crc32(chunk1))` equals `crc32(whole)`. **Nothing in LightBeam
uses it** — every call site in this repository passes a complete buffer and takes the default —
and saying so is more useful than implying otherwise: the parameter is part of the conventional
signature of these algorithms (and is what makes the function usable by anything that streams),
not a feature this protocol relies on. It is documented in the source for exactly that reason.
The default `~seed` in `crc32` is the conventional "all ones" initial value, inverted on output.

**Every line**

```ts
 1 │ /**
 2 │  * crc.ts - CRC-32 and CRC-16 checksums.
 3 │  *
 4 │  * Every LightBeam frame carries a CRC-16 over its 11-byte header. Why bother,
 5 │  * when QR Codes already have Reed-Solomon error correction?
 6 │  *
 7 │  *   Because Reed-Solomon protects the *symbol*, not the *meaning*. A camera
 8 │  *   pointed at a screen regularly produces a symbol that decodes to a valid but
 9 │  *   WRONG payload (motion blur across the finder patterns, a menu bar overlaying
10 │  *   the code, an overlapping window). Adding a 16-bit checksum over the header
11 │  *   makes the probability of accepting such a frame roughly 1 in 65536 instead
12 │  *   of "whenever the RS decoder guesses wrong", and it is 40 arithmetic
13 │  *   operations - free at 15 frames per second.
14 │  *
15 │  * CRC-32 is used once per session, over the reassembled payload: a second,
16 │  * independent check alongside SHA-256 (see crypto/integrity.ts). Everything that
17 │  * has to survive inside a single QR symbol - the 11-byte frame header, each
18 │  * manifest fragment, and the manifest fragments envelope - uses the cheaper
19 │  * CRC-16, because those checks run per frame rather than per transfer.
20 │  *
21 │  * Both implementations use a lazily built 256-entry lookup table.
22 │  */
23 │ 
24 │ /** Polynomial for CRC-32 (reflected, as used by zlib/PNG/Ethernet). */
25 │ const CRC32_POLY = 0xedb88320;
26 │ 
27 │ /** CRC-16/CCITT-FALSE: polynomial 0x1021, init 0xFFFF, no reflection. */
28 │ const CRC16_POLY = 0x1021;
29 │ 
30 │ let crc32Table: Int32Array | null = null;
31 │ 
32 │ function getCrc32Table(): Int32Array {
33 │   if (crc32Table) return crc32Table;
34 │   const table = new Int32Array(256);
35 │   for (let n = 0; n < 256; n++) {
36 │     let c = n;
37 │     for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ CRC32_POLY : c >>> 1;
38 │     table[n] = c;
39 │   }
40 │   crc32Table = table;
41 │   return table;
42 │ }
43 │ 
44 │ /**
45 │  * CRC-32 (IEEE 802.3 / zlib). Returns a signed 32-bit int, as zlib does.
46 │  *
47 │  * `seed` makes the checksum resumable - `crc32(chunk2, crc32(chunk1)) ===
48 │  * crc32(whole)` - which is the conventional signature for the algorithm. LightBeam
49 │  * itself always calls it once over a complete buffer (see sender.ts, integrity.ts),
50 │  * so every call site uses the default.
51 │  */
52 │ export function crc32(bytes: Uint8Array, seed = 0): number {
53 │   const table = getCrc32Table();
54 │   let crc = ~seed;
55 │   for (let i = 0; i < bytes.length; i++) {
56 │     crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
57 │   }
58 │   return ~crc | 0;
59 │ }
60 │ 
61 │ /** CRC-32 as an unsigned value (nicer for display and comparison). */
62 │ export function crc32u(bytes: Uint8Array, seed = 0): number {
63 │   return crc32(bytes, seed) >>> 0;
64 │ }
65 │ 
66 │ /** CRC-16/CCITT-FALSE. Returns a 16-bit unsigned value. */
67 │ export function crc16(bytes: Uint8Array, seed = 0xffff): number {
68 │   let crc = seed & 0xffff;
69 │   for (let i = 0; i < bytes.length; i++) {
70 │     crc ^= bytes[i] << 8;
71 │     for (let bit = 0; bit < 8; bit++) {
72 │       crc = crc & 0x8000 ? ((crc << 1) ^ CRC16_POLY) & 0xffff : (crc << 1) & 0xffff;
73 │     }
74 │   }
75 │   return crc & 0xffff;
76 │ }
```

---

## `packages/core/src/crypto/aead.ts`

> 171 lines

**What it is.** Optional end-to-end encryption, and a threat model that is stated before the
code — correctly, because the threat model is the hard part.

### The threat, stated honestly

A LightBeam transfer is visible to **any** camera that can see the screen, and the sender
cannot detect that camera. Without encryption, a bystander's phone can record the file, and a
screen recording of the sender captures the whole transfer. The network isolation is real
(there is no path between the devices) but it provides **no confidentiality whatsoever** —
that sentence is in the header because it is the single most misunderstood property of
screen-to-camera transfer, and the reference product says the same thing on its own site.

### The design choice that matters

**The key is not in the QR stream.** The receiver must obtain the passphrase out of band —
typed, spoken, or sent over a messenger. Embedding the key in the manifest, which is displayed
on the same screen as the data, would look reassuring and provide no protection at all. This
is the kind of decision that is easy to get wrong while believing you have done something, so
it is written down where the next person will read it.

### The construction


| Choice | Why |
| --- | --- |
| XChaCha20-Poly1305 | 192-bit nonce, so a random nonce per transfer has negligible collision probability with no counter state to maintain. No AES-NI timing concerns. Pure JS in `@noble/ciphers`, so Chromium, Firefox, Safari, and Node behave identically. |
| scrypt (N = 2¹⁵, r = 8, p = 1) | Memory-hard, unlike PBKDF2. ~32 MB and ~300 ms on a 2023-era mid-range phone: enough to make offline guessing of a 6+ word passphrase expensive, still fast enough that the user does not think the app has hung. |
| **AEAD over the whole payload, not per block** | The fountain layer reorders and drops blocks. Per-block AEAD would turn every lost frame into a decryption failure and — far worse — create a nonce-reuse hazard. One ciphertext, one nonce, one tag is both simpler and safer. |
| Manifest as associated data | Tampering with the filename, sizes, codec or KDF parameters invalidates the transfer. The value is computed by `manifestAssociatedData()` in `protocol/manifest.ts` — see the warning below. |

**The associated-data warning.** There are three places that could construct this byte string
(manifest, sender, receiver) and originally there were three *copies* of the code — and the
exported one wrongly included the `sha` field. `sha` is computed over the **ciphertext**, so it
cannot be part of the data authenticated *over the plaintext*: a receiver built from the
exported helper would have derived different associated data and produced undecryptable
transfers, with no diagnostic that pointed at the cause. Both sides now call
`manifestAssociatedData(fields)` from `protocol/manifest.ts`, and that is the only permitted
construction site.

### The functions

- **`deriveKey(passphrase, salt, params)`** — `NFKC`-normalises the passphrase before encoding
  it. Without that, a passphrase typed with a composed `é` on one device and a decomposed
  `e` + combining accent on another produces different keys from "the same" secret. Rejects an
  empty passphrase and a wrong-length salt rather than silently deriving something weak.
- **`encryptPayload(payload, passphrase, associatedData, salt?, nonce?, params?)`** — salt and
  nonce are optional so tests can pin them (deterministic vectors); in production they come
  from the platform CSPRNG. Returns the sealed ciphertext (with the 16-byte Poly1305 tag
  appended), the salt, the nonce, the KDF parameters, and a SHA-256 of the ciphertext.
- **`decryptPayload(...)`** — throws on a wrong passphrase or modified ciphertext/AAD. That
  hard failure is a feature: the UI can say "wrong passphrase" **with certainty** instead of
  showing the user garbage bytes. The sender's screen is the only channel, so "it decrypted
  but is nonsense" is a state the user must never see.
- **`FAST_KDF`** — `N = 2¹²` for constrained devices. Selecting it is a deliberate, *visible*
  downgrade: the UI says "reduced-strength key derivation" rather than silently weakening a
  file. The parameters travel in the manifest, so an old receiver still works with a new
  sender's choice.
- **`passphraseFingerprint(passphrase, salt)`** — the first 4 bytes of
  `SHA-256("lightbeam-fingerprint" ‖ salt ‖ key)`, rendered as `4F2A-91C7`. Two people can
  verify out of band that they typed the same secret *before* a multi-minute optical transfer
  starts. Same idea as Signal's safety numbers, reduced to what fits on screen next to a QR
  code. The domain-separation prefix means this digest can never collide with any other use of
  the key. **The fingerprint is uppercase hex** — an early test asserted a base32 alphabet and
  was wrong.
- **`parseFingerprint`** — strips anything that is not a hex digit, so a user pasting
  `4F2A 91C7` or `4f2a-91c7` still matches. It is used by tests today.

**A local `randomBytes`, deliberately.** This file does not import the one from `util/bytes.ts`;
it has its own three-line CSPRNG helper, with a comment giving the reason (the crypto layer
should not be coupled to a utility's signature). It **throws** when no CSPRNG exists rather
than falling back to `Math.random()`: silently weak randomness in a key or nonce is worse than
a crash, and the mobile app installs a CSPRNG shim before anything here can run.

**Every line**

```ts
  1 │ /**
  2 │  * aead.ts - optional end-to-end encryption for LightBeam transfers.
  3 │  *
  4 │  * THREAT MODEL (this is the important part)
  5 │  * -----------------------------------------
  6 │  * A LightBeam transfer is visible to *any* camera that can see the screen, and
  7 │  * the sender cannot detect that camera. Without encryption:
  8 │  *   - a bystander's phone can record your file,
  9 │  *   - a screen recording of the sender captures the whole transfer.
 10 │  * Note that the *network isolation* is real (there is no path between the
 11 │  * devices) but it provides no confidentiality at all.
 12 │  *
 13 │  * So encryption is offered, with a deliberate design choice:
 14 │  *
 15 │  *   The key is NOT in the QR stream. The receiver must be given the passphrase
 16 │  *   out of band (typed, spoken, or sent over a messenger). Embedding the key in
 17 │  *   the manifest - which is displayed on the same screen as the data - would
 18 │  *   look reassuring and provide no protection whatsoever.
 19 │  *
 20 │  * CONSTRUCTION
 21 │  * ------------
 22 │  *   passphrase --scrypt--> 32-byte key
 23 │  *   key + 24-byte random nonce --XChaCha20-Poly1305--> AEAD over the whole payload
 24 │  *
 25 │  * Why these primitives:
 26 │  *   - XChaCha20-Poly1305 (`@noble/ciphers`): 192-bit nonce, so a random nonce per
 27 │  *     transfer has negligible collision probability with no counter state; no
 28 │  *     AES-NI/timing-attack concerns; pure JS, so identical behaviour across Chromium,
 29 │  *     V8 and Node.
 30 │  *   - scrypt (`@noble/hashes`): memory-hard, unlike PBKDF2. N = 2^15, r = 8,
 31 │  *     p = 1 costs about 32 MB and ~300 ms on a mid-range phone - enough to make
 32 │  *     offline guessing of a 6+ word passphrase expensive while staying usable.
 33 │  *   - AEAD over the whole payload (not per-block): the fountain layer reorders
 34 │  *     and drops blocks, so per-block AEAD would turn every lost frame into a
 35 │  *     decryption failure and - worse - a nonce-reuse hazard. One ciphertext, one
 36 │  *     nonce, one tag is both simpler and safer.
 37 │  *
 38 │  * The AEAD covers the manifest as associated data, so tampering with the
 39 │  * filename, the sizes or the codec fields invalidates the transfer.
 40 │  */
 41 │ 
 42 │ import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
 43 │ import { scrypt } from '@noble/hashes/scrypt.js';
 44 │ import { sha256 } from '@noble/hashes/sha2.js';
 45 │ import { concatBytes, fromHex, toHex } from '../util/bytes.js';
 46 │ 
 47 │ export const KEY_BYTES = 32;
 48 │ export const NONCE_BYTES = 24;
 49 │ export const SALT_BYTES = 16;
 50 │ export const TAG_BYTES = 16;
 51 │ 
 52 │ /** scrypt cost parameters. Documented in the manifest so old receivers still work. */
 53 │ export interface KdfParams {
 54 │   /** CPU/memory cost: 2^15 = 32768. */
 55 │   N: number;
 56 │   /** Block size: 8. */
 57 │   r: number;
 58 │   /** Parallelism: 1. */
 59 │   p: number;
 60 │ }
 61 │ 
 62 │ /** Default parameters: ~32 MB and ~0.3 s on a 2023-era mid-range phone. */
 63 │ export const DEFAULT_KDF: KdfParams = { N: 1 << 15, r: 8, p: 1 };
 64 │ 
 65 │ /**
 66 │  * Lower-cost parameters for constrained devices (older phones, smart TVs).
 67 │  * Selecting these is a deliberate, visible downgrade: the UI says
 68 │  * "reduced-strength key derivation" rather than silently weakening the file.
 69 │  */
 70 │ export const FAST_KDF: KdfParams = { N: 1 << 12, r: 8, p: 1 };
 71 │ 
 72 │ /** Derive the 32-byte key from a passphrase and salt. */
 73 │ export function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Uint8Array {
 74 │   if (passphrase.length === 0) throw new RangeError('Passphrase must not be empty');
 75 │   if (salt.length !== SALT_BYTES) throw new RangeError(`Salt must be ${SALT_BYTES} bytes`);
 76 │   return scrypt(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
 77 │     N: params.N,
 78 │     r: params.r,
 79 │     p: params.p,
 80 │     dkLen: KEY_BYTES,
 81 │   });
 82 │ }
 83 │ 
 84 │ export interface EncryptedPayload {
 85 │   /** Ciphertext followed by the 16-byte Poly1305 tag. */
 86 │   ciphertext: Uint8Array;
 87 │   nonce: Uint8Array;
 88 │   salt: Uint8Array;
 89 │   params: KdfParams;
 90 │   /** SHA-256 of the ciphertext (what the transfer integrity check covers). */
 91 │   checksum: Uint8Array;
 92 │ }
 93 │ 
 94 │ /**
 95 │  * Encrypt a payload with a passphrase.
 96 │  *
 97 │  * @param payload        plaintext (already compressed if the caller wants)
 98 │  * @param passphrase     user-supplied secret, transferred out of band
 99 │  * @param associatedData extra data bound to the ciphertext (the manifest)
100 │  */
101 │ export function encryptPayload(
102 │   payload: Uint8Array,
103 │   passphrase: string,
104 │   associatedData: Uint8Array = new Uint8Array(0),
105 │   salt?: Uint8Array,
106 │   nonce?: Uint8Array,
107 │   params: KdfParams = DEFAULT_KDF,
108 │ ): EncryptedPayload {
109 │   const saltBytes = salt ?? randomBytes(SALT_BYTES);
110 │   const nonceBytes = nonce ?? randomBytes(NONCE_BYTES);
111 │   const key = deriveKey(passphrase, saltBytes, params);
112 │   const cipher = xchacha20poly1305(key, nonceBytes, associatedData);
113 │   const sealed = cipher.encrypt(payload);
114 │   return {
115 │     ciphertext: sealed,
116 │     nonce: nonceBytes,
117 │     salt: saltBytes,
118 │     params,
119 │     checksum: sha256(sealed),
120 │   };
121 │ }
122 │ 
123 │ /**
124 │  * Decrypt a payload. Throws if the passphrase is wrong or the ciphertext or
125 │  * associated data was modified - the Poly1305 tag makes this a hard failure,
126 │  * which is exactly what we want: the UI can say "wrong passphrase" with
127 │  * certainty instead of showing the user garbage bytes.
128 │  */
129 │ export function decryptPayload(
130 │   ciphertext: Uint8Array,
131 │   passphrase: string,
132 │   salt: Uint8Array,
133 │   nonce: Uint8Array,
134 │   associatedData: Uint8Array = new Uint8Array(0),
135 │   params: KdfParams = DEFAULT_KDF,
136 │ ): Uint8Array {
137 │   const key = deriveKey(passphrase, salt, params);
138 │   const cipher = xchacha20poly1305(key, nonce, associatedData);
139 │   return cipher.decrypt(ciphertext);
140 │ }
141 │ 
142 │ /**
143 │  * Short, human-comparable fingerprint of a passphrase + salt.
144 │  *
145 │  * Purpose: let two people verify out of band that they typed the same secret
146 │  * ("the sender's screen says 4F2A-91C7; your phone says 4F2A-91C7") before a
147 │  * multi-minute optical transfer starts. This is the same idea as the safety
148 │  * numbers in Signal, reduced to what fits on a screen next to a QR code.
149 │  */
150 │ export function passphraseFingerprint(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): string {
151 │   const key = deriveKey(passphrase, salt, params);
152 │   const digest = sha256(concatBytes(new TextEncoder().encode('lightbeam-fingerprint'), salt, key));
153 │   return toHex(digest.subarray(0, 4)).toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');
154 │ }
155 │ 
156 │ /** Parse a hex fingerprint back to bytes (used by tests). */
157 │ export function parseFingerprint(text: string): Uint8Array {
158 │   return fromHex(text.replace(/[^0-9a-fA-F]/g, ''));
159 │ }
160 │ 
161 │ // Local CSPRNG helper (kept here so crypto/ has no dependency on util/bytes'
162 │ // randomBytes signature changes).
163 │ function randomBytes(length: number): Uint8Array {
164 │   const out = new Uint8Array(length);
165 │   const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
166 │   if (!cryptoObj?.getRandomValues) {
167 │     throw new Error('Encryption requires a platform CSPRNG (crypto.getRandomValues)');
168 │   }
169 │   cryptoObj.getRandomValues(out);
170 │   return out;
171 │ }
```

---

## `packages/core/src/crypto/integrity.ts`

> 90 lines

**What it is.** The payload verification layer: two independent checks, deliberately with
different roles.

1. **SHA-256 over the transmitted payload**, compared against the value in the manifest. This
   is the *authoritative* check — a 2⁻²⁵⁶ false-accept probability, and crucially it also
   catches a bug in our own fountain decoder (two frames whose seeds coincide after a loss, a
   wrongly derived neighbour set, a masked block that never got unmasked).
2. **CRC-32**, also carried in the manifest, purely for user experience: while a transfer is
   running, the receiver can check the *partially* received payload and tell the user honestly
   whether what it has so far is consistent, rather than "looks like it might be working".

**What is deliberately not used**, and why — this is the part of the header comment worth
reading twice:

- **MD5 and SHA-1** — collision-broken. For a file-integrity check where an attacker controls
  the input, a collision is exactly the attack: a corrupted payload that hashes to the claimed
  digest.
- **A length check alone** — cannot detect a single flipped bit. It is the most tempting
  "optimisation" here and the one that would quietly make corruption invisible.
- **A second SHA-256 truncated to 32 bits** — would be no cheaper than the CRC and weaker
  than the CRC-32's design for burst errors.

**`hashPayload` / `hashHex` / `shortHash`.** SHA-256 via `@noble/hashes`, with a hex form for
the manifest and a 64-bit prefix (`shortHash`) for the UI. `shortHash` is *not* used for
verification, only for display: the About screen and the diagnostics panel show a short hash
so a user can tell two transfers apart at a glance. Note the import — `sha256` and
`sha256 as sha256Fn` — which is a small wart: the same function imported twice under two names
so that two code paths read naturally. It is harmless, and it is the kind of thing worth
fixing if you are already in the file.

**`verifyPayload(payload, expectedSha256Hex, expectedCrc32?)`** returns an
`IntegrityReport` rather than a boolean, and the report carries **both** computed and expected
values for both checksums. The receiver's failure screen prints them, and a hash mismatch that
shows `expected` and `actual` side by side is the difference between "the transfer failed"
and "the transfer failed *in a way I can characterise*". Note that:

- The comparison uses `bytesEqual` from `util/bytes.ts`, which does not exit on the first
  mismatched byte — constant-time-ish comparison of tags is cheap insurance and costs nothing
  here.
- `fromHexSafe` returns an **empty array** for a malformed hex string rather than throwing, so
  a corrupt manifest fails the digest comparison (`bytesEqual` with a length mismatch) instead
  of crashing the receiver inside the integrity check. This is the right failure direction:
  the user gets "verification failed", not an exception trace.
- `crcOk` defaults to `true` when the manifest carries no CRC-32 (older senders), so an absent
  optional check never blocks a transfer.

**`partialConfidence(knownBytes, totalBytes)`** — clamped to [0, 1], and returns 1 for a
degenerate zero-length payload. It feeds the progress UI's "verified so far" figure during a
stalled transfer. It is a *display* quantity and is never used to decide whether to accept a
file; the SHA-256 check does that, once, at the end.

**Every line**

```ts
 1 │ /**
 2 │  * integrity.ts - payload verification.
 3 │  *
 4 │  * Two independent checks are performed before a received payload is handed to
 5 │  * the user:
 6 │  *
 7 │  *   1. SHA-256 over the transmitted payload, compared against the value carried
 8 │  *      in the manifest. This is the authoritative check: 2^-256 chance of a false
 9 │  *      accept, and it also protects against a bug in our own fountain decoder
10 │  *      (e.g. two frames whose seeds collide after a loss).
11 │  *
12 │  *   2. A CRC-32, also carried in the manifest. It exists purely for user
13 │  *      experience: when the transfer is running, the receiver can check
14 │  *      partially-received payloads and tell the user honestly whether what it has
15 │  *      so far is consistent, instead of "looks like it might be working".
16 │  *
17 │  * Deliberately NOT used: MD5/SHA-1 (collision-broken) and a plain length check
18 │  * (a length check cannot detect a single flipped bit).
19 │  */
20 │ 
21 │ import { sha256, sha256 as sha256Fn } from '@noble/hashes/sha2.js';
22 │ import { crc32u } from './crc.js';
23 │ import { bytesEqual, toHex } from '../util/bytes.js';
24 │ 
25 │ /** SHA-256 digest of a byte array. */
26 │ export function hashPayload(bytes: Uint8Array): Uint8Array {
27 │   return sha256(bytes);
28 │ }
29 │ 
30 │ export function hashHex(bytes: Uint8Array): string {
31 │   return toHex(sha256Fn(bytes));
32 │ }
33 │ 
34 │ /** SHA-256 as a base64url-ish short token for the UI (first 8 bytes). */
35 │ export function shortHash(bytes: Uint8Array): string {
36 │   return toHex(sha256(bytes).subarray(0, 8));
37 │ }
38 │ 
39 │ export interface IntegrityReport {
40 │   ok: boolean;
41 │   /** What the manifest claimed, hex. */
42 │   expectedSha256: string;
43 │   /** What we computed, hex. */
44 │   actualSha256: string;
45 │   expectedCrc32: number;
46 │   actualCrc32: number;
47 │   bytes: number;
48 │ }
49 │ 
50 │ /** Full integrity check of a reassembled payload. */
51 │ export function verifyPayload(
52 │   payload: Uint8Array,
53 │   expectedSha256Hex: string,
54 │   expectedCrc32?: number,
55 │ ): IntegrityReport {
56 │   const digest = sha256(payload);
57 │   const actualSha256 = toHex(digest);
58 │   const actualCrc32 = crc32u(payload);
59 │   const digestOk = bytesEqual(digest, fromHexSafe(expectedSha256Hex));
60 │   const crcOk = expectedCrc32 === undefined ? true : expectedCrc32 === actualCrc32;
61 │   return {
62 │     ok: digestOk && crcOk,
63 │     expectedSha256: expectedSha256Hex,
64 │     actualSha256,
65 │     expectedCrc32: expectedCrc32 ?? actualCrc32,
66 │     actualCrc32,
67 │     bytes: payload.length,
68 │   };
69 │ }
70 │ 
71 │ function fromHexSafe(hex: string): Uint8Array {
72 │   const clean = hex.trim().toLowerCase();
73 │   if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return new Uint8Array(0);
74 │   const out = new Uint8Array(clean.length / 2);
75 │   for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
76 │   return out;
77 │ }
78 │ 
79 │ /**
80 │  * Check whether the parts of a payload we have received so far are consistent.
81 │  *
82 │  * A fountain-coded payload can be "partially decodable": some source blocks are
83 │  * known verbatim, others are still unknown. This returns the fraction of the
84 │  * bytes we can vouch for, which is what the receiver's progress UI shows when it
85 │  * is waiting on a stalled transfer.
86 │  */
87 │ export function partialConfidence(knownBytes: number, totalBytes: number): number {
88 │   if (totalBytes <= 0) return 1;
89 │   return Math.max(0, Math.min(1, knownBytes / totalBytes));
90 │ }
```

---

## `packages/core/src/protocol/frame.ts`

> 246 lines

**What it is.** The on-screen frame format — 13 bytes of header and then a payload (an LT
block or a manifest fragment). One displayed QR symbol carries exactly one frame, and this
file defines both the shape and the parser that every receiver runs on every camera frame.

### The header, field by field


**Why a fixed-size header.** The length never changes, so the receiver knows how many payload
bytes follow before it parses anything, and — the consequence that actually matters — the
symbol geometry stays constant for the whole session. That lets both sides cache encoded
symbols, and it keeps the camera's autofocus from chasing size changes every frame. A
variable-length header would mean re-encoding every symbol from scratch and a focus hunt on
every frame boundary.

**Why big-endian.** It matches how QR byte mode stores text, so a hex dump of a captured frame
reads in the same left-to-right order as the field table above. Little-endian would have been
marginally faster on the devices we care about and would have made every debugging session
require a mental byte-swap.

**Why the session id is in every frame.** This is what makes multi-sender capture work: a
receiver pointed at a wall of screens, or at a café with three other transfers running, drops
foreign frames instead of poisoning its own decode. The receiver locks onto a session only
from a **manifest** frame — never from a data frame — which is why `parseFrameDetailed` reports
the type so prominently. (An earlier revision locked onto the first frame of any kind; a stray
QR code in the camera's view then captured the session, and the transfer never completed.)

**Why CRC-16 covers the header only.** The header is the dangerous part to get wrong: a
flipped bit there means the wrong session, or a seed that poisons the fountain decoder, or a
manifest fragment claimed as complete when it is not. The payload already has Reed–Solomon
protection from the QR symbol and a whole-payload SHA-256 at the end, so a per-frame payload
CRC would cost screen time for very little. It is a good example of layered integrity: cheap
checks on the hot path, authoritative checks at the end.

**Why there is no explicit block index.** The seed *is* the index: both sides derive the
neighbour set from it (`fountain/lt.ts`). That is where fountain coding earns its place on an
optical channel — a lost frame costs only time, and the metadata for a frame is one integer
instead of a list.

### `FrameFlag`

Four bits, and the interesting one is `Base32 = 1 << 3`. It says "the payload is Base32 text,
not raw bytes", and it is set by default because the native camera APIs return a *string* for
every symbol and mangle arbitrary bytes. It costs ~10% of throughput and buys universal
compatibility, including with third-party scanner apps. The flag travels in every frame so a
receiver honours whatever the sender chose — **and the sender must set it from the plan it
actually used**. A sender that hard-coded the flag would produce frames whose declared
encoding disagreed with their contents, and a receiver built to trust the flag would decode
every frame wrongly but plausibly; `wireFlags(plan)` in `transfer/sender.ts` exists to make
that impossible to get wrong.

`Encrypted` and `Compressed` describe the payload as a whole (not this symbol), `Reserved1` is
documented as reserved rather than left undocumented, and `None = 0` gives the "no flags" case
a name.

### Building and parsing

- **`dataFrameHeader` / `manifestFrameHeader`** build headers *without* payloads. That is not
  tidiness: a base32 frame is assembled as **two QR segments** (13 raw header bytes in byte
  mode, then the alphanumeric base32 text), which is measurably denser than pushing everything
  through byte mode — 5.5 bits per transmitted character instead of 8. A concatenated byte
  string would throw that away.
- **`manifestFrameHeader` and `encodeManifestFrame` throw** if the fragment index or count
  exceeds 16 bits, rather than truncating. A manifest with >65 535 fragments cannot exist (the
  manifest is a few kilobytes at most), so this is a programming-error guard, and a silent
  truncation there would look exactly like a session-id collision.
- **`parseFrameDetailed` returns `null` for anything that is not a LightBeam frame**, and never
  throws, because it runs on every camera frame — a random QR code or a misdecoded blurry
  symbol is the *normal* case, not an exceptional one. Validation is ordered cheapest-first:
  length, magic, version, type, then the CRC.
- **`headerValid === false` does not discard the frame.** The payload may still be intact, and
  a fountain decoder can often use it. The receiver counts such frames as "suspect" and only
  uses them when the strict path stalls — that policy lives in `transfer/receiver.ts`, and the
  split is deliberate: the protocol layer reports, the transfer layer decides.
- **`describeFrame`** produces one line per frame for the diagnostics log
  (`manifest 2/3 session=5f3a01c4 bytes=42`). Both the browser and the mobile diagnostics
  panels print these, and having one formatting function means a bug report's log is readable
  by whoever wrote the parser.

**Every line**

```ts
  1 │ /**
  2 │  * frame.ts - the on-screen frame format.
  3 │  *
  4 │  * One displayed QR symbol carries exactly one frame: a 13-byte header followed by
  5 │  * the payload (either an LT block or a manifest fragment).
  6 │  *
  7 │  *   offset  size  field
  8 │  *   ------  ----  -------------------------------------------------------------
  9 │  *    0       1    magic 0x4C ('L') - lets a receiver reject foreign QR codes
 10 │  *    1       1    protocol version (high nibble) | flags (low nibble)
 11 │  *    2       1    frame type: 0 = data block, 1 = manifest fragment
 12 │  *    3       4    session id (uint32, big-endian)
 13 │  *    7       4    data frames: LT frame seed (uint32, big-endian)
 14 │  *                 manifest frames: (fragment index << 16) | fragment count
 15 │  *   11       2    CRC-16/CCITT over header bytes 0..10
 16 │  *
 17 │  * Design notes
 18 │  * ------------
 19 │  * - FIXED SIZE HEADER. The header length never changes, so the receiver knows how
 20 │  *   many payload bytes follow before it parses anything, and the symbol geometry
 21 │  *   stays constant for the whole session - which lets both sides cache encoded
 22 │  *   symbols and keeps the camera's autofocus from chasing size changes.
 23 │  * - BIG-ENDIAN. Matches how QR byte-mode stores text, so a hex dump of a captured
 24 │  *   frame reads in the same order as the field list above.
 25 │  * - SESSION ID IN EVERY FRAME. This is what makes multi-sender capture work: a
 26 │  *   receiver pointed at a wall of screens drops frames from foreign sessions
 27 │  *   instead of corrupting its own decode.
 28 │  * - CRC-16 OVER THE HEADER ONLY. The header is the dangerous part to get wrong
 29 │  *   (a flipped bit there means the wrong session, or a seed that poisons the
 30 │  *   fountain decoder). The payload already has Reed-Solomon protection from the
 31 │  *   QR symbol and a whole-payload SHA-256 at the end, so a per-frame payload CRC
 32 │  *   would cost screen time for very little.
 33 │  * - NO EXPLICIT BLOCK INDEX. The seed *is* the index: both sides derive the
 34 │  *   neighbour set from it (fountain/lt.ts). That is where fountain coding earns
 35 │  *   its place on an optical channel - a lost frame costs only time.
 36 │  */
 37 │ 
 38 │ import { crc16 } from '../crypto/crc.js';
 39 │ import { concatBytes } from '../util/bytes.js';
 40 │ 
 41 │ export const FRAME_MAGIC = 0x4c; // 'L'
 42 │ export const PROTOCOL_VERSION = 1;
 43 │ /** magic + version/flags + type + sessionId + word + crc16 */
 44 │ export const FRAME_HEADER_BYTES = 13;
 45 │ 
 46 │ export const enum FrameType {
 47 │   Data = 0,
 48 │   Manifest = 1,
 49 │ }
 50 │ 
 51 │ export const enum FrameFlag {
 52 │   None = 0,
 53 │   /** Payload is encrypted (the manifest explains how to derive the key). */
 54 │   Encrypted = 1 << 0,
 55 │   /** Payload was compressed before transmission. */
 56 │   Compressed = 1 << 1,
 57 │   /** Padded/short last frame indicator (reserved for future use). */
 58 │   Reserved1 = 1 << 2,
 59 │   /**
 60 │    * The frame payload is Base32 text rather than raw bytes.
 61 │    *
 62 │    * Set by default because native camera APIs return a *string* for every symbol
 63 │    * and mangle arbitrary bytes (see util/base32.ts). Costs ~10% of throughput and
 64 │    * buys universal compatibility, including with third-party scanner apps.
 65 │    */
 66 │   Base32 = 1 << 3,
 67 │ }
 68 │ 
 69 │ export interface FrameHeader {
 70 │   version: number;
 71 │   flags: number;
 72 │   type: FrameType;
 73 │   sessionId: number;
 74 │   seed: number;
 75 │   /** Manifest frames only. */
 76 │   fragmentIndex: number;
 77 │   fragmentCount: number;
 78 │ }
 79 │ 
 80 │ export interface ParsedFrame extends FrameHeader {
 81 │   /** Payload bytes following the header. */
 82 │   payload: Uint8Array;
 83 │ }
 84 │ 
 85 │ function writeHeader(options: {
 86 │   type: FrameType;
 87 │   sessionId: number;
 88 │   word: number;
 89 │   flags: number;
 90 │ }): Uint8Array {
 91 │   const header = new Uint8Array(FRAME_HEADER_BYTES);
 92 │   header[0] = FRAME_MAGIC;
 93 │   header[1] = ((PROTOCOL_VERSION & 0x0f) << 4) | (options.flags & 0x0f);
 94 │   header[2] = options.type & 0xff;
 95 │   header[3] = (options.sessionId >>> 24) & 0xff;
 96 │   header[4] = (options.sessionId >>> 16) & 0xff;
 97 │   header[5] = (options.sessionId >>> 8) & 0xff;
 98 │   header[6] = options.sessionId & 0xff;
 99 │   header[7] = (options.word >>> 24) & 0xff;
100 │   header[8] = (options.word >>> 16) & 0xff;
101 │   header[9] = (options.word >>> 8) & 0xff;
102 │   header[10] = options.word & 0xff;
103 │   const checksum = crc16(header.subarray(0, 11));
104 │   header[11] = (checksum >>> 8) & 0xff;
105 │   header[12] = checksum & 0xff;
106 │   return header;
107 │ }
108 │ 
109 │ /**
110 │  * Build just the 13-byte header of a data frame.
111 │  *
112 │  * Exposed separately because a base32 frame is built as "header bytes + base32
113 │  * text" (two QR segments), not as one concatenated byte string.
114 │  */
115 │ export function dataFrameHeader(options: { sessionId: number; seed: number; flags?: number }): Uint8Array {
116 │   return writeHeader({
117 │     type: FrameType.Data,
118 │     sessionId: options.sessionId,
119 │     word: options.seed,
120 │     flags: options.flags ?? FrameFlag.None,
121 │   });
122 │ }
123 │ 
124 │ /** Build just the 13-byte header of a manifest frame. */
125 │ export function manifestFrameHeader(options: {
126 │   sessionId: number;
127 │   fragmentIndex: number;
128 │   fragmentCount: number;
129 │   flags?: number;
130 │ }): Uint8Array {
131 │   if (options.fragmentIndex > 0xffff || options.fragmentCount > 0xffff) {
132 │     throw new RangeError('Manifest fragment index/count must fit in 16 bits');
133 │   }
134 │   return writeHeader({
135 │     type: FrameType.Manifest,
136 │     sessionId: options.sessionId,
137 │     word: ((options.fragmentIndex << 16) | options.fragmentCount) >>> 0,
138 │     flags: options.flags ?? FrameFlag.None,
139 │   });
140 │ }
141 │ 
142 │ /** Serialise a data frame: header + one LT block. */
143 │ export function encodeDataFrame(options: {
144 │   sessionId: number;
145 │   seed: number;
146 │   payload: Uint8Array;
147 │   flags?: number;
148 │ }): Uint8Array {
149 │   const header = writeHeader({
150 │     type: FrameType.Data,
151 │     sessionId: options.sessionId,
152 │     word: options.seed,
153 │     flags: options.flags ?? FrameFlag.None,
154 │   });
155 │   return concatBytes(header, options.payload);
156 │ }
157 │ 
158 │ /** Serialise a manifest fragment frame. */
159 │ export function encodeManifestFrame(options: {
160 │   sessionId: number;
161 │   fragmentIndex: number;
162 │   fragmentCount: number;
163 │   payload: Uint8Array;
164 │   flags?: number;
165 │ }): Uint8Array {
166 │   if (options.fragmentIndex > 0xffff || options.fragmentCount > 0xffff) {
167 │     throw new RangeError('Manifest fragment index/count must fit in 16 bits');
168 │   }
169 │   const word = ((options.fragmentIndex << 16) | options.fragmentCount) >>> 0;
170 │   const header = writeHeader({
171 │     type: FrameType.Manifest,
172 │     sessionId: options.sessionId,
173 │     word,
174 │     flags: options.flags ?? FrameFlag.None,
175 │   });
176 │   return concatBytes(header, options.payload);
177 │ }
178 │ 
179 │ export interface ParseResult {
180 │   frame: ParsedFrame;
181 │   /** False when the header CRC did not match (a corrupt or foreign symbol). */
182 │   headerValid: boolean;
183 │ }
184 │ 
185 │ /**
186 │  * Parse a decoded symbol payload into a frame.
187 │  *
188 │  * Returns null (never throws) for anything that is not a LightBeam frame, because
189 │  * this runs on every camera frame and non-LightBeam input (a random QR code, a
190 │  * misdecoded blurry symbol) is the normal case.
191 │  *
192 │  * `headerValid === false` does not discard the frame: the payload may still be
193 │  * intact, and a fountain decoder can often use it. Callers that care about
194 │  * strictness can drop those (the default receiver policy counts them as
195 │  * "suspect" and only uses them when the strict path stalls).
196 │  */
197 │ export function parseFrameDetailed(bytes: Uint8Array): ParseResult | null {
198 │   if (bytes.length < FRAME_HEADER_BYTES) return null;
199 │   if (bytes[0] !== FRAME_MAGIC) return null;
200 │ 
201 │   const version = bytes[1] >>> 4;
202 │   const flags = bytes[1] & 0x0f;
203 │   if (version !== PROTOCOL_VERSION) return null;
204 │ 
205 │   const type = bytes[2] as FrameType;
206 │   if (type !== FrameType.Data && type !== FrameType.Manifest) return null;
207 │ 
208 │   const expectedCrc = ((bytes[11] << 8) | bytes[12]) & 0xffff;
209 │   const actualCrc = crc16(bytes.subarray(0, 11));
210 │   const headerValid = expectedCrc === actualCrc;
211 │ 
212 │   const sessionId = ((bytes[3] << 24) | (bytes[4] << 16) | (bytes[5] << 8) | bytes[6]) >>> 0;
213 │   const word = ((bytes[7] << 24) | (bytes[8] << 16) | (bytes[9] << 8) | bytes[10]) >>> 0;
214 │   const payload = bytes.subarray(FRAME_HEADER_BYTES);
215 │ 
216 │   const base = { version, flags, type, sessionId, payload, headerValid };
217 │   if (type === FrameType.Manifest) {
218 │     return {
219 │       frame: {
220 │         ...base,
221 │         seed: 0,
222 │         fragmentIndex: (word >>> 16) & 0xffff,
223 │         fragmentCount: word & 0xffff,
224 │       },
225 │       headerValid,
226 │     };
227 │   }
228 │   return {
229 │     frame: { ...base, seed: word, fragmentIndex: 0, fragmentCount: 0 },
230 │     headerValid,
231 │   };
232 │ }
233 │ 
234 │ /** Convenience wrapper: the frame, or null if it is not a LightBeam frame. */
235 │ export function parseFrame(bytes: Uint8Array): ParsedFrame | null {
236 │   return parseFrameDetailed(bytes)?.frame ?? null;
237 │ }
238 │ 
239 │ /** Compact one-line description of a frame, for the diagnostics log. */
240 │ export function describeFrame(frame: ParsedFrame): string {
241 │   const id = frame.sessionId.toString(16).padStart(8, '0');
242 │   if (frame.type === FrameType.Manifest) {
243 │     return `manifest ${frame.fragmentIndex + 1}/${frame.fragmentCount} session=${id} bytes=${frame.payload.length}`;
244 │   }
245 │   return `data seed=${frame.seed} session=${id} bytes=${frame.payload.length} flags=${frame.flags}`;
246 │ }
```

---

## `packages/core/src/protocol/manifest.ts`

> 351 lines

**What it is.** The session manifest — everything a receiver must know before a data frame means
anything — and the machinery that gets it across a channel where frames arrive out of order,
in fragments, with duplicates, and in the middle of a session.

**What it carries.** Session id and a display name/type; the payload length, block size and
block count (so the receiver knows K); the codec and whether the payload is encrypted; the KDF
salt/parameters and the AEAD nonce if it is; SHA-256 and CRC-32 of the transmitted payload; and
the *original* length and name, so the receiver can restore them (`olen` exists because the
payload on the wire is compressed and encrypted, and the user must get back the file they
were sent).

**The honesty note in the header, which is the most important paragraph in the file:** the
manifest is **not authenticated by itself**. An attacker who can replace the manifest — by
holding up their own screen — can substitute their own file. When encryption is enabled the
AEAD's associated data binds the manifest to the ciphertext, so the actual defence is: verify
the passphrase fingerprint out of band (both screens show a 4+4 hex fingerprint), and for
unencrypted transfers, trust the physical proximity that made the transfer possible in the
first place. That is a real limitation of screen-to-camera transfer, stated rather than
buried.

**How it travels.** As `FrameType.Manifest` frames, fragmented, and **repeated throughout the
stream** (see `MANIFEST_REPEAT` in `transfer/sender.ts`). A receiver that starts watching in
the middle of a transfer is up to speed within one repeat interval — about two seconds —
instead of being permanently lost. This is the single biggest usability decision in the
protocol: the alternative, a manifest only at the start, means a receiver that opens the camera
late can never join.

**`validateManifest` — bounds first, at the boundary.** Every field is checked here rather than
at the point of use, because the manifest arrives in fragments from an untrusted optical
channel. The two bounds that matter most are `bs <= 1 << 20` and `k <= 1_000_000`: without
them, a garbled fragment that decodes to `k = 4 million` makes the receiver allocate gigabytes
and die. Note also the `sha` shape check (`/^[0-9a-f]{64}$/i`) and that encryption fields are
required *only* when `enc` says they should be — a manifest must be self-consistent, and a
half-encrypted manifest is rejected rather than half-processed.

**`manifestAssociatedData(fields)` — one construction site, and the bug that proved why.**


So `sha` cannot be authenticated by the AEAD: it is the *post-decryption* integrity check, and
it covers the whole payload anyway. The original code had three copies of this construction
(here, in `sender.ts`, in `receiver.ts`) and the **exported** copy wrongly included `sha`,
while the internal two did not. A third-party receiver built from the exported helper would
have derived different associated data and produced undecryptable transfers — with no
diagnostic pointing at the cause, because decryption failure looks like "wrong passphrase".
Both sides now call this one function. **Never re-introduce a local copy.**

The `AssociatedDataFields` interface is a *structural subset* of `Manifest` on purpose: callers
may pass a real manifest or the handful of fields they already have, which matters on the send
path where encryption happens before the manifest object exists.

**`splitManifest` and the 6-byte fragment header.**


The reasoning is in the comment and it is worth restating: the CRC is what lets a receiver
distinguish **"this fragment arrived garbled"** from **"this fragment has not arrived yet"**.
Without it, one corrupt fragment stalls an otherwise perfect transfer forever — the assembler
would wait for a fragment that was already received and thrown away. Two bytes each for index
and count (rather than one) allow manifests above 255 fragments, which a long filename plus a
note can reach, and keeps the overhead at 4 bytes per fragment.

**`ManifestAssembler`.** A small state machine that accepts fragments in any order with
duplicates:

- Validates the 6-byte header, rejects `count === 0`, `index >= count`, and any fragment whose
  CRC does not match — returning `null` rather than throwing, because a garbled fragment is a
  routine event on this channel.
- **Adopts the count from the first valid fragment**, and if a later fragment disagrees
  (`this.expected !== count`), it **starts over** with the new layout. That handles a receiver
  that catches the tail of one session's manifest and then the head of the next, or a sender
  that was restarted mid-scan.
- Counts *distinct* fragments, so duplicates do not advance `progress`.
- On completion, concatenates in index order and calls `deserializeManifest` — which validates —
  then resets itself, so a repeated manifest can be re-assembled later in the same session
  (which is exactly what happens, since manifests repeat).
- `progress` and `complete` exist for the UI and for the receiver's phase machine.

**`manifestFragmentSize(framePayloadBytes)`** returns its argument: manifest frames get the same
payload budget as data frames. Keeping it as a named function documents that fact and gives one
place to change if the two ever need to differ.

**The re-export line at the bottom** (`FRAME_HEADER_BYTES`, `FrameType`, base64 helpers) exists so
callers do not need two imports. It is a small convenience with a small cost: this module is
reachable from `index.ts`, so these names appear in the public API twice. Harmless, and the
comment says why it is there.

**Every line**

```ts
  1 │ /**
  2 │  * manifest.ts - the session manifest and how it reaches the receiver.
  3 │  *
  4 │  * The manifest is the metadata a receiver needs before it can do anything useful
  5 │  * with data frames:
  6 │  *
  7 │  *   - session id and a human-readable name/type for the file,
  8 │  *   - the payload length, block size and block count (so it knows what K is),
  9 │  *   - the codec used (store/deflate) and whether the payload is encrypted,
 10 │  *   - the KDF salt/parameters and the AEAD nonce if it is,
 11 │  *   - the SHA-256 and CRC-32 of the transmitted payload (integrity),
 12 │  *   - the original byte length and name (so the receiver can restore them).
 13 │  *
 14 │  * It travels as one or more MANIFEST frames repeated throughout the stream, so a
 15 │  * receiver that starts watching in the middle of a transfer is up to speed within
 16 │  * one repeat interval (about 2 seconds) instead of being permanently lost.
 17 │  *
 18 │  * IT IS NOT AUTHENTICATED BY ITSELF. An attacker who can replace the manifest
 19 │  * (e.g. by holding up their own screen) can substitute their own file. When
 20 │  * encryption is enabled the AEAD's associated data binds the manifest to the
 21 │  * ciphertext, so the real defence is: verify the passphrase fingerprint out of
 22 │  * band (the UI shows a 4+4 hex fingerprint on both screens), and for unencrypted
 23 │  * transfers, trust the physical proximity that made the transfer possible at all.
 24 │  */
 25 │ 
 26 │ import { crc16 } from '../crypto/crc.js';
 27 │ import { utf8Decode, utf8Encode, fromBase64Url, toBase64Url, fromHex, toHex } from '../util/bytes.js';
 28 │ import { FRAME_HEADER_BYTES, FrameType } from './frame.js';
 29 │ import type { Codec } from '../transfer/compress.js';
 30 │ 
 31 │ export const MANIFEST_VERSION = 1;
 32 │ 
 33 │ export interface Manifest {
 34 │   /** Manifest schema version (for forward/backward compatibility). */
 35 │   v: number;
 36 │   /** Session id, must match the frame headers. */
 37 │   sid: number;
 38 │   /** Display name of the payload ("holiday.mp4", "clipboard.txt"). */
 39 │   name: string;
 40 │   /** MIME type, best effort. */
 41 │   mime: string;
 42 │   /** Length of the transmitted payload in bytes (after compress/encrypt). */
 43 │   len: number;
 44 │   /** Length of the original payload before compression/encryption. */
 45 │   olen: number;
 46 │   /** Bytes per LT block. */
 47 │   bs: number;
 48 │   /** Number of LT blocks (K). */
 49 │   k: number;
 50 │   /** Compression codec. */
 51 │   codec: Codec;
 52 │   /** 'none' or the AEAD algorithm identifier. */
 53 │   enc: 'none' | 'xchacha20poly1305';
 54 │   /** KDF salt (base64url) when encrypted. */
 55 │   salt?: string;
 56 │   /** KDF parameters when encrypted. */
 57 │   kdf?: { N: number; r: number; p: number };
 58 │   /** AEAD nonce (base64url) when encrypted. */
 59 │   nonce?: string;
 60 │   /** SHA-256 of the transmitted payload, hex. */
 61 │   sha: string;
 62 │   /** CRC-32 of the transmitted payload (fast partial-progress check). */
 63 │   crc: number;
 64 │   /** Wall-clock creation time (epoch ms) - for ordering and display only. */
 65 │   t: number;
 66 │   /** Free-form sender hints ("compressed 78%", "8 mm left"). */
 67 │   note?: string;
 68 │ }
 69 │ 
 70 │ export interface ManifestOptions {
 71 │   sessionId: number;
 72 │   name: string;
 73 │   mime: string;
 74 │   payloadLength: number;
 75 │   originalLength: number;
 76 │   blockSize: number;
 77 │   k: number;
 78 │   codec: Codec;
 79 │   encryption:
 80 │     | { mode: 'none' }
 81 │     | { mode: 'xchacha20poly1305'; salt: Uint8Array; nonce: Uint8Array; kdf: { N: number; r: number; p: number } };
 82 │   sha256Hex: string;
 83 │   crc32: number;
 84 │   note?: string;
 85 │   now?: number;
 86 │ }
 87 │ 
 88 │ /** Build a manifest object from sender-side facts. */
 89 │ export function buildManifest(options: ManifestOptions): Manifest {
 90 │   const manifest: Manifest = {
 91 │     v: MANIFEST_VERSION,
 92 │     sid: options.sessionId,
 93 │     name: options.name,
 94 │     mime: options.mime,
 95 │     len: options.payloadLength,
 96 │     olen: options.originalLength,
 97 │     bs: options.blockSize,
 98 │     k: options.k,
 99 │     codec: options.codec,
100 │     enc: options.encryption.mode,
101 │     sha: options.sha256Hex,
102 │     crc: options.crc32,
103 │     t: options.now ?? Date.now(),
104 │   };
105 │   if (options.encryption.mode === 'xchacha20poly1305') {
106 │     manifest.salt = toBase64Url(options.encryption.salt);
107 │     manifest.nonce = toBase64Url(options.encryption.nonce);
108 │     manifest.kdf = options.encryption.kdf;
109 │   }
110 │   if (options.note) manifest.note = options.note;
111 │   return manifest;
112 │ }
113 │ 
114 │ /** Serialise a manifest to the compact JSON that goes on the wire. */
115 │ export function serializeManifest(manifest: Manifest): Uint8Array {
116 │   return utf8Encode(JSON.stringify(manifest));
117 │ }
118 │ 
119 │ export function deserializeManifest(bytes: Uint8Array): Manifest {
120 │   const text = utf8Decode(bytes);
121 │   const parsed = JSON.parse(text) as Manifest;
122 │   return validateManifest(parsed);
123 │ }
124 │ 
125 │ /**
126 │  * Validate a decoded manifest.
127 │  *
128 │  * Every field is checked here rather than at the point of use, because the
129 │  * manifest arrives in fragments from an untrusted optical channel: a truncated or
130 │  * garbage fragment must fail loudly here instead of producing, say, a K of 4
131 │  * million that makes the receiver allocate gigabytes.
132 │  */
133 │ export function validateManifest(manifest: Manifest): Manifest {
134 │   const require = (condition: boolean, message: string): void => {
135 │     if (!condition) throw new RangeError(`Invalid manifest: ${message}`);
136 │   };
137 │   require(typeof manifest === 'object' && manifest !== null, 'not an object');
138 │   require(manifest.v === MANIFEST_VERSION, `unsupported version ${manifest.v}`);
139 │   require(Number.isInteger(manifest.sid), 'session id missing');
140 │   require(typeof manifest.name === 'string' && manifest.name.length > 0, 'name missing');
141 │   require(Number.isInteger(manifest.len) && manifest.len >= 0, 'length missing');
142 │   require(Number.isInteger(manifest.bs) && manifest.bs > 0 && manifest.bs <= 1 << 20, 'block size out of range');
143 │   require(Number.isInteger(manifest.k) && manifest.k > 0 && manifest.k <= 1_000_000, 'block count out of range');
144 │   require(manifest.codec === 'store' || manifest.codec === 'deflate', 'unknown codec');
145 │   require(manifest.enc === 'none' || manifest.enc === 'xchacha20poly1305', 'unknown encryption');
146 │   require(/^[0-9a-f]{64}$/i.test(manifest.sha ?? ''), 'bad payload checksum');
147 │   require(Number.isInteger(manifest.olen) && manifest.olen >= 0, 'original length missing');
148 │   if (manifest.enc === 'xchacha20poly1305') {
149 │     require(typeof manifest.salt === 'string' && manifest.salt.length >= 16, 'salt missing');
150 │     require(typeof manifest.nonce === 'string' && manifest.nonce.length >= 16, 'nonce missing');
151 │     require(manifest.kdf !== undefined && Number.isInteger(manifest.kdf.N), 'kdf parameters missing');
152 │   }
153 │   return manifest;
154 │ }
155 │ 
156 │ /** Associated data for the AEAD: the manifest's own identity fields. */
157 │ /**
158 │  * The fields the AEAD authenticates.
159 │  *
160 │  * A structural subset of Manifest, so callers can pass either a real manifest or
161 │  * the handful of fields they already know. That flexibility exists because of the
162 │  * order of operations on the sending side:
163 │  *
164 │  *   the associated data must be fixed BEFORE encryption, but the SHA-256 in the
165 │  *   manifest is computed OVER the ciphertext. So `sha` cannot be authenticated by
166 │  *   the AEAD - it is the integrity check that comes after decryption, and it covers
167 │  *   the whole payload anyway.
168 │  *
169 │  * `sha` is therefore deliberately absent here, and this is the ONE function that
170 │  * builds associated data. There used to be three copies (here, in sender.ts and in
171 │  * receiver.ts) and the exported one included `sha` while the other two did not -
172 │  * meaning a third-party receiver built against the exported helper would have
173 │  * produced undecryptable transfers. Nothing would have caught that until somebody
174 │  * tried to interoperate.
175 │  */
176 │ export interface AssociatedDataFields {
177 │   sid: number;
178 │   name: string;
179 │   mime: string;
180 │   len: number;
181 │   olen: number;
182 │   bs: number;
183 │   k: number;
184 │   codec: Codec;
185 │   enc: 'none' | 'xchacha20poly1305';
186 │ }
187 │ 
188 │ export function manifestAssociatedData(manifest: AssociatedDataFields): Uint8Array {
189 │   return utf8Encode(
190 │     JSON.stringify({
191 │       sid: manifest.sid,
192 │       name: manifest.name,
193 │       mime: manifest.mime,
194 │       len: manifest.len,
195 │       olen: manifest.olen,
196 │       bs: manifest.bs,
197 │       k: manifest.k,
198 │       codec: manifest.codec,
199 │       enc: manifest.enc,
200 │       // NB no `sha`: see the note on AssociatedDataFields above - it is computed
201 │       // over the ciphertext and therefore cannot be part of the associated data.
202 │     }),
203 │   );
204 │ }
205 │ 
206 │ /**
207 │  * Split a serialised manifest into fragments that each fit one frame.
208 │  *
209 │  * Each fragment carries a 2-byte index and a 2-byte checksum of its own so that a
210 │  * receiver can tell "I got fragment 2, but garbled" from "I have not seen
211 │  * fragment 2 yet" - without that, one corrupt fragment would stall the receiver
212 │  * forever on a stream that is otherwise perfect.
213 │  *
214 │  * Fragment header (4 bytes): [index:1 or 2][count:1 or 2][crc16:2]
215 │  * We use 2 bytes for index and count to allow manifests larger than 255
216 │  * fragments (a very long filename plus a note), and keep the total overhead at
217 │  * 4 bytes x fragment count.
218 │  */
219 │ /**
220 │  * Overhead kept in every fragment: 2 bytes index, 2 bytes count, 2 bytes CRC-16.
221 │  * The CRC is what lets a receiver distinguish "this fragment arrived garbled"
222 │  * from "this fragment has not arrived yet" - without it, a single corrupt
223 │  * fragment would stall an otherwise perfect transfer forever.
224 │  */
225 │ export const FRAGMENT_HEADER_BYTES = 6;
226 │ 
227 │ export interface ManifestFragments {
228 │   fragments: Uint8Array[];
229 │   /** CRC-16 of the whole serialised manifest (diagnostics). */
230 │   crc: number;
231 │   count: number;
232 │ }
233 │ 
234 │ export function splitManifest(serialized: Uint8Array, fragmentPayloadBytes: number): ManifestFragments {
235 │   if (fragmentPayloadBytes <= FRAGMENT_HEADER_BYTES) {
236 │     throw new RangeError('Fragment size must exceed the fragment header');
237 │   }
238 │   const chunkBytes = fragmentPayloadBytes - FRAGMENT_HEADER_BYTES;
239 │   const count = Math.max(1, Math.ceil(serialized.length / chunkBytes));
240 │   if (count > 0xffff) {
241 │     throw new RangeError('Manifest too large to fragment (more than 65535 fragments needed)');
242 │   }
243 │   const fragments: Uint8Array[] = [];
244 │   for (let index = 0; index < count; index++) {
245 │     const start = index * chunkBytes;
246 │     const body = serialized.subarray(start, Math.min(serialized.length, start + chunkBytes));
247 │     const checksum = crc16(body);
248 │     const fragment = new Uint8Array(FRAGMENT_HEADER_BYTES + body.length);
249 │     fragment[0] = (index >>> 8) & 0xff;
250 │     fragment[1] = index & 0xff;
251 │     fragment[2] = (count >>> 8) & 0xff;
252 │     fragment[3] = count & 0xff;
253 │     fragment[4] = (checksum >>> 8) & 0xff;
254 │     fragment[5] = checksum & 0xff;
255 │     fragment.set(body, FRAGMENT_HEADER_BYTES);
256 │     fragments.push(fragment);
257 │   }
258 │   return { fragments, crc: crc16(serialized), count };
259 │ }
260 │ 
261 │ /** Reassembles manifest fragments arriving out of order and with duplicates. */
262 │ export class ManifestAssembler {
263 │   private parts: Array<Uint8Array | null> = [];
264 │   private expected = -1;
265 │   private received = 0;
266 │ 
267 │   /** Feed one manifest frame payload. Returns the manifest once complete. */
268 │   accept(fragment: Uint8Array): Manifest | null {
269 │     if (fragment.length < FRAGMENT_HEADER_BYTES) return null;
270 │     const index = (fragment[0] << 8) | fragment[1];
271 │     const count = (fragment[2] << 8) | fragment[3];
272 │     const checksum = (fragment[4] << 8) | fragment[5];
273 │     if (count === 0 || count > 0xffff || index >= count) return null;
274 │     const body = fragment.subarray(FRAGMENT_HEADER_BYTES);
275 │     if (crc16(body) !== checksum) return null; // a garbled fragment is not a missing one
276 │ 
277 │     if (this.expected === -1) {
278 │       this.expected = count;
279 │       this.parts = new Array(count).fill(null);
280 │     } else if (this.expected !== count) {
281 │       // A different manifest layout: start over with the new one.
282 │       this.expected = count;
283 │       this.parts = new Array(count).fill(null);
284 │       this.received = 0;
285 │     }
286 │ 
287 │     if (this.parts[index] === null) {
288 │       this.parts[index] = body;
289 │       this.received++;
290 │     }
291 │     if (this.received < this.expected) return null;
292 │ 
293 │     // Reassemble, preserving order.
294 │     let total = 0;
295 │     for (const part of this.parts) total += part ? part.length : 0;
296 │     const merged = new Uint8Array(total);
297 │     let offset = 0;
298 │     for (const part of this.parts) {
299 │       if (!part) return null;
300 │       merged.set(part, offset);
301 │       offset += part.length;
302 │     }
303 │     this.reset();
304 │     return deserializeManifest(merged);
305 │   }
306 │ 
307 │   get progress(): number {
308 │     if (this.expected <= 0) return 0;
309 │     return this.received / this.expected;
310 │   }
311 │ 
312 │   get complete(): boolean {
313 │     return this.expected > 0 && this.received >= this.expected;
314 │   }
315 │ 
316 │   reset(): void {
317 │     this.parts = [];
318 │     this.expected = -1;
319 │     this.received = 0;
320 │   }
321 │ }
322 │ 
323 │ /**
324 │  * Number of manifest frames that fit in one data frame's payload, given the
325 │  * session's frame capacity. Manifests are placed in `FrameType.Manifest` frames,
326 │  * whose payload budget is the same as a data frame's, so the caller passes the
327 │  * frame payload size.
328 │  */
329 │ export function manifestFragmentSize(framePayloadBytes: number): number {
330 │   return framePayloadBytes;
331 │ }
332 │ 
333 │ /** Extract AEAD parameters from a validated manifest. */
334 │ export function manifestEncryptionParams(manifest: Manifest): {
335 │   salt: Uint8Array;
336 │   nonce: Uint8Array;
337 │   kdf: { N: number; r: number; p: number };
338 │ } | null {
339 │   if (manifest.enc !== 'xchacha20poly1305' || !manifest.salt || !manifest.nonce || !manifest.kdf) return null;
340 │   return { salt: fromBase64Url(manifest.salt), nonce: fromBase64Url(manifest.nonce), kdf: manifest.kdf };
341 │ }
342 │ 
343 │ /** Short display form of a manifest, used by the UI and logs. */
344 │ export function describeManifest(manifest: Manifest): string {
345 │   const flags: string[] = [manifest.codec === 'deflate' ? 'deflate' : 'raw'];
346 │   if (manifest.enc !== 'none') flags.push('encrypted');
347 │   return `${manifest.name} (${manifest.len} B, ${manifest.k} blocks x ${manifest.bs} B, ${flags.join(', ')}) sha=${manifest.sha.slice(0, 12)}...`;
348 │ }
349 │ 
350 │ // Re-exported so callers do not need to import from two modules.
351 │ export { FRAME_HEADER_BYTES, FrameType, toBase64Url, fromBase64Url, fromHex, toHex };
```

---

## `packages/core/src/protocol/planner.ts`

> 281 lines

**What it is.** The planner decides the symbol geometry for a session, and it is where the
central trade-off of optical transfer is expressed in code:


**The physical reasoning, which is in the header because it is the reason the numbers are what
they are.** Resolving a QR module needs roughly 3+ camera pixels across it (Nyquist plus the
decoder's margin), and a phone held 20–40 cm from a phone screen covers maybe 700–900 px
across the display. That puts a comfortable ceiling at about 60–100 modules — QR versions
8–16. Beyond that, per-frame decode success collapses, and the retries cost more than the
larger payload saves. This is why the planner picks a target version from a *density profile*
rather than maximising capacity: the naive "biggest symbol that fits the screen" choice is
measurably worse at the range people actually hold their phones.

### `DENSITY_PROFILES`

| id | label | version | modules | when |
| --- | --- | --- | --- | --- |
| `phone` | Phones, close up | 10 | 57×57 | both devices in your hands |
| `balanced` | Balanced (recommended) | 15 | 77×77 | phone screen at 20–40 cm |
| `dense` | Fast (dense) | 20 | 97×97 | steady camera, bright screen |
| `tablet` | Laptop / tablet screen | 27 | 125×125 | sender is a computer display |

All four use EC level **L**, and the header explains why that is not a mistake: for a
screen-to-camera channel the dominant error source is blur and geometry, not symbol damage, and
the encoder's EC-level boosting (`encoder.ts`) already raises the level *within* the chosen
version when the payload leaves slack. The profile's `ecLevel` is the floor used for version
selection, not the ceiling used for the symbol. `profileById` falls back to `balanced`
(index 1) rather than throwing, so a stored setting from an older build still starts a session.

### `planSession` — the arithmetic


**Why base32 mode has its own line.** The symbol holds `framePayloadBytes` *characters*, and
base32 carries 5 bytes per 8 characters — so the number of data bytes is
`floor(chars × 5 / 8)`, and the 13-byte header comes out of *that*. The comment explains the
part that is easy to get wrong: **base32 wraps the whole frame including the header**, because
a native scanner hands back a decoded string, and a binary header would be mangled exactly as
badly as a binary payload. Since the LT block is what the fountain layer and the progress maths
deal with, the block size is expressed in *real bytes* and the encoding overhead is absorbed
here, once, instead of leaking into every other module. Getting this wrong in the other
direction was a real bug: base32-encoding only the payload (leaving the header binary) produced
frames that no native scanner could read.

**Two adjustments after the arithmetic:**

- **`k > maxK` throws** rather than growing the block. A bigger block would need a bigger
  symbol, and the profile cannot express one — so the honest answer is a clear error ("use a
  denser profile or a smaller file") instead of a session that silently changes geometry
  mid-transfer. `maxK` defaults to 20 000, which is also the decoder's memory ceiling.
- **`k === 1` shrinks the block to the payload length.** A 40-byte text message should not claim
  a whole 700-byte block, because the progress UI would then be measuring padding. This is the
  branch that makes a one-block session's progress meaningful rather than a jump from 0 to 100%.

**`estimateOverhead(loss)`.** `1.06 + 0.45·√loss`, clamped, and the header is explicit that it
is *conservative planning* rather than a measurement: the constant base comes from the measured
1.06–1.12× clean-channel overhead, the square-root term reflects that the decoder needs
`K + O(√K)` independent frames and loss increases the variance of "how many distinct frames we
saw". The live UI replaces the estimate with the receiver's measured goodput as soon as there
is one.

**`estimatedFrames` adds 4** for manifest frames. A small, honest fudge: manifests repeat, and
the count is small enough that no user-visible estimate is harmed by including them.

**`SessionPlan.estimatedSeconds` is a function, not a field.** Frame rate is a property of the
sender's display loop and the profile, not of the payload, so the plan stores the frame count
and exposes `estimatedFrames / fps`. That keeps a plan object valid across a frame-rate change
(the mobile sender resyncs its schedule when the device drops frames) without rebuilding it.

**`wireFlags(plan)`** — the one-line bridge between the plan and the frame header, and it exists
because of a bug of exactly the kind you would expect: the sender used to *hard-code* the
Base32 flag instead of deriving it from the plan. A raw-mode session then emitted frames whose
declared encoding disagreed with their contents — a flag that is worse than no flag, because a
receiver trusts it. Now the flag comes from `plan.wireEncoding` and nowhere else.

**`recommendedFps(platform, profileId)`** — 15 for phone/balanced, 12 dense, 10 tablet, minus two
frames on the web (minimum 8). Rendering cost is dominated by module count squared, and capture
cost on the receiving side by exposure time; a mobile web browser with rolling-shutter exposure is the
weakest link, hence the shave. The mobile sender also *resyncs* rather than trusting this: it
measures its own achieved interval and reports "behind" in the diagnostics panel when the device
cannot keep up.

**`nominalThroughput`** is deliberately optimistic — it is bytes per frame times frames per
second, i.e. what a perfect receiver would get — and the header says so, because the receiver
screen shows the *measured* goodput instead. Two different numbers for two different purposes,
labelled rather than confused.

**`planWarnings(plan, payloadLength, fps)`** returns warnings instead of throwing, because the UI
wants to say "this will take about 4 minutes" without blocking a send. Three conditions: over
5 minutes on screen, over 110 modules, over 16 MiB. The first warning even suggests the honest
alternative — copy the file over a cable.

**Every line**

```ts
  1 │ /**
  2 │  * planner.ts - choosing the symbol geometry for a session.
  3 │  *
  4 │  * The central trade-off of an optical transfer is:
  5 │  *
  6 │  *   bigger symbol  =  more bytes per frame  =  fewer frames to show
  7 │  *                   but more modules per symbol, so each module is physically
  8 │  *                   smaller on screen and harder for a camera to resolve.
  9 │  *
 10 │  * Resolving a QR module needs roughly 3+ camera pixels across it (Nyquist plus
 11 │  * the decoder's margin), and a phone held 20-40 cm away from a phone screen
 12 │  * covers maybe 700-900 px across the display. That puts a comfortable ceiling at
 13 │  * about 60-100 modules, i.e. QR versions 8-16. Beyond that, capture success
 14 │  * collapses (the decoder still *works* when it works, but the probability of a
 15 │  * clean decode per frame drops, which costs more in retries than the larger
 16 │  * payload saves).
 17 │  *
 18 │  * So the planner picks a target version from a *density profile* rather than
 19 │  * maximising capacity, and sizes the LT blocks to fill exactly one frame:
 20 │  *
 21 │  *     blockSize = maxBytePayload(version, ecLevel) - FRAME_HEADER_BYTES
 22 │  *
 23 │  * A note on EC level: for a screen-to-camera channel, QR error correction is
 24 │  * useful but not the dominant factor - blur and geometry are. Level L with a
 25 │  * perfect screen is typically the best throughput choice; level M is a good
 26 │  * compromise for phones held by hand. The planner exposes both and lets the UI
 27 │  * offer "balanced" vs "robust".
 28 │  */
 29 │ 
 30 │ import { BYTE_MODE_CAPACITY, type EcLevel } from '../qr/tables.js';
 31 │ import { maxBytePayload } from '../qr/encoder.js';
 32 │ import { FRAME_HEADER_BYTES, FrameFlag } from './frame.js';
 33 │ import { base32DecodedLength } from '../util/base32.js';
 34 │ 
 35 │ export interface DensityProfile {
 36 │   id: 'phone' | 'balanced' | 'dense' | 'tablet';
 37 │   label: string;
 38 │   description: string;
 39 │   /** QR version to target (1..40). */
 40 │   version: number;
 41 │   /** Error correction level for the target version. */
 42 │   ecLevel: EcLevel;
 43 │ }
 44 │ 
 45 │ /**
 46 │  * The profiles offered in the UI. Sizes: version v -> (17 + 4v) modules.
 47 │  *   version  8 ->  49 x 49 modules
 48 │  *   version 10 ->  57 x 57
 49 │  *   version 15 ->  77 x 77
 50 │  *   version 20 ->  97 x 97
 51 │  *   version 27 -> 125 x 125
 52 │  */
 53 │ export const DENSITY_PROFILES: DensityProfile[] = [
 54 │   {
 55 │     id: 'phone',
 56 │     label: 'Phones, close up',
 57 │     description: 'Smallest symbols, easiest to scan. Best when both devices are in your hands.',
 58 │     version: 10,
 59 │     ecLevel: 'L',
 60 │   },
 61 │   {
 62 │     id: 'balanced',
 63 │     label: 'Balanced (recommended)',
 64 │     description: 'Good throughput and reliable capture on a phone screen at 20-40 cm.',
 65 │     version: 15,
 66 │     ecLevel: 'L',
 67 │   },
 68 │   {
 69 │     id: 'dense',
 70 │     label: 'Fast (dense)',
 71 │     description: 'Bigger symbols, more bytes per frame. Needs a steady camera and a bright screen.',
 72 │     version: 20,
 73 │     ecLevel: 'L',
 74 │   },
 75 │   {
 76 │     id: 'tablet',
 77 │     label: 'Laptop / tablet screen',
 78 │     description: 'Widest symbols. Use when the sender is a computer display and the receiver is a phone.',
 79 │     version: 27,
 80 │     ecLevel: 'L',
 81 │   },
 82 │ ];
 83 │ 
 84 │ export function profileById(id: DensityProfile['id']): DensityProfile {
 85 │   return DENSITY_PROFILES.find((profile) => profile.id === id) ?? DENSITY_PROFILES[1];
 86 │ }
 87 │ 
 88 │ /**
 89 │  * Wire encoding of frame payloads.
 90 │  *
 91 │  * 'base32' is the default: universal compatibility with native camera APIs and
 92 │  * third-party scanners, at a ~10% throughput cost. 'raw' uses QR byte mode and is
 93 │  * only safe when BOTH ends are ours (web-to-web, or a custom native decoder).
 94 │  */
 95 │ export type WireEncoding = 'raw' | 'base32';
 96 │ 
 97 │ export interface SessionPlan {
 98 │   profile: DensityProfile;
 99 │   version: number;
100 │   ecLevel: EcLevel;
101 │   /** How frame payloads are encoded on the wire. */
102 │   wireEncoding: WireEncoding;
103 │   /** Modules per axis of the QR symbol (17 + 4 * version). */
104 │   modules: number;
105 │   /** Bytes available in one frame's QR payload. */
106 │   framePayloadBytes: number;
107 │   /** Bytes of LT block per frame (frame payload minus the 13-byte header). */
108 │   blockSize: number;
109 │   /** Number of LT blocks (K) for this payload. */
110 │   k: number;
111 │   /** Nominal payload bytes carried per frame (payload, not including headers). */
112 │   bytesPerFrame: number;
113 │   /**
114 │    * Estimated frames needed to move `payloadLength` bytes, including the
115 │    * expected fountain overhead (see estimateOverhead).
116 │    */
117 │   estimatedFrames: number;
118 │   /** Estimated seconds on screen at a given frame rate. */
119 │   estimatedSeconds: (fps: number) => number;
120 │ }
121 │ 
122 │ /** Maximum QR byte-mode capacity for (version, level) - ISO 18004 table 7. */
123 │ export function byteCapacity(version: number, level: EcLevel): number {
124 │   return BYTE_MODE_CAPACITY[level][version] ?? 0;
125 │ }
126 │ 
127 │ /**
128 │  * Frame payload budget: the largest byte-mode payload that fits the symbol,
129 │  * minus the frame header. `maxBytePayload` accounts for the mode indicator and
130 │  * the version-dependent character-count indicator, so this is exact.
131 │  */
132 │ export function framePayloadBytes(version: number, level: EcLevel): number {
133 │   return Math.max(0, maxBytePayload(version, level) - FRAME_HEADER_BYTES);
134 │ }
135 │ 
136 │ /**
137 │  * Expected fountain overhead as a fraction of K.
138 │  *
139 │  * Empirically (see docs/degree-experiment-output.txt) robust-soliton LT with our
140 │  * systematic prefix decodes at about 1.06-1.12x K on a clean channel, rising to
141 │  * ~1.2-1.35x when a third of the frames are missed. We use a conservative
142 │  * constant for planning and let the live UI replace it with the measured value.
143 │  */
144 │ export function estimateOverhead(framesMissedFraction = 0): number {
145 │   // Overhead grows with the square root of the loss rate in practice: the
146 │   // decoder needs K + O(sqrt(K)) independent frames, and loss only increases the
147 │   // variance of "how many distinct frames we saw".
148 │   const base = 1.06;
149 │   const lossPenalty = 0.45 * Math.sqrt(Math.max(0, Math.min(0.9, framesMissedFraction)));
150 │   return base + lossPenalty;
151 │ }
152 │ 
153 │ /** Plan a session for a payload of `payloadLength` bytes. */
154 │ export function planSession(
155 │   payloadLength: number,
156 │   profileInput: DensityProfile | DensityProfile['id'] = 'balanced',
157 │   options: {
158 │     ecLevelOverride?: EcLevel;
159 │     maxK?: number;
160 │     expectedLoss?: number;
161 │     wireEncoding?: WireEncoding;
162 │   } = {},
163 │ ): SessionPlan {
164 │   const profile = typeof profileInput === 'string' ? profileById(profileInput) : profileInput;
165 │   const version = profile.version;
166 │   const ecLevel = options.ecLevelOverride ?? profile.ecLevel;
167 │   const wireEncoding = options.wireEncoding ?? 'base32';
168 │   const budget = framePayloadBytes(version, ecLevel);
169 │   if (budget <= 0) {
170 │     throw new RangeError(`Profile version ${version} has no usable payload at EC level ${ecLevel}`);
171 │   }
172 │ 
173 │   // Blocks are sized to exactly fill a frame. (A smaller block would waste screen
174 │   // time; a larger one would need a bigger symbol.)
175 │   //
176 │   // With base32 the symbol holds `budget` characters but fewer *data* bytes:
177 │   // 8 characters carry 5 bytes. Sizing the LT block in data bytes keeps the
178 │   // fountain layer, the manifest and the progress maths all in real byte units.
179 │   //
180 │   // base32 mode wraps the WHOLE frame (header included) as text, because a native
181 │   // scanner hands back a decoded string - a binary header would be mangled just as
182 │   // badly as a binary payload. So the budget must cover base32(header + block):
183 │   //   base32DecodedLength(budget) is how many bytes fit in `budget` characters,
184 │   //   and the 13-byte frame header comes out of that.
185 │   let blockSize =
186 │     wireEncoding === 'base32'
187 │       ? Math.max(1, base32DecodedLength(budget) - FRAME_HEADER_BYTES)
188 │       : Math.max(1, budget - FRAME_HEADER_BYTES);
189 │   let k = Math.max(1, Math.ceil(payloadLength / blockSize));
190 │ 
191 │   // Very large files would need an unwieldy number of blocks. Cap K by growing
192 │   // the block size (which requires a denser symbol at the END of the range) or,
193 │   // if the profile cannot express it, report the mismatch to the caller.
194 │   const maxK = options.maxK ?? 20_000;
195 │   if (k > maxK) {
196 │     throw new RangeError(
197 │       `Payload needs ${k} blocks, above the ${maxK}-block session limit. Use a denser profile or a smaller file.`,
198 │     );
199 │   }
200 │ 
201 │   // Tiny payloads should not waste a whole block: reduce K for payloads smaller
202 │   // than one frame so the progress UI is meaningful.
203 │   if (k === 1) {
204 │     blockSize = Math.max(1, Math.min(blockSize, payloadLength || 1));
205 │     k = 1;
206 │   }
207 │ 
208 │   const overhead = estimateOverhead(options.expectedLoss ?? 0);
209 │   const estimatedFrames = Math.ceil(k * overhead) + 4; // +4 for manifest frames
210 │ 
211 │   return {
212 │     profile,
213 │     version,
214 │     ecLevel,
215 │     wireEncoding,
216 │     modules: 17 + version * 4,
217 │     framePayloadBytes: budget,
218 │     blockSize,
219 │     k,
220 │     bytesPerFrame: blockSize,
221 │     estimatedFrames,
222 │     estimatedSeconds: (fps: number) => (fps > 0 ? estimatedFrames / fps : Infinity),
223 │   };
224 │ }
225 │ 
226 │ /**
227 │  * Effective throughput in bytes/second for a session at a given display frame
228 │  * rate. This is the number the UI shows ("about 12 kB/s") and it is optimistic by
229 │  * design: it is what a *perfect* receiver would get. The receiver's own measured
230 │  * goodput is what actually matters, and the receiver screen displays that.
231 │  */
232 │ export function nominalThroughput(plan: SessionPlan, fps: number): number {
233 │   return plan.bytesPerFrame * fps;
234 │ }
235 │ 
236 │ /** Frame header flags implied by a plan (Base32 flag when applicable). */
237 │ export function wireFlags(plan: SessionPlan): number {
238 │   return plan.wireEncoding === 'base32' ? FrameFlag.Base32 : FrameFlag.None;
239 │ }
240 │ 
241 │ /** Frames per second that a sender should aim for, per browser form factor and profile. */
242 │ export function recommendedFps(
243 │   platform: 'web' | 'desktop-web' | 'mobile-web',
244 │   profileId: DensityProfile['id'],
245 │ ): number {
246 │   // Rendering cost is dominated by the symbol size (module count squared), and
247 │   // capture cost on the receiving side by the camera's exposure time.
248 │   const byProfile: Record<DensityProfile['id'], number> = {
249 │     phone: 15,
250 │     balanced: 15,
251 │     dense: 12,
252 │     tablet: 10,
253 │   };
254 │   const base = byProfile[profileId] ?? 15;
255 │   // Desktop displays comfortably hold the base rate; mobile browsers share CPU
256 │   // and thermal headroom with the page compositor, so we shave 2 fps there.
257 │   if (platform === 'mobile-web') return Math.max(8, base - 2);
258 │   return base;
259 │ }
260 │ 
261 │ /**
262 │  * Sanity-check a plan against a payload, used by the sender before it starts and
263 │  * by tests. Returns human-readable warnings rather than throwing, because the UI
264 │  * wants to warn ("this will take about 4 minutes") without blocking.
265 │  */
266 │ export function planWarnings(plan: SessionPlan, payloadLength: number, fps: number): string[] {
267 │   const warnings: string[] = [];
268 │   const seconds = plan.estimatedSeconds(fps);
269 │   if (seconds > 300) {
270 │     warnings.push(
271 │       `Estimated ${Math.round(seconds / 60)} minutes on screen at ${fps} fps. Consider a denser profile, or copy the file over a cable.`,
272 │     );
273 │   }
274 │   if (plan.modules > 110) {
275 │     warnings.push('Symbols are very dense; hold the camera steady and fill the viewfinder with the code.');
276 │   }
277 │   if (payloadLength > 16 * 1024 * 1024) {
278 │     warnings.push('Large payload: expect several minutes and keep both screens awake.');
279 │   }
280 │   return warnings;
281 │ }
```

---

## `packages/core/src/transfer/compress.ts`

> 86 lines

**What it is.** Payload compression, and the guard rails that make it safe to leave switched on
by default.

**Why it is nearly always a win.** The optical channel is the slowest part of the system
(roughly 100–400 kB/s measured), so spending a little sender CPU to shrink the payload pays for
itself immediately: deflate at level 6 typically shrinks text, JSON, source code, logs and CSV
by 3–10×, which translates one-for-one into a shorter transfer. The header gives the concrete
number: a 300 kB text file goes from about 3 seconds of screen time to about 0.4 seconds.

**The guard rails.**

| Rule | Reason |
| --- | --- |
| Only used when it saves more than `MIN_GAIN` (5%) | A JPEG or a ZIP is already compressed; inflating it would waste screen time *and* CPU. |
| Skipped entirely below 64 bytes | Not enough data for the deflate header to pay for itself. |
| Skipped above 64 MiB (`MAX_COMPRESS_BYTES`) | Keeps the UI responsive on the largest legal payload; the caller learns from the manifest's codec field. |
| `try { deflate } catch { return stored }` | **Never fail a transfer because compression failed.** A memory pressure error inside the codec must degrade to "store", not to an exception at the user. |
| `'store'` is always a valid answer | The receiver is told which codec was used, in the manifest, so the decision is explicit and reversible. |

**`pako` rather than the platform codecs, and the reason is interoperability.** The browser has
`CompressionStream` in modern browsers, while keeping `fflate` ensures the
payload checksum in the manifest is computed over the *compressed* bytes, and a receiver must be
able to reproduce them exactly. Whether `CompressionStream`'s deflate output is byte-identical
to zlib's across browsers, versions and platforms is not something to bet a transfer on. pako
is a faithful pure-JS zlib port, so the same input produces the same bytes on every device.
(This is the same reasoning that put XChaCha20 in pure JS.)

**`decompressPayload(input, codec)`** — a two-line function that throws on an unknown codec
rather than returning the input unchanged. A receiver that silently "decompresses" a payload it
does not understand would hand the user garbage bytes and a SHA-256 mismatch, when the manifest
clearly said something the build does not support. Failing loudly produces a message a user can
act on ("this file was compressed with a newer version").

**`looksCompressible(input, sampleBytes)`** — Shannon entropy over a sample (first 8 KiB by
default), returning false above 7.5 bits per byte, i.e. "essentially random". Used by the UI to
grey out the compression option for files that are certainly incompressible, so the user is not
offered a choice that cannot help. Note the early return for samples under 32 bytes: entropy of
a tiny sample is meaningless, and reporting "incompressible" for a 10-byte payload would be
misleading rather than merely useless.

**The constant this file exports and does not use.** `DEFLATE_LEVEL = 6` is exported so the level
is documented in one place and could be lowered by a caller that cared about sender CPU on an
old device; nothing in the project overrides it, because the measurement in the header is that
level 6 is the speed/size knee.

**Every line**

```ts
 1 │ /**
 2 │  * compress.ts - payload compression.
 3 │  *
 4 │  * The optical channel is the slowest part of the system (roughly 100-400 kB/s),
 5 │  * so spending a little CPU on the sender to shrink the payload is almost always a
 6 │  * win. gzip/deflate at level 6 typically shrinks text, JSON, source code, logs
 7 │  * and CSV by 3-10x, which translates one-for-one into a shorter transfer: a
 8 │  * 300 kB text file goes from ~3 s of screen time to ~0.4 s.
 9 │  *
10 │  * Guard rails, because compression is not free:
11 │  *   - it is only applied when it actually helps by more than MIN_GAIN (a JPEG or
12 │  *     a ZIP is already compressed; inflating it slightly would waste screen
13 │  *     time and CPU),
14 │  *   - the receiver is told which codec was used in the manifest, so the decision
15 │  *     is explicit and reversible,
16 │  *   - 'store' is always a valid answer.
17 │  *
18 │  * Implementation: pako (a pure-JS zlib port). Chosen over the browser's
19 │  * browser CompressionStream and Node zlib so that the exact same
20 │  * bytes are produced on every platform - the payload checksum in the manifest
21 │  * must match no matter which device re-encoded it.
22 │  */
23 │ 
24 │ import { deflate, inflate } from 'pako';
25 │ 
26 │ export type Codec = 'store' | 'deflate';
27 │ 
28 │ export interface CompressResult {
29 │   codec: Codec;
30 │   bytes: Uint8Array;
31 │   /** Bytes saved (>= 0). */
32 │   saved: number;
33 │   ratio: number;
34 │ }
35 │ 
36 │ /** Minimum fractional saving required before compression is used (5%). */
37 │ export const MIN_GAIN = 0.05;
38 │ 
39 │ /** Above this size we skip compression entirely to keep the UI responsive. */
40 │ export const MAX_COMPRESS_BYTES = 64 * 1024 * 1024;
41 │ 
42 │ /** Deflate level 6: the standard speed/size knee, and fast enough on a phone. */
43 │ export const DEFLATE_LEVEL = 6;
44 │ 
45 │ export function compressPayload(input: Uint8Array): CompressResult {
46 │   const stored: CompressResult = { codec: 'store', bytes: input, saved: 0, ratio: 1 };
47 │   if (input.length < 64 || input.length > MAX_COMPRESS_BYTES) return stored;
48 │ 
49 │   let deflated: Uint8Array;
50 │   try {
51 │     deflated = deflate(input, { level: DEFLATE_LEVEL });
52 │   } catch {
53 │     // Never fail a transfer because compression failed.
54 │     return stored;
55 │   }
56 │ 
57 │   const saved = input.length - deflated.length;
58 │   if (saved <= input.length * MIN_GAIN) return stored;
59 │   return { codec: 'deflate', bytes: deflated, saved, ratio: deflated.length / input.length };
60 │ }
61 │ 
62 │ export function decompressPayload(input: Uint8Array, codec: Codec): Uint8Array {
63 │   if (codec === 'store') return input;
64 │   if (codec === 'deflate') return inflate(input);
65 │   throw new RangeError(`Unknown codec "${codec as string}"`);
66 │ }
67 │ 
68 │ /**
69 │  * Heuristic pre-check for whether a payload is worth compressing, based on
70 │  * entropy of a sample. Used by the UI to grey out the compression option for
71 │  * files that are certainly incompressible.
72 │  */
73 │ export function looksCompressible(input: Uint8Array, sampleBytes = 8192): boolean {
74 │   const sample = input.subarray(0, Math.min(input.length, sampleBytes));
75 │   if (sample.length < 32) return false;
76 │   const counts = new Uint32Array(256);
77 │   for (let i = 0; i < sample.length; i++) counts[sample[i]]++;
78 │   let entropy = 0;
79 │   for (let i = 0; i < 256; i++) {
80 │     if (counts[i] === 0) continue;
81 │     const p = counts[i] / sample.length;
82 │     entropy -= p * Math.log2(p);
83 │   }
84 │   // > 7.5 bits/byte is essentially random (already compressed or encrypted).
85 │   return entropy < 7.5;
86 │ }
```

---

## `packages/core/src/transfer/sender.ts`

> 551 lines

**What it is.** The sending side of a transfer: compress, hash, optionally encrypt, plan the
session, build the manifest, and hand out one QR symbol per display slot. It is a **pure frame
producer** — it knows nothing about canvases, cameras, timers or React. The browser app, the
mobile app, the test suite and the CLI all drive it with their own frame loops, which is why a
transfer verified by the tests is the same code path a phone runs.

### The display schedule


In words: the metadata goes out M times up front, and thereafter one manifest fragment is slipped
in every 24th frame. **A receiver that starts in the middle — the normal case, because people
point a camera at a screen whenever they happen to — therefore has the full metadata within about
a second instead of never.** That interleave is the single most consequential scheduling decision
in the product. `MANIFEST_REPEAT = 24` is the dial: lower means faster joining, higher means more
payload throughput.

`scheduleAt(t)` is a **pure function of the slot number**, which is what makes the schedule
testable and resumable; the sender never carries a "current position" that could drift from what
is actually on screen.

**`seedForDataIndex` and `restartSystematic()`.** Normally `seed === dataIndex` (systematic prefix
first, then the fountain stream). If the operator sees the receiver struggling — the sender has no
back channel, so this is a human decision — `restartSystematic()` sets a seed offset *above every
seed already emitted*, so the prefix is replayed once and the stream then continues with fresh
seeds the receiver has not already discarded. Re-sending old seeds would be pure waste, which is
exactly the bug the offset exists to prevent.

### `symbolAt(t)` — the hot path

Called 10–20 times per second, and structured around that:

- **Manifest frames are memoised** in a `SymbolCache` keyed by
  `m:<index>:<wireEncoding>:<length>`, because they repeat verbatim for the whole session.
- **Data frames are encoded fresh but with locked geometry.** The constructor encodes the first
  data frame, takes the **mask** the encoder chose, and then pins
  `{version, ecLevel, mask}` in `EncodeOptions` for every later frame. Skipping the eight-way
  mask search skips more than half of the encoder's cost — and it also guarantees the symbol
  never changes geometry mid-stream, which matters for the camera's autofocus and for the
  receiver's cached symbol-decode parameters.
- `markShown(t)` is separate from `symbolAt(t)` on purpose: producing a symbol and displaying it
  are different events, and the stats should count what the user actually saw.

### `encodeFrameBytes` — where the base32 rule lives


**The whole frame is encoded, header included**, and the comment explains why with the incident
that produced it: the header contains the session id, the seed and the CRC, all of which have
bytes above 0x7F. A native camera API returns a decoded *string*, so those bytes come back
replaced and the header is destroyed before it can even be validated. A test that fed jsQR's
*text* output into the receiver surfaced it. Encoding only the payload was the tempting and wrong
reading of the rule.

The payoff for wrapping everything: the base32 alphabet is exactly QR's alphanumeric set, so the
segmenter puts the entire frame in alphanumeric mode — 5.5 bits per character instead of 8.

### `prepareTransfer(options)` — the order of operations


and then `SHA-256`/`CRC-32` over the **wire** payload, so a receiver can verify integrity before
spending CPU on key derivation or decompression. Non-obvious details, all of which were bugs at
some point:

1. **The plan is computed exactly once, against the exact wire length.** The plan's `blockSize`
   and `k` are authenticated by the AEAD (through the associated data) *and* carried in the
   manifest. A sender that planned against a guess and re-planned after encrypting would produce
   associated data describing one plan and a manifest describing another, and **every encrypted
   transfer would fail to decrypt**. XChaCha20-Poly1305 makes the wire length exactly predictable
   (`plaintext + 16`), and the code **asserts** `sealed.ciphertext.length === wireLength` instead
   of assuming it — so a future change to the AEAD fails loudly here rather than producing
   transfers nobody can open.
2. **The associated data is built by the receiver's function** (`manifestAssociatedData` from
   `protocol/manifest.ts`), not a local copy. The comment says why plainly: it is the only
   reliable way to be sure both sides cover the same fields. The three-copy version of this code
   is the bug this project is most glad to have caught.
3. **Compression savings compare like with like.** `saved = original.length −
   (wirePayload.length − 16 if encrypted)`: the payload *before* encryption, because the AEAD tag
   is framing overhead, not something compression failed to remove. Getting this wrong made an
   encrypted compressed transfer under-report its saving by exactly 16 bytes — small, but the kind
   of wrong number that appears in the UI and makes a user distrust every other number.
4. **`flags` is composed from `wireFlags(plan)`**, never hard-coded. The comment records the
   consequence of hard-coding it: frames that claimed raw encoding while carrying base32 text.
   A receiver trusting that flag decodes every frame wrongly but plausibly.
5. **Fragment size equals block size**, so one manifest fragment fills one frame exactly under
   either wire encoding.

The `prepareTransfer` chicken-and-egg is worth naming: the manifest is the AEAD's associated data,
but the manifest carries the SHA-256 *of the ciphertext*. It is resolved by authenticating only
the identity fields (`sid`, `name`, `mime`, `len`, `olen`, `bs`, `k`, `codec`, `enc`) — all final
before encryption — and computing `sha` afterwards. That is precisely why `AssociatedDataFields`
exists as a subset, and why `sha` is excluded with a comment instead of by omission.

### The small helpers

- **`guessMimeType`** — extension table, deliberately small. The receiver never trusts it beyond
  choosing a preview widget and never executes anything based on it, which is why a 30-entry table
  is sufficient and why there is no content sniffing.
- **`textToSenderOptions(text)`** — names a text payload `clipboard.txt` with `text/plain`,
  so a pasted URL arrives looking like a file the user can open.
- **`compressionWorthTrying`** — the UI's grey-out check, re-exported so the web and mobile apps
  do not each import `compress.ts` directly.
- **The last line re-exports** `FRAME_HEADER_BYTES`, `deriveMaskBlock` and
  `buildDegreeDistribution`, because the sender is the module most callers reach for and this saves
  them a second import. Same trade as in `manifest.ts`: a slightly wider public surface for
  slightly fewer imports.

**Every line**

```ts
  1 │ /**
  2 │  * sender.ts - the sending side of a LightBeam transfer.
  3 │  *
  4 │  * The sender is a *pure frame producer*: it owns the payload, the manifest, the
  5 │  * fountain encoder and the display schedule, and it hands out one QR symbol at a
  6 │  * time. It deliberately does not know about canvases, cameras, timers or React -
  7 │  * the browser UI and synthetic loopback harnesses drive it with their own frame loops, and
  8 │  * so can the test suite and the CLI.
  9 │  *
 10 │  * DISPLAY SCHEDULE
 11 │  * ----------------
 12 │  * Slot t of what appears on screen is:
 13 │  *
 14 │  *     t in [0, M)                      manifest fragment t                (M = fragment count)
 15 │  *     t >= M, (t - M) mod 24 == 0      manifest fragment ((t - M) / 24) mod M
 16 │  *     t >= M, (t - M) mod 24 != 0      data frame number (t - M - floor((t - M) / 24))
 17 │  *
 18 │  * In words: the metadata is sent M times up front, and thereafter one manifest
 19 │  * fragment is slipped in every 24th frame. A receiver that starts in the middle -
 20 │  * which is the normal case, because people point a camera at a screen whenever
 21 │  * they happen to - therefore has the full metadata within about a second, instead
 22 │  * of never.
 23 │  *
 24 │  * Data frames alternate: the first K frames are the *systematic* prefix (one
 25 │  * source block each), then the LT stream runs forever. If the operator sees that
 26 │  * the receiver is struggling (the sender has no back channel, so this is a human
 27 │  * decision), `restartSystematic()` replays the prefix - useful when the beginning
 28 │  * of the transfer was missed entirely.
 29 │  */
 30 │ 
 31 │ import { LTEncoder, deriveMaskBlock, expectedFramesFor } from '../fountain/lt.js';
 32 │ import { buildDegreeDistribution, type DegreeOptions } from '../fountain/degree.js';
 33 │ import { dataFrameHeader, manifestFrameHeader, FrameFlag, FRAME_HEADER_BYTES } from '../protocol/frame.js';
 34 │ import {
 35 │   buildManifest,
 36 │   manifestAssociatedData,
 37 │   serializeManifest,
 38 │   splitManifest,
 39 │   type Manifest,
 40 │   type ManifestFragments,
 41 │ } from '../protocol/manifest.js';
 42 │ import { planSession, wireFlags, type DensityProfile, type SessionPlan } from '../protocol/planner.js';
 43 │ import { compressPayload, looksCompressible, type Codec } from './compress.js';
 44 │ import { hashHex } from '../crypto/integrity.js';
 45 │ import { crc32u } from '../crypto/crc.js';
 46 │ import { encryptPayload, DEFAULT_KDF, type KdfParams } from '../crypto/aead.js';
 47 │ import { concatBytes, randomBytes, randomSessionId, sessionCode, utf8Encode } from '../util/bytes.js';
 48 │ import { base32Encode } from '../util/base32.js';
 49 │ import { encodeBinary, encodeText, SymbolCache, type EncodedSymbol, type EncodeOptions } from '../qr/encoder.js';
 50 │ 
 51 │ /** How often a manifest fragment is repeated in the data stream. */
 52 │ export const MANIFEST_REPEAT = 24;
 53 │ 
 54 │ export interface SenderOptions {
 55 │   /** Payload bytes (the file or the UTF-8 text). */
 56 │   data: Uint8Array;
 57 │   /** Display name, e.g. "notes.txt". */
 58 │   name: string;
 59 │   /** MIME type, best effort. */
 60 │   mime?: string;
 61 │   /** Session id; random when omitted. */
 62 │   sessionId?: number;
 63 │   /** Density profile (or its id). */
 64 │   profile?: DensityProfile | DensityProfile['id'];
 65 │   /** Force an EC level for the QR symbols. */
 66 │   ecLevel?: EncodeOptions['ecLevel'];
 67 │   /** Compress with deflate when it helps (default true). */
 68 │   compress?: boolean;
 69 │   /** Encrypt with a passphrase (default: no encryption). */
 70 │   passphrase?: string;
 71 │   /** KDF parameters for encryption. */
 72 │   kdf?: KdfParams;
 73 │   /** Degree distribution tuning for the fountain code. */
 74 │   degree?: DegreeOptions;
 75 │   /**
 76 │    * How the frame is written onto the wire.
 77 │    *
 78 │    * 'base32' (default) survives every platform barcode decoder, because those
 79 │    * return a STRING and base32 is pure ASCII - see util/base32.ts.
 80 │    *
 81 │    * 'raw' puts the frame bytes directly into the symbol and is about 10% faster,
 82 │    * but only a decoder that hands back real bytes can read it (jsQR in a browser).
 83 │    * Use it deliberately for browser-to-browser transfers; a native receiver will
 84 │    * silently fail to parse the frames.
 85 │    */
 86 │   wireEncoding?: 'base32' | 'raw';
 87 │   /** Extra note shown to the receiver. */
 88 │   note?: string;
 89 │ }
 90 │ 
 91 │ export interface SenderStats {
 92 │   framesShown: number;
 93 │   /** Frames shown with a data payload (excludes manifest/interleave frames). */
 94 │   dataFramesShown: number;
 95 │   manifestFramesShown: number;
 96 │   /** Highest LT seed emitted so far. */
 97 │   lastSeed: number;
 98 │   /** Expected frames for a clean decode, from the fountain model. */
 99 │   expectedFrames: number;
100 │   elapsedMs: number;
101 │   fps: number;
102 │ }
103 │ 
104 │ /**
105 │  * A prepared transfer: everything needed to start showing frames.
106 │  *
107 │  * Built by `prepareTransfer` (which is async only because key derivation is).
108 │  */
109 │ export interface PreparedTransfer {
110 │   sessionId: number;
111 │   /** Human-readable 6-character session code shown under the QR code. */
112 │   code: string;
113 │   manifest: Manifest;
114 │   fragments: ManifestFragments;
115 │   plan: SessionPlan;
116 │   /** The payload actually transmitted (compressed/encrypted as configured). */
117 │   wirePayload: Uint8Array;
118 │   /** The original payload, kept for the "original size" display. */
119 │   originalPayload: Uint8Array;
120 │   flags: number;
121 │   compression: { codec: Codec; saved: number; ratio: number };
122 │   encryption: 'none' | 'xchacha20poly1305';
123 │   /** Convenience: passphrase fingerprint is computed by the caller (crypto/aead). */
124 │ }
125 │ 
126 │ /** Everything the sender needs to build frames: computed once, reused thousands of times. */
127 │ export class TransferSender {
128 │   readonly sessionId: number;
129 │   readonly code: string;
130 │   readonly manifest: Manifest;
131 │   readonly fragments: ManifestFragments;
132 │   readonly plan: SessionPlan;
133 │   readonly flags: number;
134 │ 
135 │   private readonly encoder: LTEncoder;
136 │   private readonly symbolCache = new SymbolCache(16);
137 │   private readonly dataFrameOptions: EncodeOptions;
138 │   private manifestFrameOptions: EncodeOptions;
139 │   private framesShown = 0;
140 │   private dataFramesShown = 0;
141 │   private manifestFramesShown = 0;
142 │   private lastSeed = -1;
143 │   private startedAt = 0;
144 │   private systematicRestartSeed = -1;
145 │ 
146 │   /** Mask enforced after the first frame, so geometry never changes mid-stream. */
147 │   private lockedOptions: EncodeOptions = {};
148 │ 
149 │   constructor(
150 │     private readonly prepared: PreparedTransfer,
151 │     options: { degree?: DegreeOptions } = {},
152 │   ) {
153 │     this.sessionId = prepared.sessionId;
154 │     this.code = prepared.code;
155 │     this.manifest = prepared.manifest;
156 │     this.fragments = prepared.fragments;
157 │     this.plan = prepared.plan;
158 │     this.flags = prepared.flags;
159 │ 
160 │     const blockSize = prepared.manifest.bs;
161 │     const k = prepared.manifest.k;
162 │     this.encoder = new LTEncoder(prepared.wirePayload, {
163 │       k,
164 │       blockSize,
165 │       sessionId: prepared.sessionId,
166 │       degree: options.degree,
167 │       payloadLength: prepared.wirePayload.length,
168 │     });
169 │ 
170 │     const geometry: EncodeOptions = {
171 │       ecLevel: prepared.plan.ecLevel,
172 │       minVersion: prepared.plan.version,
173 │       maxVersion: prepared.plan.version,
174 │       boostEcLevel: true,
175 │     };
176 │     this.dataFrameOptions = geometry;
177 │     this.manifestFrameOptions = geometry;
178 │     // Warm the symbol cache with the first data frame: its geometry (mask,
179 │     // version, EC level) is then reused for every subsequent frame.
180 │     const firstSymbol = this.encodeFrameBytes(
181 │       dataFrameHeader({ sessionId: this.sessionId, seed: 0, flags: this.flags }),
182 │       this.encoder.encode(0),
183 │     );
184 │     this.lockedOptions = { ...geometry, mask: firstSymbol.mask };
185 │     this.manifestFrameOptions = this.lockedOptions;
186 │     this.dataFrameOptions.mask = firstSymbol.mask;
187 │     this.symbolCache.get('warmup', () => firstSymbol);
188 │   }
189 │ 
190 │   get blockSize(): number {
191 │     return this.manifest.bs;
192 │   }
193 │ 
194 │   get k(): number {
195 │     return this.manifest.k;
196 │   }
197 │ 
198 │   /** Bytes carried per data frame (the LT block size). */
199 │   get bytesPerFrame(): number {
200 │     return this.manifest.bs;
201 │   }
202 │ 
203 │   get payloadLength(): number {
204 │     return this.prepared.wirePayload.length;
205 │   }
206 │ 
207 │   /** Total data frames a clean receiver needs (K + fountain overhead). */
208 │   get expectedFrames(): number {
209 │     return expectedFramesFor(this.k);
210 │   }
211 │ 
212 │   /** Deterministic description of what to display at slot `t`. */
213 │   scheduleAt(t: number): { kind: 'manifest'; fragmentIndex: number } | { kind: 'data'; seed: number } {
214 │     const m = this.fragments.fragments.length;
215 │     if (t < m) return { kind: 'manifest', fragmentIndex: t };
216 │     const u = t - m;
217 │     const period = MANIFEST_REPEAT;
218 │     const block = Math.floor(u / period);
219 │     const offset = u % period;
220 │     if (offset === 0) return { kind: 'manifest', fragmentIndex: block % m };
221 │     // Data slot index across the whole stream:
222 │     const dataIndex = block * (period - 1) + (offset - 1);
223 │     return { kind: 'data', seed: this.seedForDataIndex(dataIndex) };
224 │   }
225 │ 
226 │   /**
227 │    * Map a data-slot index to an LT seed.
228 │    *
229 │    * Normally seed === dataIndex (systematic prefix first, then the fountain
230 │    * stream). After a systematic restart, seeds are offset so the prefix is
231 │    * replayed once and the stream continues with fresh seeds that the receiver has
232 │    * not already seen - re-sending old seeds would be pure waste.
233 │    */
234 │   private seedForDataIndex(dataIndex: number): number {
235 │     if (this.systematicRestartSeed < 0) return dataIndex;
236 │     if (dataIndex < this.k) return dataIndex; // replay the systematic prefix
237 │     return this.systematicRestartSeed + (dataIndex - this.k);
238 │   }
239 │ 
240 │   /**
241 │    * Produce the QR symbol for display slot `t`.
242 │    *
243 │    * Hot path: called once per displayed frame (10-20 times per second). The
244 │    * manifest frames are memoised via SymbolCache because they repeat verbatim for
245 │    * the whole session; data frames are encoded fresh but with the geometry locked
246 │    * (fixed version, EC level and mask) so there is no mask search per frame.
247 │    */
248 │   symbolAt(t: number): EncodedSymbol {
249 │     const slot = this.scheduleAt(t);
250 │     if (slot.kind === 'manifest') {
251 │       const fragment = this.fragments.fragments[slot.fragmentIndex];
252 │       const header = manifestFrameHeader({
253 │         sessionId: this.sessionId,
254 │         fragmentIndex: slot.fragmentIndex,
255 │         fragmentCount: this.fragments.fragments.length,
256 │         flags: this.flags,
257 │       });
258 │       // Manifest frames repeat verbatim for the whole session, so memoise them.
259 │       const key = `m:${slot.fragmentIndex}:${this.plan.wireEncoding}:${fragment.length}`;
260 │       return this.symbolCache.get(key, () => this.encodeFrameBytes(header, fragment));
261 │     }
262 │ 
263 │     const block = this.encoder.encode(slot.seed);
264 │     this.lastSeed = Math.max(this.lastSeed, slot.seed);
265 │     return this.encodeFrameBytes(
266 │       dataFrameHeader({ sessionId: this.sessionId, seed: slot.seed, flags: this.flags }),
267 │       block,
268 │     );
269 │   }
270 │ 
271 │   /**
272 │    * Turn "13 header bytes + payload" into a QR symbol.
273 │    *
274 │    * base32 mode (the default) encodes the ENTIRE frame - header included - as
275 │    * base32 text, so the symbol's content is pure ASCII.
276 │    *
277 │    * Encoding only the payload would not be enough: the header contains the session
278 │    * id, the seed and the CRC, all of which have bytes above 0x7F. A native camera
279 │    * API returns a decoded *string*, so those bytes come back replaced and the
280 │    * header is destroyed before it can even be validated. (A test that fed jsQR's
281 │    * text output into the receiver is what surfaced this.)
282 │    *
283 │    * Because the alphabet is exactly QR's alphanumeric set, the segmenter puts the
284 │    * whole thing in alphanumeric mode: 5.5 bits per character instead of 8.
285 │    */
286 │   private encodeFrameBytes(header: Uint8Array, payload: Uint8Array | string): EncodedSymbol {
287 │     if (this.plan.wireEncoding === 'base32') {
288 │       const body = typeof payload === 'string' ? utf8Encode(payload) : payload;
289 │       const text = base32Encode(concatBytes(header, body));
290 │       return encodeText(text, this.dataFrameOptions);
291 │     }
292 │     const bytes = concatBytes(header, typeof payload === 'string' ? utf8Encode(payload) : payload);
293 │     return encodeBinary(bytes, this.dataFrameOptions);
294 │   }
295 │ 
296 │   /** Record that slot `t` was actually displayed (drives the UI's stats). */
297 │   markShown(t: number): void {
298 │     if (this.startedAt === 0) this.startedAt = Date.now();
299 │     this.framesShown++;
300 │     const slot = this.scheduleAt(t);
301 │     if (slot.kind === 'manifest') this.manifestFramesShown++;
302 │     else this.dataFramesShown++;
303 │   }
304 │ 
305 │   /**
306 │    * Replay the systematic prefix. Call this when the receiver clearly missed the
307 │    * beginning of the transfer (its progress bar is stuck low while the camera is
308 │    * clearly locked on).
309 │    */
310 │   restartSystematic(): void {
311 │     // Jump ahead of every seed already emitted so no frame is repeated.
312 │     this.systematicRestartSeed = Math.max(this.lastSeed + 1, this.k + 1);
313 │   }
314 │ 
315 │   get isSystematicRestarted(): boolean {
316 │     return this.systematicRestartSeed >= 0;
317 │   }
318 │ 
319 │   getStats(): SenderStats {
320 │     const elapsedMs = this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
321 │     return {
322 │       framesShown: this.framesShown,
323 │       dataFramesShown: this.dataFramesShown,
324 │       manifestFramesShown: this.manifestFramesShown,
325 │       lastSeed: this.lastSeed,
326 │       expectedFrames: this.expectedFrames,
327 │       elapsedMs,
328 │       fps: elapsedMs > 0 ? (this.framesShown / elapsedMs) * 1000 : 0,
329 │     };
330 │   }
331 │ 
332 │   /** The plain-text payload (used to show text transfers in a copy box). */
333 │   get textPayload(): string | null {
334 │     if (!this.manifest.mime.startsWith('text/')) return null;
335 │     try {
336 │       return new TextDecoder().decode(this.prepared.originalPayload);
337 │     } catch {
338 │       return null;
339 │     }
340 │   }
341 │ }
342 │ 
343 │ /**
344 │  * Prepare a transfer: compress, hash, optionally encrypt, then plan the session.
345 │  *
346 │  * Order matters and is visible in the manifest:
347 │  *   original --deflate--> codec payload --AEAD--> wire payload
348 │  * The SHA-256 and CRC-32 in the manifest describe the *wire* payload, so a
349 │  * receiver can verify integrity before spending CPU on key derivation or
350 │  * decompression.
351 │  */
352 │ export async function prepareTransfer(options: SenderOptions): Promise<PreparedTransfer> {
353 │   const original = options.data;
354 │   if (original.length === 0) throw new RangeError('Nothing to send: the payload is empty');
355 │ 
356 │   // 1. Compression -----------------------------------------------------------
357 │   const compressEnabled = options.compress ?? true;
358 │   const compression = compressEnabled ? compressPayload(original) : { codec: 'store' as Codec, bytes: original, saved: 0, ratio: 1 };
359 │   let codec: Codec = compression.codec;
360 │   let staged = compression.bytes;
361 │ 
362 │   // 2. Encryption ------------------------------------------------------------
363 │   const passphrase = options.passphrase?.trim();
364 │   const encryptionMode: 'none' | 'xchacha20poly1305' = passphrase ? 'xchacha20poly1305' : 'none';
365 │   let salt: Uint8Array | null = null;
366 │   let nonce: Uint8Array | null = null;
367 │   const kdf = options.kdf ?? DEFAULT_KDF;
368 │ 
369 │   // The manifest itself is the AEAD associated data, so we must know the final
370 │   // manifest fields BEFORE encrypting. The chicken-and-egg is resolved by
371 │   // building the manifest with a placeholder checksum, using it as associated
372 │   // data, then re-deriving the manifest with the real checksum - the fields that
373 │   // matter (name, lengths, codec) are already final at that point.
374 │   const sessionId = options.sessionId ?? randomSessionId();
375 │   const name = options.name || 'lightbeam.bin';
376 │   const mime = options.mime ?? guessMimeType(name);
377 │ 
378 │   if (passphrase) {
379 │     salt = randomBytes(16);
380 │     nonce = randomBytes(24);
381 │   }
382 │ 
383 │   // 3. Plan, once -------------------------------------------------------------
384 │   //
385 │   // The plan must be computed against the EXACT wire length, because the block
386 │   // size and count it produces are authenticated by the AEAD (through the
387 │   // associated data below) and carried in the manifest. If the sender planned
388 │   // against a guess and then re-planned after encrypting, the associated data
389 │   // would describe one plan while the manifest described another and every
390 │   // encrypted transfer would fail to decrypt.
391 │   //
392 │   // XChaCha20-Poly1305 makes the wire length exactly predictable: ciphertext =
393 │   // plaintext + 16-byte tag. That is asserted below rather than assumed, so a
394 │   // future change to the AEAD fails loudly here instead of producing transfers
395 │   // that cannot be opened.
396 │   const AEAD_TAG_BYTES = 16;
397 │   const willEncrypt = Boolean(passphrase && salt && nonce);
398 │   const wireLength = staged.length + (willEncrypt ? AEAD_TAG_BYTES : 0);
399 │   const plan = planSession(wireLength, options.profile ?? 'balanced', {
400 │     ecLevelOverride: options.ecLevel,
401 │     wireEncoding: options.wireEncoding ?? 'base32',
402 │   });
403 │   const k = Math.max(1, Math.ceil(wireLength / plan.blockSize));
404 │ 
405 │   // 4. Encrypt ----------------------------------------------------------------
406 │   // The associated data binds the ciphertext to its metadata, so nobody can relabel
407 │   // an encrypted blob with a different name or claim a different size. It is built
408 │   // by the same function the RECEIVER uses (protocol/manifest.ts), which is the
409 │   // only reliable way to be sure both sides cover the same fields.
410 │   if (willEncrypt && salt && nonce) {
411 │     const associatedData = manifestAssociatedData({
412 │       sid: sessionId,
413 │       name,
414 │       mime,
415 │       len: wireLength,
416 │       olen: original.length,
417 │       bs: plan.blockSize,
418 │       k,
419 │       codec,
420 │       enc: encryptionMode,
421 │     });
422 │     const sealed = encryptPayload(staged, passphrase!, associatedData, salt, nonce, kdf);
423 │     if (sealed.ciphertext.length !== wireLength) {
424 │       throw new Error(
425 │         `AEAD produced ${sealed.ciphertext.length} bytes where ${wireLength} were planned; ` +
426 │           'the session was sized from the wrong length and would not decrypt.',
427 │       );
428 │     }
429 │     staged = sealed.ciphertext;
430 │   }
431 │ 
432 │   const wirePayload = staged;
433 │   const sha256Hex = hashHex(wirePayload);
434 │   const crc32 = crc32u(wirePayload);
435 │ 
436 │   // 5. Manifest ---------------------------------------------------------------
437 │   const manifest = buildManifest({
438 │     sessionId,
439 │     name,
440 │     mime,
441 │     payloadLength: wirePayload.length,
442 │     originalLength: original.length,
443 │     blockSize: plan.blockSize,
444 │     k,
445 │     codec,
446 │     encryption:
447 │       willEncrypt && salt && nonce
448 │         ? { mode: 'xchacha20poly1305', salt, nonce, kdf: { N: kdf.N, r: kdf.r, p: kdf.p } }
449 │         : { mode: 'none' },
450 │     sha256Hex,
451 │     crc32,
452 │     note: options.note,
453 │   });
454 │ 
455 │   const serialized = serializeManifest(manifest);
456 │   // Fragment payload budget = the same as a data block, so one manifest fragment
457 │   // fills one frame exactly under either wire encoding.
458 │   const fragments = splitManifest(serialized, Math.max(1, plan.blockSize));
459 │ 
460 │   // wireFlags() derives the Base32 flag from the plan, so the header always
461 │   // agrees with how the frame was actually written. Hard-coding it here once
462 │   // produced frames that claimed raw encoding while carrying base32 text.
463 │   const flags = FrameFlag.None | wireFlags(plan) |
464 │     (willEncrypt ? FrameFlag.Encrypted : FrameFlag.None) |
465 │     (codec === 'deflate' ? FrameFlag.Compressed : FrameFlag.None);
466 │ 
467 │   // "Saved by compression" must compare like with like: the payload BEFORE
468 │   // encryption, because the AEAD tag is framing overhead, not something
469 │   // compression failed to remove. Getting this wrong made a compressed encrypted
470 │   // transfer report 16 bytes less saving than it achieved.
471 │   const preEncryptionLength = wirePayload.length - (willEncrypt ? AEAD_TAG_BYTES : 0);
472 │   const saved = original.length - preEncryptionLength;
473 │ 
474 │   return {
475 │     sessionId,
476 │     code: sessionCode(sessionId),
477 │     manifest,
478 │     fragments,
479 │     plan,
480 │     wirePayload,
481 │     originalPayload: original,
482 │     flags,
483 │     compression: {
484 │       codec,
485 │       saved,
486 │       // >1 means compression helped ("2.4x smaller"); exactly 1 means it was not
487 │       // worth doing and the payload was stored as-is.
488 │       ratio: preEncryptionLength > 0 ? original.length / preEncryptionLength : 1,
489 │     },
490 │     encryption: encryptionMode,
491 │   };
492 │ }
493 │ 
494 │ /**
495 │  * Best-effort MIME type from a filename, for the receiver's preview.
496 │  * Deliberately small: the receiver never trusts it beyond choosing a preview
497 │  * widget, and never executes anything based on it.
498 │  */
499 │ export function guessMimeType(filename: string): string {
500 │   const lower = filename.toLowerCase();
501 │   const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
502 │   const table: Record<string, string> = {
503 │     txt: 'text/plain',
504 │     md: 'text/markdown',
505 │     csv: 'text/csv',
506 │     json: 'application/json',
507 │     xml: 'application/xml',
508 │     html: 'text/html',
509 │     js: 'text/javascript',
510 │     ts: 'text/plain',
511 │     pdf: 'application/pdf',
512 │     png: 'image/png',
513 │     jpg: 'image/jpeg',
514 │     jpeg: 'image/jpeg',
515 │     gif: 'image/gif',
516 │     webp: 'image/webp',
517 │     heic: 'image/heic',
518 │     mp4: 'video/mp4',
519 │     mov: 'video/quicktime',
520 │     webm: 'video/webm',
521 │     mp3: 'audio/mpeg',
522 │     m4a: 'audio/mp4',
523 │     wav: 'audio/wav',
524 │     zip: 'application/zip',
525 │     gz: 'application/gzip',
526 │     '7z': 'application/x-7z-compressed',
527 │     apk: 'application/vnd.android.package-archive',
528 │     doc: 'application/msword',
529 │     docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
530 │     xls: 'application/vnd.ms-excel',
531 │     xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
532 │     ppt: 'application/vnd.ms-powerpoint',
533 │     pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
534 │     vcf: 'text/vcard',
535 │     ics: 'text/calendar',
536 │   };
537 │   return table[ext] ?? 'application/octet-stream';
538 │ }
539 │ 
540 │ /** Text payload helper: wrap a string with a sensible filename and MIME type. */
541 │ export function textToSenderOptions(text: string): { data: Uint8Array; name: string; mime: string } {
542 │   const data = new TextEncoder().encode(text);
543 │   return { data, name: 'clipboard.txt', mime: 'text/plain' };
544 │ }
545 │ 
546 │ /** Diagnostics: does compression have a chance on this payload? */
547 │ export function compressionWorthTrying(data: Uint8Array): boolean {
548 │   return looksCompressible(data);
549 │ }
550 │ 
551 │ export { FRAME_HEADER_BYTES, deriveMaskBlock, buildDegreeDistribution };
```

---

## `packages/core/src/transfer/receiver.ts`

> 515 lines

**What it is.** The receiving half: a state machine fed by decoded symbols. The camera pipeline
(browser camera loop or synthetic harness) hands it the text or bytes of every successfully decoded QR symbol, plus
a timestamp and a quality metric; the receiver does everything else. It contains no camera code,
which is why the identical logic runs behind `getUserMedia` + `BarcodeDetector`/`jsQR`, the browser loopback workbench, and
the test suite (which feeds it pre-encoded symbols).


### Three things that make this more than a loop

1. **Problem frames are normal.** A camera pointed at a screen decodes garbage regularly, so every
   frame passes a chain of checks in increasing cost order: base32/byte normalisation, magic and
   version, header CRC-16, session match, then a payload-length check. Failures are **counted, not
   silently discarded** — the ratio of suspect to good frames is the single most useful diagnostic
   on the receiver screen, and it is what lets the app say "hold steadier" instead of "0%".
2. **Metadata arrives late.** Manifests repeat through the stream, so a receiver that starts
   mid-transfer learns K and the block size within a second. Until then data frames cannot be
   interpreted *at all* (K and blockSize are unknown), so they are counted as `orphan` and dropped.
3. **Verification is mandatory.** The payload is handed to the caller only after SHA-256 matches
   the manifest. Decryption and decompression happen *after* that, so a wrong passphrase or a
   truncated payload produces a precise message rather than a corrupt file.

### The counter set, and what each one tells the user

| Counter | Meaning | What a user should do |
| --- | --- | --- |
| `framesAccepted` | contributed new information | — |
| `framesDuplicate` | the same displayed frame was read twice | the camera is faster than the sender, or nothing is changing: fine, harmless |
| `framesRedundant` | new frame, no new information | normal near the end of a transfer |
| `framesSuspect` | header CRC failed, or payload length wrong | hold steadier / move closer / brighten the screen |
| `framesOrphan` | a data frame before any manifest | just started: wait one second |
| `framesForeign` | not a LightBeam frame, or another session | a stray QR code is in view |

Keeping `duplicate` and `redundant` separate is what makes those two rows honest rather than one
ambiguous "wasted frames" number.

### Session locking — the bug, and the rule that replaced it

Before a manifest is locked in, the receiver **deliberately does not lock onto the first frame it
sees**. The temptation is obvious ("a frame arrived, adopt its session"), and the failure is not:
a camera pointed at a wall of screens, or at any screen showing an unrelated QR code, latches onto
a stray session and then refuses the real manifest that arrives a moment later. Since there is no
back channel and no retry, the user just sees a transfer that never starts.

Manifest frames are the safe thing to lock on because they are self-identifying: the fragment
index/count come from the frame header, and the manifest's own `sid` must equal that header's
session id — a check made explicitly in `acceptManifestFrame`, counted as suspect if it fails.
Everything after that is decided by the session id that travels in **every** frame, which is the
reason the header carries one.

### `accept(symbol, now)` — the shape of the decision tree

`symbol` is `string | Uint8Array` because that is what platforms give you: iOS Vision and Android
ML Kit return strings; a browser decoder (jsQR) can return real bytes. `toFrameBytes` normalises in
a deliberate order:

1. a string that decodes as base32 **and** starts with the frame magic → a base32 frame;
2. otherwise a string whose character codes start with the magic → a byte-mode frame delivered as
   text;
3. raw bytes starting with the magic → a raw frame;
4. anything else → `null`, and the caller counts a foreign symbol.

The magic check inside each branch is what makes the order safe: trying base32 first cannot
mis-fire on a byte-mode string, because a mis-decode is overwhelmingly unlikely to start with
`0x4C` **and** pass a CRC-16 afterwards.

`now` is injectable purely so tests do not need a clock — the goodput window and the ETA are the
only time-dependent parts.

### `setPassphrase` — the case that needed its own method

The scenario: the sender encrypted the file, the receiver had no passphrase, collected every
block, and failed at the decryption step. The user then types the passphrase. Waiting for the
*next* frame to retry would work only while the sender is still transmitting — and the sender may
well have been stopped, because from its side the transfer is finished.

So `setPassphrase` checks whether the failure was a passphrase failure, and if the blocks are all
present it calls `finish()` **immediately**, with no further frames. It returns the resulting
`ReceiverPhase` so the calling UI can render the new state in the same tick.

### `finish()` — the order is the design


Integrity **before** decryption is a deliberate optimisation with a security flavour: scrypt costs
~32 MB and ~300 ms, and there is no reason to spend that on a payload that is provably broken. It
also means a damaged transfer reports "integrity check failed" (with both hashes, truncated to 12
hex characters) rather than "wrong passphrase", which is the difference between a user retyping a
passphrase and a user re-pointing the camera.

The associated data is `manifestAssociatedData(manifest)` — the shared builder. Where the local
copy used to be, there is now a comment explaining its removal:

> there is deliberately no local associated-data builder here. It used to exist, as a copy of the
> sender's — and a copy is exactly how the two sides drift apart until encrypted transfers stop
> working.

Step 4 catches a class of bug that is otherwise invisible: a decompressor that succeeds but
produces the wrong length (a truncated stream that inflate tolerates) would hand the user a
subtly short file. `olen` is the contract.

### `getProgress(now)` — what the UI actually reads

One call returns everything a progress screen needs: phase, fraction complete, all six counters,
goodput, ETA, the manifest, the integrity report, `awaitingPassphrase`, the error string and the
decoder's own stats.

- **Goodput uses a trailing 4-second window** (`GOODPUT_WINDOW_MS`), pruned on every call. Without
  the window, one stall would permanently poison the ETA; with it, the number recovers within
  seconds of the camera recovering.
- **The ETA is derived from measured goodput, not from the fountain model**: `remainingBlocks /
  goodputFps` in frames, converted to seconds. Below 0.1 fps it reports `Infinity` rather than a
  nonsense number, and at zero remaining blocks it reports 0 — the two degenerate cases a naive
  division would get wrong.
- **`awaitingPassphrase`** is a derived flag, not stored state: it is true when the phase is
  `failed`, the error mentions a passphrase, and the manifest claims encryption. The UI uses it to
  show a passphrase field instead of a generic error, and deriving it from the error string keeps
  the two from drifting.
- `stats` passes the decoder's internal counters straight through (peel operations, XOR operations,
  dense solves, matrix size) for the diagnostics panel. Two numbers there are worth knowing:
  `denseSolves > 0` means the fallback ran, and `denseMatrixSize` is how big the residual got.

### `partial()` — the honest preview

Returns the partially-received payload plus `knownBytes`/`totalBytes`. The UI uses it to render a
blurred or holey preview of an image long before the transfer finishes, which frequently tells the
operator more than a percentage does: you can *see* whether the camera framing is right. It returns
`null` when there is nothing useful yet (no decoder, no manifest, or already complete).

Note the arithmetic: `knownBytes` is computed by subtracting the **missing** ranges from
`manifest.len`, which is the pre-compression length. For a compressed transfer the partially known
bytes are compressed bytes, so this figure is an approximation of progress rather than an exact
count of the user's data — the *phase* and `progress` (blocks solved over K) are the quantities the
UI treats as authoritative, and `knownBytes` drives only the preview.

### `toFrameBytes` and `safeDecodeText`

`toFrameBytes` is described above. `safeDecodeText` returns `undefined` rather than throwing when a
text payload contains invalid UTF-8 — a `text/plain` file that is not really text is the sender's
problem to fix, and it must not turn a successful transfer into an exception at the receiver.

**Every line**

```ts
  1 │ /**
  2 │  * receiver.ts - the receiving side of a LightBeam transfer.
  3 │  *
  4 │  * The receiver is a *state machine fed by decoded symbols*. The camera pipeline
  5 │  * (browser camera scanner or loopback harness) hands it the text/bytes of every decoded
  6 │  * QR symbol, plus a timestamp and a quality metric; the receiver does the rest:
  7 │  *
  8 │  *   idle -> reading metadata -> collecting blocks -> verifying -> done
  9 │  *
 10 │  * It is deliberately free of camera code so the exact same logic runs behind a
 11 │  * browser `getUserMedia` scanner, the in-browser loopback workbench, and the
 12 │  * test suite (which feeds it pre-encoded symbols).
 13 │  *
 14 │  * THREE THINGS MAKE THIS MORE THAN A LOOP
 15 │  * ---------------------------------------
 16 │  * 1. PROBLEM FRAMES ARE NORMAL. A camera pointed at a screen decodes garbage
 17 │  *    regularly. Every frame therefore goes through, in order: magic/version check,
 18 │  *    header CRC-16, session match, and (for data frames) a length check. Frames
 19 │  *    that fail are counted in `suspect` rather than discarded silently, because
 20 │  *    the ratio of suspect to good frames is the single most useful diagnostic on
 21 │  *    the receiver screen ("hold steadier", "too far", "screen too dim").
 22 │  *
 23 │  * 2. METADATA ARRIVES LATE. The manifest is repeated through the stream so a
 24 │  *    receiver that starts mid-transfer still learns K and the block size within a
 25 │  *    second. Until then, data frames cannot be used (they need K and blockSize to
 26 │  *    be interpreted at all), so they are counted as `orphan` and dropped. Once the
 27 │  *    manifest lands, decoding proceeds from the frames that follow.
 28 │  *
 29 │  * 3. VERIFICATION IS MANDATORY. The payload is only handed to the caller after
 30 │  *    SHA-256 matches the manifest. Decrypt and decompress happen only after that,
 31 │  *    so a wrong passphrase or a truncated payload is reported precisely instead of
 32 │  *    producing a corrupt file.
 33 │  */
 34 │ 
 35 │ import { LTDecoder, type DecoderStats } from '../fountain/lt.js';
 36 │ import type { DegreeOptions } from '../fountain/degree.js';
 37 │ import {
 38 │   ManifestAssembler,
 39 │   manifestAssociatedData,
 40 │   manifestEncryptionParams,
 41 │   type Manifest,
 42 │ } from '../protocol/manifest.js';
 43 │ import { FRAME_MAGIC, FrameFlag, FrameType, parseFrameDetailed, type ParsedFrame } from '../protocol/frame.js';
 44 │ import { base32Decode } from '../util/base32.js';
 45 │ import { verifyPayload, type IntegrityReport } from '../crypto/integrity.js';
 46 │ import { decryptPayload } from '../crypto/aead.js';
 47 │ import { decompressPayload } from './compress.js';
 48 │ 
 49 │ export type ReceiverPhase =
 50 │   | 'waiting-for-manifest' // camera running, no manifest fragment yet
 51 │   | 'collecting' // decoding blocks
 52 │   | 'decrypting' // payload complete, key derivation running
 53 │   | 'verifying' // checking SHA-256
 54 │   | 'complete' // payload verified and ready
 55 │   | 'failed'; // unrecoverable (integrity failure, wrong passphrase, bad manifest)
 56 │ 
 57 │ export interface ReceiverOptions {
 58 │   /** Passphrase if the sender encrypted the payload (may be supplied later). */
 59 │   passphrase?: string;
 60 │   /** Degree distribution must match the sender's (default matches the sender). */
 61 │   degree?: DegreeOptions;
 62 │   /** Largest residual the dense solver will attempt. */
 63 │   denseLimit?: number;
 64 │   /** Frames without progress before a dense solve is attempted. */
 65 │   stallThreshold?: number;
 66 │   /**
 67 │    * Accept frames whose header CRC failed. Off by default: a bad header means the
 68 │    * session or seed is untrustworthy, and using it can poison the decoder. It is
 69 │    * offered because some cameras produce systematically mismatched CRCs on an
 70 │    * otherwise perfectly readable stream (a firmware quirk), and in that case
 71 │    * rejecting every frame would make the app unusable.
 72 │    */
 73 │   acceptSuspectHeaders?: boolean;
 74 │ }
 75 │ 
 76 │ export interface ReceiverProgress {
 77 │   phase: ReceiverPhase;
 78 │   /** 0..1 - fraction of source blocks recovered. */
 79 │   progress: number;
 80 │   blocksSolved: number;
 81 │   blocksTotal: number;
 82 │   framesAccepted: number;
 83 │   framesDuplicate: number;
 84 │   framesRedundant: number;
 85 │   framesSuspect: number;
 86 │   framesOrphan: number;
 87 │   framesForeign: number;
 88 │   /** Frames per second accepted over the last few seconds. */
 89 │   goodputFps: number;
 90 │   /** Effective payload throughput in bytes/second. */
 91 │   goodputBytesPerSecond: number;
 92 │   /** Seconds remaining, estimated from the current goodput. */
 93 │   etaSeconds: number;
 94 │   manifest: Manifest | null;
 95 │   integrity: IntegrityReport | null;
 96 │   /** Set when encryption is expected but no passphrase has been supplied. */
 97 │   awaitingPassphrase: boolean;
 98 │   error?: string;
 99 │   stats: DecoderStats | null;
100 │ }
101 │ 
102 │ export interface ReceiverResult {
103 │   /** Verified, decrypted, decompressed payload. */
104 │   payload: Uint8Array;
105 │   manifest: Manifest;
106 │   integrity: IntegrityReport;
107 │   /** Convenience copy for text transfers. */
108 │   text?: string;
109 │ }
110 │ 
111 │ const GOODPUT_WINDOW_MS = 4000;
112 │ 
113 │ export class TransferReceiver {
114 │   private phase: ReceiverPhase = 'waiting-for-manifest';
115 │   private manifest: Manifest | null = null;
116 │   private decoder: LTDecoder | null = null;
117 │   private opId = -1;
118 │   private assembler = new ManifestAssembler();
119 │   private passphrase: string | undefined;
120 │   private readonly degree?: DegreeOptions;
121 │   private readonly denseLimit: number;
122 │   private readonly stallThreshold: number;
123 │   private readonly acceptSuspectHeaders: boolean;
124 │ 
125 │   private framesAccepted = 0;
126 │   private framesDuplicate = 0;
127 │   private framesRedundant = 0;
128 │   private framesSuspect = 0;
129 │   private framesOrphan = 0;
130 │   private framesForeign = 0;
131 │   private integrity: IntegrityReport | null = null;
132 │   private error: string | undefined;
133 │   private result: ReceiverResult | null = null;
134 │   /** Timestamps of recently accepted frames, for the goodput window. */
135 │   private readonly recentFrames: number[] = [];
136 │   private startedAt = 0;
137 │   /** True once the first frame of any kind is seen, for the elapsed clock. */
138 │   private firstFrameAt = 0;
139 │ 
140 │   constructor(options: ReceiverOptions = {}) {
141 │     this.passphrase = options.passphrase?.trim() || undefined;
142 │     this.degree = options.degree;
143 │     this.denseLimit = options.denseLimit ?? 256;
144 │     this.stallThreshold = options.stallThreshold ?? 32;
145 │     this.acceptSuspectHeaders = options.acceptSuspectHeaders ?? false;
146 │   }
147 │ 
148 │   /**
149 │    * Supply or replace the passphrase (the UI does this after the manifest arrives).
150 │    *
151 │    * The common case this exists for: the sender encrypted the file, the receiver
152 │    * had no passphrase, collected every block, and failed at the decryption step.
153 │    * The user then types the passphrase. Waiting for the *next* frame to retry
154 │    * would work only while the sender is still transmitting - and the sender may
155 │    * well have been stopped, because from its side the transfer is done. So if the
156 │    * blocks are all present, retry the finish step immediately.
157 │    */
158 │   setPassphrase(passphrase: string, now = Date.now()): ReceiverPhase {
159 │     this.passphrase = passphrase.trim() || undefined;
160 │     // If the payload was already complete and waiting on a key, retry now.
161 │     if (this.phase === 'failed' && this.error?.includes('passphrase')) {
162 │       this.error = undefined;
163 │       this.phase = 'verifying';
164 │       if (this.decoder?.isComplete) this.finish(now);
165 │       else this.phase = 'collecting';
166 │     }
167 │     return this.phase;
168 │   }
169 │ 
170 │   get isComplete(): boolean {
171 │     return this.phase === 'complete';
172 │   }
173 │ 
174 │   get currentManifest(): Manifest | null {
175 │     return this.manifest;
176 │   }
177 │ 
178 │   /**
179 │    * Feed one decoded symbol.
180 │    *
181 │    * Accepts either form a platform decoder can produce:
182 │    *   - a STRING, which is what iOS Vision, Android ML Kit and most third-party
183 │    *     scanner apps return. Our default base32 wire encoding makes the whole
184 │    *     frame ASCII, so this is lossless (util/base32.ts explains why the frame
185 │    *     is encoded as text at all).
186 │    *   - RAW BYTES, which is what a browser decoder (jsQR) can hand back for a
187 │    *     byte-mode frame; used by the 'raw' wire encoding.
188 │    *
189 │    * @param symbol decoded symbol content
190 │    * @param now    optional timestamp (ms); injectable so tests do not need a clock
191 │    */
192 │   accept(symbol: string | Uint8Array, now = Date.now()): ReceiverPhase {
193 │     if (this.phase === 'complete' || this.phase === 'failed') return this.phase;
194 │     if (this.firstFrameAt === 0) this.firstFrameAt = now;
195 │ 
196 │     const bytes = toFrameBytes(symbol);
197 │     if (!bytes) {
198 │       this.framesForeign++;
199 │       return this.phase;
200 │     }
201 │ 
202 │     const parsed = parseFrameDetailed(bytes);
203 │     if (!parsed) {
204 │       // Not a LightBeam frame at all: a random QR code, or a misdecode.
205 │       this.framesForeign++;
206 │       return this.phase;
207 │     }
208 │     if (!parsed.headerValid && !this.acceptSuspectHeaders) {
209 │       this.framesSuspect++;
210 │       return this.phase;
211 │     }
212 │     if (!parsed.headerValid) this.framesSuspect++;
213 │ 
214 │     const frame = parsed.frame;
215 │ 
216 │     // Session filtering.
217 │     //
218 │     // Once a manifest is locked in, every frame must belong to it - the session id
219 │     // travels in every frame precisely so this is decidable.
220 │     //
221 │     // BEFORE that, we deliberately do NOT lock onto the first frame we happen to
222 │     // see: a camera pointed at a wall of screens (or at a screen showing a QR
223 │     // code unrelated to the transfer) would otherwise latch onto a stray session
224 │     // and refuse the real manifest that arrives a moment later. Manifest frames
225 │     // are self-identifying (fragment index/count plus the manifest's own sid,
226 │     // which must equal the frame header), so they are the safe thing to lock on.
227 │     if (this.manifest) {
228 │       if (frame.sessionId !== this.manifest.sid) {
229 │         this.framesForeign++;
230 │         return this.phase;
231 │       }
232 │     } else if (frame.type !== FrameType.Manifest) {
233 │       // A data frame before any manifest: unusable (K and blockSize unknown).
234 │       this.framesOrphan++;
235 │       return this.phase;
236 │     }
237 │ 
238 │     if (frame.type === FrameType.Manifest) {
239 │       return this.acceptManifestFrame(frame, now);
240 │     }
241 │ 
242 │     // Data frames need the manifest before they can be interpreted (K and
243 │     // blockSize are unknown until then).
244 │     if (!this.manifest || !this.decoder) {
245 │       this.framesOrphan++;
246 │       return this.phase;
247 │     }
248 │     if (frame.payload.length !== this.manifest.bs) {
249 │       // Wrong block size: a manifest mismatch, or a frame from another profile.
250 │       this.framesSuspect++;
251 │       return this.phase;
252 │     }
253 │ 
254 │     const outcome = this.decoder.addFrame(frame.seed, frame.payload);
255 │     if (outcome === 'duplicate') this.framesDuplicate++;
256 │     else if (outcome === 'redundant') this.framesRedundant++;
257 │     else {
258 │       this.framesAccepted++;
259 │       this.recentFrames.push(now);
260 │     }
261 │ 
262 │     if (this.decoder.isComplete) {
263 │       this.phase = 'verifying';
264 │       this.finish(now);
265 │     } else {
266 │       this.phase = 'collecting';
267 │     }
268 │     return this.phase;
269 │   }
270 │ 
271 │   private acceptManifestFrame(frame: ParsedFrame, now: number): ReceiverPhase {
272 │     let manifest: Manifest | null;
273 │     try {
274 │       manifest = this.assembler.accept(frame.payload);
275 │     } catch {
276 │       // A structurally invalid manifest is noise, not a fatal error.
277 │       this.framesSuspect++;
278 │       return this.phase;
279 │     }
280 │     if (!manifest) return this.phase;
281 │     if (manifest.sid !== frame.sessionId) {
282 │       // The manifest must agree with the frame header it arrived in.
283 │       this.framesSuspect++;
284 │       return this.phase;
285 │     }
286 │     if (this.manifest && this.manifest.sid === manifest.sid) return this.phase; // already have it
287 │ 
288 │     this.manifest = manifest;
289 │     this.opId = manifest.sid;
290 │     this.decoder = new LTDecoder({
291 │       k: manifest.k,
292 │       blockSize: manifest.bs,
293 │       sessionId: manifest.sid,
294 │       degree: this.degree,
295 │       payloadLength: manifest.len,
296 │       denseLimit: this.denseLimit,
297 │       stallThreshold: this.stallThreshold,
298 │     });
299 │     this.startedAt = now;
300 │     if (this.phase === 'waiting-for-manifest') this.phase = 'collecting';
301 │     return this.phase;
302 │   }
303 │ 
304 │   /** Verify, decrypt and decompress the completed payload. */
305 │   private finish(now: number): void {
306 │     const manifest = this.manifest!;
307 │     const decoder = this.decoder!;
308 │     const raw = decoder.reconstruct();
309 │ 
310 │     // 1. Integrity first: never spend CPU on scrypt for a payload that is broken.
311 │     const report = verifyPayload(raw, manifest.sha, manifest.crc);
312 │     this.integrity = report;
313 │     if (!report.ok) {
314 │       this.phase = 'failed';
315 │       this.error = `Integrity check failed (received ${report.bytes} bytes, sha256 ${report.actualSha256.slice(0, 12)}... != ${report.expectedSha256.slice(0, 12)}...)`;
316 │       return;
317 │     }
318 │ 
319 │     // 2. Decryption.
320 │     let payload = raw;
321 │     if (manifest.enc !== 'none') {
322 │       const params = manifestEncryptionParams(manifest);
323 │       if (!params) {
324 │         this.phase = 'failed';
325 │         this.error = 'Encrypted transfer is missing its key parameters';
326 │         return;
327 │       }
328 │       if (!this.passphrase) {
329 │         this.phase = 'failed';
330 │         this.error = 'This transfer is encrypted: enter the passphrase shown by the sender';
331 │         return;
332 │       }
333 │       this.phase = 'decrypting';
334 │       try {
335 │         payload = decryptPayload(
336 │           raw,
337 │           this.passphrase,
338 │           params.salt,
339 │           params.nonce,
340 │           manifestAssociatedData(manifest),
341 │           params.kdf,
342 │         );
343 │       } catch {
344 │         this.phase = 'failed';
345 │         this.error = 'Wrong passphrase, or the payload was modified in transit';
346 │         return;
347 │       }
348 │     }
349 │ 
350 │     // 3. Decompression.
351 │     let decoded: Uint8Array;
352 │     try {
353 │       decoded = decompressPayload(payload, manifest.codec);
354 │     } catch (cause) {
355 │       this.phase = 'failed';
356 │       this.error = `Could not decompress the payload: ${(cause as Error).message}`;
357 │       return;
358 │     }
359 │ 
360 │     if (decoded.length !== manifest.olen) {
361 │       this.phase = 'failed';
362 │       this.error = `Payload length mismatch after decompression (${decoded.length} != ${manifest.olen})`;
363 │       return;
364 │     }
365 │ 
366 │     const text = manifest.mime.startsWith('text/') ? safeDecodeText(decoded) : undefined;
367 │     this.result = { payload: decoded, manifest, integrity: report, text };
368 │     this.phase = 'complete';
369 │     void now;
370 │   }
371 │ 
372 │   /** Verified result, or null while the transfer is still running. */
373 │   getResult(): ReceiverResult | null {
374 │     return this.result;
375 │   }
376 │ 
377 │   /** Snapshot of everything the receiver UI shows. */
378 │   getProgress(now = Date.now()): ReceiverProgress {
379 │     const decoder = this.decoder;
380 │     const stats = decoder?.getStats() ?? null;
381 │     const blocksSolved = stats?.solved ?? 0;
382 │     const blocksTotal = this.manifest?.k ?? 0;
383 │ 
384 │     // Goodput over a trailing window, so a temporary stall does not permanently
385 │     // poison the ETA.
386 │     while (this.recentFrames.length > 0 && now - this.recentFrames[0] > GOODPUT_WINDOW_MS) {
387 │       this.recentFrames.shift();
388 │     }
389 │     const windowMs = this.recentFrames.length > 1 ? now - this.recentFrames[0] : 0;
390 │     const goodputFps = windowMs > 0 ? (this.recentFrames.length / windowMs) * 1000 : 0;
391 │     const bytesPerFrame = this.manifest?.bs ?? 0;
392 │     const goodputBytesPerSecond = goodputFps * bytesPerFrame;
393 │     const remainingBlocks = Math.max(0, blocksTotal - blocksSolved);
394 │     const etaSeconds =
395 │       goodputFps > 0.1 && remainingBlocks > 0 ? remainingBlocks / goodputFps : remainingBlocks > 0 ? Infinity : 0;
396 │ 
397 │     return {
398 │       phase: this.phase,
399 │       progress: blocksTotal > 0 ? blocksSolved / blocksTotal : 0,
400 │       blocksSolved,
401 │       blocksTotal,
402 │       framesAccepted: this.framesAccepted,
403 │       framesDuplicate: this.framesDuplicate,
404 │       framesRedundant: this.framesRedundant,
405 │       framesSuspect: this.framesSuspect,
406 │       framesOrphan: this.framesOrphan,
407 │       framesForeign: this.framesForeign,
408 │       goodputFps,
409 │       goodputBytesPerSecond,
410 │       etaSeconds,
411 │       manifest: this.manifest,
412 │       integrity: this.integrity,
413 │       awaitingPassphrase:
414 │         this.phase === 'failed' && !!this.error?.includes('passphrase') && this.manifest?.enc !== 'none',
415 │       error: this.error,
416 │       stats,
417 │     };
418 │   }
419 │ 
420 │   /**
421 │    * Partially received data, when the transfer is incomplete.
422 │    *
423 │    * Used by the UI to render a blurred/partial preview so the operator can see
424 │    * that the link is working - and, for images, whether the framing is correct -
425 │    * long before the last block arrives.
426 │    */
427 │   partial(): { data: Uint8Array; complete: boolean; knownBytes: number; totalBytes: number } | null {
428 │     if (!this.decoder || !this.manifest || this.isComplete) return null;
429 │     const best = this.decoder.bestEffort();
430 │     let knownBytes = 0;
431 │     for (const range of best.missingRanges) knownBytes += range.end - range.start;
432 │     return {
433 │       data: best.data,
434 │       complete: best.complete,
435 │       knownBytes: this.manifest.len - knownBytes,
436 │       totalBytes: this.manifest.len,
437 │     };
438 │   }
439 │ 
440 │   /** Elapsed milliseconds since the first frame or the manifest, whichever is later. */
441 │   elapsedMs(now = Date.now()): number {
442 │     const start = this.startedAt || this.firstFrameAt;
443 │     return start === 0 ? 0 : now - start;
444 │   }
445 │ 
446 │   reset(): void {
447 │     this.phase = 'waiting-for-manifest';
448 │     this.manifest = null;
449 │     this.decoder = null;
450 │     this.opId = -1;
451 │     this.assembler = new ManifestAssembler();
452 │     this.framesAccepted = 0;
453 │     this.framesDuplicate = 0;
454 │     this.framesRedundant = 0;
455 │     this.framesSuspect = 0;
456 │     this.framesOrphan = 0;
457 │     this.framesForeign = 0;
458 │     this.integrity = null;
459 │     this.error = undefined;
460 │     this.result = null;
461 │     this.recentFrames.length = 0;
462 │     this.startedAt = 0;
463 │     this.firstFrameAt = 0;
464 │   }
465 │ }
466 │ 
467 │ /**
468 │  * Normalise whatever the platform's QR decoder produced into frame bytes.
469 │  *
470 │  * Detection order matters and is cheap:
471 │  *   1. a string that is valid base32 and decodes to a frame magic -> base32 frame,
472 │  *   2. a string that is byte-mode content -> its char codes, if the magic matches,
473 │  *   3. raw bytes starting with the magic -> a raw frame.
474 │  * Anything else is not ours; the caller counts it as a foreign symbol.
475 │  */
476 │ function toFrameBytes(symbol: string | Uint8Array): Uint8Array | null {
477 │   if (typeof symbol === 'string') {
478 │     if (symbol.length === 0) return null;
479 │     try {
480 │       const decoded = base32Decode(symbol);
481 │       if (decoded.length > 0 && decoded[0] === FRAME_MAGIC) return decoded;
482 │     } catch {
483 │       // Not base32 text; fall through to the byte-mode interpretation.
484 │     }
485 │     const bytes = new Uint8Array(symbol.length);
486 │     for (let i = 0; i < symbol.length; i++) {
487 │       const code = symbol.charCodeAt(i);
488 │       if (code > 255) return null;
489 │       bytes[i] = code;
490 │     }
491 │     return bytes.length > 0 && bytes[0] === FRAME_MAGIC ? bytes : null;
492 │   }
493 │   return symbol.length > 0 && symbol[0] === FRAME_MAGIC ? symbol : null;
494 │ }
495 │ 
496 │ /**
497 │  * Associated data used by the AEAD, recomputed on the receiver from the manifest
498 │  * it received. Must match sender.buildAssociatedData byte for byte.
499 │  */
500 │ /*
501 │  * Note: there is deliberately no local associated-data builder here. It used to
502 │  * exist, as a copy of the sender's - and a copy is exactly how the two sides drift
503 │  * apart until encrypted transfers stop working. Both now call
504 │  * `manifestAssociatedData` from protocol/manifest.ts.
505 │  */
506 │ 
507 │ function safeDecodeText(bytes: Uint8Array): string | undefined {
508 │   try {
509 │     return new TextDecoder().decode(bytes);
510 │   } catch {
511 │     return undefined;
512 │   }
513 │ }
514 │ 
515 │ export { FrameFlag, FrameType };
```

---

## `packages/core/test/qr-encoder.test.ts`

> 261 lines

**What it proves, and how.** Every symbol this encoder produces is rasterised to pixels and
decoded with **jsQR** — an entirely separate implementation whose author has never seen this
code. If the bitstream, the Reed–Solomon block structure, the interleaving, the mask selection,
the format bits or the alignment patterns were wrong, jsQR would either fail or return different
bytes. There is no shared code and no shared table between the two, so agreement is evidence.

The header calls it "the strongest correctness check available without physical hardware", and
that is the right framing: this suite is a substitute for pointing a camera at a screen, and it
is a strict one — a camera would just fail to read a broken symbol, whereas jsQR tells us *what*
the symbol means.

**The four suites, and what each is for.**

| Suite | Tests | What it catches |
| --- | --- | --- |
| QR encoder — round trip through an independent decoder | 12 | everything in the encoding pipeline |
| Reed–Solomon encoder | 2 | the EC maths, independently of the symbol |
| SVG path rendering | 3 | the native renderer's geometry and its size budget |
| `sanitiseFileName` | 3 | path traversal from an untrusted filename |

**The round-trip suite, in order of increasing hostility:**

1. A short URL — the trivial case, which mostly proves the harness works.
2. Lowercase text, which **forces byte mode** (the alphanumeric alphabet is upper case only), so
   the byte path is exercised before any mode optimisation can hide a bug in it.
3. Digit strings — asserts `bitLength === 4 + 10 + 267`, i.e. numeric mode really was used.
   The comment explains why the assertion is on **bits and not on the version**: byte mode would
   also have fit in version 5, so comparing versions would have passed without proving anything.
4. Alphanumeric — `bitLength < text.length * 8`, the same trick.
5. Multi-byte UTF-8 including Devanagari, an emoji and a combining diaeresis — with
   `boostEcLevel: false` so the symbol stays small enough to keep the case honest.
6. **Every EC level × {(boost on), (boost off)}** — eight combinations, because EC boosting
   changes the block layout, and a block-layout bug is exactly what a single-configuration test
   would miss.
7. **Every mask pattern**, asserting `symbol.mask` equals the requested one — so a future change
   to the penalty scoring cannot silently break the "force mask 0..7" contract that the sender
   relies on for geometry locking.
8. All 256 byte values — the payload that catches sign-extension bugs (`>>> 8` versus `>> 8`).
9. **The exact capacity boundary** — a payload of exactly `maxBytePayload(5, 'L')` bytes must fit,
   which exercises the terminator-clipping path in `encoder.ts` (`Math.min(4, capacity − written)`).
   A test one byte *under* capacity would never reach that code.
10. One byte over capacity must throw, with a message matching `/does not fit/`.
11. A version-40 symbol, 2953 bytes, decoded at scale 3 — the largest thing the format holds, and
    the case where the interleaving bug (group 1 short blocks first) actually shows up.
12. Ink coverage between 0.3 and 0.7 — the property the mask's N4 penalty is trying to optimise,
    asserted as a range rather than an exact value.

**The Reed–Solomon suite.** The first test checks every EC degree that occurs in ISO 18004 by
encoding, appending the parity, and running the syndrome check (`rsVerify`). The second pins the
**published worked example** byte for byte (`0xA5 0x24 0xD4 0xC1 …` for a known 16-byte data
block at degree 10), and the comment now says why that is stronger than the syndrome check: a
wrong generator polynomial could produce zero syndromes for a carefully chosen data block, but it
cannot reproduce the standard's own numbers.

> Two things were wrong in this file and were fixed while writing this walkthrough: the EC-degree
> loop was built by iterating the EC levels and discarding the loop variable (a no-op that made
> the real subject of the test — the degree list — look like a derived value), and the
> `describe('Reed-Solomon encoder')` block was **never closed**, so the SVG suite was nested
> inside it and every test report named those three tests under the wrong parent. Both are the
> kind of defect a walkthrough of the file is good at surfacing, because writing prose forces you
> to read the braces.

**The SVG path suite** is the one that protects the *native* renderer:

- It asserts the emitted string matches `/^(M\d+ \d+h\d+v1h-\d+z)+$/` — rectangles only, in module
  units — and that the number of runs is **≤ the number of dark modules**, i.e. merging happened
  but never invented geometry.
- Every coordinate is checked to sit inside the quiet-zoned square. A symbol drawn without its
  quiet zone often scans in a lab and fails in a room, so this is a real invariant, not
  bookkeeping.
- `toSvg`'s embedded `<path d="…">` must be **byte-identical** to `toSvgPath`'s output. Two
  renderers drawing "the same" geometry is a classic drift point; asserting identity is the only
  way to keep them honest.
- The size budget test carries the measured table (version 1/15/27 → ~3.5 characters per module)
  and asserts under 4 chars/module. The comment's conclusion is worth repeating: because a QR
  symbol is deliberately high-frequency, horizontal run merging saves far less than one might
  expect (mean run length ~1.3 modules), so the answer to a slow device is a smaller profile or a
  lower frame rate — both user-visible settings — "not a cleverer path syntax".

**The `sanitiseFileName` suite** is a security test, and it reads like one: `../../etc/passwd`,
`/tmp/evil.sh`, `a\b\c.txt`, `..`, `.hidden`, `...`, embedded NUL and the Windows-reserved set,
whitespace collapsing, the 200-character cap and the empty-input fallback. The name arrives from
the *other* device, so it is untrusted input — and `..` on its own resolving to `received.bin`
rather than to something empty is the case that matters most.

**Every line**

```ts
  1 │ /**
  2 │  * qr-encoder.test.ts - round-trip verification of the QR encoder.
  3 │  *
  4 │  * Method: encode payloads with our encoder, rasterise to an RGBA image, then
  5 │  * decode that image with jsQR - a completely independent decoder implementation.
  6 │  * If our bitstream, Reed-Solomon blocks, interleaving, mask, or format bits were
  7 │  * wrong, jsQR would either fail or return different data. This is the strongest
  8 │  * correctness check available without physical hardware.
  9 │  */
 10 │ 
 11 │ import { describe, expect, it } from 'vitest';
 12 │ import jsQR from 'jsqr';
 13 │ import { encodeBinary, encodeText, maxBytePayload } from '../src/qr/encoder.js';
 14 │ import { rasterizeRgba, inkCoverage, toSvg, toSvgPath, moduleCountWithQuietZone } from '../src/qr/render.js';
 15 │ import { rsEncode, rsVerify } from '../src/qr/reed-solomon.js';
 16 │ import { sanitiseFileName } from '../src/util/bytes.js';
 17 │ import type { EcLevel } from '../src/qr/tables.js';
 18 │ 
 19 │ /** Encode -> rasterise -> decode with jsQR. Returns the decoded text. */
 20 │ function roundTrip(payload: string, options: Parameters<typeof encodeText>[1] = {}, scale = 4): string {
 21 │   const symbol = encodeText(payload, options);
 22 │   const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
 23 │   const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
 24 │   expect(result, `jsQR failed to decode: "${payload.slice(0, 40)}"`).not.toBeNull();
 25 │   return result!.data;
 26 │ }
 27 │ 
 28 │ /** Round-trip a byte payload through byte mode (the binary transfer path). */
 29 │ function roundTripBinary(bytes: Uint8Array, options: Parameters<typeof encodeBinary>[1] = {}, scale = 4): number[] {
 30 │   const symbol = encodeBinary(bytes, options);
 31 │   const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
 32 │   const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
 33 │   expect(result, `jsQR failed to decode ${bytes.length} bytes`).not.toBeNull();
 34 │   return Array.from(result!.binaryData);
 35 │ }
 36 │ 
 37 │ describe('QR encoder - round trip through an independent decoder', () => {
 38 │   it('encodes a short URL', () => {
 39 │     expect(roundTrip('https://lightbeam.app/r/AB12CD')).toBe('https://lightbeam.app/r/AB12CD');
 40 │   });
 41 │ 
 42 │   it('encodes plain text with lowercase (forces byte mode)', () => {
 43 │     const text = 'LightBeam: transfer files with light, no network required.';
 44 │     expect(roundTrip(text)).toBe(text);
 45 │   });
 46 │ 
 47 │   it('exploits numeric mode for digit strings', () => {
 48 │     const digits = '1234567890'.repeat(8);
 49 │     const symbol = encodeText(digits);
 50 │     // Numeric mode at ~3.33 bits/char: 80 digits need about 267 bits + headers,
 51 │     // i.e. a version 5-L symbol (data capacity 864 bits). Byte mode would need
 52 │     // 640 bits + header, which also fits v5 - so assert on the *bits*, not the
 53 │     // version, to keep the test meaningful:
 54 │     // 4 (mode) + 10 (count) + 267 payload bits (26 triples x 10 bits + 7 bits).
 55 │     expect(symbol.bitLength).toBe(4 + 10 + 267);
 56 │     expect(roundTrip(digits)).toBe(digits);
 57 │   });
 58 │ 
 59 │   it('exploits alphanumeric mode', () => {
 60 │     const text = 'LIGHTBEAM 2026-09-24 TEST 12345';
 61 │     const symbol = encodeText(text);
 62 │     // 11 bits per 2 chars instead of 8 bits per char.
 63 │     expect(symbol.bitLength).toBeLessThan(text.length * 8);
 64 │     expect(roundTrip(text)).toBe(text);
 65 │   });
 66 │ 
 67 │   it('handles multi-byte UTF-8 text', () => {
 68 │     const text = 'नमस्ते 🌈 Ünïcödé — 光';
 69 │     expect(roundTrip(text, { boostEcLevel: false })).toBe(text);
 70 │   });
 71 │ 
 72 │   it('round-trips every error correction level', () => {
 73 │     const payload = 'LIGHTBEAM-EC-TEST-';
 74 │     for (const ecLevel of ['L', 'M', 'Q', 'H'] as EcLevel[]) {
 75 │       for (const boostEcLevel of [true, false]) {
 76 │         const symbol = encodeText(payload, { ecLevel, boostEcLevel });
 77 │         const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
 78 │         const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
 79 │         expect(result?.data, `failed for ${ecLevel} boost=${boostEcLevel}`).toBe(payload);
 80 │       }
 81 │     }
 82 │   });
 83 │ 
 84 │   it('round-trips every mask pattern', () => {
 85 │     const payload = 'MASK-PATTERN-COVERAGE-0123456789';
 86 │     for (let mask = 0; mask < 8; mask++) {
 87 │       const symbol = encodeText(payload, { mask });
 88 │       expect(symbol.mask).toBe(mask);
 89 │       const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
 90 │       const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
 91 │       expect(result?.data, `failed for mask ${mask}`).toBe(payload);
 92 │     }
 93 │   });
 94 │ 
 95 │   it('round-trips binary payloads (byte mode, all 256 byte values)', () => {
 96 │     const bytes = new Uint8Array(256);
 97 │     for (let i = 0; i < 256; i++) bytes[i] = i;
 98 │     expect(roundTripBinary(bytes)).toEqual(Array.from(bytes));
 99 │   });
100 │ 
101 │   it('round-trips a payload at the exact capacity boundary', () => {
102 │     // Version 5-L holds 106 codewords; byte mode needs 4 + 8 bits of header.
103 │     const capacity = maxBytePayload(5, 'L');
104 │     expect(capacity).toBeGreaterThan(100);
105 │     const bytes = new Uint8Array(capacity);
106 │     for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
107 │     expect(roundTripBinary(bytes, { minVersion: 5, maxVersion: 5, ecLevel: 'L', boostEcLevel: false })).toEqual(
108 │       Array.from(bytes),
109 │     );
110 │   });
111 │ 
112 │   it('rejects a payload that is one byte over capacity', () => {
113 │     const capacity = maxBytePayload(5, 'L');
114 │     const bytes = new Uint8Array(capacity + 1);
115 │     expect(() =>
116 │       encodeBinary(bytes, { minVersion: 5, maxVersion: 5, ecLevel: 'L', boostEcLevel: false }),
117 │     ).toThrow(/does not fit/);
118 │   });
119 │ 
120 │   it('round-trips a large version-40 symbol', () => {
121 │     // 2953 bytes is the byte-mode ceiling for version 40-L.
122 │     const bytes = new Uint8Array(2953);
123 │     for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff;
124 │     const symbol = encodeBinary(bytes, { ecLevel: 'L', boostEcLevel: false });
125 │     expect(symbol.version).toBe(40);
126 │     expect(symbol.size).toBe(177);
127 │     const image = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
128 │     const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
129 │     expect(result).not.toBeNull();
130 │     expect(Array.from(result!.binaryData)).toEqual(Array.from(bytes));
131 │   });
132 │ 
133 │   it('produces a symbol with a balanced ink coverage', () => {
134 │     const symbol = encodeText('LIGHTBEAM INK COVERAGE TEST 0123456789', {});
135 │     const coverage = inkCoverage(symbol);
136 │     expect(coverage).toBeGreaterThan(0.3);
137 │     expect(coverage).toBeLessThan(0.7);
138 │   });
139 │ });
140 │ 
141 │ describe('Reed-Solomon encoder', () => {
142 │   it('produces valid codewords for every EC width used by QR', () => {
143 │     // Every degree that actually occurs in ISO 18004 across the 40 versions x 4
144 │     // EC levels. (An earlier revision built this set by looping over the EC levels
145 │     // and discarding the loop variable - a no-op that hid the fact that the list
146 │     // below is the real subject of the test.)
147 │     const degrees = [7, 10, 13, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30];
148 │     for (const degree of degrees) {
149 │       const data = new Uint8Array(40);
150 │       for (let i = 0; i < data.length; i++) data[i] = (i * 17 + degree) & 0xff;
151 │       const parity = rsEncode(data, degree);
152 │       expect(parity.length).toBe(degree);
153 │       const codeword = new Uint8Array(data.length + parity.length);
154 │       codeword.set(data);
155 │       codeword.set(parity, data.length);
156 │       expect(rsVerify(codeword, degree), `syndrome check failed for degree ${degree}`).toBe(true);
157 │     }
158 │   });
159 │ 
160 │   it('matches the worked example from ISO/IEC 18004 (Annex I)', () => {
161 │     // The published worked example: 16 data codewords, 10 EC codewords, giving the
162 │     // parity block 0xA5 0x24 0xD4 ... This is a stronger assertion than the
163 │     // syndrome check above: a wrong generator polynomial could still produce a
164 │     // codeword whose syndromes all vanish if the data were chosen adversarially,
165 │     // whereas matching the standard's own numbers byte for byte cannot be
166 │     // satisfied by an implementation that differs from the standard.
167 │     const data = Uint8Array.from([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]);
168 │     const parity = rsEncode(data, 10);
169 │     expect(Array.from(parity)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
170 │   });
171 │ });
172 │ 
173 │ describe('SVG path rendering (used by the native app)', () => {
174 │   it('emits one merged rectangle per run of dark modules, in module units', () => {
175 │     const symbol = encodeText('hello', { minVersion: 1, maxVersion: 1, ecLevel: 'M' });
176 │     const path = toSvgPath(symbol, { quietZone: 4 });
177 │     // Rectangle subpaths only, one per horizontal run.
178 │     expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
179 │     // Mostly runs of length >= 1; merging must have happened.
180 │     const runs = path.split('M').length - 1;
181 │     let darkModules = 0;
182 │     for (const value of symbol.modules) darkModules += value;
183 │     expect(runs).toBeGreaterThan(0);
184 │     expect(runs).toBeLessThanOrEqual(darkModules);
185 │     // Every coordinate sits inside the quiet-zoned square.
186 │     const limit = moduleCountWithQuietZone(symbol, 4);
187 │     for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
188 │       const [x, y, run] = [Number(match[1]), Number(match[2]), Number(match[3])];
189 │       expect(x).toBeGreaterThanOrEqual(4);
190 │       expect(y).toBeGreaterThanOrEqual(4);
191 │       expect(x + run).toBeLessThanOrEqual(limit - 4);
192 │     }
193 │   });
194 │ 
195 │   it('renders the same geometry as the SVG rasteriser', () => {
196 │     const symbol = encodeText('geometry check', { minVersion: 2, maxVersion: 2, ecLevel: 'M' });
197 │     const svg = toSvg(symbol, { scale: 1, quietZone: 4 });
198 │     const path = toSvgPath(symbol, { quietZone: 4 });
199 │     // The `<path d="...">` inside toSvg() must be byte-identical to toSvgPath().
200 │     const embedded = /<path d="([^"]*)"/.exec(svg)?.[1];
201 │     expect(embedded).toBe(path);
202 │   });
203 │ 
204 │   it('stays within the size budget the native renderer rebuilds every frame', () => {
205 │     // Measured cost, and the numbers the native app is designed around:
206 │     //
207 │     //   version  modules  dark  runs  path chars   chars/module
208 │     //      1       21      222   ~170     1.5 k         3.50
209 │     //     15       77     3018  ~2300    20.4 k         3.45
210 │     //     27      125     7516  ~5800    57.2 k         3.66
211 │     //
212 │     // A QR symbol is deliberately high-frequency, so horizontal merging of dark
213 │     // runs saves far less than one might expect (mean run length is only ~1.3
214 │     // modules). The budget below is therefore "under 4 characters per module",
215 │     // which keeps the inline `<svg><path/></svg>` fallback compact: ~20 kB of path
216 │     // string per frame at 77 modules, rebuilt 15 times a second on the UI thread.
217 │     // If a low-end device cannot keep up, the answer is a smaller profile or a
218 │     // lower frame rate - both user-visible settings - not a cleverer path syntax.
219 │     for (const [version, maxCharsPerModule] of [
220 │       [1, 4],
221 │       [15, 3.6],
222 │       [27, 3.8],
223 │     ] as const) {
224 │       const symbol = encodeText('x'.repeat(10), {
225 │         minVersion: version,
226 │         maxVersion: version,
227 │         ecLevel: 'L',
228 │       });
229 │       const path = toSvgPath(symbol);
230 │       const perModule = path.length / (symbol.size * symbol.size);
231 │       expect(perModule).toBeLessThan(maxCharsPerModule);
232 │       // Sanity: merging must never produce more runs than there are dark modules.
233 │       let dark = 0;
234 │       for (const value of symbol.modules) dark += value;
235 │       expect(path.split('M').length - 1).toBeLessThanOrEqual(dark);
236 │     }
237 │   });
238 │ });
239 │ 
240 │ describe('sanitiseFileName (must never escape the receiver inbox)', () => {
241 │   it('strips directory components and traversal', () => {
242 │     expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
243 │     expect(sanitiseFileName('/tmp/evil.sh')).toBe('evil.sh');
244 │     expect(sanitiseFileName('a\\b\\c.txt')).toBe('c.txt');
245 │     expect(sanitiseFileName('..')).toBe('received.bin');
246 │     expect(sanitiseFileName('.hidden')).toBe('hidden');
247 │     expect(sanitiseFileName('...')).toBe('received.bin');
248 │   });
249 │ 
250 │   it('removes control characters and platform-hostile ones', () => {
251 │     expect(sanitiseFileName('in\u0000voice<>:"|?*.pdf')).toBe('invoice_______.pdf');
252 │     expect(sanitiseFileName('  spaced   out.txt  ')).toBe('spaced out.txt');
253 │   });
254 │ 
255 │   it('caps the length and still produces something usable', () => {
256 │     const long = sanitiseFileName(`${'x'.repeat(400)}.txt`);
257 │     expect(long.length).toBe(200);
258 │     expect(sanitiseFileName('')).toBe('received.bin');
259 │     expect(sanitiseFileName('   ')).toBe('received.bin');
260 │   });
261 │ });
```

---

## `packages/core/test/fountain.test.ts`

> 575 lines

**What it proves.** Not "does the fountain code decode" — that is the easy question — but **how
many extra frames it needs**. These are Monte Carlo simulations of a receiver behind a lossy
channel asserting on the measured overhead ratio (frames received ÷ K), which is the number that
decides how long a real transfer takes. The header lists the literature reference points
(ideal soliton ≈ 5% overhead with a heavy tail; robust soliton with c = 0.03, δ = 0.5 typically
3–10%) so the numbers below can be compared against something other than themselves.

**The harness.** `simulateTransfer` is the important part: an encoder, a decoder and a channel
model in one function, returning `{decoded, framesSent, framesReceived, k, overhead, complete,
stats}`. The channel keeps each frame with probability `keep` **plus** periodic bursts of
consecutive losses — because a camera channel loses frames in bursts (autofocus hunts, a hand
crossing the lens, rolling shutter), and a purely random loss model would flatter the fountain
code's tail behaviour. `randomPayload` seeds its `Rng` rather than using `Math.random`, so every
run is reproducible; a flaky measurement is worse than no measurement.

### The suites

**`degree distributions` (4 tests).** Shape rather than sampled values: the ideal soliton sums to
1 with ρ(1) = 1/k, the robust soliton adds the degree-1/tail spike and stays normalised, the mean
degree stays small (it is the XOR cost per frame), and tiny k degenerates gracefully. These assert
*properties* so that re-tuning `c` does not invalidate the tests, which is exactly what you want
from a tuning-adjacent suite.

**`neighbour derivation` (4 tests).** Determinism for a seed and session; **distinctness**, which
is the property the decoder silently depends on (a repeated index cancels itself in the XOR and
lowers the effective degree); decorrelation across sessions (so two sessions in the same room
cannot derive the same frames); and coverage — over 4 000 frames, every one of 500 blocks is
covered at least once.

**`LT round trip` (12 tests).** The substantive ones:

| Test | What it establishes |
| --- | --- |
| systematic prefix delivers blocks immediately | after `prefix + 1` frames, progress ≥ prefix/k *and* the transfer is not complete — i.e. the prefix gives early data without pretending to be the whole thing |
| clean channel close to theoretical minimum | mean overhead over **6 sessions** is between 1.0 and 1.45; the comment explains why a mean and not a single run: LT decoding is heavy-tailed, so one session can need 1.6× while the mean is 1.2× |
| tuned prefix beats a full prefix under loss | asserts the *finding* behind `SYSTEMATIC_PREFIX_FRACTION` rather than a magic constant, at 30% loss over 4 sessions |
| non-block-aligned payload | 5 000 bytes with 512-byte blocks — exact byte equality, which is where the zero-padding must be trimmed correctly |
| 30% random loss | mean overhead < 1.3, with the comment clarifying that this is frames *received* per block: the honest efficiency of the code itself, independent of how much the channel drops |
| 50% loss + 40-frame blackouts | completes with overhead < 1.6 — the burst model is what makes this a real test |
| duplicate frames | frame 0 sent 100 times counts once: `duplicates === 99` and progress is exactly 1/k |
| dense GF(2) fallback | see below |
| missing ranges via bestEffort | the first missing range is exactly `{start: 2·blockSize, end: 3·blockSize}` |
| zeroed-block aliasing regression | 200 randomised sessions, each asserted complete **and byte-exact** — the regression test for the self-XOR bug |
| single-block edge case | k = 1, payload shorter than the block |
| scales to thousands of blocks | 2 MB in 1 024-byte blocks (k = 2 048) at 25% loss inside 20 s — a budget, not a benchmark |

**The dense-fallback test was wrong, and this is worth recording.** As written it fed four
*systematic* frames (with an explicit full prefix) and asserted only that four frames had been
received. It never constructed a stall, never entered `maybeDenseSolve`, and never asserted that
the solver ran — so the suite had **no coverage at all** of the code path that exists to stop a
real transfer stalling at 97%.

Rewriting it required constructing a genuine stall, which turns out to be delicate:

- **The test searches for the frames it needs** rather than hard-coding seeds: it scans LT indices
  for exact neighbour sets (`{0}`, `{1,2,3}`, `{2,3}`, `{1,2}`) and feeds those. Hard-coded seeds
  would silently stop testing anything the moment the distribution or the sampler changed.
- **The residual must be solvable and degree ≥ 2 throughout.** The chosen system is
  `x1^x2^x3 = A`, `x2^x3 = B`, `x1^x2 = C` — rank 3, but no equation is degree 1 once block 0 is
  solved, so peeling cannot move and only elimination can finish it.
- **The first attempt used the three pairwise sums `{2,3}`, `{2,4}`, `{3,4}` and failed** — and
  correctly so: in GF(2), `110 ^ 101 ^ 011 = 000`, i.e. the three equations are linearly
  **dependent**, so the system is underdetermined and there is nothing to solve. The solver
  refusing to produce an answer there is the right behaviour; the bug was in the construction.
  The comment in the test now records that, so the next person does not repeat it.
- `stallThreshold: 0` makes the escalation immediate; `denseLimit: 8` is generous for a 3×3
  residual. The assertions are `denseSolves >= 1` and `denseMatrixSize === 3`, i.e. the finish
  provably came from elimination rather than from a lucky low-degree frame.

**`mask derivation`, `frame-count estimate`, `neighbour sampler statistics` (6 tests).** The mask
is identical on both sides and differs between sessions. `expectedFramesFor` is above K and grows
*sub-linearly* (10× the blocks must not cost 10× the absolute overhead). The sampler statistics
are the ones that would have caught the biased shuffle: **history independence** (derive seed 500
directly, then again after 1 000 other frames — identical), near-uniform index coverage measured
in standard deviations of a binomial count (`worst < 5σ`, deliberately generous so the test
catches bias rather than re-rolling the PRNG), the **first-half/second-half ratio between 0.9 and
1.1** (the direct regression test for the earlier biased shuffle, which favoured low indices), and
a **worst-case degree** test: a synthetic uniform distribution with mean degree k/2 = 2 048, 200
frames, asserted under 5 s — where the O(degree²) sampler would need tens of millions of
comparisons.

**Every line**

```ts
  1 │ /**
  2 │  * fountain.test.ts - correctness and *measured* efficiency of the LT code.
  3 │  *
  4 │  * The interesting property of a fountain code is not "does it decode" but "how
  5 │  * many extra frames does it need". These tests therefore run Monte Carlo
  6 │  * simulations of a receiver behind a lossy channel and assert on the measured
  7 │  * overhead ratio (frames received / source blocks K), which is the number that
  8 │  * decides how long a real transfer takes.
  9 │  *
 10 │  * Reference points from the LT literature: ideal soliton decodes with a mean
 11 │  * overhead around 5% and a heavy tail; robust soliton with c = 0.03, delta = 0.5
 12 │  * typically lands in the 3-10% range. A camera channel also loses frames *in
 13 │  * bursts* (autofocus hunts, rolling shutter, a hand crossing the lens), which is
 14 │  * modelled explicitly by the burst-loss scenarios below.
 15 │  */
 16 │ 
 17 │ import { describe, expect, it } from 'vitest';
 18 │ import {
 19 │   LTDecoder,
 20 │   LTEncoder,
 21 │   defaultSystematicPrefix,
 22 │   deriveMaskBlock,
 23 │   frameNeighbours,
 24 │   expectedFramesFor,
 25 │ } from '../src/fountain/lt.js';
 26 │ import {
 27 │   buildDegreeDistribution,
 28 │   describeDistribution,
 29 │   robustSolitonPmf,
 30 │   idealSolitonPmf,
 31 │ } from '../src/fountain/degree.js';
 32 │ import { Rng } from '../src/util/rng.js';
 33 │ 
 34 │ function randomPayload(length: number, seed = 12345): Uint8Array {
 35 │   const rng = new Rng(seed);
 36 │   const out = new Uint8Array(length);
 37 │   for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
 38 │   return out;
 39 │ }
 40 │ 
 41 │ /**
 42 │  * Simulate a channel that keeps each frame with probability `keep`, plus
 43 │  * occasional bursts of consecutive losses (a hand, a glare, an autofocus hunt).
 44 │  */
 45 │ function simulateTransfer(config: {
 46 │   payloadLength: number;
 47 │   blockSize: number;
 48 │   sessionId: number;
 49 │   keep: number;
 50 │   burst?: { every: number; length: number };
 51 │   maxFrames?: number;
 52 │   seed?: number;
 53 │ }): {
 54 │   decoded: Uint8Array | null;
 55 │   framesSent: number;
 56 │   framesReceived: number;
 57 │   k: number;
 58 │   overhead: number;
 59 │   complete: boolean;
 60 │   stats: ReturnType<LTDecoder['getStats']>;
 61 │ } {
 62 │   const payload = randomPayload(config.payloadLength, 987);
 63 │   const k = Math.ceil(config.payloadLength / config.blockSize);
 64 │   const encoder = new LTEncoder(payload, {
 65 │     k,
 66 │     blockSize: config.blockSize,
 67 │     sessionId: config.sessionId,
 68 │     payloadLength: config.payloadLength,
 69 │   });
 70 │   const decoder = new LTDecoder({
 71 │     k,
 72 │     blockSize: config.blockSize,
 73 │     sessionId: config.sessionId,
 74 │     payloadLength: config.payloadLength,
 75 │   });
 76 │ 
 77 │   const rng = new Rng(config.seed ?? 4242);
 78 │   const maxFrames = config.maxFrames ?? Math.ceil(k * 3 + 500);
 79 │   let framesSent = 0;
 80 │   let framesReceived = 0;
 81 │   let inBurst = 0;
 82 │   let sinceBurst = 0;
 83 │ 
 84 │   for (let seed = 0; seed < maxFrames; seed++) {
 85 │     framesSent++;
 86 │     // Decide whether this frame survives the channel.
 87 │     let kept = rng.nextFloat() < config.keep;
 88 │     if (config.burst) {
 89 │       if (inBurst > 0) {
 90 │         inBurst--;
 91 │         kept = false;
 92 │       } else if (++sinceBurst >= config.burst.every) {
 93 │         sinceBurst = 0;
 94 │         inBurst = config.burst.length - 1;
 95 │         kept = false;
 96 │       }
 97 │     }
 98 │     if (!kept) continue;
 99 │ 
100 │     const frame = encoder.encode(seed);
101 │     const outcome = decoder.addFrame(seed, frame);
102 │     framesReceived++;
103 │     void outcome;
104 │     if (decoder.isComplete) {
105 │       const decoded = decoder.reconstruct();
106 │       return {
107 │         decoded,
108 │         framesSent,
109 │         framesReceived,
110 │         k,
111 │         overhead: framesReceived / k,
112 │         complete: true,
113 │         stats: decoder.getStats(),
114 │       };
115 │     }
116 │   }
117 │   return {
118 │     decoded: null,
119 │     framesSent,
120 │     framesReceived,
121 │     k,
122 │     overhead: framesReceived / k,
123 │     complete: false,
124 │     stats: decoder.getStats(),
125 │   };
126 │ }
127 │ 
128 │ describe('degree distributions', () => {
129 │   it('ideal soliton sums to 1 and has the expected shape', () => {
130 │     const pmf = idealSolitonPmf(1000);
131 │     const sum = pmf.reduce((a, b) => a + b, 0);
132 │     expect(sum).toBeCloseTo(1, 6);
133 │     expect(pmf[0]).toBeCloseTo(1 / 1000, 9);
134 │     // rho(2) = 1/2 dominates: a plain ideal soliton mostly emits degree 2.
135 │     expect(pmf[1]).toBeCloseTo(0.5, 9);
136 │   });
137 │ 
138 │   it('robust soliton adds the degree-1/tail spike and stays normalised', () => {
139 │     const k = 1000;
140 │     const rho = idealSolitonPmf(k);
141 │     const mu = robustSolitonPmf(k, 0.03, 0.5);
142 │     const sum = mu.reduce((a, b) => a + b, 0);
143 │     expect(sum).toBeCloseTo(1, 6);
144 │     // The spike lifts degree 1 well above the ideal soliton's 1/K.
145 │     expect(mu[0]).toBeGreaterThan(rho[0] * 1.5);
146 │   });
147 │ 
148 │   it('reports a mean degree that stays small (XOR cost per frame)', () => {
149 │     const dist = buildDegreeDistribution(1000);
150 │     const info = describeDistribution(dist);
151 │     expect(info.meanDegree).toBeGreaterThan(1.5);
152 │     expect(info.meanDegree).toBeLessThan(30);
153 │     expect(info.pDegree1).toBeGreaterThan(0.001);
154 │   });
155 │ 
156 │   it('degenerates gracefully for tiny block counts', () => {
157 │     for (const k of [1, 2, 3]) {
158 │       const dist = buildDegreeDistribution(k);
159 │       expect(dist.cdf[dist.cdf.length - 1]).toBe(1);
160 │       expect(dist.meanDegree).toBeGreaterThanOrEqual(1);
161 │     }
162 │   });
163 │ });
164 │ 
165 │ describe('neighbour derivation', () => {
166 │   it('is deterministic for a given seed and session', () => {
167 │     const dist = buildDegreeDistribution(500);
168 │     const a = Array.from(frameNeighbours(1234, 500, 77, dist));
169 │     const b = Array.from(frameNeighbours(1234, 500, 77, dist));
170 │     expect(a).toEqual(b);
171 │     expect(a.length).toBeGreaterThan(0);
172 │   });
173 │ 
174 │   it('never repeats an index within a frame', () => {
175 │     const dist = buildDegreeDistribution(300);
176 │     for (let seed = 0; seed < 200; seed++) {
177 │       const indices = Array.from(frameNeighbours(seed, 300, 5, dist));
178 │       expect(new Set(indices).size).toBe(indices.length);
179 │       for (const i of indices) expect(i).toBeGreaterThanOrEqual(0), expect(i).toBeLessThan(300);
180 │     }
181 │   });
182 │ 
183 │   it('decorrelates across sessions', () => {
184 │     const dist = buildDegreeDistribution(500);
185 │     const a = Array.from(frameNeighbours(42, 500, 1, dist)).join(',');
186 │     const b = Array.from(frameNeighbours(42, 500, 2, dist)).join(',');
187 │     expect(a).not.toBe(b);
188 │   });
189 │ 
190 │   it('covers every source block many times over a long stream', () => {
191 │     const k = 500;
192 │     const dist = buildDegreeDistribution(k);
193 │     const coverage = new Uint32Array(k);
194 │     for (let seed = 0; seed < 4000; seed++) {
195 │       for (const index of frameNeighbours(seed, k, 9, dist)) coverage[index]++;
196 │     }
197 │     for (let i = 0; i < k; i++) expect(coverage[i]).toBeGreaterThan(0);
198 │   });
199 │ });
200 │ 
201 │ describe('LT round trip', () => {
202 │   it('delivers the first blocks within a few frames thanks to the systematic prefix', () => {
203 │     const payloadLength = 128 * 1024;
204 │     const blockSize = 512;
205 │     const payload = randomPayload(payloadLength, 4);
206 │     const k = Math.ceil(payloadLength / blockSize);
207 │     const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 1, payloadLength });
208 │     const decoder = new LTDecoder({ k, blockSize, sessionId: 1, payloadLength });
209 │     const prefix = defaultSystematicPrefix(k);
210 │     for (let seed = 0; seed <= prefix; seed++) decoder.addFrame(seed, encoder.encode(seed));
211 │     // One frame per block for the whole prefix: the receiver already holds real,
212 │     // verified data before the fountain tail has even started.
213 │     expect(decoder.progress).toBeGreaterThanOrEqual(prefix / k - 1e-9);
214 │     expect(decoder.isComplete).toBe(false); // the rest still needs the LT stream
215 │   });
216 │ 
217 │   it('decodes a clean channel close to the theoretical minimum', () => {
218 │     // LT decoding is heavy-tailed: a single session can need 1.6x while the mean
219 │     // is 1.2x. Measure the mean over several sessions, which is what the
220 │     // published overhead figures refer to (docs/prefix-experiment-output.txt).
221 │     let sum = 0;
222 │     const sessions = 6;
223 │     for (let s = 0; s < sessions; s++) {
224 │       const result = simulateTransfer({
225 │         payloadLength: 64 * 1024,
226 │         blockSize: 512,
227 │         sessionId: 500 + s,
228 │         keep: 1,
229 │         seed: 2000 + s * 13,
230 │       });
231 │       expect(result.complete, `session ${s}`).toBe(true);
232 │       sum += result.overhead;
233 │     }
234 │     const mean = sum / sessions;
235 │     // Measured 1.16-1.26 across k = 64..1024 at 0% loss.
236 │     expect(mean).toBeLessThan(1.45);
237 │     expect(mean).toBeGreaterThan(1.0);
238 │   });
239 │ 
240 │   it('confirms the tuned prefix beats a full systematic prefix under loss', () => {
241 │     // This asserts the FINDING behind SYSTEMATIC_PREFIX_FRACTION rather than a
242 │     // magic number: a full prefix is perfect on a clean channel and worse under
243 │     // loss, which is why the shipped default is short.
244 │     const payloadLength = 64 * 1024;
245 │     const blockSize = 512;
246 │     const k = Math.ceil(payloadLength / blockSize);
247 │     const meanOverheadFor = (prefix: number): number => {
248 │       let sum = 0;
249 │       const sessions = 4;
250 │       for (let s = 0; s < sessions; s++) {
251 │         const payload = randomPayload(payloadLength, 31 + s);
252 │         const sessionId = 90 + s;
253 │         const encoder = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength, systematicPrefix: prefix });
254 │         const decoder = new LTDecoder({ k, blockSize, sessionId, payloadLength, systematicPrefix: prefix });
255 │         const channel = new Rng(7000 + s * 17);
256 │         let received = 0;
257 │         for (let seed = 0; seed < k * 8 && !decoder.isComplete; seed++) {
258 │           if (channel.nextFloat() >= 0.7) continue;
259 │           decoder.addFrame(seed, encoder.encode(seed));
260 │           received++;
261 │         }
262 │         expect(decoder.isComplete).toBe(true);
263 │         sum += received / k;
264 │       }
265 │       return sum / sessions;
266 │     };
267 │     const tuned = meanOverheadFor(defaultSystematicPrefix(k));
268 │     const full = meanOverheadFor(k);
269 │     expect(tuned).toBeLessThan(full);
270 │   });
271 │ 
272 │   it('recovers the exact bytes of a non-block-aligned payload', () => {
273 │     const payloadLength = 5000; // not a multiple of 512
274 │     const payload = randomPayload(payloadLength, 3);
275 │     const blockSize = 512;
276 │     const k = Math.ceil(payloadLength / blockSize);
277 │     const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 8, payloadLength });
278 │     const decoder = new LTDecoder({ k, blockSize, sessionId: 8, payloadLength });
279 │     for (let seed = 0; seed < k * 2 && !decoder.isComplete; seed++) {
280 │       decoder.addFrame(seed, encoder.encode(seed));
281 │     }
282 │     expect(decoder.isComplete).toBe(true);
283 │     expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
284 │   });
285 │ 
286 │   it('survives 30% random frame loss with modest overhead', () => {
287 │     const trials = 8;
288 │     let overheadSum = 0;
289 │     for (let trial = 0; trial < trials; trial++) {
290 │       const result = simulateTransfer({
291 │         payloadLength: 128 * 1024,
292 │         blockSize: 512,
293 │         sessionId: 100 + trial,
294 │         keep: 0.7,
295 │         seed: 900 + trial,
296 │       });
297 │       expect(result.complete, `trial ${trial} did not complete`).toBe(true);
298 │       overheadSum += result.overhead;
299 │     }
300 │     const meanOverhead = overheadSum / trials;
301 │     // `overhead` here is frames RECEIVED per source block: the honest efficiency
302 │     // measure of the code itself, independent of how much the channel drops (the
303 │     // sender displays 1/0.7 more). Measured ~1.13 at 30% loss.
304 │     expect(meanOverhead).toBeLessThan(1.3);
305 │     expect(meanOverhead).toBeGreaterThan(1.0);
306 │   });
307 │ 
308 │   it('survives 50% loss plus periodic 40-frame blackouts', () => {
309 │     const result = simulateTransfer({
310 │       payloadLength: 64 * 1024,
311 │       blockSize: 512,
312 │       sessionId: 55,
313 │       keep: 0.5,
314 │       burst: { every: 60, length: 40 },
315 │       maxFrames: 20000,
316 │       seed: 777,
317 │     });
318 │     expect(result.complete).toBe(true);
319 │     expect(result.overhead).toBeLessThan(1.6);
320 │   });
321 │ 
322 │   it('ignores duplicate frames', () => {
323 │     const payloadLength = 16 * 1024;
324 │     const blockSize = 512;
325 │     const payload = randomPayload(payloadLength, 11);
326 │     const k = Math.ceil(payloadLength / blockSize);
327 │     const encoder = new LTEncoder(payload, { k, blockSize, sessionId: 3, payloadLength });
328 │     const decoder = new LTDecoder({ k, blockSize, sessionId: 3, payloadLength });
329 │     // Send frame 0 a hundred times: it must count once.
330 │     for (let i = 0; i < 100; i++) decoder.addFrame(0, encoder.encode(0));
331 │     expect(decoder.getStats().duplicates).toBe(99);
332 │     expect(decoder.progress).toBeCloseTo(1 / k, 9);
333 │   });
334 │ 
335 │   it('completes a stalled decode with the dense GF(2) fallback', () => {
336 │     // The stall has to be CONSTRUCTED: the tuned distribution almost never leaves
337 │     // a residual this small, so there is no workload that reliably reaches this
338 │     // code path. Instead we search for frame seeds whose neighbour sets form a
339 │     // system that peeling cannot finish, and feed exactly those.
340 │     //
341 │     // The residual is {1,2,3} with the equations
342 │     //     x1^x2^x3 = A     x2^x3 = B     x1^x2 = C
343 │     // which has rank 3 and is solvable, but every equation has degree >= 2 once
344 │     // block 0 is solved - and peeling needs a degree-1 equation, so it stalls.
345 │     //
346 │     // (Three *pairwise* sums would not work: 110 ^ 101 ^ 011 = 000 over GF(2), a
347 │     //  dependent system. The solver correctly refuses to invent a solution for it,
348 │     //  which is what an earlier attempt at this test discovered.)
349 │     //
350 │     // This test previously claimed to cover the dense fallback without ever
351 │     // reaching it: it fed four systematic frames that peel trivially and asserted
352 │     // only that four frames had been received. The suite therefore had no coverage
353 │     // of dense elimination at all - the path that exists to stop a real transfer
354 │     // stalling at 97%.
355 │     const k = 4;
356 │     const blockSize = 64;
357 │     const sessionId = 42;
358 │     const prefix = 0;
359 │     const degree = { variant: 'uniform' } as const;
360 │     const payload = randomPayload(k * blockSize, 21);
361 │     const dist = buildDegreeDistribution(k, degree);
362 │ 
363 │     // Find the nth frame seed whose neighbour set is exactly `want` (order-blind).
364 │     const findSeed = (want: number[]): number => {
365 │       const target = [...want].sort((a, b) => a - b).join(',');
366 │       for (let lt = 0; lt < 100_000; lt++) {
367 │         const actual = Array.from(frameNeighbours(lt, k, sessionId, dist)).sort((a, b) => a - b).join(',');
368 │         if (actual === target) return lt;
369 │       }
370 │       throw new Error(`no frame seed covers exactly {${target}} out of ${k} blocks`);
371 │     };
372 │ 
373 │     const encoder = new LTEncoder(payload, {
374 │       k,
375 │       blockSize,
376 │       sessionId,
377 │       payloadLength: payload.length,
378 │       systematicPrefix: prefix,
379 │       degree,
380 │     });
381 │     const decoder = new LTDecoder({
382 │       k,
383 │       blockSize,
384 │       sessionId,
385 │       payloadLength: payload.length,
386 │       systematicPrefix: prefix,
387 │       degree,
388 │       // Make the escalation immediate rather than waiting 32 fruitless frames:
389 │       // this test is about the solver, not about the stall detector's patience.
390 │       stallThreshold: 0,
391 │       denseLimit: 8,
392 │     });
393 │ 
394 │     // With prefix 0 the frame at seed s covers the neighbours of LT index s-1, and
395 │     // seed 0 is the mask frame, so every data frame here is >= 1.
396 │     const feed = (want: number[]): void => {
397 │       const lt = findSeed(want);
398 │       decoder.addFrame(lt + 1, encoder.encode(lt + 1));
399 │     };
400 │ 
401 │     feed([0]); // solve block 0 outright, so it is out of the residual
402 │     feed([1, 2, 3]);
403 │     feed([2, 3]);
404 │     feed([1, 2]);
405 │ 
406 │     // Exactly one block was recovered before the pair arrived...
407 │     expect(decoder.isComplete).toBe(true);
408 │     const stats = decoder.getStats();
409 │     // ...and the finish came from dense elimination over a 3x3 residual, not from
410 │     // a lucky low-degree frame.
411 │     expect(stats.denseSolves).toBeGreaterThanOrEqual(1);
412 │     expect(stats.denseMatrixSize).toBe(3);
413 │     expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
414 │   });
415 │ 
416 │   it('reports missing ranges through bestEffort', () => {
417 │     const k = 10;
418 │     const blockSize = 100;
419 │     const payload = randomPayload(k * blockSize, 5);
420 │     // Full prefix so that two consecutive frames mean exactly two known blocks.
421 │     const opts = { k, blockSize, sessionId: 2, payloadLength: k * blockSize, systematicPrefix: k };
422 │     const encoder = new LTEncoder(payload, opts);
423 │     const decoder = new LTDecoder(opts);
424 │     decoder.addFrame(0, encoder.encode(0));
425 │     decoder.addFrame(1, encoder.encode(1));
426 │     const partial = decoder.bestEffort();
427 │     expect(partial.complete).toBe(false);
428 │     expect(partial.missingRanges.length).toBe(k - 2);
429 │     expect(partial.missingRanges[0]).toEqual({ start: 2 * blockSize, end: 3 * blockSize });
430 │   });
431 │ 
432 │   it('never reports complete with zeroed blocks (aliasing regression)', () => {
433 │     // Regression test for a corruption bug where a block solved through the
434 │     // peeling queue aliased the equation's accumulator, so the substitution step
435 │     // XORed it with itself and stored an all-zero block while reporting success.
436 │     // 200 randomised small sessions is enough to hit every solver path.
437 │     let checked = 0;
438 │     for (let trial = 0; trial < 200; trial++) {
439 │       const payloadLength = 5000;
440 │       const blockSize = 512;
441 │       const k = Math.ceil(payloadLength / blockSize);
442 │       const sessionId = 1 + trial;
443 │       const payload = randomPayload(payloadLength, 3 + trial * 7);
444 │       const encoder = new LTEncoder(payload, { k, blockSize, sessionId, payloadLength });
445 │       const decoder = new LTDecoder({ k, blockSize, sessionId, payloadLength });
446 │       for (let seed = 0; seed < k * 6 && !decoder.isComplete; seed++) {
447 │         decoder.addFrame(seed, encoder.encode(seed));
448 │       }
449 │       expect(decoder.isComplete, `trial ${trial} did not complete`).toBe(true);
450 │       expect(Array.from(decoder.reconstruct()), `trial ${trial} bytes differ`).toEqual(Array.from(payload));
451 │       checked++;
452 │     }
453 │     expect(checked).toBe(200);
454 │   });
455 │ 
456 │   it('handles the single-block edge case', () => {
457 │     const payload = randomPayload(200, 6);
458 │     const encoder = new LTEncoder(payload, { k: 1, blockSize: 512, sessionId: 7, payloadLength: 200 });
459 │     const decoder = new LTDecoder({ k: 1, blockSize: 512, sessionId: 7, payloadLength: 200 });
460 │     decoder.addFrame(0, encoder.encode(0));
461 │     expect(decoder.isComplete).toBe(true);
462 │     expect(Array.from(decoder.reconstruct())).toEqual(Array.from(payload));
463 │   });
464 │ 
465 │   it('scales to thousands of blocks inside a sane time budget', () => {
466 │     const started = Date.now();
467 │     const result = simulateTransfer({
468 │       payloadLength: 2 * 1024 * 1024,
469 │       blockSize: 1024,
470 │       sessionId: 999,
471 │       keep: 0.75,
472 │       maxFrames: 6000,
473 │       seed: 31337,
474 │     });
475 │     const elapsed = Date.now() - started;
476 │     expect(result.complete).toBe(true);
477 │     expect(result.k).toBe(2048);
478 │     // 2 MB / 1 KB blocks = 2048 blocks; encoding + decoding + 25% loss should
479 │     // stay well inside a second on any modern device.
480 │     expect(elapsed).toBeLessThan(20000);
481 │   });
482 │ });
483 │ 
484 │ describe('mask derivation', () => {
485 │   it('is identical on both sides and differs between sessions', () => {
486 │     const a = deriveMaskBlock(1234, 64);
487 │     const b = deriveMaskBlock(1234, 64);
488 │     const c = deriveMaskBlock(1235, 64);
489 │     expect(Array.from(a)).toEqual(Array.from(b));
490 │     expect(Array.from(a)).not.toEqual(Array.from(c));
491 │   });
492 │ });
493 │ 
494 │ describe('frame-count estimate', () => {
495 │   it('is above K and grows sub-linearly', () => {
496 │     expect(expectedFramesFor(100)).toBeGreaterThan(100);
497 │     expect(expectedFramesFor(1000)).toBeGreaterThan(1000);
498 │     // Doubling K must not double the absolute overhead.
499 │     const overhead1000 = expectedFramesFor(1000) - 1000;
500 │     const overhead10000 = expectedFramesFor(10000) - 10000;
501 │     expect(overhead10000).toBeLessThan(overhead1000 * 10);
502 │   });
503 │ });
504 │ 
505 │ describe('neighbour sampler statistics', () => {
506 │   /**
507 │    * The sampler must be (a) distinct, (b) history independent, and (c) close to
508 │    * uniform. (b) is the property that makes lossy capture possible at all: the
509 │    * receiver has to derive the same neighbours as the sender even though it sees
510 │    * a different, sparser set of frames.
511 │    */
512 │   it('is history independent: interrupting the stream changes nothing', () => {
513 │     const k = 800;
514 │     const dist = buildDegreeDistribution(k);
515 │     // Derive seed 500's neighbours directly.
516 │     const direct = Array.from(frameNeighbours(500, k, 1, dist));
517 │     // Now derive it again after generating a thousand other frames first.
518 │     for (let seed = 0; seed < 1000; seed++) frameNeighbours(seed, k, 1, dist);
519 │     const afterNoise = Array.from(frameNeighbours(500, k, 1, dist));
520 │     expect(afterNoise).toEqual(direct);
521 │   });
522 │ 
523 │   it('samples indices close to uniformly over a long stream', () => {
524 │     const k = 256;
525 │     const dist = buildDegreeDistribution(k);
526 │     const counts = new Uint32Array(k);
527 │     const frames = 4000;
528 │     for (let seed = 0; seed < frames; seed++) {
529 │       for (const index of frameNeighbours(seed, k, 7, dist)) counts[index]++;
530 │     }
531 │     const total = counts.reduce((a, b) => a + b, 0);
532 │     const expected = total / k;
533 │     // Standard deviation of a binomial count; allow generous bounds so the test
534 │     // is about catching bias, not about re-rolling the PRNG seed.
535 │     const sigma = Math.sqrt(expected * (1 - 1 / k));
536 │     let worst = 0;
537 │     for (let i = 0; i < k; i++) worst = Math.max(worst, Math.abs(counts[i] - expected) / sigma);
538 │     expect(worst).toBeLessThan(5);
539 │   });
540 │ 
541 │   it('does not favour low indices (regression test for a biased shuffle)', () => {
542 │     const k = 512;
543 │     const dist = buildDegreeDistribution(k);
544 │     const counts = new Uint32Array(k);
545 │     for (let seed = 0; seed < 2000; seed++) {
546 │       for (const index of frameNeighbours(seed, k, 3, dist)) counts[index]++;
547 │     }
548 │     const firstHalf = counts.slice(0, k / 2).reduce((a, b) => a + b, 0);
549 │     const secondHalf = counts.slice(k / 2).reduce((a, b) => a + b, 0);
550 │     const ratio = firstHalf / secondHalf;
551 │     expect(ratio).toBeGreaterThan(0.9);
552 │     expect(ratio).toBeLessThan(1.1);
553 │   });
554 │ 
555 │   it('handles very large degrees without quadratic blow-up', () => {
556 │     const k = 4096;
557 │     const dist = { k, cdf: (() => {
558 │       // Uniform distribution: mean degree K/2, the worst case for sampling cost.
559 │       const cdf = new Float64Array(k);
560 │       for (let i = 0; i < k; i++) cdf[i] = (i + 1) / k;
561 │       return cdf;
562 │     })(), meanDegree: k / 2, name: 'uniform-test' };
563 │     const started = Date.now();
564 │     for (let seed = 0; seed < 200; seed++) {
565 │       const indices = frameNeighbours(seed, k, 11, dist);
566 │       expect(indices.length).toBeGreaterThan(0);
567 │       // Distinctness is the property the decode depends on.
568 │       expect(new Set(Array.from(indices)).size).toBe(indices.length);
569 │     }
570 │     const elapsed = Date.now() - started;
571 │     // 200 frames x ~2000 neighbours: O(d^2) would be tens of millions of
572 │     // comparisons; O(d) keeps this in the tens of milliseconds.
573 │     expect(elapsed).toBeLessThan(5000);
574 │   });
575 │ });
```

---

## `packages/core/test/transfer-e2e.test.ts`

> 577 lines

**What it is.** The closest thing to a real transfer without hardware, and the file that makes the
claim "the code a test verifies is the code a phone runs" checkable. The pipeline exercised is the
production one end to end:


**Why jsQR and not the encoder's own decoder.** Because the intermediate representation is
*pixels*. The encoder produces a symbol, the symbol is rasterised exactly as a screen would show
it, and the only thing that reads it is an independent decoder that sees nothing but an RGBA
buffer. Any framing, base32, header or geometry mistake therefore has to survive a round trip
through an implementation that shares no code with ours.

**`receiveAll(sender, options)` — the harness.** One function drives a whole session:

- `loss` skips frames *before* they reach the "camera", which is how a real capture behaves.
- `scale` is pixels per module (4 is a typical phone screen at reading distance).
- The RNG is seeded from an option, so a lossy scenario is reproducible — a flaky test here would
  be worse than no test, because this is the file that catches protocol regressions.
- It feeds **`decoded.data` (the string)** rather than `binaryData`, because base32 frames produce
  text and that is what a native camera API hands over.
- It stops on `complete` **or `failed`**: a failed transfer will never recover in this loop, and
  continuing would decode thousands of frames for nothing. (The receiver's own `accept` also
  short-circuits in both phases.)

### The eight end-to-end scenarios

| Scenario | The property it pins |
| --- | --- |
| Text payload through the full pipeline | correctness including emoji and Arabic, plus `decodeFailures === 0` — a clean virtual screen must decode **every** frame, so any symbol the encoder emits badly is a failure |
| Binary payload, 25% of frames lost | the fountain code's reason for existing; asserts `framesDecoded > k`, i.e. the receiver genuinely needed more frames than blocks, and `framesSuspect === 0` |
| Image-like payload, previewed early | `receiver.partial()` returns real data mid-transfer, progress > 0.2, phase still `collecting` — the UI's "received so far" contract |
| Encrypted transfer | a **wrong passphrase fails and the right one succeeds on the same stream**, with the error matching `/passphrase|modified/i`; uses a fast KDF (N = 1024) because the test would otherwise spend 300 ms per run in scrypt |
| Compression, both directions | a repeated-text payload compresses to under a quarter of its size and round-trips; random bytes stay `store` |
| Foreign frames and misdirected sessions | interleaves frames of a *different session id* and a random QR code between every real frame, and still completes — with `framesForeign > 0`, so the test proves the filtering ran rather than that it was bypassed |
| Corrupted payload | a single flipped base32 character in the data frames must fail the end-to-end checksum, with `getResult() === null` |
| Partially lost manifest | fragments delivered in reverse order with duplicates and CRC-failing garbage mixed in; asserts the assembler completes **exactly on the final fragment** |

**The corruption test contains the most interesting piece of test engineering in the file.** It
corrupts **every** data frame, and the comment explains why: corrupting only some frames is
*non-deterministic*, because a damaged frame whose block happens to be resolved by another frame
first is discarded as redundant and never contaminates the result — so the test would pass
"through no fault of the checksum", i.e. flakily and for the wrong reason. It also notes that
manifest frames are not useful for this: they carry their own fragment CRC and are rejected
earlier, so the damage must be injected into data frames, whose protection is the whole-payload
SHA-256.

### `frame format` (3 tests)

A round trip through `encodeDataFrame`/`parseFrame`; then a **single flipped bit in the session
id must be caught by the header CRC** — and the assertion records the API's deliberate split:
`parseFrame` still returns the frame, while `parseFrameDetailed(...).headerValid` is false. The
protocol layer reports; the transfer layer decides. Third: `parseFrame` returns `null` (never
throws) for empty input, for arbitrary text, and for a wrong magic byte.

### `base32 wire encoding` (5 tests)

- All 256 byte values round-trip, the output matches `/^[A-Z2-7]+$/` (so it stays inside QR's
  alphanumeric set) and — the assertion that pins the arithmetic — 256 bytes become **exactly 410
  characters** (2048 bits ÷ 5).
- **Every length from 1 to 40 bytes** round-trips: the padding cases, where a partial 5-bit group
  is involved. This is where an off-by-one in `base32EncodedLength`/`base32DecodedLength` shows up.
- Lowercase, whitespace and `=` padding are all tolerated on input, because third-party scanners
  normalise differently.
- Characters outside the alphabet are **rejected**, and `isBase32('ABC1DEF')` is false (`0`, `1`,
  `8`, `9` are not RFC 4648 base32) — the strictness that makes a misread symbol fail loudly.
- The **cost guard**: 5 bytes → 8 characters looks like a 60% expansion, but alphanumeric mode
  packs 11 bits per 2 characters, so the real cost is ~10%. The test computes frames for both
  encodings from the planner's own numbers and asserts the ratio is under 1.2 — i.e. it guards the
  *reasoning* behind base32 being the default, not just its correctness.

### `planner and utilities` (8 tests)

`sizes blocks to exactly fill a symbol` is the careful one: for raw mode it asserts
`blockSize === framePayloadBytes(15, ecLevel) − 13`; for base32 it asserts
`base32EncodedLength(blockSize + 13) <= framePayloadBytes(...)` **and** that the leftover is under
8 characters — so a future change cannot "fit" by wasting screen time. Also: the overhead estimate
is monotonic in loss, a 64 MiB payload in the `phone` profile is refused with `/blocks/`, and two
**standard check values** are pinned: CRC-32 of `"123456789"` = `0xCBF43926` and CRC-16/CCITT-FALSE
of the same input = `0x29B1`. Those two constants are how the checksums are verified against the
rest of the world rather than against themselves.

The session-code test asserts the 7-character length, that no look-alike character (`I`, `O`, `0`,
`1`) appears, and that `sessionCodeToId` round-trips **and returns `null`** for junk. Finally,
`is deterministic across the compression and encryption boundary` checks that decompression,
decryption, `deriveKey` (called twice, same salt) and the passphrase fingerprint behave as pure
functions, with the fingerprint asserted as `/^[0-9A-F]{4}-[0-9A-F]{4}$/` — **uppercase hex**, a
detail the first version of this assertion got wrong by assuming base32.

### `sender preparation invariants (regressions)` (3 tests)

Added after the sender's order-of-operations was fixed, and they are the tests that stop those
bugs coming back:

1. **The plan matches the exact wire length, encrypted or not** — `manifest.len ===
   wirePayload.length`, `manifest.bs`/`k` equal the plan's, `blockSize * k >= wirePayload.length`
   and `k === ceil(len / bs)`.
2. **The encrypted wire length is predicted** — `wirePayload.length − (originalPayload.length −
   compression.saved) === 16`: the AEAD tag is exactly accounted for, which is the invariant the
   assert in `prepareTransfer` enforces.
3. **Compression savings are reported against the pre-encryption payload**, and are *identical*
   whether compression happens with or without encryption — the bug where an encrypted compressed
   transfer under-reported its saving by exactly 16 bytes — plus `ratio > 10` for 20 000 identical
   bytes.

### `wire encoding selection` (1 test)

The newest test, and the one that closed a hole: it asserts the **raw** plan has a larger block
size than the base32 plan for the same payload, that `flags` carries `FrameFlag.Base32` only for
base32, and that a raw session still completes end to end through jsQR with `integrity.ok` true.

Its first version was wrong in a way worth remembering: it used a *small* payload, where the block
is limited by the payload rather than by the symbol, so both encodings planned a 49-byte block and
the assertion compared 49 to 49. The fix was to use a 24 000-byte incompressible payload with
`compress: false`, so the symbol's capacity is what binds. A test that asserts the right thing
about the wrong regime is a test that will pass forever and catch nothing.

**Every line**

```ts
  1 │ /**
  2 │  * transfer-e2e.test.ts - the closest thing to a real transfer without hardware.
  3 │  *
  4 │  * The pipeline exercised here is the production one, end to end:
  5 │  *
  6 │  *   payload
  7 │  *     -> prepareTransfer          (compress, optional encrypt, hash, plan, manifest)
  8 │  *     -> TransferSender.symbolAt  (frame header + LT block + QR encoding)
  9 │  *     -> rasterizeRgba            (modules to pixels, exactly what a screen shows)
 10 │  *     -> jsQR                     (an independent QR *decoder*, standing in for a
 11 │  *                                  camera; it sees pixels only, so any protocol
 12 │  *                                  or framing mistake surfaces here)
 13 │  *     -> TransferReceiver.accept  (header validation, session filter, LT decode)
 14 │  *     -> verify / decrypt / inflate
 15 │  *     -> byte-for-byte comparison with the original payload
 16 │  *
 17 │  * Frame loss is injected between the sender and the decoder, which is how the
 18 │  * camera behaves in practice.
 19 │  */
 20 │ 
 21 │ import { describe, expect, it } from 'vitest';
 22 │ import jsQR from 'jsqr';
 23 │ import { prepareTransfer, TransferSender } from '../src/transfer/sender.js';
 24 │ import { TransferReceiver } from '../src/transfer/receiver.js';
 25 │ import { rasterizeRgba } from '../src/qr/render.js';
 26 │ import { crc32u, crc16 } from '../src/crypto/crc.js';
 27 │ import { concatBytes, toHex, fromHex, toBase64Url, fromBase64Url, sessionCode, sessionCodeToId, formatBytes } from '../src/util/bytes.js';
 28 │ import { Rng } from '../src/util/rng.js';
 29 │ import {
 30 │   parseFrame,
 31 │   parseFrameDetailed,
 32 │   encodeDataFrame,
 33 │   encodeManifestFrame,
 34 │   FrameFlag,
 35 │   FrameType,
 36 │   FRAME_HEADER_BYTES,
 37 │ } from '../src/protocol/frame.js';
 38 │ import { splitManifest, ManifestAssembler, buildManifest, serializeManifest } from '../src/protocol/manifest.js';
 39 │ import { planSession, framePayloadBytes, estimateOverhead } from '../src/protocol/planner.js';
 40 │ import { compressPayload, decompressPayload } from '../src/transfer/compress.js';
 41 │ import { hashHex } from '../src/crypto/integrity.js';
 42 │ import { base32Decode, base32Encode, base32EncodedLength, isBase32 } from '../src/util/base32.js';
 43 │ import { encryptPayload, decryptPayload, deriveKey, passphraseFingerprint } from '../src/crypto/aead.js';
 44 │ 
 45 │ function randomPayload(length: number, seed = 1): Uint8Array {
 46 │   const rng = new Rng(seed);
 47 │   const out = new Uint8Array(length);
 48 │   for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
 49 │   return out;
 50 │ }
 51 │ 
 52 │ /**
 53 │  * Show frames from a sender and read them back through a real QR decoder.
 54 │  *
 55 │  * @param loss    probability that a displayed frame is not captured at all
 56 │  * @param scale   pixels per module in the simulated screen (4 = typical phone)
 57 │  */
 58 │ function receiveAll(
 59 │   sender: TransferSender,
 60 │   options: { loss?: number; maxFrames?: number; seed?: number; scale?: number; passphrase?: string } = {},
 61 │ ): { receiver: TransferReceiver; framesShown: number; framesDecoded: number; decodeFailures: number } {
 62 │   const loss = options.loss ?? 0;
 63 │   const scale = options.scale ?? 4;
 64 │   const maxFrames = options.maxFrames ?? 4000;
 65 │   const rng = new Rng(options.seed ?? 1234);
 66 │   const receiver = new TransferReceiver({ passphrase: options.passphrase });
 67 │ 
 68 │   let framesShown = 0;
 69 │   let framesDecoded = 0;
 70 │   let decodeFailures = 0;
 71 │ 
 72 │   for (let slot = 0; slot < maxFrames; slot++) {
 73 │     if (rng.nextFloat() < loss) continue; // frame never reaches the camera
 74 │     const symbol = sender.symbolAt(slot);
 75 │     framesShown++;
 76 │ 
 77 │     // Render exactly as a screen would, then decode from pixels only.
 78 │     const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
 79 │     const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
 80 │     if (!decoded) {
 81 │       decodeFailures++;
 82 │       continue;
 83 │     }
 84 │     framesDecoded++;
 85 │     // A real platform hands over the decoded TEXT (native camera APIs) or bytes
 86 │     // (a browser decoder). jsQR provides both; the text path is what base32 frames
 87 │     // produce, so that is what we feed here.
 88 │     receiver.accept(decoded.data);
 89 │     // Stop on 'complete' and on 'failed': a failed transfer will never recover in
 90 │     // this loop, and continuing would decode thousands of frames for nothing.
 91 │     const phase = receiver.getProgress().phase;
 92 │     if (phase === 'complete' || phase === 'failed') break;
 93 │   }
 94 │   return { receiver, framesShown, framesDecoded, decodeFailures };
 95 │ }
 96 │ 
 97 │ describe('end-to-end optical transfer', () => {
 98 │   it('sends a text payload through the full pipeline', async () => {
 99 │     const text = 'LightBeam end-to-end test\nline two\n🙂 مرحبا';
100 │     const data = new TextEncoder().encode(text);
101 │     const prepared = await prepareTransfer({
102 │       data,
103 │       name: 'note.txt',
104 │       mime: 'text/plain',
105 │       sessionId: 0x11223344,
106 │       profile: 'phone',
107 │     });
108 │     const sender = new TransferSender(prepared);
109 │     const { receiver, decodeFailures } = receiveAll(sender);
110 │ 
111 │     expect(receiver.isComplete).toBe(true);
112 │     const result = receiver.getResult()!;
113 │     expect(result.text).toBe(text);
114 │     expect(Array.from(result.payload)).toEqual(Array.from(data));
115 │     expect(result.integrity.ok).toBe(true);
116 │     expect(decodeFailures).toBe(0); // a clean virtual screen must decode every frame
117 │   });
118 │ 
119 │   it('recovers a binary payload with 25% of frames lost', async () => {
120 │     const data = randomPayload(24 * 1024, 7);
121 │     const prepared = await prepareTransfer({ data, name: 'blob.bin', mime: 'application/octet-stream', sessionId: 42 });
122 │     const sender = new TransferSender(prepared);
123 │     const { receiver, framesDecoded } = receiveAll(sender, { loss: 0.25, seed: 99, maxFrames: 4000 });
124 │ 
125 │     expect(receiver.isComplete).toBe(true);
126 │     const result = receiver.getResult()!;
127 │     expect(Array.from(result.payload)).toEqual(Array.from(data));
128 │     // A quarter of the displayed frames vanish; the fountain code absorbs it.
129 │     expect(framesDecoded).toBeGreaterThan(prepared.manifest.k);
130 │     expect(receiver.getProgress().framesSuspect).toBe(0);
131 │   });
132 │ 
133 │   it('sends an image-like payload and lets the receiver preview it early', async () => {
134 │     const data = randomPayload(16 * 1024, 11);
135 │     const prepared = await prepareTransfer({ data, name: 'photo.png', mime: 'image/png', sessionId: 77 });
136 │     const sender = new TransferSender(prepared);
137 │     const receiver = new TransferReceiver();
138 │ 
139 │     // Feed half the frames, then inspect the partial state: the UI relies on this
140 │     // to show "received so far" before the transfer finishes.
141 │     const target = Math.floor(prepared.manifest.k * 0.6);
142 │     for (let slot = 0; slot < target * 2 && !receiver.isComplete; slot++) {
143 │       const symbol = sender.symbolAt(slot);
144 │       const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
145 │       const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
146 │       if (decoded) receiver.accept(decoded.data);
147 │     }
148 │     expect(receiver.isComplete).toBe(false);
149 │     const partial = receiver.partial();
150 │     expect(partial).not.toBeNull();
151 │     expect(partial!.knownBytes).toBeGreaterThan(0);
152 │     expect(partial!.totalBytes).toBe(data.length);
153 │     // Some blocks are already exactly right.
154 │     const progress = receiver.getProgress();
155 │     expect(progress.progress).toBeGreaterThan(0.2);
156 │     expect(progress.blocksTotal).toBe(prepared.manifest.k);
157 │     expect(progress.phase).toBe('collecting');
158 │   });
159 │ 
160 │   it('handles an encrypted transfer, rejecting a wrong passphrase', async () => {
161 │     const data = randomPayload(8 * 1024, 13);
162 │     const passphrase = 'correct horse battery staple';
163 │     const prepared = await prepareTransfer({
164 │       data,
165 │       name: 'secret.bin',
166 │       mime: 'application/octet-stream',
167 │       passphrase,
168 │       sessionId: 555,
169 │       kdf: { N: 1024, r: 8, p: 1 }, // fast KDF in tests; production uses 2^15
170 │     });
171 │     expect(prepared.encryption).toBe('xchacha20poly1305');
172 │     const sender = new TransferSender(prepared);
173 │ 
174 │     // Wrong passphrase first.
175 │     const wrong = receiveAll(sender, { passphrase: 'wrong passphrase', seed: 5 });
176 │     expect(wrong.receiver.isComplete).toBe(false);
177 │     expect(wrong.receiver.getProgress().phase).toBe('failed');
178 │     expect(wrong.receiver.getProgress().error).toMatch(/passphrase|modified/i);
179 │ 
180 │     // Correct passphrase.
181 │     const right = receiveAll(sender, { passphrase, seed: 6 });
182 │     expect(right.receiver.isComplete).toBe(true);
183 │     expect(Array.from(right.receiver.getResult()!.payload)).toEqual(Array.from(data));
184 │   });
185 │ 
186 │   it('compresses compressible payloads and is transparent when it does not help', async () => {
187 │     const text = 'the quick brown fox jumps over the lazy dog. '.repeat(400);
188 │     const data = new TextEncoder().encode(text);
189 │     const prepared = await prepareTransfer({ data, name: 'repeated.txt', mime: 'text/plain', sessionId: 8 });
190 │     expect(prepared.compression.codec).toBe('deflate');
191 │     expect(prepared.wirePayload.length).toBeLessThan(data.length / 4);
192 │ 
193 │     const sender = new TransferSender(prepared);
194 │     const { receiver } = receiveAll(sender, { seed: 12 });
195 │     expect(receiver.isComplete).toBe(true);
196 │     expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(data));
197 │ 
198 │     // Random bytes do not compress: the codec must stay 'store'.
199 │     const incompressible = randomPayload(4096, 3);
200 │     const second = await prepareTransfer({
201 │       data: incompressible,
202 │       name: 'noise.bin',
203 │       mime: 'application/octet-stream',
204 │       sessionId: 9,
205 │     });
206 │     expect(second.compression.codec).toBe('store');
207 │   });
208 │ 
209 │   it('ignores foreign frames and misdirected sessions', async () => {
210 │     const data = randomPayload(4 * 1024, 21);
211 │     const prepared = await prepareTransfer({ data, name: 'a.bin', mime: 'application/octet-stream', sessionId: 0xaabbccdd });
212 │     const sender = new TransferSender(prepared);
213 │     const receiver = new TransferReceiver();
214 │ 
215 │     // Interleave frames belonging to a different session and random QR content.
216 │     for (let slot = 0; slot < 200 && !receiver.isComplete; slot++) {
217 │       // Foreign session frame.
218 │       const foreign = encodeDataFrame({ sessionId: 0x11223344, seed: slot, payload: new Uint8Array(prepared.manifest.bs) });
219 │       receiver.accept(foreign);
220 │       // Random QR (e.g. a product code on a poster).
221 │       receiver.accept(new TextEncoder().encode('https://example.com/not-a-lightbeam-frame'));
222 │ 
223 │       const symbol = sender.symbolAt(slot);
224 │       const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
225 │       const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
226 │       if (decoded) receiver.accept(decoded.data);
227 │     }
228 │     expect(receiver.isComplete).toBe(true);
229 │     expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(data));
230 │     expect(receiver.getProgress().framesForeign).toBeGreaterThan(0);
231 │   });
232 │ 
233 │   it('aborts cleanly when the payload is corrupted in transit', async () => {
234 │     const data = randomPayload(4 * 1024, 31);
235 │     const prepared = await prepareTransfer({ data, name: 'flip.bin', mime: 'application/octet-stream', sessionId: 0x5a5a });
236 │     const sender = new TransferSender(prepared);
237 │     const receiver = new TransferReceiver();
238 │ 
239 │     for (let slot = 0; slot < 500 && !receiver.isComplete; slot++) {
240 │       const symbol = sender.symbolAt(slot);
241 │       const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
242 │       const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
243 │       if (!decoded) continue;
244 │       // Feed the frame as text (base32 wire encoding), but corrupt one base32
245 │       // character of an occasional DATA frame. The header still validates, so the
246 │       // receiver accepts the frame and the damage is caught only by the end-to-end
247 │       // checksum - the exact scenario that check exists for. (Manifest frames carry
248 │       // their own fragment CRC and are rejected earlier, so they are not useful
249 │       // here.)
250 │       // Corrupt every data frame. Corrupting only some would be non-deterministic:
251 │       // a damaged frame whose block happens to be resolved by another frame first
252 │       // is discarded as redundant and never contaminates the result, so the test
253 │       // would pass through no fault of the checksum.
254 │       let content = decoded.data;
255 │       const frame = parseFrame(base32Decode(content));
256 │       if (frame && frame.type === FrameType.Data && content.length > 20) {
257 │         const at = content.length - 5;
258 │         content = content.slice(0, at) + (content[at] === 'A' ? 'B' : 'A') + content.slice(at + 1);
259 │       }
260 │       receiver.accept(content);
261 │     }
262 │     const progress = receiver.getProgress();
263 │     expect(progress.phase).toBe('failed');
264 │     expect(progress.error).toMatch(/Integrity check failed/i);
265 │     expect(receiver.getResult()).toBeNull();
266 │   });
267 │ 
268 │   it('accepts a partially lost manifest by reassembling fragments', () => {
269 │     const manifest = buildManifest({
270 │       sessionId: 4242,
271 │       name: 'a-very-long-file-name-so-the-manifest-needs-several-fragments.bin',
272 │       mime: 'application/octet-stream',
273 │       payloadLength: 123456,
274 │       originalLength: 123456,
275 │       blockSize: 500,
276 │       k: 247,
277 │       codec: 'store',
278 │       encryption: { mode: 'none' },
279 │       sha256Hex: 'a'.repeat(64),
280 │       crc32: 12345,
281 │       note: 'fragment reassembly test',
282 │     });
283 │     const serialized = serializeManifest(manifest);
284 │     const { fragments, count } = splitManifest(serialized, 40);
285 │     expect(count).toBeGreaterThan(2);
286 │ 
287 │     const assembler = new ManifestAssembler();
288 │     // Deliver out of order, with duplicate and corrupted fragments mixed in.
289 │     const order = [...fragments.keys()].reverse();
290 │     for (const index of order) {
291 │       const corrupted = Uint8Array.from(fragments[(index + 1) % count]);
292 │       corrupted[corrupted.length - 1] ^= 0xff; // fails its fragment CRC
293 │       expect(assembler.accept(corrupted)).toBeNull(); // a garbled fragment is not "received"
294 │       const result = assembler.accept(fragments[index]);
295 │       if (index === 0) expect(result, 'must only complete on the final fragment').not.toBeNull();
296 │     }
297 │     expect(assembler.complete).toBe(false); // reset() after completion
298 │   });
299 │ });
300 │ 
301 │ describe('frame format', () => {
302 │   it('round-trips a data frame and detects a flipped header bit', () => {
303 │     const payload = new Uint8Array([1, 2, 3, 4, 5]);
304 │     const bytes = encodeDataFrame({ sessionId: 0xdeadbeef, seed: 0x01020304, payload });
305 │     const frame = parseFrame(bytes)!;
306 │     expect(frame.type).toBe(FrameType.Data);
307 │     expect(frame.sessionId).toBe(0xdeadbeef);
308 │     expect(frame.seed).toBe(0x01020304);
309 │     expect(Array.from(frame.payload)).toEqual([1, 2, 3, 4, 5]);
310 │ 
311 │     // A single flipped bit in the session id must be caught by the header CRC.
312 │     const tampered = Uint8Array.from(bytes);
313 │     tampered[4] ^= 0x01;
314 │     const parsed = parseFrame(tampered);
315 │     expect(parsed).not.toBeNull();
316 │     // parseFrame() deliberately still returns the frame; the detailed variant
317 │     // reports the CRC result so the receiver can decide.
318 │     expect(parseFrameDetailed(tampered)!.headerValid).toBe(false);
319 │   });
320 │ 
321 │   it('packs manifest fragment indices into the header word', () => {
322 │     const bytes = encodeManifestFrame({
323 │       sessionId: 7,
324 │       fragmentIndex: 3,
325 │       fragmentCount: 9,
326 │       payload: new Uint8Array([9, 9]),
327 │     });
328 │     const frame = parseFrame(bytes)!;
329 │     expect(frame.type).toBe(FrameType.Manifest);
330 │     expect(frame.fragmentIndex).toBe(3);
331 │     expect(frame.fragmentCount).toBe(9);
332 │   });
333 │ 
334 │   it('rejects non-LightBeam input without throwing', () => {
335 │     expect(parseFrame(new Uint8Array(0))).toBeNull();
336 │     expect(parseFrame(new TextEncoder().encode('hello world, definitely not a frame'))).toBeNull();
337 │     const wrongMagic = new Uint8Array(32);
338 │     wrongMagic[0] = 0x41;
339 │     expect(parseFrame(wrongMagic)).toBeNull();
340 │   });
341 │ });
342 │ 
343 │ describe('base32 wire encoding', () => {
344 │   it('round-trips arbitrary bytes, including all 256 values', () => {
345 │     const bytes = new Uint8Array(256);
346 │     for (let i = 0; i < 256; i++) bytes[i] = i;
347 │     const text = base32Encode(bytes);
348 │     expect(isBase32(text)).toBe(true);
349 │     expect(text).toMatch(/^[A-Z2-7]+$/); // stays inside QR's alphanumeric character set
350 │     expect(Array.from(base32Decode(text))).toEqual(Array.from(bytes));
351 │     expect(base32EncodedLength(256)).toBe(text.length);
352 │     expect(text.length).toBe(410); // 2048 bits / 5 bits per character
353 │   });
354 │ 
355 │   it('round-trips every length from 1 to 40 bytes (padding cases)', () => {
356 │     for (let length = 1; length <= 40; length++) {
357 │       const bytes = randomPayload(length, 100 + length);
358 │       const decoded = base32Decode(base32Encode(bytes));
359 │       expect(decoded.length, `length ${length}`).toBe(length);
360 │       expect(Array.from(decoded), `length ${length}`).toEqual(Array.from(bytes));
361 │     }
362 │   });
363 │ 
364 │   it('tolerates lowercase, whitespace and padding from third-party scanners', () => {
365 │     const bytes = randomPayload(37, 5);
366 │     const canonical = base32Encode(bytes);
367 │     expect(Array.from(base32Decode(canonical.toLowerCase()))).toEqual(Array.from(bytes));
368 │     expect(Array.from(base32Decode(canonical + '======'))).toEqual(Array.from(bytes));
369 │     expect(Array.from(base32Decode(`  ${canonical} `))).toEqual(Array.from(bytes));
370 │   });
371 │ 
372 │   it('rejects characters outside the alphabet', () => {
373 │     expect(() => base32Decode('ABC!DEF')).toThrow(/Invalid base32/);
374 │     expect(isBase32('ABC1DEF')).toBe(false); // 0, 1, 8, 9 are not in RFC 4648 base32
375 │   });
376 │ 
377 │   it('costs well under 20% more than raw byte mode', () => {
378 │     // 5 bytes -> 8 characters is a 60% character expansion, but QR alphanumeric
379 │     // mode packs 11 bits per 2 characters instead of 8 bits per character, so the
380 │     // real cost is roughly 10%. This test guards that reasoning.
381 │     const planRaw = planSession(100_000, 'balanced', { wireEncoding: 'raw' });
382 │     const planB32 = planSession(100_000, 'balanced', { wireEncoding: 'base32' });
383 │     expect(planB32.wireEncoding).toBe('base32');
384 │     expect(planRaw.wireEncoding).toBe('raw');
385 │     // Characters needed per frame, converted to bits at alphanumeric density.
386 │     const rawBitsPerFrame = (planRaw.blockSize + FRAME_HEADER_BYTES) * 8;
387 │     const b32BitsPerFrame = base32EncodedLength(planB32.blockSize + FRAME_HEADER_BYTES) * 5.5;
388 │     const framesRatio = (planB32.k * b32BitsPerFrame) / (planRaw.k * rawBitsPerFrame);
389 │     expect(framesRatio).toBeLessThan(1.2);
390 │   });
391 │ });
392 │ 
393 │ describe('planner and utilities', () => {
394 │   it('sizes blocks to exactly fill a symbol', () => {
395 │     const plan = planSession(100_000, 'balanced');
396 │     expect(plan.modules).toBe(77);
397 │     expect(plan.k).toBe(Math.ceil(100_000 / plan.blockSize));
398 │ 
399 │     // Raw mode: the header and the block are the only things in the symbol.
400 │     const raw = planSession(100_000, 'balanced', { wireEncoding: 'raw' });
401 │     expect(raw.blockSize).toBe(framePayloadBytes(15, raw.ecLevel) - FRAME_HEADER_BYTES);
402 │ 
403 │     // Base32 mode: base32(header + block) must fit the same character budget.
404 │     const b32 = planSession(100_000, 'balanced', { wireEncoding: 'base32' });
405 │     expect(base32EncodedLength(b32.blockSize + FRAME_HEADER_BYTES)).toBeLessThanOrEqual(
406 │       framePayloadBytes(15, b32.ecLevel),
407 │     );
408 │     // ...and be close to the budget, i.e. not wasting screen time.
409 │     expect(framePayloadBytes(15, b32.ecLevel) - base32EncodedLength(b32.blockSize + FRAME_HEADER_BYTES)).toBeLessThan(8);
410 │   });
411 │ 
412 │   it('grows the overhead estimate with loss', () => {
413 │     expect(estimateOverhead(0)).toBeLessThan(estimateOverhead(0.3));
414 │     expect(estimateOverhead(0.3)).toBeLessThan(estimateOverhead(0.6));
415 │   });
416 │ 
417 │   it('refuses absurd session sizes', () => {
418 │     expect(() => planSession(64 * 1024 * 1024, 'phone')).toThrow(/blocks/);
419 │   });
420 │ 
421 │   it('reports checksums that match known values', () => {
422 │     // CRC-32 of "123456789" is 0xCBF43926 (the standard check value).
423 │     expect(crc32u(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
424 │     // CRC-16/CCITT-FALSE of "123456789" is 0x29B1 (the standard check value).
425 │     expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
426 │   });
427 │ 
428 │   it('round-trips byte encodings', () => {
429 │     const bytes = randomPayload(257, 5);
430 │     expect(fromHex(toHex(bytes))).toEqual(bytes);
431 │     expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
432 │     expect(concatBytes(new Uint8Array([1]), [2, 3], new Uint8Array([4]))).toEqual(new Uint8Array([1, 2, 3, 4]));
433 │     expect(formatBytes(1536)).toBe('1.5 kB');
434 │   });
435 │ 
436 │   it('produces readable, reversible session codes', () => {
437 │     const id = 0x5f3a91c4;
438 │     const code = sessionCode(id);
439 │     expect(code).toHaveLength(7);
440 │     // Codes avoid look-alike characters so they can be read off a screen.
441 │     expect(code).not.toMatch(/[IO01]/);
442 │     expect(sessionCodeToId(code)).toBe(id >>> 0);
443 │     expect(sessionCodeToId('not a code')).toBeNull();
444 │   });
445 │ 
446 │   it('is deterministic across the compression and encryption boundary', () => {
447 │     const data = randomPayload(2048, 17);
448 │     const compressed = compressPayload(data);
449 │     expect(decompressPayload(compressed.bytes, compressed.codec)).toEqual(data);
450 │ 
451 │     const salt = randomPayload(16, 1);
452 │     const nonce = randomPayload(24, 2);
453 │     const sealed = encryptPayload(data, 'pw', new Uint8Array(0), salt, nonce, { N: 1024, r: 8, p: 1 });
454 │     const opened = decryptPayload(sealed.ciphertext, 'pw', salt, nonce, new Uint8Array(0), { N: 1024, r: 8, p: 1 });
455 │     expect(opened).toEqual(data);
456 │     expect(toHex(sealed.checksum)).toBe(hashHex(sealed.ciphertext));
457 │     expect(deriveKey('pw', salt, { N: 1024, r: 8, p: 1 })).toEqual(deriveKey('pw', salt, { N: 1024, r: 8, p: 1 }));
458 │     expect(passphraseFingerprint('pw', salt, { N: 1024, r: 8, p: 1 })).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
459 │   });
460 │ });
461 │ 
462 │ describe('sender preparation invariants (regressions)', () => {
463 │   it('plans the session against the exact wire length, encrypted or not', async () => {
464 │     const data = new TextEncoder().encode('invariant check '.repeat(40));
465 │ 
466 │     const plain = await prepareTransfer({ data, name: 'plain.txt', mime: 'text/plain' });
467 │     expect(plain.manifest.len).toBe(plain.wirePayload.length);
468 │     expect(plain.manifest.bs).toBe(plain.plan.blockSize);
469 │     expect(plain.manifest.k).toBe(plain.plan.k);
470 │     // The session must be big enough to carry the payload...
471 │     expect(plain.plan.blockSize * plain.plan.k).toBeGreaterThanOrEqual(plain.wirePayload.length);
472 │     // ...and not one block bigger than necessary, or every transfer would pay a
473 │     // frame of overhead it did not need.
474 │     expect(plain.manifest.k).toBe(Math.ceil(plain.wirePayload.length / plain.manifest.bs));
475 │   });
476 │ 
477 │   it('predicts the encrypted wire length (the AEAD tag is accounted for)', async () => {
478 │     const data = new TextEncoder().encode('encrypted invariant check '.repeat(30));
479 │     // A shortcut KDF: this test is about lengths and plans, not about key strength.
480 │     const fast = { N: 1024, r: 8, p: 1 };
481 │     const encrypted = await prepareTransfer({
482 │       data,
483 │       name: 'secret.txt',
484 │       mime: 'text/plain',
485 │       passphrase: 'correct horse battery staple',
486 │       kdf: fast,
487 │     });
488 │ 
489 │     // The manifest describes the wire payload exactly; if the planner had sized the
490 │     // session against a guess, `bs * k` would not cover it and decryption would
491 │     // fail on the receiver (which is what the encrypted e2e test would then catch).
492 │     expect(encrypted.manifest.len).toBe(encrypted.wirePayload.length);
493 │     expect(encrypted.manifest.bs).toBe(encrypted.plan.blockSize);
494 │     expect(encrypted.manifest.k).toBe(encrypted.plan.k);
495 │     expect(encrypted.wirePayload.length).toBeLessThanOrEqual(encrypted.plan.blockSize * encrypted.plan.k);
496 │ 
497 │     // XChaCha20-Poly1305 adds exactly a 16-byte tag. Recovering the plaintext
498 │     // length from the manifest's own numbers is what proves the planner was given
499 │     // the right wire length: preEncryption = original - saved (compression's
500 │     // contribution), and the wire payload must be that plus the tag.
501 │     const preEncryptionLength = encrypted.originalPayload.length - encrypted.compression.saved;
502 │     expect(encrypted.wirePayload.length - preEncryptionLength).toBe(16);
503 │ 
504 │     // And the plan must describe a session the frames can actually carry.
505 │     expect(Math.ceil(encrypted.wirePayload.length / encrypted.plan.blockSize)).toBe(encrypted.plan.k);
506 │   });
507 │ 
508 │   it('reports compression savings against the pre-encryption payload', async () => {
509 │     // Emphatically compressible, so the ratio is meaningful.
510 │     const text = new TextEncoder().encode('a'.repeat(20000));
511 │     const plain = await prepareTransfer({ data: text, name: 'a.txt', mime: 'text/plain' });
512 │     expect(plain.compression.codec).toBe('deflate');
513 │     expect(plain.compression.saved).toBe(text.length - plain.wirePayload.length);
514 │     expect(plain.compression.ratio).toBeGreaterThan(10);
515 │ 
516 │     const encrypted = await prepareTransfer({
517 │       data: text,
518 │       name: 'a.txt',
519 │       mime: 'text/plain',
520 │       passphrase: 'pw',
521 │       kdf: { N: 1024, r: 8, p: 1 },
522 │     });
523 │     // The AEAD tag is framing overhead, not a compression shortfall: the reported
524 │     // saving must be identical to the unencrypted case, not 16 bytes smaller.
525 │     expect(encrypted.compression.saved).toBe(plain.compression.saved);
526 │   });
527 │ });
528 │ 
529 │ describe('wire encoding selection', () => {
530 │   it('raw mode shortens frames and is flagged as such in the header', async () => {
531 │     // Incompressible and large enough that the block is limited by the symbol's
532 │     // capacity rather than by the payload. (A small payload that deflates to 49
533 │     // bytes plans a 49-byte block under BOTH encodings, which made the first
534 │     // version of this test assert something that was never true.)
535 │     const data = new Uint8Array(24_000);
536 │     for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) % 251;
537 │ 
538 │     const base32 = await prepareTransfer({ data, name: 'w.bin', mime: 'application/octet-stream', compress: false });
539 │     const raw = await prepareTransfer({
540 │       data,
541 │       name: 'w.bin',
542 │       mime: 'application/octet-stream',
543 │       compress: false,
544 │       wireEncoding: 'raw',
545 │     });
546 │ 
547 │     // Raw frames carry more data per symbol, so fewer blocks carry the payload.
548 │     expect(raw.plan.wireEncoding).toBe('raw');
549 │     expect(base32.plan.wireEncoding).toBe('base32');
550 │     expect(raw.plan.blockSize).toBeGreaterThan(base32.plan.blockSize);
551 │ 
552 │     // And the header flag must describe the encoding that was actually used, or a
553 │     // receiver that trusts the flag decodes the payload wrongly. (It did, once.)
554 │     expect(base32.flags & FrameFlag.Base32).toBe(FrameFlag.Base32);
555 │     expect(raw.flags & FrameFlag.Base32).toBe(0);
556 │ 
557 │     // A raw-encoded session must still transfer end to end in a browser-style chain.
558 │     const sender = new TransferSender(raw);
559 │     const receiver = new TransferReceiver();
560 │     let phase: ReturnType<TransferReceiver['accept']> = 'waiting-for-manifest';
561 │     for (let slot = 0; slot < 400 && phase !== 'complete'; slot++) {
562 │       const symbol = sender.symbolAt(slot);
563 │       const image = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
564 │       const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
565 │         inversionAttempts: 'dontInvert',
566 │       });
567 │       // jsQR returns a string too, but for a raw frame it is a lossy binary->string
568 │       // conversion. Passing the decoded BYTES is what a byte-mode receiver does, so
569 │       // drive that path explicitly here.
570 │       if (!decoded) continue;
571 │       const bytes = new Uint8Array(decoded.binaryData ? Array.from(decoded.binaryData) : []);
572 │       phase = bytes.length > 0 ? receiver.accept(bytes) : receiver.accept(decoded.data);
573 │     }
574 │     expect(phase).toBe('complete');
575 │     expect(receiver.getResult()!.integrity.ok).toBe(true);
576 │   });
577 │ });
```

---

## `packages/core/test/utf8.test.ts`

> 149 lines

Exercises the pure-TypeScript UTF-8 codec directly (`encodeUtf8Pure`, `decodeUtf8Pure`) across 1-, 2-, 3-, and 4-byte code points, lone surrogates, overlong encodings, and truncated sequences, and verifies `installUtf8Polyfill` cleanly installs global `TextEncoder`/`TextDecoder` shims when native globals are temporarily removed.

**Every line**

```ts
  1 │ /**
  2 │  * utf8.test.ts - the UTF-8 fallback codecs, checked against the real ones.
  3 │  *
  4 │  * Why this test matters more than most: on Node and in a browser the fallback is
  5 │  * never used, because the platform's own codecs are present. So without a test
  6 │  * that exercises the fallback DIRECTLY, a bug in it would compile, pass every
  7 │  * other test in this repository, and only appear on an iOS or Android device -
  8 │  * the two platforms that need it most.
  9 │  *
 10 │  * The strategy is differential: run the same input through Node's built-in
 11 │  * TextEncoder/TextDecoder and through the fallback, and require identical output.
 12 │  * The corpus deliberately includes the cases that break naive implementations:
 13 │  * astral-plane characters, lone surrogates, a BOM, overlong encodings, truncated
 14 │  * sequences, surrogates encoded in UTF-8, and values above U+10FFFF.
 15 │  */
 16 │ 
 17 │ import { describe, expect, it } from 'vitest';
 18 │ 
 19 │ import { Utf8Decoder, Utf8Encoder, hasNativeTextCodecs, installWebTextCodecs } from '../src/util/utf8.js';
 20 │ 
 21 │ const encoder = new Utf8Encoder();
 22 │ const decoder = new Utf8Decoder();
 23 │ 
 24 │ const STRINGS = [
 25 │   '',
 26 │   'plain ascii',
 27 │   'lightbeam',
 28 │   'Ünïcödé',
 29 │   '日本語のテキスト',
 30 │   'Ελληνικά και Кириллица',
 31 │   'emoji: 🔦📷✅',
 32 │   'astral: 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 (U+1D518)',
 33 │   'mixed 日本語 🔦 ascii',
 34 │   'nul\u0000inside',
 35 │   'combining: e\u0301 vs é',
 36 │   'rtl: \u0645\u0631\u062d\u0628\u0627',
 37 │   'zero width: a\u200bb',
 38 │   '\uD800', // lone high surrogate
 39 │   '\uDC00', // lone low surrogate
 40 │   'x\uD800y', // lone surrogate in the middle
 41 │   '\uD83D', // high surrogate without its pair
 42 │   '\uD83D\uDE00', // astral expressed as an explicit surrogate pair
 43 │   '\uFEFFwith bom',
 44 │ ];
 45 │ 
 46 │ const BYTES = [
 47 │   new Uint8Array(0),
 48 │   new Uint8Array([0x68, 0x69]),
 49 │   new Uint8Array([0xc3, 0x9c]), // Ü
 50 │   new Uint8Array([0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac]), // 日本
 51 │   new Uint8Array([0xf0, 0x9f, 0x94, 0xa6]), // 🔦
 52 │   new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), // BOM then 'a'
 53 │   new Uint8Array([0x61, 0x62, 0x63]),
 54 │   // Invalid sequences:
 55 │   new Uint8Array([0xc0, 0x80]), // overlong NUL
 56 │   new Uint8Array([0xe0, 0x80, 0x80]), // overlong
 57 │   new Uint8Array([0xed, 0xa0, 0x80]), // UTF-8 encoded surrogate
 58 │   new Uint8Array([0xf4, 0x90, 0x80, 0x80]), // above U+10FFFF
 59 │   new Uint8Array([0xe6, 0x97]), // truncated
 60 │   new Uint8Array([0x80, 0x80]), // lone continuation bytes
 61 │   new Uint8Array([0xff, 0xfe]), // never valid
 62 │   new Uint8Array([0x41, 0xe6, 0x97, 0x42]), // valid, invalid, valid
 63 │ ];
 64 │ 
 65 │ describe('Utf8Encoder fallback', () => {
 66 │   it('matches the platform encoder byte for byte', () => {
 67 │     if (!hasNativeTextCodecs()) throw new Error('expected Node to provide TextEncoder');
 68 │     const native = new TextEncoder();
 69 │     for (const text of STRINGS) {
 70 │       const expected = native.encode(text);
 71 │       const actual = encoder.encode(text);
 72 │       expect(actual.length, `length for ${JSON.stringify(text)}`).toBe(expected.length);
 73 │       expect(Array.from(actual), `bytes for ${JSON.stringify(text)}`).toEqual(Array.from(expected));
 74 │     }
 75 │   });
 76 │ 
 77 │   it('round-trips through the fallback decoder', () => {
 78 │     const nativeDecoder = new TextDecoder();
 79 │     for (const text of STRINGS) {
 80 │       const decoded = decoder.decode(encoder.encode(text));
 81 │       // Two cases are lossy BY DESIGN, and both match the platform codecs:
 82 │       //   * a lone surrogate is not encodable, so it becomes U+FFFD;
 83 │       //   * a leading BOM is stripped by every UTF-8 decoder, per WHATWG.
 84 │       // Rather than special-case them in the expectation, compare against what
 85 │       // Node does with the same string - that is the actual contract.
 86 │       const expected = nativeDecoder.decode(new TextEncoder().encode(text));
 87 │       expect(decoded, `round trip of ${JSON.stringify(text)}`).toBe(expected);
 88 │     }
 89 │   });
 90 │ });
 91 │ 
 92 │ describe('Utf8Decoder fallback', () => {
 93 │   it('matches the platform decoder on valid and invalid input', () => {
 94 │     const native = new TextDecoder();
 95 │     for (const bytes of BYTES) {
 96 │       const expected = native.decode(bytes);
 97 │       const actual = decoder.decode(bytes);
 98 │       expect(actual, `decode of [${Array.from(bytes).join(',')}]`).toBe(expected);
 99 │     }
100 │   });
101 │ 
102 │   it('strips a leading BOM but keeps one in the middle', () => {
103 │     expect(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
104 │     expect(decoder.decode(new Uint8Array([0x61, 0xef, 0xbb, 0xbf]))).toBe('a\uFEFF');
105 │   });
106 │ 
107 │   it('accepts an ArrayBuffer as well as a Uint8Array', () => {
108 │     const buffer = new Uint8Array([0x68, 0x69]).buffer;
109 │     expect(decoder.decode(buffer)).toBe('hi');
110 │   });
111 │ 
112 │   it('refuses fatal mode rather than pretending to implement it', () => {
113 │     expect(() => new Utf8Decoder('utf-8', { fatal: true })).toThrow(RangeError);
114 │   });
115 │ });
116 │ 
117 │ describe('installWebTextCodecs', () => {
118 │   it('does not replace codecs that already exist', () => {
119 │     const before = globalThis.TextEncoder;
120 │     const installed = installWebTextCodecs();
121 │     // On Node both are present, so nothing is installed and nothing changes.
122 │     expect(installed).toEqual({ textEncoder: false, textDecoder: false });
123 │     expect(globalThis.TextEncoder).toBe(before);
124 │   });
125 │ 
126 │   it('installs working codecs when they are missing', () => {
127 │     const saved = {
128 │       TextEncoder: (globalThis as Record<string, unknown>).TextEncoder,
129 │       TextDecoder: (globalThis as Record<string, unknown>).TextDecoder,
130 │     };
131 │     try {
132 │       delete (globalThis as Record<string, unknown>).TextEncoder;
133 │       delete (globalThis as Record<string, unknown>).TextDecoder;
134 │       expect(hasNativeTextCodecs()).toBe(false);
135 │ 
136 │       const installed = installWebTextCodecs();
137 │       expect(installed).toEqual({ textEncoder: true, textDecoder: true });
138 │ 
139 │       // The whole point: engine code that does `new TextEncoder()` now works.
140 │       const enc = new (globalThis as unknown as { TextEncoder: new () => Utf8Encoder }).TextEncoder();
141 │       const dec = new (globalThis as unknown as { TextDecoder: new () => Utf8Decoder }).TextDecoder();
142 │       expect(dec.decode(enc.encode('🔦 日本語 passphrase'))).toBe('🔦 日本語 passphrase');
143 │       expect(hasNativeTextCodecs()).toBe(true);
144 │     } finally {
145 │       (globalThis as Record<string, unknown>).TextEncoder = saved.TextEncoder;
146 │       (globalThis as Record<string, unknown>).TextDecoder = saved.TextDecoder;
147 │     }
148 │   });
149 │ });
```

---

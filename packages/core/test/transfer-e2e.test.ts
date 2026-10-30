/**
 * transfer-e2e.test.ts - the closest thing to a real transfer without hardware.
 *
 * The pipeline exercised here is the production one, end to end:
 *
 *   payload
 *     -> prepareTransfer          (compress, optional encrypt, hash, plan, manifest)
 *     -> TransferSender.symbolAt  (frame header + LT block + QR encoding)
 *     -> rasterizeRgba            (modules to pixels, exactly what a screen shows)
 *     -> jsQR                     (an independent QR *decoder*, standing in for a
 *                                  camera; it sees pixels only, so any protocol
 *                                  or framing mistake surfaces here)
 *     -> TransferReceiver.accept  (header validation, session filter, LT decode)
 *     -> verify / decrypt / inflate
 *     -> byte-for-byte comparison with the original payload
 *
 * Frame loss is injected between the sender and the decoder, which is how the
 * camera behaves in practice.
 */

import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { prepareTransfer, TransferSender } from '../src/transfer/sender.js';
import { TransferReceiver } from '../src/transfer/receiver.js';
import { rasterizeRgba } from '../src/qr/render.js';
import { crc32u, crc16 } from '../src/crypto/crc.js';
import { concatBytes, toHex, fromHex, toBase64Url, fromBase64Url, sessionCode, sessionCodeToId, formatBytes } from '../src/util/bytes.js';
import { Rng } from '../src/util/rng.js';
import {
  parseFrame,
  parseFrameDetailed,
  encodeDataFrame,
  encodeManifestFrame,
  FrameFlag,
  FrameType,
  FRAME_HEADER_BYTES,
} from '../src/protocol/frame.js';
import { splitManifest, ManifestAssembler, buildManifest, serializeManifest } from '../src/protocol/manifest.js';
import { planSession, framePayloadBytes, estimateOverhead } from '../src/protocol/planner.js';
import { compressPayload, decompressPayload } from '../src/transfer/compress.js';
import { hashHex } from '../src/crypto/integrity.js';
import { base32Decode, base32Encode, base32EncodedLength, isBase32 } from '../src/util/base32.js';
import { encryptPayload, decryptPayload, deriveKey, passphraseFingerprint } from '../src/crypto/aead.js';

function randomPayload(length: number, seed = 1): Uint8Array {
  const rng = new Rng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.nextUint32() & 0xff;
  return out;
}

/**
 * Show frames from a sender and read them back through a real QR decoder.
 *
 * @param loss    probability that a displayed frame is not captured at all
 * @param scale   pixels per module in the simulated screen (4 = typical phone)
 */
function receiveAll(
  sender: TransferSender,
  options: { loss?: number; maxFrames?: number; seed?: number; scale?: number; passphrase?: string } = {},
): { receiver: TransferReceiver; framesShown: number; framesDecoded: number; decodeFailures: number } {
  const loss = options.loss ?? 0;
  const scale = options.scale ?? 4;
  const maxFrames = options.maxFrames ?? 4000;
  const rng = new Rng(options.seed ?? 1234);
  const receiver = new TransferReceiver({ passphrase: options.passphrase });

  let framesShown = 0;
  let framesDecoded = 0;
  let decodeFailures = 0;

  for (let slot = 0; slot < maxFrames; slot++) {
    if (rng.nextFloat() < loss) continue; // frame never reaches the camera
    const symbol = sender.symbolAt(slot);
    framesShown++;

    // Render exactly as a screen would, then decode from pixels only.
    const image = rasterizeRgba(symbol, { scale, quietZone: 4 });
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    if (!decoded) {
      decodeFailures++;
      continue;
    }
    framesDecoded++;
    // A real platform hands over the decoded TEXT (native camera APIs) or bytes
    // (a browser decoder). jsQR provides both; the text path is what base32 frames
    // produce, so that is what we feed here.
    receiver.accept(decoded.data);
    // Stop on 'complete' and on 'failed': a failed transfer will never recover in
    // this loop, and continuing would decode thousands of frames for nothing.
    const phase = receiver.getProgress().phase;
    if (phase === 'complete' || phase === 'failed') break;
  }
  return { receiver, framesShown, framesDecoded, decodeFailures };
}

describe('end-to-end optical transfer', () => {
  it('sends a text payload through the full pipeline', async () => {
    const text = 'LightBeam end-to-end test\nline two\n🙂 مرحبا';
    const data = new TextEncoder().encode(text);
    const prepared = await prepareTransfer({
      data,
      name: 'note.txt',
      mime: 'text/plain',
      sessionId: 0x11223344,
      profile: 'phone',
    });
    const sender = new TransferSender(prepared);
    const { receiver, decodeFailures } = receiveAll(sender);

    expect(receiver.isComplete).toBe(true);
    const result = receiver.getResult()!;
    expect(result.text).toBe(text);
    expect(Array.from(result.payload)).toEqual(Array.from(data));
    expect(result.integrity.ok).toBe(true);
    expect(decodeFailures).toBe(0); // a clean virtual screen must decode every frame
  });

  it('recovers a binary payload with 25% of frames lost', async () => {
    const data = randomPayload(24 * 1024, 7);
    const prepared = await prepareTransfer({ data, name: 'blob.bin', mime: 'application/octet-stream', sessionId: 42 });
    const sender = new TransferSender(prepared);
    const { receiver, framesDecoded } = receiveAll(sender, { loss: 0.25, seed: 99, maxFrames: 4000 });

    expect(receiver.isComplete).toBe(true);
    const result = receiver.getResult()!;
    expect(Array.from(result.payload)).toEqual(Array.from(data));
    // A quarter of the displayed frames vanish; the fountain code absorbs it.
    expect(framesDecoded).toBeGreaterThan(prepared.manifest.k);
    expect(receiver.getProgress().framesSuspect).toBe(0);
  });

  it('sends an image-like payload and lets the receiver preview it early', async () => {
    const data = randomPayload(16 * 1024, 11);
    const prepared = await prepareTransfer({ data, name: 'photo.png', mime: 'image/png', sessionId: 77 });
    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();

    // Feed half the frames, then inspect the partial state: the UI relies on this
    // to show "received so far" before the transfer finishes.
    const target = Math.floor(prepared.manifest.k * 0.6);
    for (let slot = 0; slot < target * 2 && !receiver.isComplete; slot++) {
      const symbol = sender.symbolAt(slot);
      const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
      if (decoded) receiver.accept(decoded.data);
    }
    expect(receiver.isComplete).toBe(false);
    const partial = receiver.partial();
    expect(partial).not.toBeNull();
    expect(partial!.knownBytes).toBeGreaterThan(0);
    expect(partial!.totalBytes).toBe(data.length);
    // Some blocks are already exactly right.
    const progress = receiver.getProgress();
    expect(progress.progress).toBeGreaterThan(0.2);
    expect(progress.blocksTotal).toBe(prepared.manifest.k);
    expect(progress.phase).toBe('collecting');
  });

  it('handles an encrypted transfer, rejecting a wrong passphrase', async () => {
    const data = randomPayload(8 * 1024, 13);
    const passphrase = 'correct horse battery staple';
    const prepared = await prepareTransfer({
      data,
      name: 'secret.bin',
      mime: 'application/octet-stream',
      passphrase,
      sessionId: 555,
      kdf: { N: 1024, r: 8, p: 1 }, // fast KDF in tests; production uses 2^15
    });
    expect(prepared.encryption).toBe('xchacha20poly1305');
    const sender = new TransferSender(prepared);

    // Wrong passphrase first.
    const wrong = receiveAll(sender, { passphrase: 'wrong passphrase', seed: 5 });
    expect(wrong.receiver.isComplete).toBe(false);
    expect(wrong.receiver.getProgress().phase).toBe('failed');
    expect(wrong.receiver.getProgress().error).toMatch(/passphrase|modified/i);

    // Correct passphrase.
    const right = receiveAll(sender, { passphrase, seed: 6 });
    expect(right.receiver.isComplete).toBe(true);
    expect(Array.from(right.receiver.getResult()!.payload)).toEqual(Array.from(data));
  });

  it('compresses compressible payloads and is transparent when it does not help', async () => {
    const text = 'the quick brown fox jumps over the lazy dog. '.repeat(400);
    const data = new TextEncoder().encode(text);
    const prepared = await prepareTransfer({ data, name: 'repeated.txt', mime: 'text/plain', sessionId: 8 });
    expect(prepared.compression.codec).toBe('deflate');
    expect(prepared.wirePayload.length).toBeLessThan(data.length / 4);

    const sender = new TransferSender(prepared);
    const { receiver } = receiveAll(sender, { seed: 12 });
    expect(receiver.isComplete).toBe(true);
    expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(data));

    // Random bytes do not compress: the codec must stay 'store'.
    const incompressible = randomPayload(4096, 3);
    const second = await prepareTransfer({
      data: incompressible,
      name: 'noise.bin',
      mime: 'application/octet-stream',
      sessionId: 9,
    });
    expect(second.compression.codec).toBe('store');
  });

  it('ignores foreign frames and misdirected sessions', async () => {
    const data = randomPayload(4 * 1024, 21);
    const prepared = await prepareTransfer({ data, name: 'a.bin', mime: 'application/octet-stream', sessionId: 0xaabbccdd });
    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();

    // Interleave frames belonging to a different session and random QR content.
    for (let slot = 0; slot < 200 && !receiver.isComplete; slot++) {
      // Foreign session frame.
      const foreign = encodeDataFrame({ sessionId: 0x11223344, seed: slot, payload: new Uint8Array(prepared.manifest.bs) });
      receiver.accept(foreign);
      // Random QR (e.g. a product code on a poster).
      receiver.accept(new TextEncoder().encode('https://example.com/not-a-lightbeam-frame'));

      const symbol = sender.symbolAt(slot);
      const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
      if (decoded) receiver.accept(decoded.data);
    }
    expect(receiver.isComplete).toBe(true);
    expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(data));
    expect(receiver.getProgress().framesForeign).toBeGreaterThan(0);
  });

  it('aborts cleanly when the payload is corrupted in transit', async () => {
    const data = randomPayload(4 * 1024, 31);
    const prepared = await prepareTransfer({ data, name: 'flip.bin', mime: 'application/octet-stream', sessionId: 0x5a5a });
    const sender = new TransferSender(prepared);
    const receiver = new TransferReceiver();

    for (let slot = 0; slot < 500 && !receiver.isComplete; slot++) {
      const symbol = sender.symbolAt(slot);
      const image = rasterizeRgba(symbol, { scale: 4, quietZone: 4 });
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
      if (!decoded) continue;
      // Feed the frame as text (base32 wire encoding), but corrupt one base32
      // character of an occasional DATA frame. The header still validates, so the
      // receiver accepts the frame and the damage is caught only by the end-to-end
      // checksum - the exact scenario that check exists for. (Manifest frames carry
      // their own fragment CRC and are rejected earlier, so they are not useful
      // here.)
      // Corrupt every data frame. Corrupting only some would be non-deterministic:
      // a damaged frame whose block happens to be resolved by another frame first
      // is discarded as redundant and never contaminates the result, so the test
      // would pass through no fault of the checksum.
      let content = decoded.data;
      const frame = parseFrame(base32Decode(content));
      if (frame && frame.type === FrameType.Data && content.length > 20) {
        const at = content.length - 5;
        content = content.slice(0, at) + (content[at] === 'A' ? 'B' : 'A') + content.slice(at + 1);
      }
      receiver.accept(content);
    }
    const progress = receiver.getProgress();
    expect(progress.phase).toBe('failed');
    expect(progress.error).toMatch(/Integrity check failed/i);
    expect(receiver.getResult()).toBeNull();
  });

  it('accepts a partially lost manifest by reassembling fragments', () => {
    const manifest = buildManifest({
      sessionId: 4242,
      name: 'a-very-long-file-name-so-the-manifest-needs-several-fragments.bin',
      mime: 'application/octet-stream',
      payloadLength: 123456,
      originalLength: 123456,
      blockSize: 500,
      k: 247,
      codec: 'store',
      encryption: { mode: 'none' },
      sha256Hex: 'a'.repeat(64),
      crc32: 12345,
      note: 'fragment reassembly test',
    });
    const serialized = serializeManifest(manifest);
    const { fragments, count } = splitManifest(serialized, 40);
    expect(count).toBeGreaterThan(2);

    const assembler = new ManifestAssembler();
    // Deliver out of order, with duplicate and corrupted fragments mixed in.
    const order = [...fragments.keys()].reverse();
    for (const index of order) {
      const corrupted = Uint8Array.from(fragments[(index + 1) % count]);
      corrupted[corrupted.length - 1] ^= 0xff; // fails its fragment CRC
      expect(assembler.accept(corrupted)).toBeNull(); // a garbled fragment is not "received"
      const result = assembler.accept(fragments[index]);
      if (index === 0) expect(result, 'must only complete on the final fragment').not.toBeNull();
    }
    expect(assembler.complete).toBe(false); // reset() after completion
  });
});

describe('frame format', () => {
  it('round-trips a data frame and detects a flipped header bit', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const bytes = encodeDataFrame({ sessionId: 0xdeadbeef, seed: 0x01020304, payload });
    const frame = parseFrame(bytes)!;
    expect(frame.type).toBe(FrameType.Data);
    expect(frame.sessionId).toBe(0xdeadbeef);
    expect(frame.seed).toBe(0x01020304);
    expect(Array.from(frame.payload)).toEqual([1, 2, 3, 4, 5]);

    // A single flipped bit in the session id must be caught by the header CRC.
    const tampered = Uint8Array.from(bytes);
    tampered[4] ^= 0x01;
    const parsed = parseFrame(tampered);
    expect(parsed).not.toBeNull();
    // parseFrame() deliberately still returns the frame; the detailed variant
    // reports the CRC result so the receiver can decide.
    expect(parseFrameDetailed(tampered)!.headerValid).toBe(false);
  });

  it('packs manifest fragment indices into the header word', () => {
    const bytes = encodeManifestFrame({
      sessionId: 7,
      fragmentIndex: 3,
      fragmentCount: 9,
      payload: new Uint8Array([9, 9]),
    });
    const frame = parseFrame(bytes)!;
    expect(frame.type).toBe(FrameType.Manifest);
    expect(frame.fragmentIndex).toBe(3);
    expect(frame.fragmentCount).toBe(9);
  });

  it('rejects non-LightBeam input without throwing', () => {
    expect(parseFrame(new Uint8Array(0))).toBeNull();
    expect(parseFrame(new TextEncoder().encode('hello world, definitely not a frame'))).toBeNull();
    const wrongMagic = new Uint8Array(32);
    wrongMagic[0] = 0x41;
    expect(parseFrame(wrongMagic)).toBeNull();
  });
});

describe('base32 wire encoding', () => {
  it('round-trips arbitrary bytes, including all 256 values', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const text = base32Encode(bytes);
    expect(isBase32(text)).toBe(true);
    expect(text).toMatch(/^[A-Z2-7]+$/); // stays inside QR's alphanumeric character set
    expect(Array.from(base32Decode(text))).toEqual(Array.from(bytes));
    expect(base32EncodedLength(256)).toBe(text.length);
    expect(text.length).toBe(410); // 2048 bits / 5 bits per character
  });

  it('round-trips every length from 1 to 40 bytes (padding cases)', () => {
    for (let length = 1; length <= 40; length++) {
      const bytes = randomPayload(length, 100 + length);
      const decoded = base32Decode(base32Encode(bytes));
      expect(decoded.length, `length ${length}`).toBe(length);
      expect(Array.from(decoded), `length ${length}`).toEqual(Array.from(bytes));
    }
  });

  it('tolerates lowercase, whitespace and padding from third-party scanners', () => {
    const bytes = randomPayload(37, 5);
    const canonical = base32Encode(bytes);
    expect(Array.from(base32Decode(canonical.toLowerCase()))).toEqual(Array.from(bytes));
    expect(Array.from(base32Decode(canonical + '======'))).toEqual(Array.from(bytes));
    expect(Array.from(base32Decode(`  ${canonical} `))).toEqual(Array.from(bytes));
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('ABC!DEF')).toThrow(/Invalid base32/);
    expect(isBase32('ABC1DEF')).toBe(false); // 0, 1, 8, 9 are not in RFC 4648 base32
  });

  it('costs well under 20% more than raw byte mode', () => {
    // 5 bytes -> 8 characters is a 60% character expansion, but QR alphanumeric
    // mode packs 11 bits per 2 characters instead of 8 bits per character, so the
    // real cost is roughly 10%. This test guards that reasoning.
    const planRaw = planSession(100_000, 'balanced', { wireEncoding: 'raw' });
    const planB32 = planSession(100_000, 'balanced', { wireEncoding: 'base32' });
    expect(planB32.wireEncoding).toBe('base32');
    expect(planRaw.wireEncoding).toBe('raw');
    // Characters needed per frame, converted to bits at alphanumeric density.
    const rawBitsPerFrame = (planRaw.blockSize + FRAME_HEADER_BYTES) * 8;
    const b32BitsPerFrame = base32EncodedLength(planB32.blockSize + FRAME_HEADER_BYTES) * 5.5;
    const framesRatio = (planB32.k * b32BitsPerFrame) / (planRaw.k * rawBitsPerFrame);
    expect(framesRatio).toBeLessThan(1.2);
  });
});

describe('planner and utilities', () => {
  it('sizes blocks to exactly fill a symbol', () => {
    const plan = planSession(100_000, 'balanced');
    expect(plan.modules).toBe(77);
    expect(plan.k).toBe(Math.ceil(100_000 / plan.blockSize));

    // Raw mode: the header and the block are the only things in the symbol.
    const raw = planSession(100_000, 'balanced', { wireEncoding: 'raw' });
    expect(raw.blockSize).toBe(framePayloadBytes(15, raw.ecLevel) - FRAME_HEADER_BYTES);

    // Base32 mode: base32(header + block) must fit the same character budget.
    const b32 = planSession(100_000, 'balanced', { wireEncoding: 'base32' });
    expect(base32EncodedLength(b32.blockSize + FRAME_HEADER_BYTES)).toBeLessThanOrEqual(
      framePayloadBytes(15, b32.ecLevel),
    );
    // ...and be close to the budget, i.e. not wasting screen time.
    expect(framePayloadBytes(15, b32.ecLevel) - base32EncodedLength(b32.blockSize + FRAME_HEADER_BYTES)).toBeLessThan(8);
  });

  it('grows the overhead estimate with loss', () => {
    expect(estimateOverhead(0)).toBeLessThan(estimateOverhead(0.3));
    expect(estimateOverhead(0.3)).toBeLessThan(estimateOverhead(0.6));
  });

  it('refuses absurd session sizes', () => {
    expect(() => planSession(64 * 1024 * 1024, 'phone')).toThrow(/blocks/);
  });

  it('reports checksums that match known values', () => {
    // CRC-32 of "123456789" is 0xCBF43926 (the standard check value).
    expect(crc32u(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    // CRC-16/CCITT-FALSE of "123456789" is 0x29B1 (the standard check value).
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });

  it('round-trips byte encodings', () => {
    const bytes = randomPayload(257, 5);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(concatBytes(new Uint8Array([1]), [2, 3], new Uint8Array([4]))).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(formatBytes(1536)).toBe('1.5 kB');
  });

  it('produces readable, reversible session codes', () => {
    const id = 0x5f3a91c4;
    const code = sessionCode(id);
    expect(code).toHaveLength(7);
    // Codes avoid look-alike characters so they can be read off a screen.
    expect(code).not.toMatch(/[IO01]/);
    expect(sessionCodeToId(code)).toBe(id >>> 0);
    expect(sessionCodeToId('not a code')).toBeNull();
  });

  it('is deterministic across the compression and encryption boundary', () => {
    const data = randomPayload(2048, 17);
    const compressed = compressPayload(data);
    expect(decompressPayload(compressed.bytes, compressed.codec)).toEqual(data);

    const salt = randomPayload(16, 1);
    const nonce = randomPayload(24, 2);
    const sealed = encryptPayload(data, 'pw', new Uint8Array(0), salt, nonce, { N: 1024, r: 8, p: 1 });
    const opened = decryptPayload(sealed.ciphertext, 'pw', salt, nonce, new Uint8Array(0), { N: 1024, r: 8, p: 1 });
    expect(opened).toEqual(data);
    expect(toHex(sealed.checksum)).toBe(hashHex(sealed.ciphertext));
    expect(deriveKey('pw', salt, { N: 1024, r: 8, p: 1 })).toEqual(deriveKey('pw', salt, { N: 1024, r: 8, p: 1 }));
    expect(passphraseFingerprint('pw', salt, { N: 1024, r: 8, p: 1 })).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});

describe('sender preparation invariants (regressions)', () => {
  it('plans the session against the exact wire length, encrypted or not', async () => {
    const data = new TextEncoder().encode('invariant check '.repeat(40));

    const plain = await prepareTransfer({ data, name: 'plain.txt', mime: 'text/plain' });
    expect(plain.manifest.len).toBe(plain.wirePayload.length);
    expect(plain.manifest.bs).toBe(plain.plan.blockSize);
    expect(plain.manifest.k).toBe(plain.plan.k);
    // The session must be big enough to carry the payload...
    expect(plain.plan.blockSize * plain.plan.k).toBeGreaterThanOrEqual(plain.wirePayload.length);
    // ...and not one block bigger than necessary, or every transfer would pay a
    // frame of overhead it did not need.
    expect(plain.manifest.k).toBe(Math.ceil(plain.wirePayload.length / plain.manifest.bs));
  });

  it('predicts the encrypted wire length (the AEAD tag is accounted for)', async () => {
    const data = new TextEncoder().encode('encrypted invariant check '.repeat(30));
    // A shortcut KDF: this test is about lengths and plans, not about key strength.
    const fast = { N: 1024, r: 8, p: 1 };
    const encrypted = await prepareTransfer({
      data,
      name: 'secret.txt',
      mime: 'text/plain',
      passphrase: 'correct horse battery staple',
      kdf: fast,
    });

    // The manifest describes the wire payload exactly; if the planner had sized the
    // session against a guess, `bs * k` would not cover it and decryption would
    // fail on the receiver (which is what the encrypted e2e test would then catch).
    expect(encrypted.manifest.len).toBe(encrypted.wirePayload.length);
    expect(encrypted.manifest.bs).toBe(encrypted.plan.blockSize);
    expect(encrypted.manifest.k).toBe(encrypted.plan.k);
    expect(encrypted.wirePayload.length).toBeLessThanOrEqual(encrypted.plan.blockSize * encrypted.plan.k);

    // XChaCha20-Poly1305 adds exactly a 16-byte tag. Recovering the plaintext
    // length from the manifest's own numbers is what proves the planner was given
    // the right wire length: preEncryption = original - saved (compression's
    // contribution), and the wire payload must be that plus the tag.
    const preEncryptionLength = encrypted.originalPayload.length - encrypted.compression.saved;
    expect(encrypted.wirePayload.length - preEncryptionLength).toBe(16);

    // And the plan must describe a session the frames can actually carry.
    expect(Math.ceil(encrypted.wirePayload.length / encrypted.plan.blockSize)).toBe(encrypted.plan.k);
  });

  it('reports compression savings against the pre-encryption payload', async () => {
    // Emphatically compressible, so the ratio is meaningful.
    const text = new TextEncoder().encode('a'.repeat(20000));
    const plain = await prepareTransfer({ data: text, name: 'a.txt', mime: 'text/plain' });
    expect(plain.compression.codec).toBe('deflate');
    expect(plain.compression.saved).toBe(text.length - plain.wirePayload.length);
    expect(plain.compression.ratio).toBeGreaterThan(10);

    const encrypted = await prepareTransfer({
      data: text,
      name: 'a.txt',
      mime: 'text/plain',
      passphrase: 'pw',
      kdf: { N: 1024, r: 8, p: 1 },
    });
    // The AEAD tag is framing overhead, not a compression shortfall: the reported
    // saving must be identical to the unencrypted case, not 16 bytes smaller.
    expect(encrypted.compression.saved).toBe(plain.compression.saved);
  });
});

describe('wire encoding selection', () => {
  it('raw mode shortens frames and is flagged as such in the header', async () => {
    // Incompressible and large enough that the block is limited by the symbol's
    // capacity rather than by the payload. (A small payload that deflates to 49
    // bytes plans a 49-byte block under BOTH encodings, which made the first
    // version of this test assert something that was never true.)
    const data = new Uint8Array(24_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) % 251;

    const base32 = await prepareTransfer({ data, name: 'w.bin', mime: 'application/octet-stream', compress: false });
    const raw = await prepareTransfer({
      data,
      name: 'w.bin',
      mime: 'application/octet-stream',
      compress: false,
      wireEncoding: 'raw',
    });

    // Raw frames carry more data per symbol, so fewer blocks carry the payload.
    expect(raw.plan.wireEncoding).toBe('raw');
    expect(base32.plan.wireEncoding).toBe('base32');
    expect(raw.plan.blockSize).toBeGreaterThan(base32.plan.blockSize);

    // And the header flag must describe the encoding that was actually used, or a
    // receiver that trusts the flag decodes the payload wrongly. (It did, once.)
    expect(base32.flags & FrameFlag.Base32).toBe(FrameFlag.Base32);
    expect(raw.flags & FrameFlag.Base32).toBe(0);

    // A raw-encoded session must still transfer end to end in a browser-style chain.
    const sender = new TransferSender(raw);
    const receiver = new TransferReceiver();
    let phase: ReturnType<TransferReceiver['accept']> = 'waiting-for-manifest';
    for (let slot = 0; slot < 400 && phase !== 'complete'; slot++) {
      const symbol = sender.symbolAt(slot);
      const image = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
      const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
        inversionAttempts: 'dontInvert',
      });
      // jsQR returns a string too, but for a raw frame it is a lossy binary->string
      // conversion. Passing the decoded BYTES is what a byte-mode receiver does, so
      // drive that path explicitly here.
      if (!decoded) continue;
      const bytes = new Uint8Array(decoded.binaryData ? Array.from(decoded.binaryData) : []);
      phase = bytes.length > 0 ? receiver.accept(bytes) : receiver.accept(decoded.data);
    }
    expect(phase).toBe('complete');
    expect(receiver.getResult()!.integrity.ok).toBe(true);
  });
});

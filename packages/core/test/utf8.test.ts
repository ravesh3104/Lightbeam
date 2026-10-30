/**
 * utf8.test.ts - the UTF-8 fallback codecs, checked against the real ones.
 *
 * Why this test matters more than most: on Node and in a browser the fallback is
 * never used, because the platform's own codecs are present. So without a test
 * that exercises the fallback DIRECTLY, a bug in it would compile, pass every
 * other test in this repository, and only appear on an iOS or Android device -
 * the two platforms that need it most.
 *
 * The strategy is differential: run the same input through Node's built-in
 * TextEncoder/TextDecoder and through the fallback, and require identical output.
 * The corpus deliberately includes the cases that break naive implementations:
 * astral-plane characters, lone surrogates, a BOM, overlong encodings, truncated
 * sequences, surrogates encoded in UTF-8, and values above U+10FFFF.
 */

import { describe, expect, it } from 'vitest';

import { Utf8Decoder, Utf8Encoder, hasNativeTextCodecs, installWebTextCodecs } from '../src/util/utf8.js';

const encoder = new Utf8Encoder();
const decoder = new Utf8Decoder();

const STRINGS = [
  '',
  'plain ascii',
  'lightbeam',
  'Ünïcödé',
  '日本語のテキスト',
  'Ελληνικά και Кириллица',
  'emoji: 🔦📷✅',
  'astral: 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 (U+1D518)',
  'mixed 日本語 🔦 ascii',
  'nul\u0000inside',
  'combining: e\u0301 vs é',
  'rtl: \u0645\u0631\u062d\u0628\u0627',
  'zero width: a\u200bb',
  '\uD800', // lone high surrogate
  '\uDC00', // lone low surrogate
  'x\uD800y', // lone surrogate in the middle
  '\uD83D', // high surrogate without its pair
  '\uD83D\uDE00', // astral expressed as an explicit surrogate pair
  '\uFEFFwith bom',
];

const BYTES = [
  new Uint8Array(0),
  new Uint8Array([0x68, 0x69]),
  new Uint8Array([0xc3, 0x9c]), // Ü
  new Uint8Array([0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac]), // 日本
  new Uint8Array([0xf0, 0x9f, 0x94, 0xa6]), // 🔦
  new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), // BOM then 'a'
  new Uint8Array([0x61, 0x62, 0x63]),
  // Invalid sequences:
  new Uint8Array([0xc0, 0x80]), // overlong NUL
  new Uint8Array([0xe0, 0x80, 0x80]), // overlong
  new Uint8Array([0xed, 0xa0, 0x80]), // UTF-8 encoded surrogate
  new Uint8Array([0xf4, 0x90, 0x80, 0x80]), // above U+10FFFF
  new Uint8Array([0xe6, 0x97]), // truncated
  new Uint8Array([0x80, 0x80]), // lone continuation bytes
  new Uint8Array([0xff, 0xfe]), // never valid
  new Uint8Array([0x41, 0xe6, 0x97, 0x42]), // valid, invalid, valid
];

describe('Utf8Encoder fallback', () => {
  it('matches the platform encoder byte for byte', () => {
    if (!hasNativeTextCodecs()) throw new Error('expected Node to provide TextEncoder');
    const native = new TextEncoder();
    for (const text of STRINGS) {
      const expected = native.encode(text);
      const actual = encoder.encode(text);
      expect(actual.length, `length for ${JSON.stringify(text)}`).toBe(expected.length);
      expect(Array.from(actual), `bytes for ${JSON.stringify(text)}`).toEqual(Array.from(expected));
    }
  });

  it('round-trips through the fallback decoder', () => {
    const nativeDecoder = new TextDecoder();
    for (const text of STRINGS) {
      const decoded = decoder.decode(encoder.encode(text));
      // Two cases are lossy BY DESIGN, and both match the platform codecs:
      //   * a lone surrogate is not encodable, so it becomes U+FFFD;
      //   * a leading BOM is stripped by every UTF-8 decoder, per WHATWG.
      // Rather than special-case them in the expectation, compare against what
      // Node does with the same string - that is the actual contract.
      const expected = nativeDecoder.decode(new TextEncoder().encode(text));
      expect(decoded, `round trip of ${JSON.stringify(text)}`).toBe(expected);
    }
  });
});

describe('Utf8Decoder fallback', () => {
  it('matches the platform decoder on valid and invalid input', () => {
    const native = new TextDecoder();
    for (const bytes of BYTES) {
      const expected = native.decode(bytes);
      const actual = decoder.decode(bytes);
      expect(actual, `decode of [${Array.from(bytes).join(',')}]`).toBe(expected);
    }
  });

  it('strips a leading BOM but keeps one in the middle', () => {
    expect(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(decoder.decode(new Uint8Array([0x61, 0xef, 0xbb, 0xbf]))).toBe('a\uFEFF');
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const buffer = new Uint8Array([0x68, 0x69]).buffer;
    expect(decoder.decode(buffer)).toBe('hi');
  });

  it('refuses fatal mode rather than pretending to implement it', () => {
    expect(() => new Utf8Decoder('utf-8', { fatal: true })).toThrow(RangeError);
  });
});

describe('installWebTextCodecs', () => {
  it('does not replace codecs that already exist', () => {
    const before = globalThis.TextEncoder;
    const installed = installWebTextCodecs();
    // On Node both are present, so nothing is installed and nothing changes.
    expect(installed).toEqual({ textEncoder: false, textDecoder: false });
    expect(globalThis.TextEncoder).toBe(before);
  });

  it('installs working codecs when they are missing', () => {
    const saved = {
      TextEncoder: (globalThis as Record<string, unknown>).TextEncoder,
      TextDecoder: (globalThis as Record<string, unknown>).TextDecoder,
    };
    try {
      delete (globalThis as Record<string, unknown>).TextEncoder;
      delete (globalThis as Record<string, unknown>).TextDecoder;
      expect(hasNativeTextCodecs()).toBe(false);

      const installed = installWebTextCodecs();
      expect(installed).toEqual({ textEncoder: true, textDecoder: true });

      // The whole point: engine code that does `new TextEncoder()` now works.
      const enc = new (globalThis as unknown as { TextEncoder: new () => Utf8Encoder }).TextEncoder();
      const dec = new (globalThis as unknown as { TextDecoder: new () => Utf8Decoder }).TextDecoder();
      expect(dec.decode(enc.encode('🔦 日本語 passphrase'))).toBe('🔦 日本語 passphrase');
      expect(hasNativeTextCodecs()).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).TextEncoder = saved.TextEncoder;
      (globalThis as Record<string, unknown>).TextDecoder = saved.TextDecoder;
    }
  });
});

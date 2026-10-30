/**
 * utf8.ts - UTF-8 codecs, and a way to install them where the platform forgot to.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The engine encodes text, decodes manifest JSON, derives keys from a passphrase
 * and reads the sender's name out of a QR frame - all of which needs UTF-8. On
 * Node and modern browsers, `TextEncoder`/`TextDecoder` are built in; constrained
 * embedded JS sandboxes and stripped worker runtimes sometimes omit one or both.
 *
 * Implementing deterministic WHATWG-conformant codecs here, tested byte-for-byte
 * against Node's built-ins (see test/utf8.test.ts), guarantees identical string
 * handling across every browser, worker and test runtime.
 *
 * Correctness notes, because "just encode the code units" is not correct:
 *   - code points above U+FFFF (emoji, rare CJK) are surrogate PAIRS in
 *     JavaScript and must become one 4-byte sequence, not two 3-byte ones;
 *   - a lone surrogate is not encodable; WHATWG mandates U+FFFD, and Node does
 *     the same, so the tests pin that behaviour;
 *   - the decoder must reject overlong encodings, surrogates and out-of-range
 *     code points, replacing each bad sequence with exactly one U+FFFD - a
 *     decoder that "repairs" silently would turn a corrupted manifest into a
 *     plausible-but-wrong one.
 */

const REPLACEMENT = 0xfffd;

/** WHATWG-conformant UTF-8 encoder. */
export class Utf8Encoder {
  /**
   * Encode a string to UTF-8 bytes.
   *
   * The output is sized exactly: the string is measured in a first pass (one
   * arithmetic branch per code unit, no allocation) and the array is allocated
   * once at the final length. The alternative - allocate 3x, encode, then slice -
   * is the same number of passes plus a copy.
   *
   * @param input anything; non-strings are coerced with String(), matching
   *              TextEncoder.encode, which the tests compare against.
   */
  encode(input = ''): Uint8Array {
    const text = String(input);
    // Worst case is 3 bytes per UTF-16 code unit + 1; measure first so the
    // result is exactly sized rather than over-allocated and sliced.
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) size += 1;
      else if (code < 0x800) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        // High surrogate: 4 bytes if a valid low surrogate follows, else U+FFFD.
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          size += 4;
          i++;
        } else size += 3;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        size += 3; // lone low surrogate -> U+FFFD
      } else size += 3;
    }

    const out = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
          i++;
        } else {
          code = REPLACEMENT;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = REPLACEMENT;
      }

      if (code < 0x80) {
        out[offset++] = code;
      } else if (code < 0x800) {
        out[offset++] = 0xc0 | (code >> 6);
        out[offset++] = 0x80 | (code & 0x3f);
      } else if (code < 0x10000) {
        out[offset++] = 0xe0 | (code >> 12);
        out[offset++] = 0x80 | ((code >> 6) & 0x3f);
        out[offset++] = 0x80 | (code & 0x3f);
      } else {
        out[offset++] = 0xf0 | (code >> 18);
        out[offset++] = 0x80 | ((code >> 12) & 0x3f);
        out[offset++] = 0x80 | ((code >> 6) & 0x3f);
        out[offset++] = 0x80 | (code & 0x3f);
      }
    }
    return out;
  }
}

/** WHATWG-conformant UTF-8 decoder (non-streaming use, which is all we need). */
export class Utf8Decoder {
  readonly encoding = 'utf-8';
  readonly fatal = false;
  readonly ignoreBOM: boolean;

  constructor(label = 'utf-8', options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
    void label;
    this.ignoreBOM = options.ignoreBOM ?? false;
    if (options.fatal) {
      // The engine never asks for fatal mode; failing loudly would turn a single
      // damaged byte into a dead session, and the integrity check downstream is
      // what actually decides whether data is good.
      throw new RangeError('Utf8Decoder fallback does not implement fatal decoding');
    }
  }

  decode(input?: Uint8Array | ArrayBuffer | ArrayBufferView): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof Uint8Array
        ? input
        : input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array((input as ArrayBufferView).buffer, (input as ArrayBufferView).byteOffset, (input as ArrayBufferView).byteLength);

    let out = '';
    let i = 0;

    // A leading BOM is stripped unless ignoreBOM is set, matching TextDecoder.
    if (!this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      i = 3;
    }

    while (i < bytes.length) {
      const lead = bytes[i];

      if (lead < 0x80) {
        out += String.fromCharCode(lead);
        i++;
        continue;
      }

      /*
       * Work out what this lead byte promises.
       *
       * The `second` range is the part that makes this a *maximal subpart*
       * decoder rather than an approximate one: each of the four special lead
       * bytes (E0, ED, F0, F4) narrows the legal second byte, and that narrowing
       * is exactly what rejects overlong encodings (E0 80 ...), UTF-8 encoded
       * surrogates (ED A0 ...), and code points beyond U+10FFFF (F4 90 ...).
       *
       * Matching the platform decoders here is not pedantry. Node's TextDecoder
       * (via ICU) emits one U+FFFD per ill-formed maximal subpart, and so does
       * the browser. A decoder that emits a different number of replacement
       * characters would produce different strings for the same damaged input -
       * and the fallback runs on iOS and Android, where nothing else would catch
       * the discrepancy (see test/utf8.test.ts, which compares against Node).
       */
      let needed: number;
      let codePoint: number;
      let secondMin: number;
      let secondMax: number;

      if (lead >= 0xc2 && lead <= 0xdf) {
        needed = 1;
        codePoint = lead & 0x1f;
        secondMin = 0x80;
        secondMax = 0xbf;
      } else if (lead === 0xe0) {
        needed = 2;
        codePoint = lead & 0x0f;
        secondMin = 0xa0;
        secondMax = 0xbf;
      } else if ((lead >= 0xe1 && lead <= 0xec) || lead === 0xee || lead === 0xef) {
        needed = 2;
        codePoint = lead & 0x0f;
        secondMin = 0x80;
        secondMax = 0xbf;
      } else if (lead === 0xed) {
        needed = 2;
        codePoint = lead & 0x0f;
        secondMin = 0x80;
        secondMax = 0x9f; // excludes surrogates U+D800..U+DFFF
      } else if (lead === 0xf0) {
        needed = 3;
        codePoint = lead & 0x07;
        secondMin = 0x90;
        secondMax = 0xbf;
      } else if (lead >= 0xf1 && lead <= 0xf3) {
        needed = 3;
        codePoint = lead & 0x07;
        secondMin = 0x80;
        secondMax = 0xbf;
      } else if (lead === 0xf4) {
        needed = 3;
        codePoint = lead & 0x07;
        secondMin = 0x80;
        secondMax = 0x8f; // excludes anything above U+10FFFF
      } else {
        // 0x80-0xC1 (continuation bytes and overlong leads) and 0xF5-0xFF can
        // never begin a sequence: each is its own maximal subpart.
        out += String.fromCharCode(REPLACEMENT);
        i++;
        continue;
      }

      const sequenceStart = i;
      i++;

      // First continuation byte: the special range applies.
      if (i >= bytes.length) {
        out += String.fromCharCode(REPLACEMENT); // truncated at end of input
        break;
      }
      const second = bytes[i];
      if (second < secondMin || second > secondMax) {
        // Only the lead byte is ill-formed; do not consume the byte that failed.
        out += String.fromCharCode(REPLACEMENT);
        i = sequenceStart + 1;
        continue;
      }
      codePoint = (codePoint << 6) | (second & 0x3f);
      needed--;
      i++;

      // Remaining continuation bytes: plain 0x80-0xBF range.
      let truncated = false;
      while (needed > 0) {
        if (i >= bytes.length) {
          truncated = true;
          break;
        }
        const continuation = bytes[i];
        if (continuation < 0x80 || continuation > 0xbf) break;
        codePoint = (codePoint << 6) | (continuation & 0x3f);
        needed--;
        i++;
      }

      if (truncated) {
        out += String.fromCharCode(REPLACEMENT);
        break;
      }
      if (needed > 0) {
        // The prefix was well-formed but the next byte cannot continue it: one
        // U+FFFD for the prefix, and the offending byte is reconsidered.
        out += String.fromCharCode(REPLACEMENT);
        continue;
      }

      if (codePoint <= 0xffff) {
        out += String.fromCharCode(codePoint);
      } else {
        const adjusted = codePoint - 0x10000;
        out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      }
    }

    return out;
  }
}

/**
 * Install the codecs as globals if the runtime is missing them.
 *
 * Returns a description of what was installed, which the mobile app shows in the
 * About screen's diagnostics - so "why does this build think it needs a
 * polyfill?" is answerable from a screenshot.
 */
export function installWebTextCodecs(): { textEncoder: boolean; textDecoder: boolean } {
  const target = globalThis as unknown as {
    TextEncoder?: unknown;
    TextDecoder?: unknown;
  };
  const installed = { textEncoder: false, textDecoder: false };
  if (typeof target.TextEncoder === 'undefined') {
    target.TextEncoder = Utf8Encoder;
    installed.textEncoder = true;
  }
  if (typeof target.TextDecoder === 'undefined') {
    target.TextDecoder = Utf8Decoder;
    installed.textDecoder = true;
  }
  return installed;
}

/** True when the runtime provides UTF-8 codecs natively (Node, browsers, Deno). */
export function hasNativeTextCodecs(): boolean {
  return typeof (globalThis as { TextEncoder?: unknown }).TextEncoder !== 'undefined';
}

/** UTF-8 encode using whatever is available. */
export function utf8EncodeWithFallback(text: string): Uint8Array {
  const Ctor = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  return Ctor ? new Ctor().encode(text) : new Utf8Encoder().encode(text);
}

/** UTF-8 decode using whatever is available. */
export function utf8DecodeWithFallback(bytes: Uint8Array): string {
  const Ctor = (globalThis as { TextDecoder?: new () => { decode(input: Uint8Array): string } }).TextDecoder;
  return Ctor ? new Ctor().decode(bytes) : new Utf8Decoder().decode(bytes);
}

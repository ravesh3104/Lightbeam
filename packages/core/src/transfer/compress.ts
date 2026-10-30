/**
 * compress.ts - payload compression.
 *
 * The optical channel is the slowest part of the system (roughly 100-400 kB/s),
 * so spending a little CPU on the sender to shrink the payload is almost always a
 * win. gzip/deflate at level 6 typically shrinks text, JSON, source code, logs
 * and CSV by 3-10x, which translates one-for-one into a shorter transfer: a
 * 300 kB text file goes from ~3 s of screen time to ~0.4 s.
 *
 * Guard rails, because compression is not free:
 *   - it is only applied when it actually helps by more than MIN_GAIN (a JPEG or
 *     a ZIP is already compressed; inflating it slightly would waste screen
 *     time and CPU),
 *   - the receiver is told which codec was used in the manifest, so the decision
 *     is explicit and reversible,
 *   - 'store' is always a valid answer.
 *
 * Implementation: pako (a pure-JS zlib port). Chosen over the browser's
 * browser CompressionStream and Node zlib so that the exact same
 * bytes are produced on every platform - the payload checksum in the manifest
 * must match no matter which device re-encoded it.
 */

import { deflate, inflate } from 'pako';

export type Codec = 'store' | 'deflate';

export interface CompressResult {
  codec: Codec;
  bytes: Uint8Array;
  /** Bytes saved (>= 0). */
  saved: number;
  ratio: number;
}

/** Minimum fractional saving required before compression is used (5%). */
export const MIN_GAIN = 0.05;

/** Above this size we skip compression entirely to keep the UI responsive. */
export const MAX_COMPRESS_BYTES = 64 * 1024 * 1024;

/** Deflate level 6: the standard speed/size knee, and fast enough on a phone. */
export const DEFLATE_LEVEL = 6;

export function compressPayload(input: Uint8Array): CompressResult {
  const stored: CompressResult = { codec: 'store', bytes: input, saved: 0, ratio: 1 };
  if (input.length < 64 || input.length > MAX_COMPRESS_BYTES) return stored;

  let deflated: Uint8Array;
  try {
    deflated = deflate(input, { level: DEFLATE_LEVEL });
  } catch {
    // Never fail a transfer because compression failed.
    return stored;
  }

  const saved = input.length - deflated.length;
  if (saved <= input.length * MIN_GAIN) return stored;
  return { codec: 'deflate', bytes: deflated, saved, ratio: deflated.length / input.length };
}

export function decompressPayload(input: Uint8Array, codec: Codec): Uint8Array {
  if (codec === 'store') return input;
  if (codec === 'deflate') return inflate(input);
  throw new RangeError(`Unknown codec "${codec as string}"`);
}

/**
 * Heuristic pre-check for whether a payload is worth compressing, based on
 * entropy of a sample. Used by the UI to grey out the compression option for
 * files that are certainly incompressible.
 */
export function looksCompressible(input: Uint8Array, sampleBytes = 8192): boolean {
  const sample = input.subarray(0, Math.min(input.length, sampleBytes));
  if (sample.length < 32) return false;
  const counts = new Uint32Array(256);
  for (let i = 0; i < sample.length; i++) counts[sample[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (counts[i] === 0) continue;
    const p = counts[i] / sample.length;
    entropy -= p * Math.log2(p);
  }
  // > 7.5 bits/byte is essentially random (already compressed or encrypted).
  return entropy < 7.5;
}

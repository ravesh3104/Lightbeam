/**
 * scanner.ts - dual-engine browser QR decoder and camera helpers.
 *
 * Modern Chromium and WebKit browsers increasingly expose the Shape Detection
 * `BarcodeDetector` API (`formats: ['qr_code']`), which offloads decoding to the
 * OS vision pipeline off the JS main thread. Firefox, older Safari, and desktop
 * Linux builds often do not, so LightBeam transparently falls back to `jsQR`
 * (`inversionAttempts: 'dontInvert'`) over a reusable 2D scratch canvas.
 *
 * Notice why `TransferReceiver` accepts both string and binary frames:
 *   - `BarcodeDetector.detect()` returns `rawValue: string` (requiring Base32),
 *   - `jsQR` exposes both `.data` (string) and `.binaryData` (`number[]`), so
 *     browser-to-browser `raw` byte mode also works seamlessly when `jsQR` runs!
 */

import { useCallback, useMemo, useRef } from 'react';
import jsQR from 'jsqr';
import { TransferReceiver, type ReceiverPhase } from '@lightbeam/core';
import type { ScannerEnginePreference } from '../state/settings';

interface DetectedBarcodeLike {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructorLike {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function getBarcodeDetectorCtor(): BarcodeDetectorConstructorLike | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
  return typeof candidate === 'function' ? candidate : null;
}

export function isCameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function isSecureContextOk(): boolean {
  if (typeof window === 'undefined') return true;
  return Boolean(
    window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1',
  );
}

export function hasNativeBarcodeDetector(): boolean {
  return getBarcodeDetectorCtor() !== null;
}

export interface DecodedQrFrame {
  /** String representation (used for Base32 frames) or raw bytes (for raw mode). */
  payload: string | Uint8Array;
  engine: 'BarcodeDetector' | 'jsQR';
  decodeMs: number;
}

/**
 * Reusable frame decoder that prefers native `BarcodeDetector` when requested
 * and falls back cleanly to `jsQR`.
 */
export class BrowserQrScanner {
  private scratch: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private nativeDetector: BarcodeDetectorLike | null = null;
  private nativeFailed = false;

  constructor(private preference: ScannerEnginePreference = 'auto') {
    if (preference === 'auto') {
      const Ctor = getBarcodeDetectorCtor();
      if (Ctor) {
        try {
          this.nativeDetector = new Ctor({ formats: ['qr_code'] });
        } catch {
          this.nativeDetector = null;
        }
      }
    }
  }

  setPreference(preference: ScannerEnginePreference): void {
    this.preference = preference;
    if (preference === 'auto' && !this.nativeDetector && !this.nativeFailed) {
      const Ctor = getBarcodeDetectorCtor();
      if (Ctor) {
        try {
          this.nativeDetector = new Ctor({ formats: ['qr_code'] });
        } catch {
          this.nativeDetector = null;
        }
      }
    }
  }

  get activeEngineName(): 'BarcodeDetector' | 'jsQR' {
    return this.preference === 'auto' && this.nativeDetector && !this.nativeFailed ? 'BarcodeDetector' : 'jsQR';
  }

  private ensureScratch(width: number, height: number): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.scratch) {
      this.scratch = document.createElement('canvas');
      this.ctx = this.scratch.getContext('2d', { willReadFrequently: true });
    }
    if (!this.ctx || !this.scratch) return null;
    if (this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch.width = width;
      this.scratch.height = height;
    }
    return this.ctx;
  }

  /** Decode a raw RGBA pixel buffer directly via jsQR (used in tests and loopback). */
  decodeRgba(data: Uint8ClampedArray, width: number, height: number): DecodedQrFrame | null {
    const started = performance.now();
    const hit = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
    const decodeMs = performance.now() - started;
    if (!hit) return null;
    // Prefer text when non-empty ASCII (Base32), otherwise hand raw binaryData to core.
    const payload =
      hit.data && hit.data.length > 0 ? hit.data : new Uint8Array(hit.binaryData);
    return { payload, engine: 'jsQR', decodeMs };
  }

  /** Decode one frame from a live `<video>` element or an uploaded image/canvas. */
  async decodeVideoOrImage(
    source: CanvasImageSource,
    width: number,
    height: number,
  ): Promise<DecodedQrFrame | null> {
    if (width <= 0 || height <= 0) return null;

    if (this.preference === 'auto' && this.nativeDetector && !this.nativeFailed) {
      const started = performance.now();
      try {
        const codes = await this.nativeDetector.detect(source as ImageBitmapSource);
        const decodeMs = performance.now() - started;
        if (codes.length > 0 && codes[0].rawValue) {
          return { payload: codes[0].rawValue, engine: 'BarcodeDetector', decodeMs };
        }
        return null;
      } catch {
        // Some desktop builds expose BarcodeDetector without qr_code support; fall back permanently.
        this.nativeFailed = true;
      }
    }

    const ctx = this.ensureScratch(width, height);
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    return this.decodeRgba(image.data, width, height);
  }
}

/**
 * Keep `TransferReceiver` in a ref so frame ingestion never triggers React
 * state serialisation on every camera frame.
 */
export interface ReceiverHandle {
  receiver: TransferReceiver;
  accept: (data: string | Uint8Array, now?: number) => ReceiverPhase;
}

export function useReceiver(): ReceiverHandle {
  const ref = useRef<TransferReceiver | null>(null);
  if (ref.current === null) ref.current = new TransferReceiver();
  const receiver = ref.current;

  const accept = useCallback(
    (data: string | Uint8Array, now = Date.now()) => receiver.accept(data, now),
    [receiver],
  );
  return useMemo(() => ({ receiver, accept }), [accept, receiver]);
}

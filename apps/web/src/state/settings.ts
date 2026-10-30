/**
 * settings.ts - user preferences persisted in localStorage.
 *
 * LightBeam keeps only UI preferences between browser sessions: symbol density,
 * target frame rate, wire encoding, encryption default, Wake Lock preference,
 * cinema stage mode, vibration feedback, and preferred scanner engine.
 * Passphrases are NEVER stored anywhere on disk or in localStorage.
 */

import type { DensityProfile, WireEncoding } from '@lightbeam/core';

export type ScannerEnginePreference = 'auto' | 'jsqr';

export interface Settings {
  /** Target QR symbol density profile. */
  profile: DensityProfile['id'];
  /** Displayed frames per second while sending. */
  fps: number;
  /** Default wire encoding ('base32' universal or 'raw' browser-to-browser). */
  wireEncoding: WireEncoding;
  /** Pre-enable passphrase encryption on the Send screen. */
  encryptByDefault: boolean;
  /** Request Screen Wake Lock during active transfers. */
  keepAwake: boolean;
  /** Offer dark-room high-contrast surround on the sending stage. */
  cinemaStage: boolean;
  /** Trigger short haptic pulse (navigator.vibrate) when a transfer finishes. */
  vibrateOnComplete: boolean;
  /** Prefer hardware BarcodeDetector when available, or force jsQR. */
  scannerEngine: ScannerEnginePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  profile: 'balanced',
  fps: 15,
  wireEncoding: 'base32',
  encryptByDefault: false,
  keepAwake: true,
  cinemaStage: false,
  vibrateOnComplete: true,
  scannerEngine: 'auto',
};

const STORAGE_KEY = 'lightbeam:web-settings:v1';

/** Clamp frame rate to a realistic optical range (5..30 fps). */
export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_SETTINGS.fps;
  return Math.max(5, Math.min(30, Math.round(fps)));
}

export function loadSettings(): Settings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
    const candidate = parsed as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...candidate,
      fps: clampFps(Number(candidate.fps ?? DEFAULT_SETTINGS.fps)),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage quota or private-browsing restrictions are never fatal.
  }
}

export function resetSettings(): Settings {
  const fresh = { ...DEFAULT_SETTINGS };
  saveSettings(fresh);
  return fresh;
}

/** Detect whether the current browser is likely a handheld/mobile browser. */
export function browserPlatformTag(): 'desktop-web' | 'mobile-web' {
  if (typeof navigator === 'undefined') return 'desktop-web';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile-web' : 'desktop-web';
}

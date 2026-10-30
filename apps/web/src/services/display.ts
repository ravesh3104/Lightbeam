/**
 * display.ts - Screen Wake Lock, Fullscreen stage, and haptic helpers for the web.
 *
 * Optical transfers fail if either device dims or locks mid-stream. Modern
 * browsers expose the Screen Wake Lock API (`navigator.wakeLock.request('screen')`),
 * which automatically releases when a tab is hidden and must be re-acquired on
 * `visibilitychange`. Browsers cannot override OS panel brightness directly, so
 * LightBeam pairs Wake Lock with an optional full-bleed black Cinema Stage that
 * maximises camera contrast around the white QR quiet zone.
 */

import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/** Hold a browser Screen Wake Lock while `active && enabled` is true. */
export function useScreenWakeLock(active: boolean, enabled = true): {
  supported: boolean;
  held: boolean;
} {
  const supported = isWakeLockSupported();
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || !enabled || !supported) {
      setHeld(false);
      return;
    }

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        const lock = await nav.wakeLock?.request('screen');
        if (cancelled) {
          await lock?.release().catch(() => undefined);
          return;
        }
        sentinel = lock ?? null;
        setHeld(Boolean(sentinel));
      } catch {
        if (!cancelled) setHeld(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      setHeld(false);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active, enabled, supported]);

  return { supported, held };
}

/** Toggle browser Fullscreen on an element when supported. */
export async function toggleFullscreen(element: HTMLElement | null): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    if (element?.requestFullscreen) {
      await element.requestFullscreen();
      return true;
    }
  } catch {
    // Fullscreen gesture or iframe restriction; CSS cinema mode still works.
  }
  return false;
}

/** Short vibration pulse on mobile browsers that support the Vibration API. */
export function triggerHaptic(kind: 'ok' | 'error' = 'ok'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'ok' ? 40 : [30, 50, 30]);
    }
  } catch {
    // Ignored on desktop browsers.
  }
}

/** Format a duration in seconds into human-readable units ("14s", "1m 12s"). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'estimating...';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

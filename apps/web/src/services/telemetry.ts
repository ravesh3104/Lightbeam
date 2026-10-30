/**
 * telemetry.ts - relative-URL client for the unified LightBeam Node backend.
 *
 * Every call uses relative paths (`/api/...`) so the exact same build works
 * behind Vite's dev proxy, on localhost, behind Caddy TLS, or inside a cloud
 * preview proxy. Every call is non-throwing: if the user is offline or running
 * from a cached PWA shell, optical transfers proceed uninterrupted.
 */

export interface ServerStats {
  total: number;
  completed: number;
  failed: number;
  bytesSent: number;
  medianOverhead: number | null;
  medianSeconds: number | null;
  byPlatform: Record<string, number>;
  byProfile: Record<string, number>;
}

export interface ServerHealth {
  ok: boolean;
  service: string;
  version: string;
  uptimeSeconds: number;
  sessions: number;
  storesFileContent: boolean;
}

export interface SessionSummary {
  sessionId: number;
  code: string;
  name: string;
  mime: string;
  bytes: number;
  wireBytes: number;
  blockSize: number;
  blocks: number;
  profile: string;
  encrypted: boolean;
  codec: 'store' | 'deflate';
  platform: string;
  createdAt: number;
  completedAt?: number;
}

export async function fetchServerOverview(): Promise<{
  health: ServerHealth | null;
  stats: ServerStats | null;
}> {
  try {
    const [healthRes, statsRes] = await Promise.all([fetch('/api/health'), fetch('/api/stats')]);
    const health = healthRes.ok ? ((await healthRes.json()) as ServerHealth) : null;
    const stats = statsRes.ok ? ((await statsRes.json()) as ServerStats) : null;
    return { health, stats };
  } catch {
    return { health: null, stats: null };
  }
}

export async function registerSession(payload: Record<string, unknown>): Promise<SessionSummary | null> {
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return null;
    return (await response.json()) as SessionSummary;
  } catch {
    return null;
  }
}

export async function lookupSession(code: string): Promise<SessionSummary | null> {
  try {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(clean)) return null;
    const response = await fetch(`/api/sessions/${encodeURIComponent(clean)}`);
    if (!response.ok) return null;
    return (await response.json()) as SessionSummary;
  } catch {
    return null;
  }
}

export async function reportCompletion(code: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{7}$/.test(clean)) return;
    await fetch(`/api/sessions/${encodeURIComponent(clean)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline or self-hosted static mode: ignore telemetry failures.
  }
}

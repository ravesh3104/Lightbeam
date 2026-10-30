/**
 * api.ts - pure JSON API handlers for the unified LightBeam web server.
 *
 * Deliberately stores NO file content and NO passphrases. Every field is
 * length- and range-bounded, with request bodies capped at 64 kB.
 */

import { LIMITS, VERSION } from '@lightbeam/core';
import { SessionStore, type SessionRecord, type WebPlatform } from '../store/session-store.js';

export interface ApiResponse {
  status: number;
  body: unknown;
}

const MAX_BODY_BYTES = 64 * 1024;
const VALID_PLATFORMS: readonly WebPlatform[] = ['web', 'desktop-web', 'mobile-web', 'pwa', 'unknown'];

export async function readJsonBody(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function asString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`Field "${field}" must be a string`);
  if (value.length > maxLength) throw new Error(`Field "${field}" is too long`);
  return value;
}

function asNumber(value: unknown, field: string, min = 0, max = 2 ** 40): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Field "${field}" must be a number`);
  }
  if (value < min || value > max) throw new Error(`Field "${field}" is out of range`);
  return value;
}

export function handleHealth(store: SessionStore): ApiResponse {
  const stats = store.stats();
  return {
    status: 200,
    body: {
      ok: true,
      service: 'lightbeam-server',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      sessions: stats.total,
      storesFileContent: false,
    },
  };
}

export function handleStats(store: SessionStore): ApiResponse {
  return { status: 200, body: store.stats() };
}

export function handleRecentSessions(store: SessionStore, url: URL): ApiResponse {
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get('count') ?? 20)));
  return { status: 200, body: { sessions: store.recent(count) } };
}

export function handleGetSession(store: SessionStore, code: string): ApiResponse {
  const record = store.get(code);
  if (!record) return { status: 404, body: { error: 'Session not found' } };
  return { status: 200, body: record };
}

export function handleCreateSession(store: SessionStore, body: Record<string, unknown>): ApiResponse {
  const sessionId = asNumber(body.sessionId, 'sessionId', 0, 0xffffffff);
  const name = asString(body.name, 'name', 200);
  const mime = asString(body.mime ?? 'application/octet-stream', 'mime', 120);
  const bytes = asNumber(body.bytes, 'bytes', 0, 2 ** 40);
  const wireBytes = asNumber(body.wireBytes ?? bytes, 'wireBytes', 0, 2 ** 40);
  const blockSize = asNumber(body.blockSize, 'blockSize', 1, 2 ** 20);
  const blocks = asNumber(body.blocks, 'blocks', 1, 1_000_000);
  const profile = asString(body.profile ?? 'balanced', 'profile', 32);
  const rawPlatform = asString(body.platform ?? 'web', 'platform', 24);
  const codec = (body.codec === 'deflate' ? 'deflate' : 'store') as SessionRecord['codec'];
  const encrypted = body.encrypted === true;
  const code = asString(body.code, 'code', 16).toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(code)) {
    return { status: 400, body: { error: 'Invalid session code' } };
  }

  const platform: WebPlatform = (VALID_PLATFORMS as readonly string[]).includes(rawPlatform)
    ? (rawPlatform as WebPlatform)
    : 'unknown';

  const record: SessionRecord = {
    sessionId,
    code,
    name,
    mime,
    bytes,
    wireBytes,
    blockSize,
    blocks,
    profile,
    encrypted,
    codec,
    platform,
    createdAt: Date.now(),
  };
  return { status: 201, body: store.create(record) };
}

export function handleCompleteSession(
  store: SessionStore,
  code: string,
  body: Record<string, unknown>,
): ApiResponse {
  const record = store.get(code);
  if (!record) return { status: 404, body: { error: 'Session not found' } };
  const result: NonNullable<SessionRecord['result']> = {
    elapsedSeconds: asNumber(body.elapsedSeconds ?? 0, 'elapsedSeconds', 0, 86400),
    overheadRatio: asNumber(body.overheadRatio ?? 0, 'overheadRatio', 0, 1000),
    throughputBytesPerSecond: asNumber(body.throughputBytesPerSecond ?? 0, 'throughputBytesPerSecond', 0, 1e9),
    framesAccepted: asNumber(body.framesAccepted ?? 0, 'framesAccepted', 0, 1e9),
    framesSuspect: asNumber(body.framesSuspect ?? 0, 'framesSuspect', 0, 1e9),
    verified: body.verified === true,
  };
  const updated = store.complete(code, result);
  return { status: 200, body: updated };
}

export function handleCapabilities(): ApiResponse {
  return {
    status: 200,
    body: {
      protocol: { version: 1, wireEncodings: ['base32', 'raw'], frameHeaderBytes: 13 },
      profiles: ['phone', 'balanced', 'dense', 'tablet'],
      limits: {
        maxPayloadBytes: LIMITS.maxPayloadBytes,
        maxTextBytes: LIMITS.maxTextBytes,
        maxBlocks: LIMITS.maxBlocks,
      },
    },
  };
}

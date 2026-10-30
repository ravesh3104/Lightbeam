/**
 * api.test.ts - unit tests for pure JSON API handlers and session registry.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleCapabilities,
  handleCompleteSession,
  handleCreateSession,
  handleGetSession,
  handleHealth,
  handleStats,
  readJsonBody,
} from '../src/routes/api.js';
import { SessionStore } from '../src/store/session-store.js';

let tempDir: string;
let store: SessionStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'lightbeam-api-test-'));
  store = new SessionStore({ file: join(tempDir, 'sessions.json') });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('JSON API handlers', () => {
  it('reports health with storesFileContent: false and protocol capabilities', () => {
    const health = handleHealth(store);
    expect(health.status).toBe(200);
    expect((health.body as { storesFileContent: boolean }).storesFileContent).toBe(false);

    const caps = handleCapabilities();
    expect(caps.status).toBe(200);
    expect((caps.body as { profiles: string[] }).profiles).toEqual([
      'phone',
      'balanced',
      'dense',
      'tablet',
    ]);
  });

  it('creates, retrieves, and completes a web transfer session, including multi-megabyte sizes', () => {
    const createRes = handleCreateSession(store, {
      sessionId: 0x12345678,
      code: 'ABCD234',
      name: 'archive.zip',
      mime: 'application/zip',
      bytes: 12 * 1024 * 1024,
      wireBytes: 11 * 1024 * 1024,
      blockSize: 303,
      blocks: 38000,
      profile: 'dense',
      encrypted: true,
      codec: 'deflate',
      platform: 'desktop-web',
    });
    expect(createRes.status).toBe(201);

    const getRes = handleGetSession(store, 'abcd234');
    expect(getRes.status).toBe(200);

    const completeRes = handleCompleteSession(store, 'ABCD234', {
      elapsedSeconds: 45,
      overheadRatio: 1.12,
      throughputBytesPerSecond: 266_000,
      framesAccepted: 42560,
      framesSuspect: 12,
      verified: true,
    });
    expect(completeRes.status).toBe(200);

    const stats = handleStats(store).body as {
      total: number;
      completed: number;
      bytesSent: number;
      medianOverhead: number | null;
      byPlatform: Record<string, number>;
    };
    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.bytesSent).toBe(12 * 1024 * 1024);
    expect(stats.medianOverhead).toBe(1.12);
    expect(stats.byPlatform['desktop-web']).toBe(1);
  });

  it('rejects malformed session codes and oversized request bodies', async () => {
    const badCode = handleCreateSession(store, {
      sessionId: 1,
      code: 'IO01BAD', // contains disallowed look-alike characters 0, 1, I, O
      name: 'a.txt',
      bytes: 10,
      blockSize: 10,
      blocks: 1,
    });
    expect(badCode.status).toBe(400);

    async function* hugeBody() {
      yield new Uint8Array(70 * 1024);
    }
    await expect(readJsonBody(hugeBody())).rejects.toThrow(/exceeds/);
  });
});

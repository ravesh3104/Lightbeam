/**
 * session-store.ts - atomic JSON persistence for session codes and telemetry.
 *
 * File bytes and passphrases NEVER reach the server: transfers travel as light
 * from screen to camera. The store holds only short 7-character session codes,
 * payload sizes, symbol profile metadata, and receiver-reported completion stats.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export type WebPlatform = 'web' | 'desktop-web' | 'mobile-web' | 'pwa' | 'unknown';

export interface SessionRecord {
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
  platform: WebPlatform;
  createdAt: number;
  completedAt?: number;
  result?: {
    elapsedSeconds: number;
    overheadRatio: number;
    throughputBytesPerSecond: number;
    framesAccepted: number;
    framesSuspect: number;
    verified: boolean;
  };
}

export interface SessionStoreOptions {
  file?: string;
  limit?: number;
}

export class SessionStore {
  private readonly file: string;
  private readonly limit: number;
  private sessions = new Map<string, SessionRecord>();
  private loaded = false;

  constructor(options: SessionStoreOptions = {}) {
    this.file = options.file ?? fileURLToPath(new URL('../../data/sessions.json', import.meta.url));
    this.limit = options.limit ?? 500;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.file)) return;
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as SessionRecord[];
      for (const record of parsed) this.sessions.set(record.code, record);
    } catch (error) {
      console.warn(`[store] could not read ${this.file}: ${(error as Error).message}`);
    }
  }

  private flush(): void {
    const all = [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
    while (all.length > this.limit) {
      const oldest = all.shift()!;
      this.sessions.delete(oldest.code);
    }
    const tmp = `${this.file}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, this.file);
  }

  create(record: SessionRecord): SessionRecord {
    this.ensureLoaded();
    this.sessions.set(record.code, record);
    this.flush();
    return record;
  }

  get(code: string): SessionRecord | undefined {
    this.ensureLoaded();
    return this.sessions.get(code.trim().toUpperCase());
  }

  complete(code: string, result: NonNullable<SessionRecord['result']>): SessionRecord | undefined {
    this.ensureLoaded();
    const record = this.sessions.get(code.trim().toUpperCase());
    if (!record) return undefined;
    record.completedAt = Date.now();
    record.result = result;
    this.flush();
    return record;
  }

  recent(count = 20): SessionRecord[] {
    this.ensureLoaded();
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, count);
  }

  stats(): {
    total: number;
    completed: number;
    failed: number;
    bytesSent: number;
    medianOverhead: number | null;
    medianSeconds: number | null;
    byPlatform: Record<string, number>;
    byProfile: Record<string, number>;
  } {
    this.ensureLoaded();
    const all = [...this.sessions.values()];
    const completed = all.filter((record) => record.result?.verified);
    const overheads = completed.map((record) => record.result!.overheadRatio).sort((a, b) => a - b);
    const seconds = completed.map((record) => record.result!.elapsedSeconds).sort((a, b) => a - b);
    const median = (values: number[]): number | null =>
      values.length === 0 ? null : values[Math.floor(values.length / 2)];

    const byPlatform: Record<string, number> = {};
    const byProfile: Record<string, number> = {};
    for (const record of all) {
      byPlatform[record.platform] = (byPlatform[record.platform] ?? 0) + 1;
      byProfile[record.profile] = (byProfile[record.profile] ?? 0) + 1;
    }

    return {
      total: all.length,
      completed: completed.length,
      failed: all.filter((record) => record.completedAt && !record.result?.verified).length,
      bytesSent: all.reduce((sum, record) => sum + record.bytes, 0),
      medianOverhead: median(overheads),
      medianSeconds: median(seconds),
      byPlatform,
      byProfile,
    };
  }
}

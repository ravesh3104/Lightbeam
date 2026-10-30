/**
 * server-spa.test.ts - integration tests against the unified HTTP server and Vite build.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppServer } from '../src/server.js';
import { SessionStore } from '../src/store/session-store.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(here, '../public');

let tempDir: string;
let server: Server;
let baseUrl: string;
let port: number;

beforeAll(async () => {
  if (!existsSync(join(publicDir, 'index.html'))) {
    throw new Error('Missing Vite build in apps/server/public. Run: npm run build:web');
  }
  tempDir = mkdtempSync(join(tmpdir(), 'lightbeam-http-test-'));
  const store = new SessionStore({ file: join(tempDir, 'sessions.json') });
  server = createAppServer({ publicDir, store });
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(tempDir, { recursive: true, force: true });
});

describe('unified HTTP server + React SPA shell', () => {
  it('serves the built React SPA for all deep links and verifies referenced bundles exist', async () => {
    const htmlOnDisk = readFileSync(join(publicDir, 'index.html'), 'utf8');
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(htmlOnDisk);
    expect(scriptMatch).not.toBeNull();

    for (const route of ['/', '/send', '/receive?code=K7M9P2Q', '/files', '/settings', '/about']) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const text = await res.text();
      expect(text).toContain('<div id="root"></div>');
    }

    const bundleRes = await fetch(`${baseUrl}${scriptMatch![1]}`);
    expect(bundleRes.status).toBe(200);
    expect(bundleRes.headers.get('cache-control')).toContain('immutable');
  });

  it('serves PWA manifest, service worker, and icons, and 404s missing assets', async () => {
    for (const asset of ['/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png']) {
      const res = await fetch(`${baseUrl}${asset}`);
      expect(res.status).toBe(200);
    }

    const missing = await fetch(`${baseUrl}/assets/does-not-exist.js`);
    expect(missing.status).toBe(404);
  });

  it('redirects /r?code=... with query intact and blocks encoded path traversal with 403', async () => {
    const redirectRes = await fetch(`${baseUrl}/r?code=ZYXW987`, { redirect: 'manual' });
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('location')).toBe('/receive?code=ZYXW987');

    // Send an encoded `..` segment over a raw HTTP request so URL client normalisation does not strip it.
    const status = await new Promise<number>((resolveStatus, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/assets/%2e%2e/%2e%2e/package.json', method: 'GET' },
        (res) => {
          res.resume();
          resolveStatus(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});

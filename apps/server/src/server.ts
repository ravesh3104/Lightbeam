/**
 * server.ts - unified LightBeam Node HTTP server.
 *
 * Serves the Vite-built React PWA (with SPA history fallback for `/send`,
 * `/receive`, `/files`, `/settings`, `/about`), short-URL redirects (`/s`, `/r`),
 * and the zero-file-content JSON session registry (`/api/*`).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleCapabilities,
  handleCompleteSession,
  handleCreateSession,
  handleGetSession,
  handleHealth,
  handleRecentSessions,
  handleStats,
  readJsonBody,
  type ApiResponse,
} from './routes/api.js';
import { aliasTarget } from './routes/redirects.js';
import { SessionStore } from './store/session-store.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response: ServerResponse, result: ApiResponse): void {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

export interface AppServerOptions {
  publicDir?: string;
  store?: SessionStore;
  /** Optional X-Frame-Options override for hardened standalone deployments. */
  frameOptions?: string;
}

export function createAppServer(options: AppServerOptions = {}): Server {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const publicDir = resolve(options.publicDir ?? resolve(here, '../public'));
  const store =
    options.store ??
    new SessionStore({ file: process.env.SESSION_FILE ?? resolve(here, '../data/sessions.json') });

  async function serveStatic(response: ServerResponse, urlPath: string, search = ''): Promise<void> {
    const alias = aliasTarget(urlPath, search);
    if (alias) {
      response.writeHead(302, { location: alias });
      response.end();
      return;
    }

    // Reject raw traversal attempts before and after normalisation.
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(urlPath);
    } catch {
      sendText(response, 400, 'Bad URL');
      return;
    }
    if (decodedPath.includes('..') || decodedPath.includes('\0')) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    const relativePath = decodedPath === '/' ? '/index.html' : decodedPath;
    const candidate = resolve(publicDir, `.${normalize(relativePath)}`);
    if (!candidate.startsWith(publicDir)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    const hasExtension = extname(candidate).length > 0;
    try {
      const info = await stat(candidate);
      const target = info.isDirectory() ? join(candidate, 'index.html') : candidate;
      const content = await readFile(target);
      const ext = extname(target).toLowerCase();
      const type = CONTENT_TYPES[ext] ?? 'application/octet-stream';
      const isHtmlOrSw = target.endsWith('.html') || target.endsWith('/sw.js');
      const isHashedAsset = decodedPath.startsWith('/assets/');
      response.writeHead(200, {
        'content-type': type,
        'content-length': content.length,
        'cache-control': isHtmlOrSw
          ? 'no-cache'
          : isHashedAsset
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=300',
      });
      response.end(content);
      return;
    } catch {
      // Missing files WITH an extension (.js, .css, .png) are genuine 404s.
      if (hasExtension) {
        sendText(response, 404, 'Not found');
        return;
      }
    }

    // Extensionless browser routes (/send, /receive, /files, /settings, /about)
    // load the SPA shell so client-side routing renders the requested screen.
    try {
      const shell = await readFile(join(publicDir, 'index.html'));
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': shell.length,
        'cache-control': 'no-cache',
      });
      response.end(shell);
    } catch {
      sendText(
        response,
        503,
        'Web bundle not built yet. Run: npm run build:web',
      );
    }
  }

  async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;

    try {
      if (request.method === 'GET' && path === '/api/health') {
        sendJson(response, handleHealth(store));
        return true;
      }
      if (request.method === 'GET' && path === '/api/stats') {
        sendJson(response, handleStats(store));
        return true;
      }
      if (request.method === 'GET' && path === '/api/capabilities') {
        sendJson(response, handleCapabilities());
        return true;
      }
      if (request.method === 'GET' && path === '/api/sessions') {
        sendJson(response, handleRecentSessions(store, url));
        return true;
      }
      if (request.method === 'POST' && path === '/api/sessions') {
        const body = await readJsonBody(request);
        sendJson(response, handleCreateSession(store, body));
        return true;
      }

      const sessionMatch = /^\/api\/sessions\/([A-Za-z0-9]+)$/.exec(path);
      if (sessionMatch) {
        const code = sessionMatch[1];
        if (request.method === 'GET') {
          sendJson(response, handleGetSession(store, code));
          return true;
        }
        if (request.method === 'POST') {
          const body = await readJsonBody(request);
          sendJson(response, handleCompleteSession(store, code, body));
          return true;
        }
      }

      sendJson(response, { status: 405, body: { error: 'Method not allowed' } });
      return true;
    } catch (error) {
      sendJson(response, { status: 400, body: { error: (error as Error).message } });
      return true;
    }
  }

  return createServer((request, response) => {
    const rawUrl = request.url ?? '/';
    const rawPathname = rawUrl.split('?')[0] ?? '/';
    let decodedRawPath = rawPathname;
    try {
      decodedRawPath = decodeURIComponent(rawPathname);
    } catch {
      sendText(response, 400, 'Bad URL');
      return;
    }
    if (decodedRawPath.includes('..') || decodedRawPath.includes('\0')) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    const url = new URL(rawUrl, `http://${request.headers.host ?? 'localhost'}`);

    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    if (options.frameOptions ?? process.env.FRAME_OPTIONS) {
      response.setHeader('x-frame-options', (options.frameOptions ?? process.env.FRAME_OPTIONS)!);
    }
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'",
    );
    response.setHeader('permissions-policy', 'camera=(self)');

    void (async () => {
      if (await handleApi(request, response, url)) return;
      await serveStatic(response, url.pathname, url.search);
    })().catch((error: unknown) => {
      console.error('[server] unhandled error', error);
      if (!response.headersSent) sendText(response, 500, 'Internal error');
      else response.end();
    });
  });
}

// Start listening when executed directly (`node dist/server.js` or `tsx src/server.ts`).
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const selfPath = fileURLToPath(import.meta.url);
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === resolve(selfPath).toLowerCase()
    : resolve(entry) === resolve(selfPath);
})();

if (isMain) {
  const PORT = Number(process.env.PORT ?? 8787);
  const HOST = process.env.HOST ?? '0.0.0.0';
  const here = fileURLToPath(new URL('.', import.meta.url));
  const store = new SessionStore({
    file: process.env.SESSION_FILE ?? resolve(here, '../data/sessions.json'),
  });
  const server = createAppServer({ store });

  server.listen(PORT, HOST, () => {
    console.log(`LightBeam web server listening on http://${HOST}:${PORT}`);
    console.log(`  Web App:      http://localhost:${PORT}/`);
    console.log(`  Send page:    http://localhost:${PORT}/send`);
    console.log(`  Receive page: http://localhost:${PORT}/receive`);
    console.log(`  Sessions:     ${store.recent(0).length} record(s) in the store`);
    console.log('  File bytes never reach this process: transfers travel screen -> camera.');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n[server] ${signal} received, shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

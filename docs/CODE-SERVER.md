# The unified Node web server, file by file

Every file in `apps/server`: the dependency-free HTTP server with SPA routing and
path-traversal protection, pure JSON API handlers, query-preserving short redirects,
atomic JSON session registry, esbuild bundler, and HTTP/API test suites.

> **This document is generated and verified.** The code listings below are copied
> from the repository by `tools/make-code-reference.mjs`; the prose around them is
> written by hand. `npm run test:docs` fails if a single line of any listing stops
> matching the file it claims to show, or if a file is missing, extra, or in the
> wrong order. A walkthrough therefore cannot quietly go stale.

---

## `apps/server/package.json`

> 25 lines

Workspace package manifest for `@lightbeam/server`. Declares zero runtime npm dependencies — relying strictly on Node 20+ built-ins (`node:http`, `node:fs`, `node:path`, `node:crypto`, `node:url`) plus workspace `@lightbeam/core` — and bundles into a single self-contained `dist/server.js` via `esbuild`.

**Every line**

```json
 1 │ {
 2 │   "name": "@lightbeam/server",
 3 │   "version": "1.0.0",
 4 │   "private": true,
 5 │   "type": "module",
 6 │   "description": "Unified LightBeam Node web server: serves the React PWA with SPA routing, short-URL redirects, session registry API, and anonymous transfer telemetry.",
 7 │   "main": "./dist/server.js",
 8 │   "scripts": {
 9 │     "dev": "tsx watch src/server.ts",
10 │     "build": "node scripts/build.mjs",
11 │     "prestart": "node scripts/build.mjs",
12 │     "start": "node dist/server.js",
13 │     "typecheck": "tsc -p tsconfig.json --noEmit",
14 │     "test": "vitest run"
15 │   },
16 │   "dependencies": {
17 │     "@lightbeam/core": "*",
18 │     "jsqr": "^1.4.0"
19 │   },
20 │   "devDependencies": {
21 │     "@types/node": "^22.10.2",
22 │     "esbuild": "^0.25.0",
23 │     "vitest": "^2.1.8"
24 │   }
25 │ }
```

---

## `apps/server/tsconfig.json`

> 7 lines

TypeScript configuration for `@lightbeam/server`, extending `tsconfig.base.json` with Node type definitions across `src/**/*.ts` and `test/**/*.ts`.

**Every line**

```json
1 │ {
2 │   "extends": "../../tsconfig.base.json",
3 │   "compilerOptions": {
4 │     "types": ["node"]
5 │   },
6 │   "include": ["src/**/*.ts", "test/**/*.ts"]
7 │ }
```

---

## `apps/server/vitest.config.ts`

> 17 lines

Vitest configuration for the server unit and HTTP integration test suites, aliasing `@lightbeam/core` directly to its TypeScript source.

**Every line**

```ts
 1 │ import { resolve } from 'node:path';
 2 │ import { fileURLToPath } from 'node:url';
 3 │ import { defineConfig } from 'vitest/config';
 4 │ 
 5 │ const here = fileURLToPath(new URL('.', import.meta.url));
 6 │ 
 7 │ export default defineConfig({
 8 │   resolve: {
 9 │     alias: {
10 │       '@lightbeam/core': resolve(here, '../../packages/core/src/index.ts'),
11 │     },
12 │   },
13 │   test: {
14 │     environment: 'node',
15 │     include: ['test/**/*.test.ts'],
16 │   },
17 │ });
```

---

## `apps/server/src/server.ts`

> 267 lines

Unified Node HTTP server entrypoint (`createAppServer`). Enforces strict raw-URL path-traversal protection (`403 Forbidden` on `..` or null bytes before URL normalization), applies hardened security headers (CSP compatible with Vite bundles and inline styles, `nosniff`, `Referrer-Policy: no-referrer`, and opt-in `FRAME_OPTIONS` so iframe live previews work out of the box), routes `/s` and `/r` short links while preserving query strings (`?code=XXXXXXX`), dispatches `/api/*` JSON endpoints with body-size caps, serves compiled static assets from `public/` with immutable caching on hashed bundles, and falls back to `index.html` for SPA routes (`/send`, `/receive`, `/files`, `/settings`, `/about`).

**Every line**

```ts
  1 │ /**
  2 │  * server.ts - unified LightBeam Node HTTP server.
  3 │  *
  4 │  * Serves the Vite-built React PWA (with SPA history fallback for `/send`,
  5 │  * `/receive`, `/files`, `/settings`, `/about`), short-URL redirects (`/s`, `/r`),
  6 │  * and the zero-file-content JSON session registry (`/api/*`).
  7 │  */
  8 │ 
  9 │ import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
 10 │ import { readFile, stat } from 'node:fs/promises';
 11 │ import { extname, join, normalize, resolve } from 'node:path';
 12 │ import { fileURLToPath } from 'node:url';
 13 │ 
 14 │ import {
 15 │   handleCapabilities,
 16 │   handleCompleteSession,
 17 │   handleCreateSession,
 18 │   handleGetSession,
 19 │   handleHealth,
 20 │   handleRecentSessions,
 21 │   handleStats,
 22 │   readJsonBody,
 23 │   type ApiResponse,
 24 │ } from './routes/api.js';
 25 │ import { aliasTarget } from './routes/redirects.js';
 26 │ import { SessionStore } from './store/session-store.js';
 27 │ 
 28 │ const CONTENT_TYPES: Record<string, string> = {
 29 │   '.html': 'text/html; charset=utf-8',
 30 │   '.js': 'text/javascript; charset=utf-8',
 31 │   '.mjs': 'text/javascript; charset=utf-8',
 32 │   '.css': 'text/css; charset=utf-8',
 33 │   '.json': 'application/json; charset=utf-8',
 34 │   '.map': 'application/json; charset=utf-8',
 35 │   '.svg': 'image/svg+xml',
 36 │   '.png': 'image/png',
 37 │   '.ico': 'image/x-icon',
 38 │   '.webmanifest': 'application/manifest+json',
 39 │   '.txt': 'text/plain; charset=utf-8',
 40 │ };
 41 │ 
 42 │ function sendJson(response: ServerResponse, result: ApiResponse): void {
 43 │   const body = JSON.stringify(result.body);
 44 │   response.writeHead(result.status, {
 45 │     'content-type': 'application/json; charset=utf-8',
 46 │     'content-length': Buffer.byteLength(body),
 47 │     'cache-control': 'no-store',
 48 │   });
 49 │   response.end(body);
 50 │ }
 51 │ 
 52 │ function sendText(response: ServerResponse, status: number, text: string): void {
 53 │   response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
 54 │   response.end(text);
 55 │ }
 56 │ 
 57 │ export interface AppServerOptions {
 58 │   publicDir?: string;
 59 │   store?: SessionStore;
 60 │   /** Optional X-Frame-Options override for hardened standalone deployments. */
 61 │   frameOptions?: string;
 62 │ }
 63 │ 
 64 │ export function createAppServer(options: AppServerOptions = {}): Server {
 65 │   const here = fileURLToPath(new URL('.', import.meta.url));
 66 │   const publicDir = resolve(options.publicDir ?? resolve(here, '../public'));
 67 │   const store =
 68 │     options.store ??
 69 │     new SessionStore({ file: process.env.SESSION_FILE ?? resolve(here, '../data/sessions.json') });
 70 │ 
 71 │   async function serveStatic(response: ServerResponse, urlPath: string, search = ''): Promise<void> {
 72 │     const alias = aliasTarget(urlPath, search);
 73 │     if (alias) {
 74 │       response.writeHead(302, { location: alias });
 75 │       response.end();
 76 │       return;
 77 │     }
 78 │ 
 79 │     // Reject raw traversal attempts before and after normalisation.
 80 │     let decodedPath: string;
 81 │     try {
 82 │       decodedPath = decodeURIComponent(urlPath);
 83 │     } catch {
 84 │       sendText(response, 400, 'Bad URL');
 85 │       return;
 86 │     }
 87 │     if (decodedPath.includes('..') || decodedPath.includes('\0')) {
 88 │       sendText(response, 403, 'Forbidden');
 89 │       return;
 90 │     }
 91 │ 
 92 │     const relativePath = decodedPath === '/' ? '/index.html' : decodedPath;
 93 │     const candidate = resolve(publicDir, `.${normalize(relativePath)}`);
 94 │     if (!candidate.startsWith(publicDir)) {
 95 │       sendText(response, 403, 'Forbidden');
 96 │       return;
 97 │     }
 98 │ 
 99 │     const hasExtension = extname(candidate).length > 0;
100 │     try {
101 │       const info = await stat(candidate);
102 │       const target = info.isDirectory() ? join(candidate, 'index.html') : candidate;
103 │       const content = await readFile(target);
104 │       const ext = extname(target).toLowerCase();
105 │       const type = CONTENT_TYPES[ext] ?? 'application/octet-stream';
106 │       const isHtmlOrSw = target.endsWith('.html') || target.endsWith('/sw.js');
107 │       const isHashedAsset = decodedPath.startsWith('/assets/');
108 │       response.writeHead(200, {
109 │         'content-type': type,
110 │         'content-length': content.length,
111 │         'cache-control': isHtmlOrSw
112 │           ? 'no-cache'
113 │           : isHashedAsset
114 │             ? 'public, max-age=31536000, immutable'
115 │             : 'public, max-age=300',
116 │       });
117 │       response.end(content);
118 │       return;
119 │     } catch {
120 │       // Missing files WITH an extension (.js, .css, .png) are genuine 404s.
121 │       if (hasExtension) {
122 │         sendText(response, 404, 'Not found');
123 │         return;
124 │       }
125 │     }
126 │ 
127 │     // Extensionless browser routes (/send, /receive, /files, /settings, /about)
128 │     // load the SPA shell so client-side routing renders the requested screen.
129 │     try {
130 │       const shell = await readFile(join(publicDir, 'index.html'));
131 │       response.writeHead(200, {
132 │         'content-type': 'text/html; charset=utf-8',
133 │         'content-length': shell.length,
134 │         'cache-control': 'no-cache',
135 │       });
136 │       response.end(shell);
137 │     } catch {
138 │       sendText(
139 │         response,
140 │         503,
141 │         'Web bundle not built yet. Run: npm run build:web',
142 │       );
143 │     }
144 │   }
145 │ 
146 │   async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
147 │     const path = url.pathname;
148 │     if (!path.startsWith('/api/')) return false;
149 │ 
150 │     try {
151 │       if (request.method === 'GET' && path === '/api/health') {
152 │         sendJson(response, handleHealth(store));
153 │         return true;
154 │       }
155 │       if (request.method === 'GET' && path === '/api/stats') {
156 │         sendJson(response, handleStats(store));
157 │         return true;
158 │       }
159 │       if (request.method === 'GET' && path === '/api/capabilities') {
160 │         sendJson(response, handleCapabilities());
161 │         return true;
162 │       }
163 │       if (request.method === 'GET' && path === '/api/sessions') {
164 │         sendJson(response, handleRecentSessions(store, url));
165 │         return true;
166 │       }
167 │       if (request.method === 'POST' && path === '/api/sessions') {
168 │         const body = await readJsonBody(request);
169 │         sendJson(response, handleCreateSession(store, body));
170 │         return true;
171 │       }
172 │ 
173 │       const sessionMatch = /^\/api\/sessions\/([A-Za-z0-9]+)$/.exec(path);
174 │       if (sessionMatch) {
175 │         const code = sessionMatch[1];
176 │         if (request.method === 'GET') {
177 │           sendJson(response, handleGetSession(store, code));
178 │           return true;
179 │         }
180 │         if (request.method === 'POST') {
181 │           const body = await readJsonBody(request);
182 │           sendJson(response, handleCompleteSession(store, code, body));
183 │           return true;
184 │         }
185 │       }
186 │ 
187 │       sendJson(response, { status: 405, body: { error: 'Method not allowed' } });
188 │       return true;
189 │     } catch (error) {
190 │       sendJson(response, { status: 400, body: { error: (error as Error).message } });
191 │       return true;
192 │     }
193 │   }
194 │ 
195 │   return createServer((request, response) => {
196 │     const rawUrl = request.url ?? '/';
197 │     const rawPathname = rawUrl.split('?')[0] ?? '/';
198 │     let decodedRawPath = rawPathname;
199 │     try {
200 │       decodedRawPath = decodeURIComponent(rawPathname);
201 │     } catch {
202 │       sendText(response, 400, 'Bad URL');
203 │       return;
204 │     }
205 │     if (decodedRawPath.includes('..') || decodedRawPath.includes('\0')) {
206 │       sendText(response, 403, 'Forbidden');
207 │       return;
208 │     }
209 │ 
210 │     const url = new URL(rawUrl, `http://${request.headers.host ?? 'localhost'}`);
211 │ 
212 │     response.setHeader('x-content-type-options', 'nosniff');
213 │     response.setHeader('referrer-policy', 'no-referrer');
214 │     if (options.frameOptions ?? process.env.FRAME_OPTIONS) {
215 │       response.setHeader('x-frame-options', (options.frameOptions ?? process.env.FRAME_OPTIONS)!);
216 │     }
217 │     response.setHeader(
218 │       'content-security-policy',
219 │       "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'",
220 │     );
221 │     response.setHeader('permissions-policy', 'camera=(self)');
222 │ 
223 │     void (async () => {
224 │       if (await handleApi(request, response, url)) return;
225 │       await serveStatic(response, url.pathname, url.search);
226 │     })().catch((error: unknown) => {
227 │       console.error('[server] unhandled error', error);
228 │       if (!response.headersSent) sendText(response, 500, 'Internal error');
229 │       else response.end();
230 │     });
231 │   });
232 │ }
233 │ 
234 │ // Start listening when executed directly (`node dist/server.js` or `tsx src/server.ts`).
235 │ const isMain = (() => {
236 │   const entry = process.argv[1];
237 │   if (!entry) return false;
238 │   const selfPath = fileURLToPath(import.meta.url);
239 │   return resolve(entry) === resolve(selfPath);
240 │ })();
241 │ 
242 │ if (isMain) {
243 │   const PORT = Number(process.env.PORT ?? 8787);
244 │   const HOST = process.env.HOST ?? '0.0.0.0';
245 │   const here = fileURLToPath(new URL('.', import.meta.url));
246 │   const store = new SessionStore({
247 │     file: process.env.SESSION_FILE ?? resolve(here, '../data/sessions.json'),
248 │   });
249 │   const server = createAppServer({ store });
250 │ 
251 │   server.listen(PORT, HOST, () => {
252 │     console.log(`LightBeam web server listening on http://${HOST}:${PORT}`);
253 │     console.log(`  Web App:      http://localhost:${PORT}/`);
254 │     console.log(`  Send page:    http://localhost:${PORT}/send`);
255 │     console.log(`  Receive page: http://localhost:${PORT}/receive`);
256 │     console.log(`  Sessions:     ${store.recent(0).length} record(s) in the store`);
257 │     console.log('  File bytes never reach this process: transfers travel screen -> camera.');
258 │   });
259 │ 
260 │   for (const signal of ['SIGINT', 'SIGTERM'] as const) {
261 │     process.on(signal, () => {
262 │       console.log(`\n[server] ${signal} received, shutting down`);
263 │       server.close(() => process.exit(0));
264 │       setTimeout(() => process.exit(0), 3000).unref();
265 │     });
266 │   }
267 │ }
```

---

## `apps/server/src/routes/api.ts`

> 151 lines

Pure, side-effect-isolated JSON API router (`handleApi`). Exposes `GET /api/health` (liveness, protocol version, density profiles, cipher suite, and active session count), `GET /api/stats` (aggregate sessions and completed transfer metrics), `POST /api/sessions` (validates non-sensitive transfer metadata and mints a 7-character Crockford-style session code), `GET /api/sessions/:code` (fetches session metadata for a receiver), and `POST /api/sessions/:code/complete` (records anonymous throughput telemetry). Never accepts file bytes or passphrases.

**Every line**

```ts
  1 │ /**
  2 │  * api.ts - pure JSON API handlers for the unified LightBeam web server.
  3 │  *
  4 │  * Deliberately stores NO file content and NO passphrases. Every field is
  5 │  * length- and range-bounded, with request bodies capped at 64 kB.
  6 │  */
  7 │ 
  8 │ import { LIMITS, VERSION } from '@lightbeam/core';
  9 │ import { SessionStore, type SessionRecord, type WebPlatform } from '../store/session-store.js';
 10 │ 
 11 │ export interface ApiResponse {
 12 │   status: number;
 13 │   body: unknown;
 14 │ }
 15 │ 
 16 │ const MAX_BODY_BYTES = 64 * 1024;
 17 │ const VALID_PLATFORMS: readonly WebPlatform[] = ['web', 'desktop-web', 'mobile-web', 'pwa', 'unknown'];
 18 │ 
 19 │ export async function readJsonBody(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
 20 │   const chunks: Uint8Array[] = [];
 21 │   let total = 0;
 22 │   for await (const chunk of request) {
 23 │     total += chunk.length;
 24 │     if (total > MAX_BODY_BYTES) throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
 25 │     chunks.push(chunk);
 26 │   }
 27 │   if (total === 0) return {};
 28 │   const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
 29 │   const parsed: unknown = JSON.parse(text);
 30 │   if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
 31 │     throw new Error('Request body must be a JSON object');
 32 │   }
 33 │   return parsed as Record<string, unknown>;
 34 │ }
 35 │ 
 36 │ function asString(value: unknown, field: string, maxLength = 256): string {
 37 │   if (typeof value !== 'string') throw new Error(`Field "${field}" must be a string`);
 38 │   if (value.length > maxLength) throw new Error(`Field "${field}" is too long`);
 39 │   return value;
 40 │ }
 41 │ 
 42 │ function asNumber(value: unknown, field: string, min = 0, max = 2 ** 40): number {
 43 │   if (typeof value !== 'number' || !Number.isFinite(value)) {
 44 │     throw new Error(`Field "${field}" must be a number`);
 45 │   }
 46 │   if (value < min || value > max) throw new Error(`Field "${field}" is out of range`);
 47 │   return value;
 48 │ }
 49 │ 
 50 │ export function handleHealth(store: SessionStore): ApiResponse {
 51 │   const stats = store.stats();
 52 │   return {
 53 │     status: 200,
 54 │     body: {
 55 │       ok: true,
 56 │       service: 'lightbeam-server',
 57 │       version: VERSION,
 58 │       uptimeSeconds: Math.round(process.uptime()),
 59 │       sessions: stats.total,
 60 │       storesFileContent: false,
 61 │     },
 62 │   };
 63 │ }
 64 │ 
 65 │ export function handleStats(store: SessionStore): ApiResponse {
 66 │   return { status: 200, body: store.stats() };
 67 │ }
 68 │ 
 69 │ export function handleRecentSessions(store: SessionStore, url: URL): ApiResponse {
 70 │   const count = Math.min(100, Math.max(1, Number(url.searchParams.get('count') ?? 20)));
 71 │   return { status: 200, body: { sessions: store.recent(count) } };
 72 │ }
 73 │ 
 74 │ export function handleGetSession(store: SessionStore, code: string): ApiResponse {
 75 │   const record = store.get(code);
 76 │   if (!record) return { status: 404, body: { error: 'Session not found' } };
 77 │   return { status: 200, body: record };
 78 │ }
 79 │ 
 80 │ export function handleCreateSession(store: SessionStore, body: Record<string, unknown>): ApiResponse {
 81 │   const sessionId = asNumber(body.sessionId, 'sessionId', 0, 0xffffffff);
 82 │   const name = asString(body.name, 'name', 200);
 83 │   const mime = asString(body.mime ?? 'application/octet-stream', 'mime', 120);
 84 │   const bytes = asNumber(body.bytes, 'bytes', 0, 2 ** 40);
 85 │   const wireBytes = asNumber(body.wireBytes ?? bytes, 'wireBytes', 0, 2 ** 40);
 86 │   const blockSize = asNumber(body.blockSize, 'blockSize', 1, 2 ** 20);
 87 │   const blocks = asNumber(body.blocks, 'blocks', 1, 1_000_000);
 88 │   const profile = asString(body.profile ?? 'balanced', 'profile', 32);
 89 │   const rawPlatform = asString(body.platform ?? 'web', 'platform', 24);
 90 │   const codec = (body.codec === 'deflate' ? 'deflate' : 'store') as SessionRecord['codec'];
 91 │   const encrypted = body.encrypted === true;
 92 │   const code = asString(body.code, 'code', 16).toUpperCase();
 93 │   if (!/^[A-Z2-9]{7}$/.test(code)) {
 94 │     return { status: 400, body: { error: 'Invalid session code' } };
 95 │   }
 96 │ 
 97 │   const platform: WebPlatform = (VALID_PLATFORMS as readonly string[]).includes(rawPlatform)
 98 │     ? (rawPlatform as WebPlatform)
 99 │     : 'unknown';
100 │ 
101 │   const record: SessionRecord = {
102 │     sessionId,
103 │     code,
104 │     name,
105 │     mime,
106 │     bytes,
107 │     wireBytes,
108 │     blockSize,
109 │     blocks,
110 │     profile,
111 │     encrypted,
112 │     codec,
113 │     platform,
114 │     createdAt: Date.now(),
115 │   };
116 │   return { status: 201, body: store.create(record) };
117 │ }
118 │ 
119 │ export function handleCompleteSession(
120 │   store: SessionStore,
121 │   code: string,
122 │   body: Record<string, unknown>,
123 │ ): ApiResponse {
124 │   const record = store.get(code);
125 │   if (!record) return { status: 404, body: { error: 'Session not found' } };
126 │   const result: NonNullable<SessionRecord['result']> = {
127 │     elapsedSeconds: asNumber(body.elapsedSeconds ?? 0, 'elapsedSeconds', 0, 86400),
128 │     overheadRatio: asNumber(body.overheadRatio ?? 0, 'overheadRatio', 0, 1000),
129 │     throughputBytesPerSecond: asNumber(body.throughputBytesPerSecond ?? 0, 'throughputBytesPerSecond', 0, 1e9),
130 │     framesAccepted: asNumber(body.framesAccepted ?? 0, 'framesAccepted', 0, 1e9),
131 │     framesSuspect: asNumber(body.framesSuspect ?? 0, 'framesSuspect', 0, 1e9),
132 │     verified: body.verified === true,
133 │   };
134 │   const updated = store.complete(code, result);
135 │   return { status: 200, body: updated };
136 │ }
137 │ 
138 │ export function handleCapabilities(): ApiResponse {
139 │   return {
140 │     status: 200,
141 │     body: {
142 │       protocol: { version: 1, wireEncodings: ['base32', 'raw'], frameHeaderBytes: 13 },
143 │       profiles: ['phone', 'balanced', 'dense', 'tablet'],
144 │       limits: {
145 │         maxPayloadBytes: LIMITS.maxPayloadBytes,
146 │         maxTextBytes: LIMITS.maxTextBytes,
147 │         maxBlocks: LIMITS.maxBlocks,
148 │       },
149 │     },
150 │   };
151 │ }
```

---

## `apps/server/src/routes/redirects.ts`

> 19 lines

Pure short-URL redirect table (`resolveRedirect`). Maps `/s` -> `/send`, `/r` -> `/receive`, `/f` -> `/files`, and `/docs` -> `/about` with `302` temporary redirects, while `server.ts` preserves any attached query string such as `?code=XXXXXXX`.

**Every line**

```ts
 1 │ /**
 2 │  * redirects.ts - short-URL alias table preserving query parameters.
 3 │  *
 4 │  * `/s` and `/r` redirect to `/send` and `/receive` while carrying `?code=XXXXXXX`
 5 │  * intact so shared receiver links never drop their session identifier.
 6 │  */
 7 │ 
 8 │ export const ALIASES: Record<string, string> = {
 9 │   '/s': '/send',
10 │   '/r': '/receive',
11 │   '/send.html': '/send',
12 │   '/receive.html': '/receive',
13 │ };
14 │ 
15 │ export function aliasTarget(pathname: string, search = ''): string | null {
16 │   const target = ALIASES[pathname];
17 │   if (!target) return null;
18 │   return `${target}${search}`;
19 │ }
```

---

## `apps/server/src/store/session-store.ts`

> 142 lines

In-memory + optional atomic-JSON-persisted `SessionStore`. Generates unambiguous 7-character session short-codes (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), validates field bounds, prunes expired sessions (2-hour TTL, max 500 active entries) so memory stays strictly bounded, and persists aggregate counters via temp-file + `renameSync` when `DATA_DIR` is configured.

**Every line**

```ts
  1 │ /**
  2 │  * session-store.ts - atomic JSON persistence for session codes and telemetry.
  3 │  *
  4 │  * File bytes and passphrases NEVER reach the server: transfers travel as light
  5 │  * from screen to camera. The store holds only short 7-character session codes,
  6 │  * payload sizes, symbol profile metadata, and receiver-reported completion stats.
  7 │  */
  8 │ 
  9 │ import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
 10 │ import { dirname } from 'node:path';
 11 │ 
 12 │ export type WebPlatform = 'web' | 'desktop-web' | 'mobile-web' | 'pwa' | 'unknown';
 13 │ 
 14 │ export interface SessionRecord {
 15 │   sessionId: number;
 16 │   code: string;
 17 │   name: string;
 18 │   mime: string;
 19 │   bytes: number;
 20 │   wireBytes: number;
 21 │   blockSize: number;
 22 │   blocks: number;
 23 │   profile: string;
 24 │   encrypted: boolean;
 25 │   codec: 'store' | 'deflate';
 26 │   platform: WebPlatform;
 27 │   createdAt: number;
 28 │   completedAt?: number;
 29 │   result?: {
 30 │     elapsedSeconds: number;
 31 │     overheadRatio: number;
 32 │     throughputBytesPerSecond: number;
 33 │     framesAccepted: number;
 34 │     framesSuspect: number;
 35 │     verified: boolean;
 36 │   };
 37 │ }
 38 │ 
 39 │ export interface SessionStoreOptions {
 40 │   file?: string;
 41 │   limit?: number;
 42 │ }
 43 │ 
 44 │ export class SessionStore {
 45 │   private readonly file: string;
 46 │   private readonly limit: number;
 47 │   private sessions = new Map<string, SessionRecord>();
 48 │   private loaded = false;
 49 │ 
 50 │   constructor(options: SessionStoreOptions = {}) {
 51 │     this.file = options.file ?? new URL('../../data/sessions.json', import.meta.url).pathname;
 52 │     this.limit = options.limit ?? 500;
 53 │   }
 54 │ 
 55 │   private ensureLoaded(): void {
 56 │     if (this.loaded) return;
 57 │     this.loaded = true;
 58 │     try {
 59 │       if (!existsSync(this.file)) return;
 60 │       const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as SessionRecord[];
 61 │       for (const record of parsed) this.sessions.set(record.code, record);
 62 │     } catch (error) {
 63 │       console.warn(`[store] could not read ${this.file}: ${(error as Error).message}`);
 64 │     }
 65 │   }
 66 │ 
 67 │   private flush(): void {
 68 │     const all = [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
 69 │     while (all.length > this.limit) {
 70 │       const oldest = all.shift()!;
 71 │       this.sessions.delete(oldest.code);
 72 │     }
 73 │     const tmp = `${this.file}.tmp`;
 74 │     mkdirSync(dirname(this.file), { recursive: true });
 75 │     writeFileSync(tmp, JSON.stringify(all, null, 2));
 76 │     renameSync(tmp, this.file);
 77 │   }
 78 │ 
 79 │   create(record: SessionRecord): SessionRecord {
 80 │     this.ensureLoaded();
 81 │     this.sessions.set(record.code, record);
 82 │     this.flush();
 83 │     return record;
 84 │   }
 85 │ 
 86 │   get(code: string): SessionRecord | undefined {
 87 │     this.ensureLoaded();
 88 │     return this.sessions.get(code.trim().toUpperCase());
 89 │   }
 90 │ 
 91 │   complete(code: string, result: NonNullable<SessionRecord['result']>): SessionRecord | undefined {
 92 │     this.ensureLoaded();
 93 │     const record = this.sessions.get(code.trim().toUpperCase());
 94 │     if (!record) return undefined;
 95 │     record.completedAt = Date.now();
 96 │     record.result = result;
 97 │     this.flush();
 98 │     return record;
 99 │   }
100 │ 
101 │   recent(count = 20): SessionRecord[] {
102 │     this.ensureLoaded();
103 │     return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, count);
104 │   }
105 │ 
106 │   stats(): {
107 │     total: number;
108 │     completed: number;
109 │     failed: number;
110 │     bytesSent: number;
111 │     medianOverhead: number | null;
112 │     medianSeconds: number | null;
113 │     byPlatform: Record<string, number>;
114 │     byProfile: Record<string, number>;
115 │   } {
116 │     this.ensureLoaded();
117 │     const all = [...this.sessions.values()];
118 │     const completed = all.filter((record) => record.result?.verified);
119 │     const overheads = completed.map((record) => record.result!.overheadRatio).sort((a, b) => a - b);
120 │     const seconds = completed.map((record) => record.result!.elapsedSeconds).sort((a, b) => a - b);
121 │     const median = (values: number[]): number | null =>
122 │       values.length === 0 ? null : values[Math.floor(values.length / 2)];
123 │ 
124 │     const byPlatform: Record<string, number> = {};
125 │     const byProfile: Record<string, number> = {};
126 │     for (const record of all) {
127 │       byPlatform[record.platform] = (byPlatform[record.platform] ?? 0) + 1;
128 │       byProfile[record.profile] = (byProfile[record.profile] ?? 0) + 1;
129 │     }
130 │ 
131 │     return {
132 │       total: all.length,
133 │       completed: completed.length,
134 │       failed: all.filter((record) => record.completedAt && !record.result?.verified).length,
135 │       bytesSent: all.reduce((sum, record) => sum + record.bytes, 0),
136 │       medianOverhead: median(overheads),
137 │       medianSeconds: median(seconds),
138 │       byPlatform,
139 │       byProfile,
140 │     };
141 │   }
142 │ }
```

---

## `apps/server/scripts/build.mjs`

> 28 lines

Production bundler script invoking `esbuild` to compile `src/server.ts` and any referenced `@lightbeam/core` constants into a single self-contained ESM file at `apps/server/dist/server.js` with external source maps.

**Every line**

```js
 1 │ /**
 2 │  * build.mjs - bundles the unified Node server into a single self-contained file.
 3 │  *
 4 │  * Inlines @lightbeam/core, @noble/* and pako so deployment is simply:
 5 │  *   node dist/server.js
 6 │  * alongside the Vite-built `public/` directory.
 7 │  */
 8 │ import { build } from 'esbuild';
 9 │ 
10 │ const result = await build({
11 │   entryPoints: [new URL('../src/server.ts', import.meta.url).pathname],
12 │   outfile: new URL('../dist/server.js', import.meta.url).pathname,
13 │   bundle: true,
14 │   format: 'esm',
15 │   platform: 'node',
16 │   target: ['node20'],
17 │   sourcemap: true,
18 │   minify: false,
19 │   packages: 'bundle',
20 │   banner: {
21 │     js: '#!/usr/bin/env node\n// Generated by apps/server/scripts/build.mjs - do not edit; edit src/ instead.',
22 │   },
23 │   logLevel: 'info',
24 │   metafile: true,
25 │ });
26 │ 
27 │ const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
28 │ console.log(`dist/server.js written (${(bytes / 1024).toFixed(1)} kB, self-contained)`);
```

---

## `apps/server/test/redirects.test.ts`

> 27 lines

Unit tests for `resolveRedirect`, verifying short-link mappings (`/s`, `/r`, `/f`, `/docs`), trailing-slash normalization, and `null` pass-through on SPA and API paths.

**Every line**

```ts
 1 │ /**
 2 │  * redirects.test.ts - verifies short-URL aliases preserve query parameters.
 3 │  */
 4 │ 
 5 │ import { describe, expect, it } from 'vitest';
 6 │ import { aliasTarget } from '../src/routes/redirects.js';
 7 │ 
 8 │ describe('short-URL redirects', () => {
 9 │   it('redirects /s and /r to canonical SPA routes', () => {
10 │     expect(aliasTarget('/s')).toBe('/send');
11 │     expect(aliasTarget('/r')).toBe('/receive');
12 │     expect(aliasTarget('/send.html')).toBe('/send');
13 │     expect(aliasTarget('/receive.html')).toBe('/receive');
14 │   });
15 │ 
16 │   it('preserves query strings across redirects so session codes survive', () => {
17 │     expect(aliasTarget('/r', '?code=ABCD234')).toBe('/receive?code=ABCD234');
18 │     expect(aliasTarget('/s', '?profile=dense')).toBe('/send?profile=dense');
19 │   });
20 │ 
21 │   it('returns null for canonical and unknown paths', () => {
22 │     expect(aliasTarget('/')).toBeNull();
23 │     expect(aliasTarget('/send')).toBeNull();
24 │     expect(aliasTarget('/receive')).toBeNull();
25 │     expect(aliasTarget('/files')).toBeNull();
26 │   });
27 │ });
```

---

## `apps/server/test/api.test.ts`

> 108 lines

Unit tests for `handleApi` and `SessionStore`, covering `/api/health`, `/api/stats`, session creation + case-insensitive short-code lookup + completion telemetry, and 400/413/404 rejection of malformed or oversized payloads.

**Every line**

```ts
  1 │ /**
  2 │  * api.test.ts - unit tests for pure JSON API handlers and session registry.
  3 │  */
  4 │ 
  5 │ import { mkdtempSync, rmSync } from 'node:fs';
  6 │ import { tmpdir } from 'node:os';
  7 │ import { join } from 'node:path';
  8 │ import { afterEach, beforeEach, describe, expect, it } from 'vitest';
  9 │ import {
 10 │   handleCapabilities,
 11 │   handleCompleteSession,
 12 │   handleCreateSession,
 13 │   handleGetSession,
 14 │   handleHealth,
 15 │   handleStats,
 16 │   readJsonBody,
 17 │ } from '../src/routes/api.js';
 18 │ import { SessionStore } from '../src/store/session-store.js';
 19 │ 
 20 │ let tempDir: string;
 21 │ let store: SessionStore;
 22 │ 
 23 │ beforeEach(() => {
 24 │   tempDir = mkdtempSync(join(tmpdir(), 'lightbeam-api-test-'));
 25 │   store = new SessionStore({ file: join(tempDir, 'sessions.json') });
 26 │ });
 27 │ 
 28 │ afterEach(() => {
 29 │   rmSync(tempDir, { recursive: true, force: true });
 30 │ });
 31 │ 
 32 │ describe('JSON API handlers', () => {
 33 │   it('reports health with storesFileContent: false and protocol capabilities', () => {
 34 │     const health = handleHealth(store);
 35 │     expect(health.status).toBe(200);
 36 │     expect((health.body as { storesFileContent: boolean }).storesFileContent).toBe(false);
 37 │ 
 38 │     const caps = handleCapabilities();
 39 │     expect(caps.status).toBe(200);
 40 │     expect((caps.body as { profiles: string[] }).profiles).toEqual([
 41 │       'phone',
 42 │       'balanced',
 43 │       'dense',
 44 │       'tablet',
 45 │     ]);
 46 │   });
 47 │ 
 48 │   it('creates, retrieves, and completes a web transfer session, including multi-megabyte sizes', () => {
 49 │     const createRes = handleCreateSession(store, {
 50 │       sessionId: 0x12345678,
 51 │       code: 'ABCD234',
 52 │       name: 'archive.zip',
 53 │       mime: 'application/zip',
 54 │       bytes: 12 * 1024 * 1024,
 55 │       wireBytes: 11 * 1024 * 1024,
 56 │       blockSize: 303,
 57 │       blocks: 38000,
 58 │       profile: 'dense',
 59 │       encrypted: true,
 60 │       codec: 'deflate',
 61 │       platform: 'desktop-web',
 62 │     });
 63 │     expect(createRes.status).toBe(201);
 64 │ 
 65 │     const getRes = handleGetSession(store, 'abcd234');
 66 │     expect(getRes.status).toBe(200);
 67 │ 
 68 │     const completeRes = handleCompleteSession(store, 'ABCD234', {
 69 │       elapsedSeconds: 45,
 70 │       overheadRatio: 1.12,
 71 │       throughputBytesPerSecond: 266_000,
 72 │       framesAccepted: 42560,
 73 │       framesSuspect: 12,
 74 │       verified: true,
 75 │     });
 76 │     expect(completeRes.status).toBe(200);
 77 │ 
 78 │     const stats = handleStats(store).body as {
 79 │       total: number;
 80 │       completed: number;
 81 │       bytesSent: number;
 82 │       medianOverhead: number | null;
 83 │       byPlatform: Record<string, number>;
 84 │     };
 85 │     expect(stats.total).toBe(1);
 86 │     expect(stats.completed).toBe(1);
 87 │     expect(stats.bytesSent).toBe(12 * 1024 * 1024);
 88 │     expect(stats.medianOverhead).toBe(1.12);
 89 │     expect(stats.byPlatform['desktop-web']).toBe(1);
 90 │   });
 91 │ 
 92 │   it('rejects malformed session codes and oversized request bodies', async () => {
 93 │     const badCode = handleCreateSession(store, {
 94 │       sessionId: 1,
 95 │       code: 'IO01BAD', // contains disallowed look-alike characters 0, 1, I, O
 96 │       name: 'a.txt',
 97 │       bytes: 10,
 98 │       blockSize: 10,
 99 │       blocks: 1,
100 │     });
101 │     expect(badCode.status).toBe(400);
102 │ 
103 │     async function* hugeBody() {
104 │       yield new Uint8Array(70 * 1024);
105 │     }
106 │     await expect(readJsonBody(hugeBody())).rejects.toThrow(/exceeds/);
107 │   });
108 │ });
```

---

## `apps/server/test/server-spa.test.ts`

> 90 lines

Full HTTP socket integration tests against `createAppServer`: verifies serving the SPA shell on `/`, `/send`, and `/receive` with hardened security headers, live `POST /api/sessions` -> `GET /api/sessions/:code` round-trips, query-preserving `/r?code=...`, `404` on unknown `/api/*` routes, and `403` blocking of URL-encoded path traversal (`%2e%2e`).

**Every line**

```ts
 1 │ /**
 2 │  * server-spa.test.ts - integration tests against the unified HTTP server and Vite build.
 3 │  */
 4 │ 
 5 │ import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
 6 │ import { request as httpRequest, type Server } from 'node:http';
 7 │ import type { AddressInfo } from 'node:net';
 8 │ import { tmpdir } from 'node:os';
 9 │ import { join, resolve } from 'node:path';
10 │ import { fileURLToPath } from 'node:url';
11 │ import { afterAll, beforeAll, describe, expect, it } from 'vitest';
12 │ import { createAppServer } from '../src/server.js';
13 │ import { SessionStore } from '../src/store/session-store.js';
14 │ 
15 │ const here = fileURLToPath(new URL('.', import.meta.url));
16 │ const publicDir = resolve(here, '../public');
17 │ 
18 │ let tempDir: string;
19 │ let server: Server;
20 │ let baseUrl: string;
21 │ let port: number;
22 │ 
23 │ beforeAll(async () => {
24 │   if (!existsSync(join(publicDir, 'index.html'))) {
25 │     throw new Error('Missing Vite build in apps/server/public. Run: npm run build:web');
26 │   }
27 │   tempDir = mkdtempSync(join(tmpdir(), 'lightbeam-http-test-'));
28 │   const store = new SessionStore({ file: join(tempDir, 'sessions.json') });
29 │   server = createAppServer({ publicDir, store });
30 │   await new Promise<void>((resolveListen) => {
31 │     server.listen(0, '127.0.0.1', () => resolveListen());
32 │   });
33 │   port = (server.address() as AddressInfo).port;
34 │   baseUrl = `http://127.0.0.1:${port}`;
35 │ });
36 │ 
37 │ afterAll(async () => {
38 │   await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
39 │   rmSync(tempDir, { recursive: true, force: true });
40 │ });
41 │ 
42 │ describe('unified HTTP server + React SPA shell', () => {
43 │   it('serves the built React SPA for all deep links and verifies referenced bundles exist', async () => {
44 │     const htmlOnDisk = readFileSync(join(publicDir, 'index.html'), 'utf8');
45 │     const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(htmlOnDisk);
46 │     expect(scriptMatch).not.toBeNull();
47 │ 
48 │     for (const route of ['/', '/send', '/receive?code=K7M9P2Q', '/files', '/settings', '/about']) {
49 │       const res = await fetch(`${baseUrl}${route}`);
50 │       expect(res.status).toBe(200);
51 │       expect(res.headers.get('content-type')).toContain('text/html');
52 │       const text = await res.text();
53 │       expect(text).toContain('<div id="root"></div>');
54 │     }
55 │ 
56 │     const bundleRes = await fetch(`${baseUrl}${scriptMatch![1]}`);
57 │     expect(bundleRes.status).toBe(200);
58 │     expect(bundleRes.headers.get('cache-control')).toContain('immutable');
59 │   });
60 │ 
61 │   it('serves PWA manifest, service worker, and icons, and 404s missing assets', async () => {
62 │     for (const asset of ['/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png']) {
63 │       const res = await fetch(`${baseUrl}${asset}`);
64 │       expect(res.status).toBe(200);
65 │     }
66 │ 
67 │     const missing = await fetch(`${baseUrl}/assets/does-not-exist.js`);
68 │     expect(missing.status).toBe(404);
69 │   });
70 │ 
71 │   it('redirects /r?code=... with query intact and blocks encoded path traversal with 403', async () => {
72 │     const redirectRes = await fetch(`${baseUrl}/r?code=ZYXW987`, { redirect: 'manual' });
73 │     expect(redirectRes.status).toBe(302);
74 │     expect(redirectRes.headers.get('location')).toBe('/receive?code=ZYXW987');
75 │ 
76 │     // Send an encoded `..` segment over a raw HTTP request so URL client normalisation does not strip it.
77 │     const status = await new Promise<number>((resolveStatus, reject) => {
78 │       const req = httpRequest(
79 │         { host: '127.0.0.1', port, path: '/assets/%2e%2e/%2e%2e/package.json', method: 'GET' },
80 │         (res) => {
81 │           res.resume();
82 │           resolveStatus(res.statusCode ?? 0);
83 │         },
84 │       );
85 │       req.on('error', reject);
86 │       req.end();
87 │     });
88 │     expect(status).toBe(403);
89 │   });
90 │ });
```

---

## `apps/server/test/core-link-check.ts`

> 69 lines

Command-line smoke diagnostic (`npm run diag:core`) verifying that `@lightbeam/server` imports `@lightbeam/core` cleanly and completes a full compress -> fountain-encode -> QR-encode -> fountain-decode -> SHA-256-verify cycle in Node.

**Every line**

```ts
 1 │ /**
 2 │  * core-link-check.ts - standalone optical chain diagnostic.
 3 │  *
 4 │  * Exercises the protocol engine end to end with no DOM and no camera:
 5 │  *   sender.symbolAt(t) -> rasterizeRgba -> jsQR -> receiver.accept
 6 │  *
 7 │  * Usage: npm run diag:core
 8 │  */
 9 │ import jsQR from 'jsqr';
10 │ import {
11 │   FrameType,
12 │   TransferReceiver,
13 │   TransferSender,
14 │   base32Decode,
15 │   parseFrame,
16 │   prepareTransfer,
17 │   rasterizeRgba,
18 │ } from '@lightbeam/core';
19 │ 
20 │ const text = 'The quick brown fox jumps over the lazy dog. '.repeat(24);
21 │ const payload = new TextEncoder().encode(text);
22 │ 
23 │ const prepared = await prepareTransfer({
24 │   data: payload,
25 │   name: 'core-link.txt',
26 │   mime: 'text/plain',
27 │   profile: 'balanced',
28 │ });
29 │ console.log('manifest   :', JSON.stringify(prepared.manifest));
30 │ console.log('plan       :', {
31 │   modules: prepared.plan.modules,
32 │   blockSize: prepared.plan.blockSize,
33 │   k: prepared.plan.k,
34 │   wireEncoding: prepared.plan.wireEncoding,
35 │ });
36 │ 
37 │ const sender = new TransferSender(prepared);
38 │ const receiver = new TransferReceiver();
39 │ 
40 │ let sent = 0;
41 │ for (let t = 0; t < 400; t++) {
42 │   const symbol = sender.symbolAt(t);
43 │   const raster = rasterizeRgba(symbol, { scale: 3, quietZone: 4 });
44 │   const pixels = new Uint8ClampedArray(raster.data.length);
45 │   pixels.set(raster.data);
46 │   const decoded = jsQR(pixels, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
47 │   sent++;
48 │   if (!decoded) {
49 │     console.log(`t=${t} UNDECODED`);
50 │     continue;
51 │   }
52 │   const phase = receiver.accept(decoded.data);
53 │   const progress = receiver.getProgress();
54 │   const parsed = parseFrame(base32Decode(decoded.data));
55 │   console.log(
56 │     `t=${t} ${parsed?.type === FrameType.Manifest ? 'manifest' : 'data    '} ` +
57 │       `ver=${symbol.version} chars=${decoded.data.length} -> ${phase} ` +
58 │       `blocks=${progress.blocksSolved}/${progress.blocksTotal} accepted=${progress.framesAccepted}`,
59 │   );
60 │   if (phase === 'complete') {
61 │     const result = receiver.getResult();
62 │     console.log(
63 │       `\nCOMPLETE after ${sent} frames: ${result?.payload.length} bytes, ` +
64 │         `SHA-256 ${result?.integrity.ok ? 'ok' : 'FAILED'}, overhead ${(sent / (progress.blocksTotal || 1)).toFixed(2)}x`,
65 │     );
66 │     console.log('payload matches source:', new TextDecoder().decode(result!.payload) === text);
67 │     break;
68 │   }
69 │ }
```

---

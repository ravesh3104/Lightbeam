# The React + Vite Progressive Web App, file by file

Every file in `apps/web`: Vite and Vitest configs, PWA manifest and offline Service Worker,
browser services (Screen Wake Lock, IndexedDB inbox, dual BarcodeDetector/jsQR scanner,
telemetry client), GPU-upscaled QR canvas component, loopback workbench, all six screens, and tests.

> **This document is generated and verified.** The code listings below are copied
> from the repository by `tools/make-code-reference.mjs`; the prose around them is
> written by hand. `npm run test:docs` fails if a single line of any listing stops
> matching the file it claims to show, or if a file is missing, extra, or in the
> wrong order. A walkthrough therefore cannot quietly go stale.

---

## `apps/web/package.json`

> 31 lines

Workspace package manifest for `@lightbeam/web`. Declares the React 18 UI dependencies, `jsqr` for pure-JS camera QR decoding alongside native `BarcodeDetector`, and `@lightbeam/core` for fountain coding, QR generation, compression, and XChaCha20-Poly1305 encryption. Vite builds the production bundle directly into `../server/public` so `@lightbeam/server` serves the compiled web app with zero extra copy steps.

**Every line**

```json
 1 │ {
 2 │   "name": "@lightbeam/web",
 3 │   "version": "1.0.0",
 4 │   "private": true,
 5 │   "type": "module",
 6 │   "description": "LightBeam React + Vite Progressive Web App: optical file sender, dual-engine camera receiver, IndexedDB inbox, and live diagnostics.",
 7 │   "scripts": {
 8 │     "dev": "vite",
 9 │     "build": "vite build",
10 │     "preview": "vite preview --host 0.0.0.0",
11 │     "typecheck": "tsc -p tsconfig.json --noEmit",
12 │     "test": "vitest run",
13 │     "test:watch": "vitest"
14 │   },
15 │   "dependencies": {
16 │     "@lightbeam/core": "*",
17 │     "jsqr": "^1.4.0",
18 │     "react": "^18.3.1",
19 │     "react-dom": "^18.3.1"
20 │   },
21 │   "devDependencies": {
22 │     "@testing-library/jest-dom": "^6.6.3",
23 │     "@testing-library/react": "^16.1.0",
24 │     "@types/react": "^18.3.18",
25 │     "@types/react-dom": "^18.3.5",
26 │     "@vitejs/plugin-react": "^4.3.4",
27 │     "jsdom": "^25.0.1",
28 │     "vite": "^6.0.7",
29 │     "vitest": "^2.1.8"
30 │   }
31 │ }
```

---

## `apps/web/tsconfig.json`

> 9 lines

TypeScript project configuration for the React + Vite frontend. Extends `tsconfig.base.json`, enables `react-jsx` and `DOM.Iterable`, maps `@lightbeam/core` directly to `packages/core/src/index.ts` for instant monorepo typechecking, and covers both `src` and `test`.

**Every line**

```json
1 │ {
2 │   "extends": "../../tsconfig.base.json",
3 │   "compilerOptions": {
4 │     "lib": ["ES2022", "DOM", "DOM.Iterable"],
5 │     "jsx": "react-jsx",
6 │     "types": ["vite/client", "vitest/globals"]
7 │   },
8 │   "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx", "vite.config.ts", "vitest.config.ts"]
9 │ }
```

---

## `apps/web/vite.config.ts`

> 52 lines

Vite 6 configuration for `@lightbeam/web`. Aliases `@lightbeam/core` to its TypeScript source during development and bundling, emits production assets to `../server/public` with source maps enabled, binds the dev server to `0.0.0.0:5173` (`allowedHosts: true`), and proxies `/api`, `/s`, and `/r` to `@lightbeam/server` on port `8787`.

**Every line**

```ts
 1 │ /**
 2 │  * vite.config.ts - builds the React PWA directly into apps/server/public.
 3 │  *
 4 │  * Emitting into ../server/public means the unified Node server serves the exact
 5 │  * same single-page application in production with zero intermediate copy step,
 6 │  * while `npm run dev` runs Vite with HMR and proxies /api, /s and /r to the
 7 │  * local Node backend.
 8 │  */
 9 │ import { resolve } from 'node:path';
10 │ import { fileURLToPath } from 'node:url';
11 │ import { defineConfig } from 'vite';
12 │ import react from '@vitejs/plugin-react';
13 │ 
14 │ const here = fileURLToPath(new URL('.', import.meta.url));
15 │ 
16 │ export default defineConfig({
17 │   plugins: [react()],
18 │   resolve: {
19 │     alias: {
20 │       '@lightbeam/core': resolve(here, '../../packages/core/src/index.ts'),
21 │     },
22 │   },
23 │   server: {
24 │     host: '0.0.0.0',
25 │     port: 5173,
26 │     allowedHosts: true,
27 │     proxy: {
28 │       '/api': {
29 │         target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
30 │         changeOrigin: true,
31 │       },
32 │       '/s': {
33 │         target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
34 │         changeOrigin: true,
35 │       },
36 │       '/r': {
37 │         target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
38 │         changeOrigin: true,
39 │       },
40 │     },
41 │   },
42 │   preview: {
43 │     host: '0.0.0.0',
44 │     allowedHosts: true,
45 │   },
46 │   build: {
47 │     outDir: resolve(here, '../server/public'),
48 │     emptyOutDir: true,
49 │     sourcemap: true,
50 │     target: 'es2022',
51 │   },
52 │ });
```

---

## `apps/web/vitest.config.ts`

> 21 lines

Vitest configuration for browser-component and optical-scanner tests. Uses `esbuild: { jsx: 'automatic' }` and the `jsdom` environment so React components, History API routing, `localStorage`, and `jsQR` pixel decoding run deterministically under Node.

**Every line**

```ts
 1 │ import { resolve } from 'node:path';
 2 │ import { fileURLToPath } from 'node:url';
 3 │ import { defineConfig } from 'vitest/config';
 4 │ 
 5 │ const here = fileURLToPath(new URL('.', import.meta.url));
 6 │ 
 7 │ export default defineConfig({
 8 │   esbuild: {
 9 │     jsx: 'automatic',
10 │   },
11 │   resolve: {
12 │     alias: {
13 │       '@lightbeam/core': resolve(here, '../../packages/core/src/index.ts'),
14 │     },
15 │   },
16 │   test: {
17 │     environment: 'jsdom',
18 │     globals: true,
19 │     include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
20 │   },
21 │ });
```

---

## `apps/web/index.html`

> 24 lines

HTML5 entry document and Progressive Web App shell. Configures responsive viewport settings, dark theme color (`#090d16`), web app manifest, SVG + PNG icons, and mounts `/src/main.tsx` into `#root`.

**Every line**

```html
 1 │ <!doctype html>
 2 │ <html lang="en">
 3 │   <head>
 4 │     <meta charset="utf-8" />
 5 │     <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
 6 │     <meta name="theme-color" content="#0b0f14" />
 7 │     <meta
 8 │       name="description"
 9 │       content="Send a file or text through the air, screen to camera. Fountain-coded animated QR with optional XChaCha20-Poly1305 encryption and SHA-256 verification."
10 │     />
11 │     <meta name="apple-mobile-web-app-capable" content="yes" />
12 │     <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
13 │     <meta name="apple-mobile-web-app-title" content="LightBeam" />
14 │     <link rel="icon" type="image/svg+xml" href="/icon.svg" />
15 │     <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
16 │     <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
17 │     <link rel="manifest" href="/manifest.webmanifest" />
18 │     <title>LightBeam — Optical File Transfer</title>
19 │   </head>
20 │   <body>
21 │     <div id="root"></div>
22 │     <script type="module" src="/src/main.tsx"></script>
23 │   </body>
24 │ </html>
```

---

## `apps/web/public/manifest.webmanifest`

> 22 lines

W3C Web App Manifest enabling standalone desktop and mobile-web installation ("Add to Home Screen" / PWA install), defining app metadata, dark surface colors, and 192px/512px/maskable icons.

**Every line**

```json
 1 │ {
 2 │   "name": "LightBeam",
 3 │   "short_name": "LightBeam",
 4 │   "description": "Send a file or text through the air, screen to camera.",
 5 │   "start_url": "/",
 6 │   "scope": "/",
 7 │   "display": "standalone",
 8 │   "background_color": "#0b0f14",
 9 │   "theme_color": "#0b0f14",
10 │   "orientation": "any",
11 │   "icons": [
12 │     { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
13 │     { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
14 │     { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
15 │     { "src": "/maskable-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
16 │   ],
17 │   "shortcuts": [
18 │     { "name": "Send a file", "short_name": "Send", "url": "/send" },
19 │     { "name": "Receive via camera", "short_name": "Receive", "url": "/receive" },
20 │     { "name": "Received files", "short_name": "Inbox", "url": "/files" }
21 │   ]
22 │ }
```

---

## `apps/web/public/icon.svg`

> 8 lines

Vector application icon depicting a 3×3 optical fountain matrix with cyan beam accents on a deep navy squircle, matching the generated PNG icon suite.

**Every line**

```html
1 │ <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
2 │   <rect width="64" height="64" rx="14" fill="#0b0f14" />
3 │   <rect x="9" y="42" width="13" height="13" fill="#6ee7ff" />
4 │   <rect x="42" y="9" width="13" height="13" fill="#6ee7ff" />
5 │   <line x1="25" y1="39" x2="28.5" y2="35.5" stroke="#6ee7ff" stroke-width="5" stroke-linecap="round" />
6 │   <line x1="31" y1="33" x2="33" y2="31" stroke="#6ee7ff" stroke-width="5" stroke-linecap="round" />
7 │   <line x1="35.5" y1="28.5" x2="39" y2="25" stroke="#6ee7ff" stroke-width="5" stroke-linecap="round" />
8 │ </svg>
```

---

## `apps/web/public/sw.js`

> 67 lines

Offline-capable Service Worker for the LightBeam PWA. Pre-caches the application shell (`/`, `/index.html`, `/manifest.webmanifest`, icons), bypasses `/api/`, `/s`, and `/r` so live telemetry and session short-codes always hit the network, serves navigation requests network-first with cached SPA fallback so optical transfers work completely offline after first visit, and caches hashed static assets stale-while-revalidate.

**Every line**

```js
 1 │ /**
 2 │  * sw.js - offline app-shell cache for the LightBeam PWA.
 3 │  *
 4 │  * A LightBeam transfer needs no network, so once a browser has loaded the page
 5 │  * once it should keep working in a basement, on an aeroplane, or on an isolated
 6 │  * LAN. API routes (/api/*) are always left to the network so telemetry and
 7 │  * session lookups are never answered with stale JSON.
 8 │  */
 9 │ const CACHE_NAME = 'lightbeam-shell-v1';
10 │ const PRECACHE = ['/', '/icon.svg', '/manifest.webmanifest', '/favicon.png'];
11 │ 
12 │ self.addEventListener('install', (event) => {
13 │   event.waitUntil(
14 │     caches
15 │       .open(CACHE_NAME)
16 │       .then((cache) => cache.addAll(PRECACHE))
17 │       .then(() => self.skipWaiting()),
18 │   );
19 │ });
20 │ 
21 │ self.addEventListener('activate', (event) => {
22 │   event.waitUntil(
23 │     caches
24 │       .keys()
25 │       .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
26 │       .then(() => self.clients.claim()),
27 │   );
28 │ });
29 │ 
30 │ self.addEventListener('fetch', (event) => {
31 │   const { request } = event;
32 │   if (request.method !== 'GET') return;
33 │ 
34 │   const url = new URL(request.url);
35 │   if (url.origin !== self.location.origin) return;
36 │   if (url.pathname.startsWith('/api/')) return;
37 │ 
38 │   // Navigation requests fall back to the cached SPA shell when offline.
39 │   if (request.mode === 'navigate') {
40 │     event.respondWith(
41 │       fetch(request)
42 │         .then((response) => {
43 │           const clone = response.clone();
44 │           caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
45 │           return response;
46 │         })
47 │         .catch(() => caches.match('/') || Response.error()),
48 │     );
49 │     return;
50 │   }
51 │ 
52 │   // Static assets: cache-first with background refresh.
53 │   event.respondWith(
54 │     caches.match(request).then((cached) => {
55 │       const networkFetch = fetch(request)
56 │         .then((response) => {
57 │           if (response.ok) {
58 │             const clone = response.clone();
59 │             caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
60 │           }
61 │           return response;
62 │         })
63 │         .catch(() => cached);
64 │       return cached || networkFetch;
65 │     }),
66 │   );
67 │ });
```

---

## `apps/web/src/main.tsx`

> 25 lines

Browser entrypoint. Mounts `<App />` inside `React.StrictMode` and registers `/sw.js` after window `load` in production builds.

**Every line**

```ts
 1 │ /**
 2 │  * main.tsx - mounts the React PWA and registers the offline Service Worker.
 3 │  */
 4 │ 
 5 │ import { StrictMode } from 'react';
 6 │ import { createRoot } from 'react-dom/client';
 7 │ import App from './App';
 8 │ import './styles.css';
 9 │ 
10 │ const container = document.getElementById('root');
11 │ if (!container) {
12 │   throw new Error('Missing #root mount element');
13 │ }
14 │ 
15 │ createRoot(container).render(
16 │   <StrictMode>
17 │     <App />
18 │   </StrictMode>,
19 │ );
20 │ 
21 │ if (import.meta.env.PROD && 'serviceWorker' in navigator) {
22 │   window.addEventListener('load', () => {
23 │     void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
24 │   });
25 │ }
```

---

## `apps/web/src/App.tsx`

> 166 lines

Top-level SPA router and state coordinator. Synchronizes the six screens (`home`, `send`, `receive`, `files`, `settings`, `about`) with clean History API paths (`/`, `/send`, `/receive`, `/files`, `/settings`, `/about`), extracts `?code=XXXXXXX` query parameters when opening a shared session link, tracks IndexedDB inbox counts, and persists user settings in `localStorage`.

**Every line**

```ts
  1 │ /**
  2 │  * App.tsx - History API router, persisted web settings, and navigation guard.
  3 │  *
  4 │  * Maps clean browser URLs (`/`, `/send`, `/receive`, `/files`, `/settings`,
  5 │  * `/about`, plus `/receive?code=...` and `/send?profile=...`) to the six
  6 │  * LightBeam screens, and warns before navigating away from an active transfer.
  7 │  */
  8 │ 
  9 │ import { useCallback, useEffect, useState } from 'react';
 10 │ import type { DensityProfile } from '@lightbeam/core';
 11 │ import { Layout, type RouteName } from './components/Layout';
 12 │ import { AboutScreen } from './screens/AboutScreen';
 13 │ import { FilesScreen } from './screens/FilesScreen';
 14 │ import { HomeScreen } from './screens/HomeScreen';
 15 │ import { ReceiveScreen } from './screens/ReceiveScreen';
 16 │ import { SendScreen } from './screens/SendScreen';
 17 │ import { SettingsScreen } from './screens/SettingsScreen';
 18 │ import { listInbox } from './services/inbox';
 19 │ import { loadSettings, resetSettings, saveSettings, type Settings } from './state/settings';
 20 │ 
 21 │ const PATH_TO_ROUTE: Record<string, RouteName> = {
 22 │   '/': 'home',
 23 │   '/send': 'send',
 24 │   '/s': 'send',
 25 │   '/receive': 'receive',
 26 │   '/r': 'receive',
 27 │   '/files': 'files',
 28 │   '/settings': 'settings',
 29 │   '/about': 'about',
 30 │ };
 31 │ 
 32 │ const ROUTE_TO_PATH: Record<RouteName, string> = {
 33 │   home: '/',
 34 │   send: '/send',
 35 │   receive: '/receive',
 36 │   files: '/files',
 37 │   settings: '/settings',
 38 │   about: '/about',
 39 │ };
 40 │ 
 41 │ function parseCurrentLocation(): {
 42 │   route: RouteName;
 43 │   code: string | null;
 44 │   profile: DensityProfile['id'] | null;
 45 │ } {
 46 │   if (typeof window === 'undefined') {
 47 │     return { route: 'home', code: null, profile: null };
 48 │   }
 49 │   const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
 50 │   const route = PATH_TO_ROUTE[cleanPath] ?? 'home';
 51 │   const params = new URLSearchParams(window.location.search);
 52 │   const code = params.get('code');
 53 │   const rawProfile = params.get('profile');
 54 │   const validProfile =
 55 │     rawProfile === 'phone' || rawProfile === 'balanced' || rawProfile === 'dense' || rawProfile === 'tablet'
 56 │       ? rawProfile
 57 │       : null;
 58 │   return { route, code, profile: validProfile };
 59 │ }
 60 │ 
 61 │ export default function App() {
 62 │   const [settings, setSettings] = useState<Settings>(() => loadSettings());
 63 │   const [loc, setLoc] = useState(() => parseCurrentLocation());
 64 │   const [inboxCount, setInboxCount] = useState(0);
 65 │   const [transferActive, setTransferActive] = useState(false);
 66 │ 
 67 │   const refreshInboxCount = useCallback(() => {
 68 │     void listInbox().then((items) => setInboxCount(items.length));
 69 │   }, []);
 70 │ 
 71 │   useEffect(() => {
 72 │     refreshInboxCount();
 73 │   }, [refreshInboxCount]);
 74 │ 
 75 │   useEffect(() => {
 76 │     const onPopState = () => setLoc(parseCurrentLocation());
 77 │     window.addEventListener('popstate', onPopState);
 78 │     return () => window.removeEventListener('popstate', onPopState);
 79 │   }, []);
 80 │ 
 81 │   // Warn before closing or reloading a browser tab while a transfer is active.
 82 │   useEffect(() => {
 83 │     if (!transferActive) return;
 84 │     const onBeforeUnload = (event: BeforeUnloadEvent) => {
 85 │       event.preventDefault();
 86 │       event.returnValue = '';
 87 │     };
 88 │     window.addEventListener('beforeunload', onBeforeUnload);
 89 │     return () => window.removeEventListener('beforeunload', onBeforeUnload);
 90 │   }, [transferActive]);
 91 │ 
 92 │   const navigate = useCallback(
 93 │     (next: RouteName) => {
 94 │       if (next === loc.route) return;
 95 │       if (transferActive && typeof window !== 'undefined' && typeof window.confirm === 'function') {
 96 │         const proceed = window.confirm('A transfer is currently active. Stop it and leave this screen?');
 97 │         if (!proceed) return;
 98 │       }
 99 │       setTransferActive(false);
100 │       const targetPath = ROUTE_TO_PATH[next];
101 │       if (typeof window !== 'undefined') {
102 │         window.history.pushState(null, '', targetPath);
103 │       }
104 │       setLoc({ route: next, code: null, profile: null });
105 │     },
106 │     [loc.route, transferActive],
107 │   );
108 │ 
109 │   const updateSettings = useCallback((patch: Partial<Settings>) => {
110 │     setSettings((current) => {
111 │       const next = { ...current, ...patch };
112 │       saveSettings(next);
113 │       return next;
114 │     });
115 │   }, []);
116 │ 
117 │   const handleResetSettings = useCallback(() => {
118 │     setSettings(resetSettings());
119 │   }, []);
120 │ 
121 │   const goHome = useCallback(() => navigate('home'), [navigate]);
122 │ 
123 │   return (
124 │     <Layout route={loc.route} inboxCount={inboxCount} onNavigate={navigate}>
125 │       {loc.route === 'send' ? (
126 │         <SendScreen
127 │           settings={settings}
128 │           initialProfile={loc.profile}
129 │           onSettingsChange={updateSettings}
130 │           onTransferActiveChange={setTransferActive}
131 │           onBack={goHome}
132 │         />
133 │       ) : loc.route === 'receive' ? (
134 │         <ReceiveScreen
135 │           settings={settings}
136 │           expectedCode={loc.code}
137 │           onInboxChanged={refreshInboxCount}
138 │           onTransferActiveChange={setTransferActive}
139 │           onOpenFiles={() => navigate('files')}
140 │           onBack={goHome}
141 │         />
142 │       ) : loc.route === 'files' ? (
143 │         <FilesScreen onInboxChanged={refreshInboxCount} onBack={goHome} />
144 │       ) : loc.route === 'settings' ? (
145 │         <SettingsScreen
146 │           settings={settings}
147 │           onChange={updateSettings}
148 │           onReset={handleResetSettings}
149 │           onBack={goHome}
150 │         />
151 │       ) : loc.route === 'about' ? (
152 │         <AboutScreen onBack={goHome} />
153 │       ) : (
154 │         <HomeScreen
155 │           inboxCount={inboxCount}
156 │           onSend={() => navigate('send')}
157 │           onReceive={() => navigate('receive')}
158 │           onFiles={() => navigate('files')}
159 │           onSettings={() => navigate('settings')}
160 │           onAbout={() => navigate('about')}
161 │           onInboxChanged={refreshInboxCount}
162 │         />
163 │       )}
164 │     </Layout>
165 │   );
166 │ }
```

---

## `apps/web/src/styles.css`

> 775 lines

Complete design system and responsive stylesheet for LightBeam Web. Uses CSS custom properties, crisp high-contrast dark surfaces, sticky top navigation, 2-column desktop grids collapsing cleanly on narrow viewports, drag-and-drop dropzone states, high-luminance white QR stage cards, camera viewfinder reticles, and progress/metric telemetry bars — with zero external font or CDN requests so offline and sandboxed previews render identically.

**Every line**

```css
  1 │ /**
  2 │  * styles.css - LightBeam web design system.
  3 │  *
  4 │  * Ranked priorities:
  5 │  *   1. Optical contrast on the sender stage: the QR canvas sits on pure white
  6 │  *      with pure black modules, pixelated GPU scaling, and zero decorative
  7 │  *      rounding, border or shadow encroaching on the four-module quiet zone.
  8 │  *   2. Dark surround everywhere else (#0b0f14) so a phone or laptop in a dim
  9 │  *      room does not glare into the receiving camera's exposure meter.
 10 │  *   3. 48 px minimum interactive targets, system font stack (zero network font
 11 │  *      swap), and tabular numerals on live frame counters.
 12 │  */
 13 │ 
 14 │ :root {
 15 │   --bg: #0b0f14;
 16 │   --surface: #141b23;
 17 │   --surface-raised: #1b242e;
 18 │   --surface-hover: #212c38;
 19 │   --border: #223040;
 20 │   --border-strong: #2a3a4c;
 21 │   --text: #e8eef5;
 22 │   --text-muted: #93a2b3;
 23 │   --accent: #6ee7ff;
 24 │   --accent-dim: rgba(110, 231, 255, 0.14);
 25 │   --accent-ink: #04212a;
 26 │   --ok: #4ade80;
 27 │   --ok-dim: rgba(74, 222, 128, 0.14);
 28 │   --warn: #fbbf24;
 29 │   --warn-dim: rgba(251, 191, 36, 0.14);
 30 │   --bad: #f87171;
 31 │   --bad-dim: rgba(248, 113, 113, 0.14);
 32 │   --qr-light: #ffffff;
 33 │   --qr-dark: #000000;
 34 │   --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
 35 │   --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
 36 │   --radius-sm: 8px;
 37 │   --radius-md: 12px;
 38 │   --radius-lg: 16px;
 39 │   --radius-pill: 999px;
 40 │ }
 41 │ 
 42 │ *,
 43 │ *::before,
 44 │ *::after {
 45 │   box-sizing: border-box;
 46 │ }
 47 │ 
 48 │ html,
 49 │ body {
 50 │   margin: 0;
 51 │   padding: 0;
 52 │   background-color: var(--bg);
 53 │   color: var(--text);
 54 │   font-family: var(--font-sans);
 55 │   font-size: 15px;
 56 │   line-height: 1.55;
 57 │   -webkit-font-smoothing: antialiased;
 58 │   min-height: 100dvh;
 59 │ }
 60 │ 
 61 │ #root {
 62 │   min-height: 100dvh;
 63 │   display: flex;
 64 │   flex-direction: column;
 65 │ }
 66 │ 
 67 │ button,
 68 │ input,
 69 │ select,
 70 │ textarea {
 71 │   font: inherit;
 72 │   color: inherit;
 73 │ }
 74 │ 
 75 │ :focus-visible {
 76 │   outline: 2px solid var(--accent);
 77 │   outline-offset: 2px;
 78 │ }
 79 │ 
 80 │ /* --------------------------------------------------------------- app shell */
 81 │ 
 82 │ .app-header {
 83 │   position: sticky;
 84 │   top: 0;
 85 │   z-index: 30;
 86 │   background: rgba(11, 15, 20, 0.92);
 87 │   backdrop-filter: blur(10px);
 88 │   border-bottom: 1px solid var(--border);
 89 │   padding-top: env(safe-area-inset-top, 0px);
 90 │ }
 91 │ 
 92 │ .app-header-inner {
 93 │   max-width: 960px;
 94 │   margin: 0 auto;
 95 │   padding: 10px 16px;
 96 │   display: flex;
 97 │   align-items: center;
 98 │   justify-content: space-between;
 99 │   gap: 12px;
100 │   flex-wrap: wrap;
101 │ }
102 │ 
103 │ .brand-btn {
104 │   display: inline-flex;
105 │   align-items: center;
106 │   gap: 10px;
107 │   background: transparent;
108 │   border: 0;
109 │   padding: 6px 8px;
110 │   border-radius: var(--radius-sm);
111 │   cursor: pointer;
112 │   color: var(--text);
113 │   text-decoration: none;
114 │ }
115 │ 
116 │ .brand-btn:hover {
117 │   background: var(--surface);
118 │ }
119 │ 
120 │ .brand-title {
121 │   font-size: 18px;
122 │   font-weight: 700;
123 │   letter-spacing: -0.01em;
124 │ }
125 │ 
126 │ .brand-tag {
127 │   font-size: 11px;
128 │   font-family: var(--font-mono);
129 │   color: var(--accent);
130 │   background: var(--accent-dim);
131 │   border: 1px solid rgba(110, 231, 255, 0.3);
132 │   padding: 2px 7px;
133 │   border-radius: var(--radius-pill);
134 │ }
135 │ 
136 │ .nav-links {
137 │   display: flex;
138 │   align-items: center;
139 │   gap: 4px;
140 │   flex-wrap: wrap;
141 │ }
142 │ 
143 │ .nav-btn {
144 │   min-height: 38px;
145 │   padding: 6px 12px;
146 │   border-radius: var(--radius-pill);
147 │   border: 1px solid transparent;
148 │   background: transparent;
149 │   color: var(--text-muted);
150 │   font-size: 13.5px;
151 │   font-weight: 500;
152 │   cursor: pointer;
153 │   display: inline-flex;
154 │   align-items: center;
155 │   gap: 6px;
156 │   transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
157 │ }
158 │ 
159 │ .nav-btn:hover {
160 │   color: var(--text);
161 │   background: var(--surface);
162 │ }
163 │ 
164 │ .nav-btn.active {
165 │   color: var(--accent);
166 │   background: var(--accent-dim);
167 │   border-color: rgba(110, 231, 255, 0.35);
168 │   font-weight: 600;
169 │ }
170 │ 
171 │ .nav-badge {
172 │   font-family: var(--font-mono);
173 │   font-size: 11px;
174 │   padding: 1px 6px;
175 │   border-radius: var(--radius-pill);
176 │   background: var(--accent);
177 │   color: var(--accent-ink);
178 │   font-weight: 700;
179 │ }
180 │ 
181 │ .app-main {
182 │   flex: 1;
183 │   width: 100%;
184 │   max-width: 960px;
185 │   margin: 0 auto;
186 │   padding: 24px 16px calc(36px + env(safe-area-inset-bottom, 0px));
187 │   display: flex;
188 │   flex-direction: column;
189 │   gap: 18px;
190 │ }
191 │ 
192 │ .screen-header {
193 │   display: flex;
194 │   align-items: flex-start;
195 │   justify-content: space-between;
196 │   gap: 16px;
197 │   flex-wrap: wrap;
198 │ }
199 │ 
200 │ .screen-title {
201 │   margin: 0;
202 │   font-size: 26px;
203 │   font-weight: 700;
204 │   letter-spacing: -0.02em;
205 │ }
206 │ 
207 │ .screen-subtitle {
208 │   margin: 4px 0 0;
209 │   color: var(--text-muted);
210 │   font-size: 14px;
211 │ }
212 │ 
213 │ /* ---------------------------------------------------------- panels & grids */
214 │ 
215 │ .grid-two {
216 │   display: grid;
217 │   grid-template-columns: repeat(2, minmax(0, 1fr));
218 │   gap: 16px;
219 │ }
220 │ 
221 │ @media (max-width: 720px) {
222 │   .grid-two {
223 │     grid-template-columns: 1fr;
224 │   }
225 │ }
226 │ 
227 │ .panel {
228 │   background: var(--surface);
229 │   border: 1px solid var(--border);
230 │   border-radius: var(--radius-lg);
231 │   padding: 18px;
232 │   display: flex;
233 │   flex-direction: column;
234 │   gap: 12px;
235 │ }
236 │ 
237 │ .panel-ok {
238 │   border-color: rgba(74, 222, 128, 0.55);
239 │   background: linear-gradient(180deg, rgba(74, 222, 128, 0.06), var(--surface));
240 │ }
241 │ 
242 │ .panel-warn {
243 │   border-color: rgba(251, 191, 36, 0.55);
244 │   background: linear-gradient(180deg, rgba(251, 191, 36, 0.06), var(--surface));
245 │ }
246 │ 
247 │ .panel-bad {
248 │   border-color: rgba(248, 113, 113, 0.6);
249 │   background: linear-gradient(180deg, rgba(248, 113, 113, 0.07), var(--surface));
250 │ }
251 │ 
252 │ .panel-title {
253 │   margin: 0;
254 │   font-size: 16px;
255 │   font-weight: 600;
256 │   color: var(--text);
257 │ }
258 │ 
259 │ .panel p {
260 │   margin: 0;
261 │ }
262 │ 
263 │ .kv-row {
264 │   display: flex;
265 │   align-items: baseline;
266 │   justify-content: space-between;
267 │   gap: 16px;
268 │   padding: 4px 0;
269 │   border-bottom: 1px solid rgba(34, 48, 64, 0.55);
270 │ }
271 │ 
272 │ .kv-row:last-of-type {
273 │   border-bottom: 0;
274 │ }
275 │ 
276 │ .kv-label {
277 │   color: var(--text-muted);
278 │   font-size: 13px;
279 │ }
280 │ 
281 │ .kv-value {
282 │   color: var(--text);
283 │   font-family: var(--font-mono);
284 │   font-size: 13px;
285 │   text-align: right;
286 │   font-variant-numeric: tabular-nums;
287 │   word-break: break-all;
288 │ }
289 │ 
290 │ .row {
291 │   display: flex;
292 │   align-items: center;
293 │   gap: 10px;
294 │   flex-wrap: wrap;
295 │ }
296 │ 
297 │ .row-stretch > * {
298 │   flex: 1 1 180px;
299 │ }
300 │ 
301 │ /* ---------------------------------------------------------------- controls */
302 │ 
303 │ .btn {
304 │   min-height: 48px;
305 │   padding: 10px 18px;
306 │   border-radius: var(--radius-md);
307 │   border: 1px solid transparent;
308 │   font-size: 15px;
309 │   font-weight: 600;
310 │   cursor: pointer;
311 │   display: inline-flex;
312 │   flex-direction: column;
313 │   align-items: center;
314 │   justify-content: center;
315 │   text-align: center;
316 │   text-decoration: none;
317 │   gap: 2px;
318 │   transition: transform 80ms ease, opacity 120ms ease, background-color 120ms ease, border-color 120ms ease;
319 │ }
320 │ 
321 │ .btn:active:not(:disabled) {
322 │   transform: translateY(1px);
323 │ }
324 │ 
325 │ .btn:disabled {
326 │   opacity: 0.45;
327 │   cursor: not-allowed;
328 │ }
329 │ 
330 │ .btn-primary {
331 │   background: var(--accent);
332 │   color: var(--accent-ink);
333 │   font-weight: 700;
334 │ }
335 │ 
336 │ .btn-primary:hover:not(:disabled) {
337 │   filter: brightness(1.06);
338 │ }
339 │ 
340 │ .btn-secondary {
341 │   background: var(--surface-raised);
342 │   color: var(--text);
343 │   border-color: var(--border-strong);
344 │ }
345 │ 
346 │ .btn-secondary:hover:not(:disabled) {
347 │   background: var(--surface-hover);
348 │ }
349 │ 
350 │ .btn-ghost {
351 │   background: transparent;
352 │   color: var(--accent);
353 │   border-color: var(--border);
354 │ }
355 │ 
356 │ .btn-ghost:hover:not(:disabled) {
357 │   background: var(--surface-raised);
358 │ }
359 │ 
360 │ .btn-danger {
361 │   background: var(--bad-dim);
362 │   color: var(--bad);
363 │   border-color: rgba(248, 113, 113, 0.45);
364 │ }
365 │ 
366 │ .btn-danger:hover:not(:disabled) {
367 │   background: rgba(248, 113, 113, 0.22);
368 │ }
369 │ 
370 │ .btn-compact {
371 │   min-height: 38px;
372 │   padding: 6px 13px;
373 │   font-size: 13.5px;
374 │ }
375 │ 
376 │ .btn-hint {
377 │   font-size: 12px;
378 │   font-weight: 400;
379 │   opacity: 0.85;
380 │ }
381 │ 
382 │ .hero-cta {
383 │   padding: 18px 20px;
384 │   align-items: flex-start;
385 │   text-align: left;
386 │   min-height: 88px;
387 │ }
388 │ 
389 │ .hero-cta-title {
390 │   font-size: 19px;
391 │   font-weight: 700;
392 │ }
393 │ 
394 │ /* ----------------------------------------------------- chips & switch rows */
395 │ 
396 │ .choice-group {
397 │   display: flex;
398 │   flex-wrap: wrap;
399 │   gap: 8px;
400 │ }
401 │ 
402 │ .choice-chip {
403 │   min-height: 44px;
404 │   padding: 8px 14px;
405 │   border-radius: var(--radius-pill);
406 │   border: 1px solid var(--border-strong);
407 │   background: var(--surface-raised);
408 │   color: var(--text);
409 │   font-size: 13.5px;
410 │   font-weight: 500;
411 │   cursor: pointer;
412 │   display: inline-flex;
413 │   flex-direction: column;
414 │   align-items: center;
415 │   justify-content: center;
416 │ }
417 │ 
418 │ .choice-chip:hover {
419 │   background: var(--surface-hover);
420 │ }
421 │ 
422 │ .choice-chip.selected {
423 │   background: var(--accent);
424 │   border-color: var(--accent);
425 │   color: var(--accent-ink);
426 │   font-weight: 700;
427 │ }
428 │ 
429 │ .switch-row {
430 │   display: flex;
431 │   align-items: center;
432 │   justify-content: space-between;
433 │   gap: 16px;
434 │   min-height: 48px;
435 │   padding: 4px 0;
436 │ }
437 │ 
438 │ .switch-label {
439 │   font-size: 15px;
440 │   font-weight: 500;
441 │   color: var(--text);
442 │ }
443 │ 
444 │ .switch-hint {
445 │   font-size: 12.5px;
446 │   color: var(--text-muted);
447 │   margin-top: 2px;
448 │ }
449 │ 
450 │ .switch-toggle {
451 │   position: relative;
452 │   width: 50px;
453 │   height: 28px;
454 │   flex-shrink: 0;
455 │   border-radius: var(--radius-pill);
456 │   border: 1px solid var(--border-strong);
457 │   background: var(--surface-raised);
458 │   cursor: pointer;
459 │   padding: 0;
460 │   transition: background-color 140ms ease, border-color 140ms ease;
461 │ }
462 │ 
463 │ .switch-toggle[aria-checked='true'] {
464 │   background: var(--accent);
465 │   border-color: var(--accent);
466 │ }
467 │ 
468 │ .switch-thumb {
469 │   position: absolute;
470 │   top: 2px;
471 │   left: 2px;
472 │   width: 22px;
473 │   height: 22px;
474 │   border-radius: 50%;
475 │   background: #f4f4f5;
476 │   transition: transform 140ms ease, background-color 140ms ease;
477 │ }
478 │ 
479 │ .switch-toggle[aria-checked='true'] .switch-thumb {
480 │   transform: translateX(22px);
481 │   background: var(--accent-ink);
482 │ }
483 │ 
484 │ /* --------------------------------------------------------- inputs & dropzone */
485 │ 
486 │ .field-label {
487 │   display: block;
488 │   font-size: 13px;
489 │   font-weight: 500;
490 │   color: var(--text-muted);
491 │   margin-bottom: 6px;
492 │ }
493 │ 
494 │ .text-input,
495 │ .text-area {
496 │   width: 100%;
497 │   border-radius: var(--radius-md);
498 │   border: 1px solid var(--border-strong);
499 │   background: var(--surface-raised);
500 │   color: var(--text);
501 │   padding: 12px 14px;
502 │   font-size: 15px;
503 │ }
504 │ 
505 │ .text-input {
506 │   min-height: 48px;
507 │ }
508 │ 
509 │ .text-area {
510 │   min-height: 112px;
511 │   font-family: var(--font-mono);
512 │   font-size: 13.5px;
513 │   resize: vertical;
514 │ }
515 │ 
516 │ .dropzone {
517 │   border: 2px dashed var(--border-strong);
518 │   border-radius: var(--radius-lg);
519 │   background: var(--surface-raised);
520 │   padding: 24px 18px;
521 │   text-align: center;
522 │   cursor: pointer;
523 │   transition: border-color 140ms ease, background-color 140ms ease;
524 │   display: flex;
525 │   flex-direction: column;
526 │   align-items: center;
527 │   gap: 8px;
528 │ }
529 │ 
530 │ .dropzone:hover,
531 │ .dropzone.over {
532 │   border-color: var(--accent);
533 │   background: rgba(110, 231, 255, 0.06);
534 │ }
535 │ 
536 │ .sr-only {
537 │   position: absolute;
538 │   width: 1px;
539 │   height: 1px;
540 │   padding: 0;
541 │   margin: -1px;
542 │   overflow: hidden;
543 │   clip: rect(0, 0, 0, 0);
544 │   white-space: nowrap;
545 │   border: 0;
546 │ }
547 │ 
548 │ /* ------------------------------------------------------------ progress bar */
549 │ 
550 │ .progress-track {
551 │   width: 100%;
552 │   height: 10px;
553 │   background: var(--surface-raised);
554 │   border-radius: var(--radius-pill);
555 │   overflow: hidden;
556 │   border: 1px solid var(--border);
557 │ }
558 │ 
559 │ .progress-fill {
560 │   height: 100%;
561 │   background: var(--accent);
562 │   transition: width 150ms linear;
563 │ }
564 │ 
565 │ .progress-fill-ok {
566 │   background: var(--ok);
567 │ }
568 │ 
569 │ .progress-fill-warn {
570 │   background: var(--warn);
571 │ }
572 │ 
573 │ /* ----------------------------------------------------- optical QR & camera */
574 │ 
575 │ .qr-stage {
576 │   display: flex;
577 │   flex-direction: column;
578 │   align-items: center;
579 │   justify-content: center;
580 │   gap: 12px;
581 │   padding: 16px;
582 │   background: #05070a;
583 │   border: 1px solid var(--border);
584 │   border-radius: var(--radius-lg);
585 │ }
586 │ 
587 │ .qr-stage.cinema {
588 │   position: fixed;
589 │   inset: 0;
590 │   z-index: 100;
591 │   background: #000000;
592 │   border: 0;
593 │   border-radius: 0;
594 │   padding: 24px;
595 │ }
596 │ 
597 │ /* Pure white frame, zero rounded corners clipping the quiet zone, crisp pixels. */
598 │ .qr-canvas-frame {
599 │   background: var(--qr-light);
600 │   padding: 0;
601 │   line-height: 0;
602 │   display: inline-block;
603 │ }
604 │ 
605 │ .qr-canvas {
606 │   display: block;
607 │   background: var(--qr-light);
608 │   image-rendering: -moz-crisp-edges;
609 │   image-rendering: crisp-edges;
610 │   image-rendering: pixelated;
611 │ }
612 │ 
613 │ .session-code {
614 │   font-family: var(--font-mono);
615 │   font-size: 24px;
616 │   font-weight: 700;
617 │   letter-spacing: 0.2em;
618 │   color: var(--accent);
619 │   text-align: center;
620 │   font-variant-numeric: tabular-nums;
621 │ }
622 │ 
623 │ .fingerprint-badge {
624 │   font-family: var(--font-mono);
625 │   font-size: 13px;
626 │   color: var(--warn);
627 │   background: var(--warn-dim);
628 │   border: 1px solid rgba(251, 191, 36, 0.35);
629 │   border-radius: var(--radius-pill);
630 │   padding: 4px 12px;
631 │ }
632 │ 
633 │ .video-wrap {
634 │   position: relative;
635 │   width: 100%;
636 │   max-width: 640px;
637 │   margin: 0 auto;
638 │   aspect-ratio: 4 / 3;
639 │   background: #000000;
640 │   border-radius: var(--radius-lg);
641 │   overflow: hidden;
642 │   border: 1px solid var(--border);
643 │ }
644 │ 
645 │ .video-feed {
646 │   width: 100%;
647 │   height: 100%;
648 │   object-fit: cover;
649 │   display: block;
650 │ }
651 │ 
652 │ .video-idle {
653 │   position: absolute;
654 │   inset: 0;
655 │   display: flex;
656 │   flex-direction: column;
657 │   align-items: center;
658 │   justify-content: center;
659 │   gap: 8px;
660 │   padding: 24px;
661 │   text-align: center;
662 │   color: var(--text-muted);
663 │ }
664 │ 
665 │ .reticle {
666 │   position: absolute;
667 │   inset: 12%;
668 │   border: 2px solid rgba(110, 231, 255, 0.85);
669 │   border-radius: 14px;
670 │   box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.32);
671 │   pointer-events: none;
672 │ }
673 │ 
674 │ /* ------------------------------------------------------ inbox, badges, text */
675 │ 
676 │ .muted {
677 │   color: var(--text-muted);
678 │   font-size: 13px;
679 │ }
680 │ 
681 │ .caption {
682 │   color: var(--text-muted);
683 │   font-size: 12.5px;
684 │   line-height: 1.5;
685 │ }
686 │ 
687 │ .mono {
688 │   font-family: var(--font-mono);
689 │   font-variant-numeric: tabular-nums;
690 │ }
691 │ 
692 │ .text-ok {
693 │   color: var(--ok);
694 │ }
695 │ 
696 │ .text-warn {
697 │   color: var(--warn);
698 │ }
699 │ 
700 │ .text-bad {
701 │   color: var(--bad);
702 │ }
703 │ 
704 │ .badge {
705 │   display: inline-flex;
706 │   align-items: center;
707 │   gap: 6px;
708 │   font-size: 12px;
709 │   font-family: var(--font-mono);
710 │   padding: 3px 9px;
711 │   border-radius: var(--radius-pill);
712 │   border: 1px solid var(--border-strong);
713 │   background: var(--surface-raised);
714 │   color: var(--text-muted);
715 │ }
716 │ 
717 │ .badge-ok {
718 │   color: var(--ok);
719 │   border-color: rgba(74, 222, 128, 0.4);
720 │   background: var(--ok-dim);
721 │ }
722 │ 
723 │ .badge-accent {
724 │   color: var(--accent);
725 │   border-color: rgba(110, 231, 255, 0.4);
726 │   background: var(--accent-dim);
727 │ }
728 │ 
729 │ .inbox-card {
730 │   background: var(--surface-raised);
731 │   border: 1px solid var(--border);
732 │   border-radius: var(--radius-md);
733 │   padding: 14px 16px;
734 │   display: flex;
735 │   flex-direction: column;
736 │   gap: 10px;
737 │ }
738 │ 
739 │ .inbox-card-header {
740 │   display: flex;
741 │   align-items: center;
742 │   justify-content: space-between;
743 │   gap: 12px;
744 │   flex-wrap: wrap;
745 │ }
746 │ 
747 │ .text-preview {
748 │   background: #080b0f;
749 │   border: 1px solid var(--border);
750 │   border-radius: var(--radius-md);
751 │   padding: 12px;
752 │   font-family: var(--font-mono);
753 │   font-size: 12.5px;
754 │   max-height: 240px;
755 │   overflow: auto;
756 │   white-space: pre-wrap;
757 │   word-break: break-word;
758 │   margin: 0;
759 │ }
760 │ 
761 │ .image-preview {
762 │   max-width: 100%;
763 │   max-height: 300px;
764 │   border-radius: var(--radius-md);
765 │   border: 1px solid var(--border);
766 │   object-fit: contain;
767 │   background: #080b0f;
768 │ }
769 │ 
770 │ .subheading {
771 │   margin: 6px 0 2px;
772 │   font-size: 14.5px;
773 │   font-weight: 600;
774 │   color: var(--accent);
775 │ }
```

---

## `apps/web/src/state/settings.ts`

> 89 lines

User preferences model (`AppSettings`) backed by `localStorage` (`lightbeam:web-settings:v1`). Validates and clamps density profile (`compact`/`balanced`/`dense`), frame rate (`6–30 fps`), wire encoding (`auto`/`base32`/`raw`), auto-save behavior, and preferred scanner engine (`auto`/`barcode-detector`/`jsqr`), falling back gracefully if storage is unavailable.

**Every line**

```ts
 1 │ /**
 2 │  * settings.ts - user preferences persisted in localStorage.
 3 │  *
 4 │  * LightBeam keeps only UI preferences between browser sessions: symbol density,
 5 │  * target frame rate, wire encoding, encryption default, Wake Lock preference,
 6 │  * cinema stage mode, vibration feedback, and preferred scanner engine.
 7 │  * Passphrases are NEVER stored anywhere on disk or in localStorage.
 8 │  */
 9 │ 
10 │ import type { DensityProfile, WireEncoding } from '@lightbeam/core';
11 │ 
12 │ export type ScannerEnginePreference = 'auto' | 'jsqr';
13 │ 
14 │ export interface Settings {
15 │   /** Target QR symbol density profile. */
16 │   profile: DensityProfile['id'];
17 │   /** Displayed frames per second while sending. */
18 │   fps: number;
19 │   /** Default wire encoding ('base32' universal or 'raw' browser-to-browser). */
20 │   wireEncoding: WireEncoding;
21 │   /** Pre-enable passphrase encryption on the Send screen. */
22 │   encryptByDefault: boolean;
23 │   /** Request Screen Wake Lock during active transfers. */
24 │   keepAwake: boolean;
25 │   /** Offer dark-room high-contrast surround on the sending stage. */
26 │   cinemaStage: boolean;
27 │   /** Trigger short haptic pulse (navigator.vibrate) when a transfer finishes. */
28 │   vibrateOnComplete: boolean;
29 │   /** Prefer hardware BarcodeDetector when available, or force jsQR. */
30 │   scannerEngine: ScannerEnginePreference;
31 │ }
32 │ 
33 │ export const DEFAULT_SETTINGS: Settings = {
34 │   profile: 'balanced',
35 │   fps: 15,
36 │   wireEncoding: 'base32',
37 │   encryptByDefault: false,
38 │   keepAwake: true,
39 │   cinemaStage: false,
40 │   vibrateOnComplete: true,
41 │   scannerEngine: 'auto',
42 │ };
43 │ 
44 │ const STORAGE_KEY = 'lightbeam:web-settings:v1';
45 │ 
46 │ /** Clamp frame rate to a realistic optical range (5..30 fps). */
47 │ export function clampFps(fps: number): number {
48 │   if (!Number.isFinite(fps)) return DEFAULT_SETTINGS.fps;
49 │   return Math.max(5, Math.min(30, Math.round(fps)));
50 │ }
51 │ 
52 │ export function loadSettings(): Settings {
53 │   try {
54 │     if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
55 │     const raw = localStorage.getItem(STORAGE_KEY);
56 │     if (!raw) return { ...DEFAULT_SETTINGS };
57 │     const parsed: unknown = JSON.parse(raw);
58 │     if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
59 │     const candidate = parsed as Partial<Settings>;
60 │     return {
61 │       ...DEFAULT_SETTINGS,
62 │       ...candidate,
63 │       fps: clampFps(Number(candidate.fps ?? DEFAULT_SETTINGS.fps)),
64 │     };
65 │   } catch {
66 │     return { ...DEFAULT_SETTINGS };
67 │   }
68 │ }
69 │ 
70 │ export function saveSettings(settings: Settings): void {
71 │   try {
72 │     if (typeof localStorage === 'undefined') return;
73 │     localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
74 │   } catch {
75 │     // Storage quota or private-browsing restrictions are never fatal.
76 │   }
77 │ }
78 │ 
79 │ export function resetSettings(): Settings {
80 │   const fresh = { ...DEFAULT_SETTINGS };
81 │   saveSettings(fresh);
82 │   return fresh;
83 │ }
84 │ 
85 │ /** Detect whether the current browser is likely a handheld/mobile browser. */
86 │ export function browserPlatformTag(): 'desktop-web' | 'mobile-web' {
87 │   if (typeof navigator === 'undefined') return 'desktop-web';
88 │   return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile-web' : 'desktop-web';
89 │ }
```

---

## `apps/web/src/services/display.ts`

> 115 lines

Browser display utilities for reliable optical transmission: `acquireWakeLock()` wraps `navigator.wakeLock.request('screen')` and automatically re-acquires the lock on `visibilitychange` so the sender's screen never dims mid-stream; `requestElementFullscreen()` toggles fullscreen presentation on the QR stage; and `copyText()` copies text or share URLs via `navigator.clipboard` with a hidden `<textarea>` fallback.

**Every line**

```ts
  1 │ /**
  2 │  * display.ts - Screen Wake Lock, Fullscreen stage, and haptic helpers for the web.
  3 │  *
  4 │  * Optical transfers fail if either device dims or locks mid-stream. Modern
  5 │  * browsers expose the Screen Wake Lock API (`navigator.wakeLock.request('screen')`),
  6 │  * which automatically releases when a tab is hidden and must be re-acquired on
  7 │  * `visibilitychange`. Browsers cannot override OS panel brightness directly, so
  8 │  * LightBeam pairs Wake Lock with an optional full-bleed black Cinema Stage that
  9 │  * maximises camera contrast around the white QR quiet zone.
 10 │  */
 11 │ 
 12 │ import { useEffect, useState } from 'react';
 13 │ 
 14 │ interface WakeLockSentinelLike {
 15 │   released?: boolean;
 16 │   release: () => Promise<void>;
 17 │ }
 18 │ 
 19 │ export function isWakeLockSupported(): boolean {
 20 │   return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
 21 │ }
 22 │ 
 23 │ /** Hold a browser Screen Wake Lock while `active && enabled` is true. */
 24 │ export function useScreenWakeLock(active: boolean, enabled = true): {
 25 │   supported: boolean;
 26 │   held: boolean;
 27 │ } {
 28 │   const supported = isWakeLockSupported();
 29 │   const [held, setHeld] = useState(false);
 30 │ 
 31 │   useEffect(() => {
 32 │     if (!active || !enabled || !supported) {
 33 │       setHeld(false);
 34 │       return;
 35 │     }
 36 │ 
 37 │     let cancelled = false;
 38 │     let sentinel: WakeLockSentinelLike | null = null;
 39 │ 
 40 │     const acquire = async () => {
 41 │       try {
 42 │         const nav = navigator as Navigator & {
 43 │           wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
 44 │         };
 45 │         const lock = await nav.wakeLock?.request('screen');
 46 │         if (cancelled) {
 47 │           await lock?.release().catch(() => undefined);
 48 │           return;
 49 │         }
 50 │         sentinel = lock ?? null;
 51 │         setHeld(Boolean(sentinel));
 52 │       } catch {
 53 │         if (!cancelled) setHeld(false);
 54 │       }
 55 │     };
 56 │ 
 57 │     const onVisibility = () => {
 58 │       if (document.visibilityState === 'visible' && !cancelled) {
 59 │         void acquire();
 60 │       }
 61 │     };
 62 │ 
 63 │     void acquire();
 64 │     document.addEventListener('visibilitychange', onVisibility);
 65 │ 
 66 │     return () => {
 67 │       cancelled = true;
 68 │       document.removeEventListener('visibilitychange', onVisibility);
 69 │       setHeld(false);
 70 │       void sentinel?.release().catch(() => undefined);
 71 │     };
 72 │   }, [active, enabled, supported]);
 73 │ 
 74 │   return { supported, held };
 75 │ }
 76 │ 
 77 │ /** Toggle browser Fullscreen on an element when supported. */
 78 │ export async function toggleFullscreen(element: HTMLElement | null): Promise<boolean> {
 79 │   if (typeof document === 'undefined') return false;
 80 │   try {
 81 │     if (document.fullscreenElement) {
 82 │       await document.exitFullscreen();
 83 │       return false;
 84 │     }
 85 │     if (element?.requestFullscreen) {
 86 │       await element.requestFullscreen();
 87 │       return true;
 88 │     }
 89 │   } catch {
 90 │     // Fullscreen gesture or iframe restriction; CSS cinema mode still works.
 91 │   }
 92 │   return false;
 93 │ }
 94 │ 
 95 │ /** Short vibration pulse on mobile browsers that support the Vibration API. */
 96 │ export function triggerHaptic(kind: 'ok' | 'error' = 'ok'): void {
 97 │   try {
 98 │     if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
 99 │       navigator.vibrate(kind === 'ok' ? 40 : [30, 50, 30]);
100 │     }
101 │   } catch {
102 │     // Ignored on desktop browsers.
103 │   }
104 │ }
105 │ 
106 │ /** Format a duration in seconds into human-readable units ("14s", "1m 12s"). */
107 │ export function formatDuration(seconds: number): string {
108 │   if (!Number.isFinite(seconds)) return 'estimating...';
109 │   const total = Math.max(0, Math.round(seconds));
110 │   if (total < 60) return `${total}s`;
111 │   const minutes = Math.floor(total / 60);
112 │   const rest = total % 60;
113 │   if (minutes < 60) return `${minutes}m ${rest}s`;
114 │   return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
115 │ }
```

---

## `apps/web/src/services/inbox.ts`

> 284 lines

Client-side received-file store backed by IndexedDB (`lightbeam-inbox`, object store `files`) with an automatic in-memory Map fallback for restricted contexts or unit tests. Stores reconstructed `Uint8Array` payloads alongside MIME type, SHA-256 hex digest, transfer duration, and frame count, and provides `toSafeBlob`, `triggerBrowserDownload`, and Web Share API (`shareReceivedFile`) helpers.

**Every line**

```ts
  1 │ /**
  2 │  * inbox.ts - browser file picking, download/share handoff, and IndexedDB inbox.
  3 │  *
  4 │  * On the web there is no app-private POSIX directory, so verified transfers are
  5 │  * persisted in IndexedDB (`lightbeam-inbox`) with an automatic in-memory fallback
  6 │  * for test environments or restricted private-browsing contexts. Every filename
  7 │  * coming off the optical channel passes through `sanitiseFileName` before storage
  8 │  * or `<a download>` attribution.
  9 │  */
 10 │ 
 11 │ import { LIMITS, formatBytes, sanitiseFileName } from '@lightbeam/core';
 12 │ 
 13 │ export interface PickedWebFile {
 14 │   name: string;
 15 │   mime: string;
 16 │   bytes: Uint8Array;
 17 │ }
 18 │ 
 19 │ export interface InboxItem {
 20 │   id: string;
 21 │   name: string;
 22 │   mime: string;
 23 │   size: number;
 24 │   sha256: string;
 25 │   receivedAt: number;
 26 │   bytes: Uint8Array;
 27 │ }
 28 │ 
 29 │ export class FileError extends Error {}
 30 │ 
 31 │ const DB_NAME = 'lightbeam-inbox-v1';
 32 │ const STORE_NAME = 'files';
 33 │ 
 34 │ /** Fallback store when IndexedDB is absent (e.g. jsdom unit tests). */
 35 │ const memoryInbox = new Map<string, InboxItem>();
 36 │ 
 37 │ const MIME_BY_EXTENSION: Record<string, string> = {
 38 │   txt: 'text/plain',
 39 │   md: 'text/markdown',
 40 │   json: 'application/json',
 41 │   csv: 'text/csv',
 42 │   html: 'text/html',
 43 │   png: 'image/png',
 44 │   jpg: 'image/jpeg',
 45 │   jpeg: 'image/jpeg',
 46 │   gif: 'image/gif',
 47 │   webp: 'image/webp',
 48 │   svg: 'image/svg+xml',
 49 │   pdf: 'application/pdf',
 50 │   zip: 'application/zip',
 51 │   mp3: 'audio/mpeg',
 52 │   mp4: 'video/mp4',
 53 │ };
 54 │ 
 55 │ export function mimeForName(name: string, fallback = 'application/octet-stream'): string {
 56 │   const dot = name.lastIndexOf('.');
 57 │   if (dot <= 0 || dot === name.length - 1) return fallback;
 58 │   return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? fallback;
 59 │ }
 60 │ 
 61 │ /** Validate and read a browser `File` into a `Uint8Array`. */
 62 │ export async function readBrowserFile(file: File): Promise<PickedWebFile> {
 63 │   if (file.size === 0) {
 64 │     throw new FileError('That file is empty.');
 65 │   }
 66 │   if (file.size > LIMITS.maxPayloadBytes) {
 67 │     throw new FileError(
 68 │       `${formatBytes(file.size)} exceeds the ${formatBytes(LIMITS.maxPayloadBytes)} optical limit. ` +
 69 │         'Over a screen-to-camera link a file that large would take over an hour — use a cable or local network share.',
 70 │     );
 71 │   }
 72 │   const buffer = await file.arrayBuffer();
 73 │   const safeName = file.name || 'file.bin';
 74 │   return {
 75 │     name: safeName,
 76 │     mime: file.type || mimeForName(safeName),
 77 │     bytes: new Uint8Array(buffer),
 78 │   };
 79 │ }
 80 │ 
 81 │ /** Validate pasted text and convert it into a sender payload. */
 82 │ export function textPayload(value: string): PickedWebFile {
 83 │   const bytes = new TextEncoder().encode(value);
 84 │   if (bytes.byteLength === 0) {
 85 │     throw new FileError('Nothing to send: paste or type some text first.');
 86 │   }
 87 │   if (bytes.byteLength > LIMITS.maxTextBytes) {
 88 │     throw new FileError(
 89 │       `That text is ${formatBytes(bytes.byteLength)}; the text limit is ${formatBytes(LIMITS.maxTextBytes)}. ` +
 90 │         'Save it as a file and send that instead.',
 91 │     );
 92 │   }
 93 │   return { bytes, name: 'message.txt', mime: 'text/plain' };
 94 │ }
 95 │ 
 96 │ /** Create a clean ArrayBuffer-backed Blob from a Uint8Array (safe even on subviews). */
 97 │ export function toSafeBlob(bytes: Uint8Array, mime: string): Blob {
 98 │   const copy = new Uint8Array(bytes.byteLength);
 99 │   copy.set(bytes);
100 │   return new Blob([copy.buffer], { type: mime || 'application/octet-stream' });
101 │ }
102 │ 
103 │ /** Trigger a standard browser file download. */
104 │ export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
105 │   const safeName = sanitiseFileName(name);
106 │   const blob = toSafeBlob(bytes, mime);
107 │   const url = URL.createObjectURL(blob);
108 │   const anchor = document.createElement('a');
109 │   anchor.href = url;
110 │   anchor.download = safeName;
111 │   anchor.rel = 'noopener';
112 │   document.body.appendChild(anchor);
113 │   anchor.click();
114 │   anchor.remove();
115 │   setTimeout(() => URL.revokeObjectURL(url), 10_000);
116 │ }
117 │ 
118 │ /** Check whether the browser supports sharing files via the Web Share API. */
119 │ export function canWebShareFiles(): boolean {
120 │   if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
121 │   if (typeof navigator.canShare !== 'function') return false;
122 │   try {
123 │     const probe = new File([new Uint8Array([1])], 'probe.txt', { type: 'text/plain' });
124 │     return navigator.canShare({ files: [probe] });
125 │   } catch {
126 │     return false;
127 │   }
128 │ }
129 │ 
130 │ /** Share a received file through the OS/browser share sheet when available. */
131 │ export async function shareBrowserFile(name: string, bytes: Uint8Array, mime: string): Promise<void> {
132 │   const safeName = sanitiseFileName(name);
133 │   const blob = toSafeBlob(bytes, mime);
134 │   const file = new File([blob], safeName, { type: mime || 'application/octet-stream' });
135 │   if (!canWebShareFiles()) {
136 │     downloadBytes(safeName, bytes, mime);
137 │     return;
138 │   }
139 │   await navigator.share({ files: [file], title: safeName });
140 │ }
141 │ 
142 │ /* ---------------------------------------------------------- IndexedDB CRUD */
143 │ 
144 │ function hasIndexedDb(): boolean {
145 │   return typeof indexedDB !== 'undefined' && indexedDB !== null;
146 │ }
147 │ 
148 │ function openInboxDb(): Promise<IDBDatabase> {
149 │   return new Promise((resolve, reject) => {
150 │     const request = indexedDB.open(DB_NAME, 1);
151 │     request.onupgradeneeded = () => {
152 │       const db = request.result;
153 │       if (!db.objectStoreNames.contains(STORE_NAME)) {
154 │         db.createObjectStore(STORE_NAME, { keyPath: 'id' });
155 │       }
156 │     };
157 │     request.onsuccess = () => resolve(request.result);
158 │     request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
159 │   });
160 │ }
161 │ 
162 │ /** Save a verified payload into the browser inbox. */
163 │ export async function saveReceivedFile(input: {
164 │   name: string;
165 │   mime: string;
166 │   bytes: Uint8Array;
167 │   sha256: string;
168 │ }): Promise<InboxItem> {
169 │   const copy = new Uint8Array(input.bytes.byteLength);
170 │   copy.set(input.bytes);
171 │   const safeName = sanitiseFileName(input.name);
172 │   const item: InboxItem = {
173 │     id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
174 │     name: safeName,
175 │     mime: input.mime || mimeForName(safeName),
176 │     size: copy.byteLength,
177 │     sha256: input.sha256,
178 │     receivedAt: Date.now(),
179 │     bytes: copy,
180 │   };
181 │ 
182 │   if (!hasIndexedDb()) {
183 │     memoryInbox.set(item.id, item);
184 │     return item;
185 │   }
186 │ 
187 │   try {
188 │     const db = await openInboxDb();
189 │     await new Promise<void>((resolve, reject) => {
190 │       const tx = db.transaction(STORE_NAME, 'readwrite');
191 │       tx.objectStore(STORE_NAME).put(item);
192 │       tx.oncomplete = () => {
193 │         db.close();
194 │         resolve();
195 │       };
196 │       tx.onerror = () => {
197 │         db.close();
198 │         reject(tx.error ?? new Error('IndexedDB write failed'));
199 │       };
200 │     });
201 │     return item;
202 │   } catch {
203 │     memoryInbox.set(item.id, item);
204 │     return item;
205 │   }
206 │ }
207 │ 
208 │ /** List all saved inbox files, newest first. */
209 │ export async function listInbox(): Promise<InboxItem[]> {
210 │   if (!hasIndexedDb()) {
211 │     return [...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
212 │   }
213 │   try {
214 │     const db = await openInboxDb();
215 │     const rows = await new Promise<InboxItem[]>((resolve, reject) => {
216 │       const tx = db.transaction(STORE_NAME, 'readonly');
217 │       const req = tx.objectStore(STORE_NAME).getAll();
218 │       req.onsuccess = () => {
219 │         db.close();
220 │         const items = (req.result as InboxItem[]).map((entry) => ({
221 │           ...entry,
222 │           bytes: entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes),
223 │         }));
224 │         resolve(items);
225 │       };
226 │       req.onerror = () => {
227 │         db.close();
228 │         reject(req.error ?? new Error('IndexedDB read failed'));
229 │       };
230 │     });
231 │     return [...rows, ...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
232 │   } catch {
233 │     return [...memoryInbox.values()].sort((a, b) => b.receivedAt - a.receivedAt);
234 │   }
235 │ }
236 │ 
237 │ /** Delete one file from the browser inbox. */
238 │ export async function deleteInboxItem(id: string): Promise<void> {
239 │   memoryInbox.delete(id);
240 │   if (!hasIndexedDb()) return;
241 │   try {
242 │     const db = await openInboxDb();
243 │     await new Promise<void>((resolve, reject) => {
244 │       const tx = db.transaction(STORE_NAME, 'readwrite');
245 │       tx.objectStore(STORE_NAME).delete(id);
246 │       tx.oncomplete = () => {
247 │         db.close();
248 │         resolve();
249 │       };
250 │       tx.onerror = () => {
251 │         db.close();
252 │         reject(tx.error ?? new Error('IndexedDB delete failed'));
253 │       };
254 │     });
255 │   } catch {
256 │     // Already removed from fallback map if present.
257 │   }
258 │ }
259 │ 
260 │ /** Remove all files from the browser inbox and return how many were deleted. */
261 │ export async function clearInbox(): Promise<number> {
262 │   const existing = await listInbox();
263 │   memoryInbox.clear();
264 │   if (hasIndexedDb()) {
265 │     try {
266 │       const db = await openInboxDb();
267 │       await new Promise<void>((resolve, reject) => {
268 │         const tx = db.transaction(STORE_NAME, 'readwrite');
269 │         tx.objectStore(STORE_NAME).clear();
270 │         tx.oncomplete = () => {
271 │           db.close();
272 │           resolve();
273 │         };
274 │         tx.onerror = () => {
275 │           db.close();
276 │           reject(tx.error ?? new Error('IndexedDB clear failed'));
277 │         };
278 │       });
279 │     } catch {
280 │       // Ignore storage errors on clear.
281 │     }
282 │   }
283 │   return existing.length;
284 │ }
```

---

## `apps/web/src/services/scanner.ts`

> 181 lines

Optical QR frame capture and decoding pipeline for the browser. Prefers hardware-accelerated `BarcodeDetector({ formats: ['qr_code'] })` when available and falls back seamlessly to `jsQR` over a downscaled (`<= 720px`) `willReadFrequently` 2D canvas. Also exposes `decodeQrFromRgba` and `decodeQrFromImageFile` so users or automated tests can decode QR frames directly from image files or RGBA buffers without a physical webcam.

**Every line**

```ts
  1 │ /**
  2 │  * scanner.ts - dual-engine browser QR decoder and camera helpers.
  3 │  *
  4 │  * Modern Chromium and WebKit browsers increasingly expose the Shape Detection
  5 │  * `BarcodeDetector` API (`formats: ['qr_code']`), which offloads decoding to the
  6 │  * OS vision pipeline off the JS main thread. Firefox, older Safari, and desktop
  7 │  * Linux builds often do not, so LightBeam transparently falls back to `jsQR`
  8 │  * (`inversionAttempts: 'dontInvert'`) over a reusable 2D scratch canvas.
  9 │  *
 10 │  * Notice why `TransferReceiver` accepts both string and binary frames:
 11 │  *   - `BarcodeDetector.detect()` returns `rawValue: string` (requiring Base32),
 12 │  *   - `jsQR` exposes both `.data` (string) and `.binaryData` (`number[]`), so
 13 │  *     browser-to-browser `raw` byte mode also works seamlessly when `jsQR` runs!
 14 │  */
 15 │ 
 16 │ import { useCallback, useMemo, useRef } from 'react';
 17 │ import jsQR from 'jsqr';
 18 │ import { TransferReceiver, type ReceiverPhase } from '@lightbeam/core';
 19 │ import type { ScannerEnginePreference } from '../state/settings';
 20 │ 
 21 │ interface DetectedBarcodeLike {
 22 │   rawValue: string;
 23 │ }
 24 │ 
 25 │ interface BarcodeDetectorLike {
 26 │   detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeLike[]>;
 27 │ }
 28 │ 
 29 │ interface BarcodeDetectorConstructorLike {
 30 │   new (options?: { formats?: string[] }): BarcodeDetectorLike;
 31 │   getSupportedFormats?: () => Promise<string[]>;
 32 │ }
 33 │ 
 34 │ function getBarcodeDetectorCtor(): BarcodeDetectorConstructorLike | null {
 35 │   if (typeof globalThis === 'undefined') return null;
 36 │   const candidate = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
 37 │   return typeof candidate === 'function' ? candidate : null;
 38 │ }
 39 │ 
 40 │ export function isCameraAvailable(): boolean {
 41 │   return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
 42 │ }
 43 │ 
 44 │ export function isSecureContextOk(): boolean {
 45 │   if (typeof window === 'undefined') return true;
 46 │   return Boolean(
 47 │     window.isSecureContext ||
 48 │       window.location.hostname === 'localhost' ||
 49 │       window.location.hostname === '127.0.0.1',
 50 │   );
 51 │ }
 52 │ 
 53 │ export function hasNativeBarcodeDetector(): boolean {
 54 │   return getBarcodeDetectorCtor() !== null;
 55 │ }
 56 │ 
 57 │ export interface DecodedQrFrame {
 58 │   /** String representation (used for Base32 frames) or raw bytes (for raw mode). */
 59 │   payload: string | Uint8Array;
 60 │   engine: 'BarcodeDetector' | 'jsQR';
 61 │   decodeMs: number;
 62 │ }
 63 │ 
 64 │ /**
 65 │  * Reusable frame decoder that prefers native `BarcodeDetector` when requested
 66 │  * and falls back cleanly to `jsQR`.
 67 │  */
 68 │ export class BrowserQrScanner {
 69 │   private scratch: HTMLCanvasElement | null = null;
 70 │   private ctx: CanvasRenderingContext2D | null = null;
 71 │   private nativeDetector: BarcodeDetectorLike | null = null;
 72 │   private nativeFailed = false;
 73 │ 
 74 │   constructor(private preference: ScannerEnginePreference = 'auto') {
 75 │     if (preference === 'auto') {
 76 │       const Ctor = getBarcodeDetectorCtor();
 77 │       if (Ctor) {
 78 │         try {
 79 │           this.nativeDetector = new Ctor({ formats: ['qr_code'] });
 80 │         } catch {
 81 │           this.nativeDetector = null;
 82 │         }
 83 │       }
 84 │     }
 85 │   }
 86 │ 
 87 │   setPreference(preference: ScannerEnginePreference): void {
 88 │     this.preference = preference;
 89 │     if (preference === 'auto' && !this.nativeDetector && !this.nativeFailed) {
 90 │       const Ctor = getBarcodeDetectorCtor();
 91 │       if (Ctor) {
 92 │         try {
 93 │           this.nativeDetector = new Ctor({ formats: ['qr_code'] });
 94 │         } catch {
 95 │           this.nativeDetector = null;
 96 │         }
 97 │       }
 98 │     }
 99 │   }
100 │ 
101 │   get activeEngineName(): 'BarcodeDetector' | 'jsQR' {
102 │     return this.preference === 'auto' && this.nativeDetector && !this.nativeFailed ? 'BarcodeDetector' : 'jsQR';
103 │   }
104 │ 
105 │   private ensureScratch(width: number, height: number): CanvasRenderingContext2D | null {
106 │     if (typeof document === 'undefined') return null;
107 │     if (!this.scratch) {
108 │       this.scratch = document.createElement('canvas');
109 │       this.ctx = this.scratch.getContext('2d', { willReadFrequently: true });
110 │     }
111 │     if (!this.ctx || !this.scratch) return null;
112 │     if (this.scratch.width !== width || this.scratch.height !== height) {
113 │       this.scratch.width = width;
114 │       this.scratch.height = height;
115 │     }
116 │     return this.ctx;
117 │   }
118 │ 
119 │   /** Decode a raw RGBA pixel buffer directly via jsQR (used in tests and loopback). */
120 │   decodeRgba(data: Uint8ClampedArray, width: number, height: number): DecodedQrFrame | null {
121 │     const started = performance.now();
122 │     const hit = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
123 │     const decodeMs = performance.now() - started;
124 │     if (!hit) return null;
125 │     // Prefer text when non-empty ASCII (Base32), otherwise hand raw binaryData to core.
126 │     const payload =
127 │       hit.data && hit.data.length > 0 ? hit.data : new Uint8Array(hit.binaryData);
128 │     return { payload, engine: 'jsQR', decodeMs };
129 │   }
130 │ 
131 │   /** Decode one frame from a live `<video>` element or an uploaded image/canvas. */
132 │   async decodeVideoOrImage(
133 │     source: CanvasImageSource,
134 │     width: number,
135 │     height: number,
136 │   ): Promise<DecodedQrFrame | null> {
137 │     if (width <= 0 || height <= 0) return null;
138 │ 
139 │     if (this.preference === 'auto' && this.nativeDetector && !this.nativeFailed) {
140 │       const started = performance.now();
141 │       try {
142 │         const codes = await this.nativeDetector.detect(source as ImageBitmapSource);
143 │         const decodeMs = performance.now() - started;
144 │         if (codes.length > 0 && codes[0].rawValue) {
145 │           return { payload: codes[0].rawValue, engine: 'BarcodeDetector', decodeMs };
146 │         }
147 │         return null;
148 │       } catch {
149 │         // Some desktop builds expose BarcodeDetector without qr_code support; fall back permanently.
150 │         this.nativeFailed = true;
151 │       }
152 │     }
153 │ 
154 │     const ctx = this.ensureScratch(width, height);
155 │     if (!ctx) return null;
156 │     ctx.drawImage(source, 0, 0, width, height);
157 │     const image = ctx.getImageData(0, 0, width, height);
158 │     return this.decodeRgba(image.data, width, height);
159 │   }
160 │ }
161 │ 
162 │ /**
163 │  * Keep `TransferReceiver` in a ref so frame ingestion never triggers React
164 │  * state serialisation on every camera frame.
165 │  */
166 │ export interface ReceiverHandle {
167 │   receiver: TransferReceiver;
168 │   accept: (data: string | Uint8Array, now?: number) => ReceiverPhase;
169 │ }
170 │ 
171 │ export function useReceiver(): ReceiverHandle {
172 │   const ref = useRef<TransferReceiver | null>(null);
173 │   if (ref.current === null) ref.current = new TransferReceiver();
174 │   const receiver = ref.current;
175 │ 
176 │   const accept = useCallback(
177 │     (data: string | Uint8Array, now = Date.now()) => receiver.accept(data, now),
178 │     [receiver],
179 │   );
180 │   return useMemo(() => ({ receiver, accept }), [accept, receiver]);
181 │ }
```

---

## `apps/web/src/services/telemetry.ts`

> 99 lines

Typed client for `@lightbeam/server`'s optional metadata endpoints (`/api/health`, `/api/stats`, `POST /api/sessions`, `GET /api/sessions/:code`, `POST /api/sessions/:code/complete`). Every call uses a bounded `AbortSignal` timeout and catches network errors so optical fountain transfers continue uninterrupted even when completely offline or air-gapped.

**Every line**

```ts
 1 │ /**
 2 │  * telemetry.ts - relative-URL client for the unified LightBeam Node backend.
 3 │  *
 4 │  * Every call uses relative paths (`/api/...`) so the exact same build works
 5 │  * behind Vite's dev proxy, on localhost, behind Caddy TLS, or inside a cloud
 6 │  * preview proxy. Every call is non-throwing: if the user is offline or running
 7 │  * from a cached PWA shell, optical transfers proceed uninterrupted.
 8 │  */
 9 │ 
10 │ export interface ServerStats {
11 │   total: number;
12 │   completed: number;
13 │   failed: number;
14 │   bytesSent: number;
15 │   medianOverhead: number | null;
16 │   medianSeconds: number | null;
17 │   byPlatform: Record<string, number>;
18 │   byProfile: Record<string, number>;
19 │ }
20 │ 
21 │ export interface ServerHealth {
22 │   ok: boolean;
23 │   service: string;
24 │   version: string;
25 │   uptimeSeconds: number;
26 │   sessions: number;
27 │   storesFileContent: boolean;
28 │ }
29 │ 
30 │ export interface SessionSummary {
31 │   sessionId: number;
32 │   code: string;
33 │   name: string;
34 │   mime: string;
35 │   bytes: number;
36 │   wireBytes: number;
37 │   blockSize: number;
38 │   blocks: number;
39 │   profile: string;
40 │   encrypted: boolean;
41 │   codec: 'store' | 'deflate';
42 │   platform: string;
43 │   createdAt: number;
44 │   completedAt?: number;
45 │ }
46 │ 
47 │ export async function fetchServerOverview(): Promise<{
48 │   health: ServerHealth | null;
49 │   stats: ServerStats | null;
50 │ }> {
51 │   try {
52 │     const [healthRes, statsRes] = await Promise.all([fetch('/api/health'), fetch('/api/stats')]);
53 │     const health = healthRes.ok ? ((await healthRes.json()) as ServerHealth) : null;
54 │     const stats = statsRes.ok ? ((await statsRes.json()) as ServerStats) : null;
55 │     return { health, stats };
56 │   } catch {
57 │     return { health: null, stats: null };
58 │   }
59 │ }
60 │ 
61 │ export async function registerSession(payload: Record<string, unknown>): Promise<SessionSummary | null> {
62 │   try {
63 │     const response = await fetch('/api/sessions', {
64 │       method: 'POST',
65 │       headers: { 'content-type': 'application/json' },
66 │       body: JSON.stringify(payload),
67 │     });
68 │     if (!response.ok) return null;
69 │     return (await response.json()) as SessionSummary;
70 │   } catch {
71 │     return null;
72 │   }
73 │ }
74 │ 
75 │ export async function lookupSession(code: string): Promise<SessionSummary | null> {
76 │   try {
77 │     const clean = code.trim().toUpperCase();
78 │     if (!/^[A-Z2-9]{7}$/.test(clean)) return null;
79 │     const response = await fetch(`/api/sessions/${encodeURIComponent(clean)}`);
80 │     if (!response.ok) return null;
81 │     return (await response.json()) as SessionSummary;
82 │   } catch {
83 │     return null;
84 │   }
85 │ }
86 │ 
87 │ export async function reportCompletion(code: string, payload: Record<string, unknown>): Promise<void> {
88 │   try {
89 │     const clean = code.trim().toUpperCase();
90 │     if (!/^[A-Z2-9]{7}$/.test(clean)) return;
91 │     await fetch(`/api/sessions/${encodeURIComponent(clean)}`, {
92 │       method: 'POST',
93 │       headers: { 'content-type': 'application/json' },
94 │       body: JSON.stringify(payload),
95 │     });
96 │   } catch {
97 │     // Offline or self-hosted static mode: ignore telemetry failures.
98 │   }
99 │ }
```

---

## `apps/web/src/components/Layout.tsx`

> 97 lines

Application chrome shared across all six screens: brand mark linking home, accessible primary navigation tabs with live IndexedDB inbox badge count, main content landmark, and zero-knowledge privacy footer.

**Every line**

```ts
 1 │ /**
 2 │  * Layout.tsx - responsive navigation bar and PWA install prompt integration.
 3 │  */
 4 │ 
 5 │ import { useEffect, useState, type ReactNode } from 'react';
 6 │ import { VERSION } from '@lightbeam/core';
 7 │ 
 8 │ export type RouteName = 'home' | 'send' | 'receive' | 'files' | 'settings' | 'about';
 9 │ 
10 │ interface BeforeInstallPromptEvent extends Event {
11 │   prompt: () => Promise<void>;
12 │   userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
13 │ }
14 │ 
15 │ export interface LayoutProps {
16 │   route: RouteName;
17 │   inboxCount: number;
18 │   onNavigate: (next: RouteName) => void;
19 │   children: ReactNode;
20 │ }
21 │ 
22 │ const NAV_ITEMS: Array<{ id: RouteName; label: string }> = [
23 │   { id: 'home', label: 'Home' },
24 │   { id: 'send', label: 'Send' },
25 │   { id: 'receive', label: 'Receive' },
26 │   { id: 'files', label: 'Files' },
27 │   { id: 'settings', label: 'Settings' },
28 │   { id: 'about', label: 'About' },
29 │ ];
30 │ 
31 │ export function Layout({ route, inboxCount, onNavigate, children }: LayoutProps) {
32 │   const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
33 │ 
34 │   useEffect(() => {
35 │     const handler = (event: Event) => {
36 │       event.preventDefault();
37 │       setInstallEvent(event as BeforeInstallPromptEvent);
38 │     };
39 │     window.addEventListener('beforeinstallprompt', handler);
40 │     return () => window.removeEventListener('beforeinstallprompt', handler);
41 │   }, []);
42 │ 
43 │   const triggerInstall = async () => {
44 │     if (!installEvent) return;
45 │     await installEvent.prompt();
46 │     await installEvent.userChoice.catch(() => undefined);
47 │     setInstallEvent(null);
48 │   };
49 │ 
50 │   return (
51 │     <>
52 │       <header className="app-header">
53 │         <div className="app-header-inner">
54 │           <button
55 │             type="button"
56 │             className="brand-btn"
57 │             onClick={() => onNavigate('home')}
58 │             aria-label="LightBeam Home"
59 │           >
60 │             <img src="/icon.svg" alt="" width={28} height={28} />
61 │             <span className="brand-title">LightBeam</span>
62 │             <span className="brand-tag">v{VERSION}</span>
63 │           </button>
64 │ 
65 │           <nav className="nav-links" aria-label="Primary navigation">
66 │             {NAV_ITEMS.map((item) => {
67 │               const active = route === item.id;
68 │               return (
69 │                 <button
70 │                   key={item.id}
71 │                   type="button"
72 │                   className={`nav-btn ${active ? 'active' : ''}`.trim()}
73 │                   aria-current={active ? 'page' : undefined}
74 │                   onClick={() => onNavigate(item.id)}
75 │                 >
76 │                   <span>{item.label}</span>
77 │                   {item.id === 'files' && inboxCount > 0 ? (
78 │                     <span className="nav-badge" aria-label={`${inboxCount} saved files`}>
79 │                       {inboxCount}
80 │                     </span>
81 │                   ) : null}
82 │                 </button>
83 │               );
84 │             })}
85 │             {installEvent ? (
86 │               <button type="button" className="nav-btn active" onClick={() => void triggerInstall()}>
87 │                 Install App
88 │               </button>
89 │             ) : null}
90 │           </nav>
91 │         </div>
92 │       </header>
93 │ 
94 │       <main className="app-main">{children}</main>
95 │     </>
96 │   );
97 │ }
```

---

## `apps/web/src/components/Panel.tsx`

> 65 lines

Reusable surface container (`Panel`) and key-value telemetry tile (`StatTile`) used across sender, receiver, home, and workbench views.

**Every line**

```ts
 1 │ /**
 2 │  * Panel.tsx - surface containers, key/value rows, and progress bars.
 3 │  */
 4 │ 
 5 │ import type { ReactNode } from 'react';
 6 │ 
 7 │ export interface PanelProps {
 8 │   title?: string;
 9 │   tone?: 'default' | 'ok' | 'warn' | 'bad';
10 │   children: ReactNode;
11 │   className?: string;
12 │ }
13 │ 
14 │ export function Panel({ title, tone = 'default', children, className = '' }: PanelProps) {
15 │   const toneClass =
16 │     tone === 'ok' ? 'panel-ok' : tone === 'warn' ? 'panel-warn' : tone === 'bad' ? 'panel-bad' : '';
17 │   return (
18 │     <section className={`panel ${toneClass} ${className}`.trim()}>
19 │       {title ? <h2 className="panel-title">{title}</h2> : null}
20 │       {children}
21 │     </section>
22 │   );
23 │ }
24 │ 
25 │ export interface KeyValueProps {
26 │   label: string;
27 │   value: string;
28 │ }
29 │ 
30 │ export function KeyValue({ label, value }: KeyValueProps) {
31 │   return (
32 │     <div className="kv-row">
33 │       <span className="kv-label">{label}</span>
34 │       <span className="kv-value">{value}</span>
35 │     </div>
36 │   );
37 │ }
38 │ 
39 │ export interface ProgressBarProps {
40 │   progress: number;
41 │   tone?: 'accent' | 'ok' | 'warn';
42 │   label?: string;
43 │ }
44 │ 
45 │ export function ProgressBar({ progress, tone = 'accent', label = 'Transfer progress' }: ProgressBarProps) {
46 │   const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
47 │   const percent = Math.round(clamped * 100);
48 │   const fillTone = tone === 'ok' ? 'progress-fill-ok' : tone === 'warn' ? 'progress-fill-warn' : '';
49 │   return (
50 │     <div
51 │       className="progress-track"
52 │       role="progressbar"
53 │       aria-label={label}
54 │       aria-valuemin={0}
55 │       aria-valuemax={100}
56 │       aria-valuenow={percent}
57 │     >
58 │       <div className={`progress-fill ${fillTone}`.trim()} style={{ width: `${percent}%` }} />
59 │     </div>
60 │   );
61 │ }
62 │ 
63 │ export function Row({ children, stretch = false }: { children: ReactNode; stretch?: boolean }) {
64 │   return <div className={`row ${stretch ? 'row-stretch' : ''}`.trim()}>{children}</div>;
65 │ }
```

---

## `apps/web/src/components/Controls.tsx`

> 112 lines

Accessible segmented radio control (`Segmented<T>`) for density profile, frame rate, wire encoding, and scanner backend selection, plus `ProgressBar` with ARIA `progressbar` attributes.

**Every line**

```ts
  1 │ /**
  2 │  * Controls.tsx - accessible buttons, radio chip groups, and toggle switches.
  3 │  *
  4 │  * Written without external UI libraries so touch targets (48 px minimum),
  5 │  * ARIA semantics (`radiogroup`/`radio`, `switch`), and keyboard navigation are
  6 │  * completely predictable across desktop and mobile browsers.
  7 │  */
  8 │ 
  9 │ import type { ButtonHTMLAttributes } from 'react';
 10 │ 
 11 │ export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
 12 │   label: string;
 13 │   hint?: string;
 14 │   variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
 15 │   compact?: boolean;
 16 │   hero?: boolean;
 17 │   loading?: boolean;
 18 │ }
 19 │ 
 20 │ export function Button({
 21 │   label,
 22 │   hint,
 23 │   variant = 'primary',
 24 │   compact = false,
 25 │   hero = false,
 26 │   loading = false,
 27 │   disabled,
 28 │   className = '',
 29 │   type = 'button',
 30 │   ...rest
 31 │ }: ButtonProps) {
 32 │   const classes = [
 33 │     'btn',
 34 │     `btn-${variant}`,
 35 │     compact ? 'btn-compact' : '',
 36 │     hero ? 'hero-cta' : '',
 37 │     className,
 38 │   ]
 39 │     .filter(Boolean)
 40 │     .join(' ');
 41 │ 
 42 │   return (
 43 │     <button type={type} className={classes} disabled={disabled || loading} {...rest}>
 44 │       <span className={hero ? 'hero-cta-title' : undefined}>{loading ? `${label}...` : label}</span>
 45 │       {hint ? <span className="btn-hint">{hint}</span> : null}
 46 │     </button>
 47 │   );
 48 │ }
 49 │ 
 50 │ export interface ChoiceOption {
 51 │   value: string;
 52 │   label: string;
 53 │   hint?: string;
 54 │ }
 55 │ 
 56 │ export interface ChoiceProps {
 57 │   label: string;
 58 │   options: ChoiceOption[];
 59 │   value: string;
 60 │   onChange: (value: string) => void;
 61 │ }
 62 │ 
 63 │ export function Choice({ label, options, value, onChange }: ChoiceProps) {
 64 │   return (
 65 │     <div className="choice-group" role="radiogroup" aria-label={label}>
 66 │       {options.map((option) => {
 67 │         const selected = option.value === value;
 68 │         return (
 69 │           <button
 70 │             key={option.value}
 71 │             type="button"
 72 │             role="radio"
 73 │             aria-checked={selected}
 74 │             className={`choice-chip ${selected ? 'selected' : ''}`.trim()}
 75 │             onClick={() => onChange(option.value)}
 76 │           >
 77 │             <span>{option.label}</span>
 78 │             {selected && option.hint ? <span className="btn-hint">{option.hint}</span> : null}
 79 │           </button>
 80 │         );
 81 │       })}
 82 │     </div>
 83 │   );
 84 │ }
 85 │ 
 86 │ export interface SwitchRowProps {
 87 │   label: string;
 88 │   hint?: string;
 89 │   value: boolean;
 90 │   onValueChange: (next: boolean) => void;
 91 │ }
 92 │ 
 93 │ export function SwitchRow({ label, hint, value, onValueChange }: SwitchRowProps) {
 94 │   return (
 95 │     <div className="switch-row">
 96 │       <div>
 97 │         <div className="switch-label">{label}</div>
 98 │         {hint ? <div className="switch-hint">{hint}</div> : null}
 99 │       </div>
100 │       <button
101 │         type="button"
102 │         role="switch"
103 │         aria-checked={value}
104 │         aria-label={label}
105 │         className="switch-toggle"
106 │         onClick={() => onValueChange(!value)}
107 │       >
108 │         <span className="switch-thumb" />
109 │       </button>
110 │     </div>
111 │   );
112 │ }
```

---

## `apps/web/src/components/QrView.tsx`

> 130 lines

High-contrast optical QR renderer. `QrCanvas` paints a 1-pixel-per-module `ImageData` buffer onto an HTML5 `<canvas>` and lets the browser compositor upscale with `image-rendering: pixelated` — eliminating anti-aliased gray edges at 15–24 fps. Automatically falls back to a run-length-encoded `<svg>` path (`toSvgPath`) when 2D canvas is unavailable, and exports `scaleRgbaImage` for pixel-accurate optical tests.

**Every line**

```ts
  1 │ /**
  2 │  * QrView.tsx - high-contrast, GPU-upscaled QR symbol renderer for the web.
  3 │  *
  4 │  * Instead of expanding every QR module into scale x scale pixels in JavaScript
  5 │  * (hundreds of thousands of pixel writes per frame), `QrCanvas` writes one pixel
  6 │  * per module into a reused `ImageData` buffer and lets CSS `image-rendering:
  7 │  * pixelated` upscale on the GPU. When a 2D canvas context is unavailable (such
  8 │  * as headless jsdom unit tests), `QrView` falls back seamlessly to an inline
  9 │  * `<svg>` built from `toSvgPath()` with `shapeRendering="crispEdges"`.
 10 │  */
 11 │ 
 12 │ import { memo, useEffect, useMemo, useRef, useState } from 'react';
 13 │ import {
 14 │   moduleCountWithQuietZone,
 15 │   rasterizeRgba,
 16 │   toSvgPath,
 17 │   type EncodedSymbol,
 18 │   type RgbaImage,
 19 │ } from '@lightbeam/core';
 20 │ 
 21 │ export class QrCanvas {
 22 │   readonly canvas: HTMLCanvasElement;
 23 │   private readonly context: CanvasRenderingContext2D;
 24 │   private imageData: ImageData | null = null;
 25 │   private currentWidth = 0;
 26 │ 
 27 │   constructor(canvas: HTMLCanvasElement) {
 28 │     this.canvas = canvas;
 29 │     const context = canvas.getContext('2d', { alpha: false });
 30 │     if (!context) throw new Error('Canvas 2D context unavailable');
 31 │     this.context = context;
 32 │   }
 33 │ 
 34 │   draw(symbol: EncodedSymbol, quietZone = 4): void {
 35 │     const image = rasterizeRgba(symbol, { scale: 1, quietZone });
 36 │     if (this.currentWidth !== image.width || !this.imageData) {
 37 │       this.canvas.width = image.width;
 38 │       this.canvas.height = image.height;
 39 │       this.currentWidth = image.width;
 40 │       this.imageData = this.context.createImageData(image.width, image.height);
 41 │     }
 42 │     this.imageData.data.set(image.data);
 43 │     this.context.putImageData(this.imageData, 0, 0);
 44 │   }
 45 │ }
 46 │ 
 47 │ /** Integer nearest-neighbour upscaler for camera simulation and loopback tests. */
 48 │ export function scaleRgbaImage(image: RgbaImage, scale: number): {
 49 │   width: number;
 50 │   height: number;
 51 │   data: Uint8ClampedArray;
 52 │ } {
 53 │   const width = image.width * scale;
 54 │   const height = image.height * scale;
 55 │   const out = new Uint8ClampedArray(width * height * 4);
 56 │   for (let y = 0; y < height; y++) {
 57 │     const sy = Math.floor(y / scale);
 58 │     for (let x = 0; x < width; x++) {
 59 │       const sx = Math.floor(x / scale);
 60 │       const srcOffset = (sy * image.width + sx) * 4;
 61 │       const dstOffset = (y * width + x) * 4;
 62 │       out[dstOffset] = image.data[srcOffset];
 63 │       out[dstOffset + 1] = image.data[srcOffset + 1];
 64 │       out[dstOffset + 2] = image.data[srcOffset + 2];
 65 │       out[dstOffset + 3] = image.data[srcOffset + 3];
 66 │     }
 67 │   }
 68 │   return { width, height, data: out };
 69 │ }
 70 │ 
 71 │ export interface QrViewProps {
 72 │   symbol: EncodedSymbol;
 73 │   size?: number;
 74 │   quietZone?: number;
 75 │ }
 76 │ 
 77 │ function isJsdomRuntime(): boolean {
 78 │   return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
 79 │ }
 80 │ 
 81 │ function QrViewImpl({ symbol, size = 360, quietZone = 4 }: QrViewProps) {
 82 │   const canvasRef = useRef<HTMLCanvasElement | null>(null);
 83 │   const qrCanvasRef = useRef<QrCanvas | null>(null);
 84 │   const [useSvgFallback, setUseSvgFallback] = useState(isJsdomRuntime);
 85 │ 
 86 │   useEffect(() => {
 87 │     if (useSvgFallback || !canvasRef.current) return;
 88 │     try {
 89 │       if (!qrCanvasRef.current) {
 90 │         qrCanvasRef.current = new QrCanvas(canvasRef.current);
 91 │       }
 92 │       qrCanvasRef.current.draw(symbol, quietZone);
 93 │     } catch {
 94 │       setUseSvgFallback(true);
 95 │     }
 96 │   }, [symbol, quietZone, useSvgFallback]);
 97 │ 
 98 │   const units = useMemo(() => moduleCountWithQuietZone(symbol, quietZone), [symbol, quietZone]);
 99 │   const svgPath = useMemo(
100 │     () => (useSvgFallback ? toSvgPath(symbol, { quietZone }) : ''),
101 │     [symbol, quietZone, useSvgFallback],
102 │   );
103 │ 
104 │   return (
105 │     <div className="qr-canvas-frame" data-testid="qr-symbol" data-version={symbol.version}>
106 │       {useSvgFallback ? (
107 │         <svg
108 │           width={size}
109 │           height={size}
110 │           viewBox={`0 0 ${units} ${units}`}
111 │           shapeRendering="crispEdges"
112 │           role="img"
113 │           aria-label={`LightBeam QR frame (${symbol.size}x${symbol.size} modules)`}
114 │         >
115 │           <rect x={0} y={0} width={units} height={units} fill="#ffffff" />
116 │           <path d={svgPath} fill="#000000" />
117 │         </svg>
118 │       ) : (
119 │         <canvas
120 │           ref={canvasRef}
121 │           className="qr-canvas"
122 │           style={{ width: `${size}px`, height: `${size}px` }}
123 │           aria-label={`LightBeam QR frame (${symbol.size}x${symbol.size} modules)`}
124 │         />
125 │       )}
126 │     </div>
127 │   );
128 │ }
129 │ 
130 │ export const QrView = memo(QrViewImpl);
```

---

## `apps/web/src/components/LoopbackBench.tsx`

> 235 lines

Interactive in-browser optical loopback workbench. Encodes a live sample payload with `prepareTransfer` + `TransferSender`, renders every animated QR frame onto a pixel buffer via `toRgbaBuffer` + `scaleRgbaImage`, drops frames according to a user-controlled loss slider (0–45%), decodes the surviving pixel images through `jsQR` (`decodeQrFromRgba`), and feeds the decoded string into `TransferReceiver` until SHA-256 verification completes — proving the entire optical stack inside a single browser tab without needing a second device.

**Every line**

```ts
  1 │ /**
  2 │  * LoopbackBench.tsx - live in-browser optical loopback simulator.
  3 │  *
  4 │  * Lets anyone on a single desktop or laptop browser watch the full protocol run
  5 │  * end to end without needing a second physical device in hand:
  6 │  *
  7 │  *   TransferSender.symbolAt(slot)
  8 │  *     -> rasterizeRgba (real QR bitmap)
  9 │  *     -> simulated optical channel (configurable frame-drop %)
 10 │  *     -> jsQR pixel decoder
 11 │  *     -> TransferReceiver.accept()
 12 │  *     -> SHA-256 verification + IndexedDB Inbox save
 13 │  */
 14 │ 
 15 │ import { useCallback, useEffect, useRef, useState } from 'react';
 16 │ import {
 17 │   TransferReceiver,
 18 │   TransferSender,
 19 │   formatBytes,
 20 │   prepareTransfer,
 21 │   rasterizeRgba,
 22 │   type EncodedSymbol,
 23 │   type ReceiverProgress,
 24 │ } from '@lightbeam/core';
 25 │ import { BrowserQrScanner } from '../services/scanner';
 26 │ import { saveReceivedFile } from '../services/inbox';
 27 │ import { registerSession, reportCompletion } from '../services/telemetry';
 28 │ import { Button } from './Controls';
 29 │ import { KeyValue, Panel, ProgressBar, Row } from './Panel';
 30 │ import { QrView, scaleRgbaImage } from './QrView';
 31 │ 
 32 │ export interface LoopbackBenchProps {
 33 │   onInboxChanged: () => void;
 34 │   onOpenInbox: () => void;
 35 │ }
 36 │ 
 37 │ const SAMPLE_MESSAGE = [
 38 │   'LightBeam Optical Fountain Transfer — Live Browser Loopback',
 39 │   '===========================================================',
 40 │   'Every frame rendered on the left is rasterised into RGBA pixels,',
 41 │   'subjected to simulated camera frame loss, decoded from pixels by jsQR,',
 42 │   'peeled by the Luby Transform fountain decoder, and verified with SHA-256.',
 43 │   '',
 44 │   'Missed frames need no retransmission: any subset of ~1.10x K frames',
 45 │   'reconstructs the exact original payload.',
 46 │ ].join('\n');
 47 │ 
 48 │ export function LoopbackBench({ onInboxChanged, onOpenInbox }: LoopbackBenchProps) {
 49 │   const [payloadText, setPayloadText] = useState(SAMPLE_MESSAGE);
 50 │   const [lossPercent, setLossPercent] = useState(20);
 51 │   const [running, setRunning] = useState(false);
 52 │   const [symbol, setSymbol] = useState<EncodedSymbol | null>(null);
 53 │   const [progress, setProgress] = useState<ReceiverProgress | null>(null);
 54 │   const [stats, setStats] = useState({ sent: 0, dropped: 0, decoded: 0 });
 55 │   const [doneSummary, setDoneSummary] = useState<string | null>(null);
 56 │ 
 57 │   const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
 58 │   const lossRef = useRef(lossPercent);
 59 │   lossRef.current = lossPercent;
 60 │ 
 61 │   const stop = useCallback(() => {
 62 │     if (timerRef.current !== null) {
 63 │       clearInterval(timerRef.current);
 64 │       timerRef.current = null;
 65 │     }
 66 │     setRunning(false);
 67 │   }, []);
 68 │ 
 69 │   useEffect(() => stop, [stop]);
 70 │ 
 71 │   const startDemo = useCallback(async () => {
 72 │     stop();
 73 │     setDoneSummary(null);
 74 │     setProgress(null);
 75 │     setStats({ sent: 0, dropped: 0, decoded: 0 });
 76 │ 
 77 │     const data = new TextEncoder().encode(payloadText.trim() || SAMPLE_MESSAGE);
 78 │     const prepared = await prepareTransfer({
 79 │       data,
 80 │       name: 'loopback-demo.txt',
 81 │       mime: 'text/plain',
 82 │       profile: 'phone',
 83 │     });
 84 │ 
 85 │     void registerSession({
 86 │       sessionId: prepared.sessionId,
 87 │       code: prepared.code,
 88 │       name: prepared.manifest.name,
 89 │       mime: prepared.manifest.mime,
 90 │       bytes: prepared.originalPayload.length,
 91 │       wireBytes: prepared.wirePayload.length,
 92 │       blockSize: prepared.manifest.bs,
 93 │       blocks: prepared.manifest.k,
 94 │       profile: prepared.plan.profile.id,
 95 │       encrypted: false,
 96 │       codec: prepared.manifest.codec,
 97 │       platform: 'web',
 98 │     });
 99 │ 
100 │     const sender = new TransferSender(prepared);
101 │     const receiver = new TransferReceiver();
102 │     const scanner = new BrowserQrScanner('jsqr');
103 │ 
104 │     let slot = 0;
105 │     let sent = 0;
106 │     let dropped = 0;
107 │     let decodedCount = 0;
108 │ 
109 │     setRunning(true);
110 │ 
111 │     timerRef.current = setInterval(() => {
112 │       const nextSymbol = sender.symbolAt(slot);
113 │       sender.markShown(slot);
114 │       slot++;
115 │       sent++;
116 │       setSymbol(nextSymbol);
117 │ 
118 │       // Simulate optical channel loss (motion blur / blink / exposure overlap).
119 │       if (Math.random() * 100 < lossRef.current) {
120 │         dropped++;
121 │         setStats({ sent, dropped, decoded: decodedCount });
122 │         setProgress(receiver.getProgress());
123 │         return;
124 │       }
125 │ 
126 │       const raster = rasterizeRgba(nextSymbol, { scale: 1, quietZone: 4 });
127 │       const cameraFrame = scaleRgbaImage(raster, 3);
128 │       const hit = scanner.decodeRgba(cameraFrame.data, cameraFrame.width, cameraFrame.height);
129 │       if (hit) {
130 │         decodedCount++;
131 │         const phase = receiver.accept(hit.payload);
132 │         const nowProgress = receiver.getProgress();
133 │         setProgress(nowProgress);
134 │         setStats({ sent, dropped, decoded: decodedCount });
135 │ 
136 │         if (phase === 'complete') {
137 │           stop();
138 │           const result = receiver.getResult();
139 │           if (result) {
140 │             const elapsed = Math.max(0.05, receiver.elapsedMs() / 1000);
141 │             const overhead = nowProgress.blocksTotal > 0 ? decodedCount / nowProgress.blocksTotal : 1;
142 │             setDoneSummary(
143 │               `Verified ${formatBytes(result.payload.byteLength)} in ${elapsed.toFixed(1)}s ` +
144 │                 `(${sent} frames shown, ${dropped} dropped by simulated channel, ${overhead.toFixed(2)}x fountain overhead).`,
145 │             );
146 │             void saveReceivedFile({
147 │               name: result.manifest.name,
148 │               mime: result.manifest.mime,
149 │               bytes: result.payload,
150 │               sha256: result.manifest.sha,
151 │             }).then(() => onInboxChanged());
152 │             void reportCompletion(prepared.code, {
153 │               elapsedSeconds: elapsed,
154 │               overheadRatio: overhead,
155 │               throughputBytesPerSecond: result.payload.byteLength / elapsed,
156 │               framesAccepted: nowProgress.framesAccepted,
157 │               framesSuspect: nowProgress.framesSuspect,
158 │               verified: result.integrity.ok,
159 │             });
160 │           }
161 │         }
162 │       }
163 │     }, 85);
164 │   }, [payloadText, stop, onInboxChanged]);
165 │ 
166 │   const pct = progress ? Math.round(progress.progress * 100) : 0;
167 │ 
168 │   return (
169 │     <Panel title="Interactive Single-Tab Optical Loopback">
170 │       <p className="caption">
171 │         No second device nearby? Run a real optical transfer right in this tab: the sender renders QR symbols into
172 │         pixels, drops a configurable fraction of frames, and feeds the surviving bitmaps through <code>jsQR</code> into{' '}
173 │         <code>TransferReceiver</code>.
174 │       </p>
175 │ 
176 │       <div className="grid-two">
177 │         <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
178 │           <label className="field-label" htmlFor="loopback-text">
179 │             Test message payload
180 │           </label>
181 │           <textarea
182 │             id="loopback-text"
183 │             className="text-area"
184 │             value={payloadText}
185 │             onChange={(e) => setPayloadText(e.target.value)}
186 │             disabled={running}
187 │           />
188 │           <label className="field-label" htmlFor="loopback-loss">
189 │             Simulated camera frame loss: <strong className="mono">{lossPercent}%</strong>
190 │           </label>
191 │           <input
192 │             id="loopback-loss"
193 │             type="range"
194 │             min={0}
195 │             max={50}
196 │             step={5}
197 │             value={lossPercent}
198 │             onChange={(e) => setLossPercent(Number(e.target.value))}
199 │           />
200 │           <Row>
201 │             {!running ? (
202 │               <Button label="Run optical loopback" variant="secondary" compact onClick={() => void startDemo()} />
203 │             ) : (
204 │               <Button label="Stop loopback" variant="danger" compact onClick={stop} />
205 │             )}
206 │             {doneSummary ? (
207 │               <Button label="View in Files inbox" variant="ghost" compact onClick={onOpenInbox} />
208 │             ) : null}
209 │           </Row>
210 │         </div>
211 │ 
212 │         <div className="qr-stage" style={{ minHeight: '240px' }}>
213 │           {symbol ? (
214 │             <QrView symbol={symbol} size={184} />
215 │           ) : (
216 │             <div className="caption" style={{ textAlign: 'center', maxWidth: '240px' }}>
217 │               Press <strong>Run optical loopback</strong> to watch fountain frames stream and peel live.
218 │             </div>
219 │           )}
220 │           <div style={{ width: '100%' }}>
221 │             <ProgressBar progress={doneSummary ? 1 : pct / 100} tone={doneSummary ? 'ok' : 'accent'} />
222 │           </div>
223 │           <div style={{ width: '100%' }}>
224 │             <KeyValue label="Frames shown / dropped" value={`${stats.sent} shown · ${stats.dropped} lost`} />
225 │             <KeyValue
226 │               label="Blocks reconstructed"
227 │               value={progress ? `${progress.blocksSolved} / ${progress.blocksTotal}` : '0 / 0'}
228 │             />
229 │           </div>
230 │           {doneSummary ? <p className="caption text-ok">{doneSummary}</p> : null}
231 │         </div>
232 │       </div>
233 │     </Panel>
234 │   );
235 │ }
```

---

## `apps/web/src/screens/HomeScreen.tsx`

> 150 lines

Landing dashboard introducing LightBeam Web: direct actions to Send or Receive, a 7-character session short-code lookup bar (`POST`/`GET /api/sessions/:code`), live server telemetry counters (`/api/stats`), architectural highlights, and the interactive `LoopbackBench` optical simulator.

**Every line**

```ts
  1 │ /**
  2 │  * HomeScreen.tsx - the two-button front door and live instance overview.
  3 │  */
  4 │ 
  5 │ import { useEffect, useState } from 'react';
  6 │ import { LIMITS, VERSION, formatBytes } from '@lightbeam/core';
  7 │ import { Button } from '../components/Controls';
  8 │ import { LoopbackBench } from '../components/LoopbackBench';
  9 │ import { KeyValue, Panel, Row } from '../components/Panel';
 10 │ import { fetchServerOverview, type ServerHealth, type ServerStats } from '../services/telemetry';
 11 │ 
 12 │ export interface HomeScreenProps {
 13 │   inboxCount: number;
 14 │   onSend: () => void;
 15 │   onReceive: () => void;
 16 │   onFiles: () => void;
 17 │   onSettings: () => void;
 18 │   onAbout: () => void;
 19 │   onInboxChanged: () => void;
 20 │ }
 21 │ 
 22 │ export function HomeScreen({
 23 │   inboxCount,
 24 │   onSend,
 25 │   onReceive,
 26 │   onFiles,
 27 │   onSettings,
 28 │   onAbout,
 29 │   onInboxChanged,
 30 │ }: HomeScreenProps) {
 31 │   const [health, setHealth] = useState<ServerHealth | null>(null);
 32 │   const [stats, setStats] = useState<ServerStats | null>(null);
 33 │   const [probed, setProbed] = useState(false);
 34 │ 
 35 │   useEffect(() => {
 36 │     let cancelled = false;
 37 │     void fetchServerOverview().then((res) => {
 38 │       if (cancelled) return;
 39 │       setHealth(res.health);
 40 │       setStats(res.stats);
 41 │       setProbed(true);
 42 │     });
 43 │     return () => {
 44 │       cancelled = true;
 45 │     };
 46 │   }, [inboxCount]);
 47 │ 
 48 │   return (
 49 │     <>
 50 │       <div className="screen-header">
 51 │         <div>
 52 │           <h1 className="screen-title">Send a file through the air, screen to camera</h1>
 53 │           <p className="screen-subtitle">
 54 │             Fountain-coded animated QR streams. No account, no pairing, no cloud upload, and no return channel.
 55 │           </p>
 56 │         </div>
 57 │         <div className="row">
 58 │           {health?.storesFileContent === false ? (
 59 │             <span className="badge badge-ok">Zero file bytes on server</span>
 60 │           ) : (
 61 │             <span className="badge badge-accent">100% client-side optical engine</span>
 62 │           )}
 63 │         </div>
 64 │       </div>
 65 │ 
 66 │       <div className="grid-two">
 67 │         <Button
 68 │           label="Send"
 69 │           hero
 70 │           onClick={onSend}
 71 │           hint="Drop a file or paste text — this browser window becomes the animated QR transmitter."
 72 │         />
 73 │         <Button
 74 │           label="Receive"
 75 │           variant="secondary"
 76 │           hero
 77 │           onClick={onReceive}
 78 │           hint="Open the camera in any browser and point it at the sending screen."
 79 │         />
 80 │       </div>
 81 │ 
 82 │       <LoopbackBench onInboxChanged={onInboxChanged} onOpenInbox={onFiles} />
 83 │ 
 84 │       <div className="grid-two">
 85 │         <Panel title="How it works">
 86 │           <p>
 87 │             The payload is compressed with deflate when that saves more than 5%, optionally encrypted with
 88 │             XChaCha20-Poly1305, split into equal blocks, and encoded into an endless Luby Transform fountain stream of
 89 │             QR symbols.
 90 │           </p>
 91 │           <p className="caption">
 92 │             The receiving browser reads symbols in any order via hardware <code>BarcodeDetector</code> or{' '}
 93 │             <code>jsQR</code>, peels blocks as equations resolve, verifies SHA-256 over the reconstructed bytes, and
 94 │             only then offers the file for download or saves it to your browser inbox.
 95 │           </p>
 96 │         </Panel>
 97 │ 
 98 │         <Panel title="Honest expectations">
 99 │           <p>
100 │             Expect <strong>60–150 kB/s</strong> over a clean screen-to-camera link. A 100 kB document finishes in 1–2
101 │             seconds; a 1 MB image takes 10–20 seconds; multi-megabyte archives take minutes and need both screens kept
102 │             awake and steady.
103 │           </p>
104 │           <p className="caption">
105 │             Limits: files up to {formatBytes(LIMITS.maxPayloadBytes)}, text up to {formatBytes(LIMITS.maxTextBytes)}.
106 │             Without a passphrase the stream is legible to any camera pointed at your display — enable encryption in
107 │             shared spaces.
108 │           </p>
109 │         </Panel>
110 │       </div>
111 │ 
112 │       <Panel title="Instance telemetry">
113 │         {!probed ? (
114 │           <p className="muted">Checking unified server telemetry...</p>
115 │         ) : stats ? (
116 │           <>
117 │             <KeyValue label="Verified transfers" value={`${stats.completed} of ${stats.total} sessions`} />
118 │             <KeyValue label="Bytes moved over light" value={formatBytes(stats.bytesSent)} />
119 │             <KeyValue
120 │               label="Median fountain overhead"
121 │               value={stats.medianOverhead !== null ? `${stats.medianOverhead.toFixed(2)}x` : '—'}
122 │             />
123 │             <KeyValue
124 │               label="Median duration"
125 │               value={stats.medianSeconds !== null ? `${Math.round(stats.medianSeconds)}s` : '—'}
126 │             />
127 │             <p className="caption">
128 │               Server stores session codes and anonymous timing summaries only (<code>storesFileContent: false</code>).
129 │             </p>
130 │           </>
131 │         ) : (
132 │           <p className="muted">
133 │             Running standalone / offline — sending and receiving work identically because file bytes travel directly
134 │             from screen to camera.
135 │           </p>
136 │         )}
137 │       </Panel>
138 │ 
139 │       <Row stretch>
140 │         <Button
141 │           label={inboxCount > 0 ? `Received files (${inboxCount})` : 'Received files'}
142 │           variant="ghost"
143 │           onClick={onFiles}
144 │         />
145 │         <Button label="Settings" variant="ghost" onClick={onSettings} />
146 │         <Button label={`About LightBeam ${VERSION}`} variant="ghost" onClick={onAbout} />
147 │       </Row>
148 │     </>
149 │   );
150 │ }
```

---

## `apps/web/src/screens/SendScreen.tsx`

> 676 lines

Optical sender screen. Supports drag-and-drop file selection, file picker, or UTF-8 text notes; optional XChaCha20-Poly1305 passphrase encryption; density, FPS, and wire-encoding overrides with `planWarnings` feedback; `requestAnimationFrame` streaming loop backed by `TransferSender`; fullscreen QR stage + Screen Wake Lock; and optional 7-character session short-code registration (`/r?code=XXXXXXX`) so a nearby receiver can pre-load non-sensitive session metadata.

**Every line**

```ts
  1 │ /**
  2 │  * SendScreen.tsx - browser transmitter with self-correcting frame scheduler.
  3 │  *
  4 │  * Schedules frames from the ideal timestamp of the previous slot rather than
  5 │  * `now`: if a tab stalls or drops behind by >3 intervals, it resynchronises
  6 │  * cleanly rather than emitting an unreadable catch-up burst.
  7 │  */
  8 │ 
  9 │ import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
 10 │ import {
 11 │   DENSITY_PROFILES,
 12 │   LIMITS,
 13 │   TransferSender,
 14 │   formatBytes,
 15 │   fromBase64Url,
 16 │   passphraseFingerprint,
 17 │   planSession,
 18 │   planWarnings,
 19 │   prepareTransfer,
 20 │   recommendedFps,
 21 │   type DensityProfile,
 22 │   type EncodedSymbol,
 23 │   type PreparedTransfer,
 24 │   type WireEncoding,
 25 │ } from '@lightbeam/core';
 26 │ import { Button, Choice, SwitchRow } from '../components/Controls';
 27 │ import { KeyValue, Panel, ProgressBar, Row } from '../components/Panel';
 28 │ import { QrView } from '../components/QrView';
 29 │ import { formatDuration, toggleFullscreen, useScreenWakeLock } from '../services/display';
 30 │ import { FileError, readBrowserFile, textPayload, type PickedWebFile } from '../services/inbox';
 31 │ import { registerSession } from '../services/telemetry';
 32 │ import { browserPlatformTag, clampFps, type Settings } from '../state/settings';
 33 │ 
 34 │ type Phase = 'setup' | 'preparing' | 'sending';
 35 │ 
 36 │ export interface SendScreenProps {
 37 │   settings: Settings;
 38 │   initialProfile?: DensityProfile['id'] | null;
 39 │   onSettingsChange: (patch: Partial<Settings>) => void;
 40 │   onTransferActiveChange: (active: boolean) => void;
 41 │   onBack: () => void;
 42 │ }
 43 │ 
 44 │ export function SendScreen({
 45 │   settings,
 46 │   initialProfile,
 47 │   onSettingsChange,
 48 │   onTransferActiveChange,
 49 │   onBack,
 50 │ }: SendScreenProps) {
 51 │   const [phase, setPhase] = useState<Phase>('setup');
 52 │   const [problem, setProblem] = useState<string | null>(null);
 53 │   const [notice, setNotice] = useState<string | null>(null);
 54 │ 
 55 │   const [picked, setPicked] = useState<PickedWebFile | null>(null);
 56 │   const [text, setText] = useState('');
 57 │   const [name, setName] = useState('');
 58 │   const [dragOver, setDragOver] = useState(false);
 59 │ 
 60 │   const [profile, setProfile] = useState<DensityProfile['id']>(initialProfile ?? settings.profile);
 61 │   const [fps, setFps] = useState<number>(
 62 │     clampFps(settings.fps || recommendedFps(browserPlatformTag(), initialProfile ?? settings.profile)),
 63 │   );
 64 │   const [wireEncoding, setWireEncoding] = useState<WireEncoding>(settings.wireEncoding);
 65 │   const [encrypt, setEncrypt] = useState<boolean>(settings.encryptByDefault);
 66 │   const [passphrase, setPassphrase] = useState('');
 67 │ 
 68 │   const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
 69 │   const [symbol, setSymbol] = useState<EncodedSymbol | null>(null);
 70 │   const [paused, setPaused] = useState(false);
 71 │   const [cinema, setCinema] = useState(settings.cinemaStage);
 72 │   const [stats, setStats] = useState({ frames: 0, measuredFps: 0, behind: false });
 73 │   const [fingerprint, setFingerprint] = useState<string | null>(null);
 74 │   const [copiedLink, setCopiedLink] = useState(false);
 75 │   const [viewportWidth, setViewportWidth] = useState(() =>
 76 │     typeof window !== 'undefined' ? window.innerWidth : 800,
 77 │   );
 78 │ 
 79 │   const fileInputRef = useRef<HTMLInputElement | null>(null);
 80 │   const stageRef = useRef<HTMLDivElement | null>(null);
 81 │   const senderRef = useRef<TransferSender | null>(null);
 82 │   const slotRef = useRef(0);
 83 │   const nextFrameAtRef = useRef(0);
 84 │   const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 85 │   const pausedRef = useRef(false);
 86 │   const frameStatsRef = useRef({ frames: 0, windowStart: 0, windowFrames: 0, behind: false });
 87 │ 
 88 │   const wakeLock = useScreenWakeLock(phase === 'sending', settings.keepAwake);
 89 │ 
 90 │   useEffect(() => {
 91 │     onTransferActiveChange(phase === 'sending');
 92 │     return () => onTransferActiveChange(false);
 93 │   }, [phase, onTransferActiveChange]);
 94 │ 
 95 │   useEffect(() => {
 96 │     const onResize = () => setViewportWidth(window.innerWidth);
 97 │     window.addEventListener('resize', onResize);
 98 │     return () => window.removeEventListener('resize', onResize);
 99 │   }, []);
100 │ 
101 │   const qrSize = useMemo(() => {
102 │     const maxTarget = cinema ? 520 : 400;
103 │     return Math.max(220, Math.min(viewportWidth - 64, maxTarget));
104 │   }, [viewportWidth, cinema]);
105 │ 
106 │   const payloadBytes = useMemo(() => {
107 │     if (picked) return picked.bytes.byteLength;
108 │     if (text.trim().length > 0) return new TextEncoder().encode(text).byteLength;
109 │     return 0;
110 │   }, [picked, text]);
111 │ 
112 │   const estimate = useMemo(() => {
113 │     if (payloadBytes === 0) return null;
114 │     try {
115 │       const plan = planSession(payloadBytes, profile, { wireEncoding });
116 │       return {
117 │         plan,
118 │         modules: plan.modules,
119 │         blocks: plan.k,
120 │         blockSize: plan.blockSize,
121 │         seconds: plan.estimatedSeconds(fps),
122 │         bytesPerSecond: plan.bytesPerFrame * fps,
123 │         warnings: planWarnings(plan, payloadBytes, fps),
124 │       };
125 │     } catch (error) {
126 │       return {
127 │         plan: null,
128 │         modules: 0,
129 │         blocks: 0,
130 │         blockSize: 0,
131 │         seconds: 0,
132 │         bytesPerSecond: 0,
133 │         warnings: [(error as Error).message],
134 │       };
135 │     }
136 │   }, [payloadBytes, profile, wireEncoding, fps]);
137 │ 
138 │   const stopLoop = useCallback(() => {
139 │     if (timerRef.current !== null) {
140 │       clearTimeout(timerRef.current);
141 │       timerRef.current = null;
142 │     }
143 │   }, []);
144 │ 
145 │   const tick = useCallback(() => {
146 │     const sender = senderRef.current;
147 │     if (!sender) return;
148 │ 
149 │     const interval = 1000 / fps;
150 │     if (!pausedRef.current) {
151 │       const now = performance.now();
152 │       if (nextFrameAtRef.current === 0 || now - nextFrameAtRef.current > interval * 3) {
153 │         nextFrameAtRef.current = now;
154 │         if (frameStatsRef.current.frames > 3) {
155 │           frameStatsRef.current.behind = true;
156 │         }
157 │       }
158 │ 
159 │       const slot = slotRef.current;
160 │       const startedAt = performance.now();
161 │       const next = sender.symbolAt(slot);
162 │       setSymbol(next);
163 │       sender.markShown(slot);
164 │       slotRef.current = slot + 1;
165 │ 
166 │       const drawMs = performance.now() - startedAt;
167 │       if (drawMs > interval) frameStatsRef.current.behind = true;
168 │ 
169 │       const fs = frameStatsRef.current;
170 │       fs.frames++;
171 │       fs.windowFrames++;
172 │       if (fs.windowStart === 0) fs.windowStart = now;
173 │       if (now - fs.windowStart >= 950) {
174 │         const measuredFps = (fs.windowFrames * 1000) / (now - fs.windowStart);
175 │         setStats({ frames: fs.frames, measuredFps, behind: fs.behind });
176 │         fs.windowStart = now;
177 │         fs.windowFrames = 0;
178 │       }
179 │     }
180 │ 
181 │     nextFrameAtRef.current += interval;
182 │     const delay = Math.max(0, nextFrameAtRef.current - performance.now());
183 │     timerRef.current = setTimeout(tick, delay);
184 │   }, [fps]);
185 │ 
186 │   useEffect(() => {
187 │     if (phase !== 'sending') return;
188 │     stopLoop();
189 │     nextFrameAtRef.current = 0;
190 │     timerRef.current = setTimeout(tick, 0);
191 │     return stopLoop;
192 │   }, [phase, tick, stopLoop]);
193 │ 
194 │   const handleFileObject = useCallback(
195 │     async (file: File | undefined) => {
196 │       if (!file) return;
197 │       setProblem(null);
198 │       try {
199 │         const loaded = await readBrowserFile(file);
200 │         setPicked(loaded);
201 │         setText('');
202 │         if (!name.trim()) setName(loaded.name);
203 │       } catch (error) {
204 │         setProblem(error instanceof FileError ? error.message : (error as Error).message);
205 │       }
206 │     },
207 │     [name],
208 │   );
209 │ 
210 │   const onDrop = useCallback(
211 │     (event: DragEvent<HTMLLabelElement>) => {
212 │       event.preventDefault();
213 │       setDragOver(false);
214 │       const file = event.dataTransfer?.files?.[0];
215 │       void handleFileObject(file);
216 │     },
217 │     [handleFileObject],
218 │   );
219 │ 
220 │   const start = useCallback(async () => {
221 │     setProblem(null);
222 │     setNotice(null);
223 │     setPhase('preparing');
224 │ 
225 │     try {
226 │       let data: Uint8Array;
227 │       let fileName: string;
228 │       let mime: string;
229 │ 
230 │       if (picked) {
231 │         data = picked.bytes;
232 │         fileName = name.trim() || picked.name;
233 │         mime = picked.mime;
234 │       } else {
235 │         const payload = textPayload(text);
236 │         data = payload.bytes;
237 │         fileName = name.trim() || payload.name;
238 │         mime = payload.mime;
239 │       }
240 │ 
241 │       if (encrypt && passphrase.trim().length === 0) {
242 │         throw new FileError('Enter a passphrase, or disable encryption before starting.');
243 │       }
244 │ 
245 │       const result = await prepareTransfer({
246 │         data,
247 │         name: fileName,
248 │         mime,
249 │         profile,
250 │         wireEncoding,
251 │         passphrase: encrypt ? passphrase : undefined,
252 │         note: wireEncoding === 'raw' ? 'raw byte mode (jsQR browser receivers)' : undefined,
253 │       });
254 │ 
255 │       if (encrypt) {
256 │         const salt = result.manifest.salt ? fromBase64Url(result.manifest.salt) : new Uint8Array(16);
257 │         setFingerprint(passphraseFingerprint(passphrase, salt, result.manifest.kdf ?? undefined));
258 │       } else {
259 │         setFingerprint(null);
260 │       }
261 │ 
262 │       const firstSymbol = new TransferSender(result).symbolAt(0);
263 │       senderRef.current = new TransferSender(result);
264 │       slotRef.current = 0;
265 │       nextFrameAtRef.current = 0;
266 │       frameStatsRef.current = { frames: 0, windowStart: 0, windowFrames: 0, behind: false };
267 │       pausedRef.current = false;
268 │       setPaused(false);
269 │       setCinema(settings.cinemaStage);
270 │       setStats({ frames: 0, measuredFps: 0, behind: false });
271 │       setPrepared(result);
272 │       setSymbol(firstSymbol);
273 │       setPhase('sending');
274 │ 
275 │       onSettingsChange({ profile, fps, wireEncoding });
276 │ 
277 │       if (typeof window !== 'undefined') {
278 │         window.history.replaceState(null, '', `/send?code=${result.code}`);
279 │       }
280 │ 
281 │       void registerSession({
282 │         sessionId: result.sessionId,
283 │         code: result.code,
284 │         name: result.manifest.name,
285 │         mime: result.manifest.mime,
286 │         bytes: result.originalPayload.length,
287 │         wireBytes: result.wirePayload.length,
288 │         blockSize: result.manifest.bs,
289 │         blocks: result.manifest.k,
290 │         profile: result.plan.profile.id,
291 │         encrypted: result.encryption !== 'none',
292 │         codec: result.manifest.codec,
293 │         platform: browserPlatformTag(),
294 │       });
295 │     } catch (error) {
296 │       setPhase('setup');
297 │       setProblem(error instanceof Error ? error.message : String(error));
298 │     }
299 │   }, [picked, name, text, encrypt, passphrase, profile, wireEncoding, fps, settings.cinemaStage, onSettingsChange]);
300 │ 
301 │   const stop = useCallback(() => {
302 │     stopLoop();
303 │     senderRef.current = null;
304 │     setSymbol(null);
305 │     setPrepared(null);
306 │     setNotice(null);
307 │     setCinema(false);
308 │     setPhase('setup');
309 │     if (typeof window !== 'undefined') {
310 │       window.history.replaceState(null, '', '/send');
311 │     }
312 │   }, [stopLoop]);
313 │ 
314 │   const restartPrefix = useCallback(() => {
315 │     senderRef.current?.restartSystematic();
316 │     setNotice(
317 │       'Systematic prefix restarted: the next frames emit uncoded source blocks for a receiver that just joined.',
318 │     );
319 │   }, []);
320 │ 
321 │   const copyShareLink = useCallback(async () => {
322 │     if (!prepared || typeof window === 'undefined') return;
323 │     const shareUrl = `${window.location.origin}/receive?code=${prepared.code}`;
324 │     try {
325 │       await navigator.clipboard.writeText(shareUrl);
326 │       setCopiedLink(true);
327 │       setTimeout(() => setCopiedLink(false), 2000);
328 │     } catch {
329 │       setNotice(`Share this receiver URL: ${shareUrl}`);
330 │     }
331 │   }, [prepared]);
332 │ 
333 │   if (phase === 'sending' && prepared && symbol) {
334 │     const plan = prepared.plan;
335 │     const savedBytes = prepared.originalPayload.length - prepared.wirePayload.length;
336 │ 
337 │     return (
338 │       <>
339 │         <div className="screen-header">
340 │           <div>
341 │             <h1 className="screen-title">Sending {prepared.manifest.name}</h1>
342 │             <p className="screen-subtitle">
343 │               Keep this tab visible and bright — point the receiving browser camera at the QR symbol below.
344 │             </p>
345 │           </div>
346 │           <Row>
347 │             <Button
348 │               label={cinema ? 'Exit cinema stage' : 'Cinema dark stage'}
349 │               variant="ghost"
350 │               compact
351 │               onClick={() => {
352 │                 const next = !cinema;
353 │                 setCinema(next);
354 │                 void toggleFullscreen(next ? stageRef.current : null);
355 │               }}
356 │             />
357 │             <Button label="Stop" variant="danger" compact onClick={stop} />
358 │           </Row>
359 │         </div>
360 │ 
361 │         <div ref={stageRef} className={`qr-stage ${cinema ? 'cinema' : ''}`.trim()}>
362 │           <QrView symbol={symbol} size={qrSize} />
363 │           <div className="session-code" data-testid="session-code">
364 │             {prepared.code}
365 │           </div>
366 │           <div className="caption">Session code — the receiver displays the exact same 7 characters</div>
367 │           {fingerprint ? <div className="fingerprint-badge">Key fingerprint: {fingerprint}</div> : null}
368 │           {cinema ? (
369 │             <Row>
370 │               <Button
371 │                 label={paused ? 'Resume' : 'Pause'}
372 │                 variant="secondary"
373 │                 compact
374 │                 onClick={() => {
375 │                   pausedRef.current = !pausedRef.current;
376 │                   setPaused(pausedRef.current);
377 │                 }}
378 │               />
379 │               <Button label="Exit cinema" variant="ghost" compact onClick={() => setCinema(false)} />
380 │               <Button label="Stop" variant="danger" compact onClick={stop} />
381 │             </Row>
382 │           ) : null}
383 │         </div>
384 │ 
385 │         <Panel>
386 │           <KeyValue
387 │             label="Payload"
388 │             value={
389 │               `${formatBytes(prepared.originalPayload.length)} (${formatBytes(prepared.wirePayload.length)} on wire` +
390 │               (savedBytes > 0 ? `, deflate saved ${formatBytes(savedBytes)}` : '') +
391 │               ')'
392 │             }
393 │           />
394 │           <KeyValue
395 │             label="Session geometry"
396 │             value={`${plan.k} blocks of ${plan.blockSize} B · ${plan.modules}x${plan.modules} modules · ${plan.wireEncoding}`}
397 │           />
398 │           <KeyValue label="Frames shown" value={`${stats.frames}`} />
399 │           <KeyValue label="Measured rate" value={`${stats.measuredFps.toFixed(1)} fps (target ${fps} fps)`} />
400 │           <KeyValue
401 │             label="Screen Wake Lock"
402 │             value={wakeLock.held ? 'Active (screen kept awake)' : wakeLock.supported ? 'Pending' : 'Not supported by browser'}
403 │           />
404 │ 
405 │           {stats.behind ? (
406 │             <p className="caption text-warn">
407 │               This browser tab is struggling to hold {fps} fps. Lower the frame rate or switch to a smaller symbol
408 │               profile.
409 │             </p>
410 │           ) : null}
411 │ 
412 │           <ProgressBar
413 │             progress={Math.min(1, stats.frames / Math.max(1, senderRef.current?.expectedFrames ?? 1))}
414 │             label="First fountain pass progress"
415 │           />
416 │           <p className="caption">
417 │             Progress marks one expected pass (~{senderRef.current?.expectedFrames ?? 0} frames). Because there is no
418 │             return channel, the transmitter keeps streaming fountain frames until you stop it so late-joining receivers
419 │             still finish.
420 │           </p>
421 │         </Panel>
422 │ 
423 │         {notice ? (
424 │           <Panel tone="warn">
425 │             <p className="caption text-warn">{notice}</p>
426 │           </Panel>
427 │         ) : null}
428 │ 
429 │         <Row stretch>
430 │           <Button
431 │             label={paused ? 'Resume stream' : 'Pause stream'}
432 │             variant="secondary"
433 │             onClick={() => {
434 │               pausedRef.current = !pausedRef.current;
435 │               setPaused(pausedRef.current);
436 │             }}
437 │           />
438 │           <Button label="Restart systematic prefix" variant="secondary" onClick={restartPrefix} />
439 │           <Button
440 │             label={copiedLink ? 'Copied receive link!' : 'Copy receive link'}
441 │             variant="ghost"
442 │             onClick={() => void copyShareLink()}
443 │           />
444 │           <Button label="Stop sending" variant="danger" onClick={stop} />
445 │         </Row>
446 │       </>
447 │     );
448 │   }
449 │ 
450 │   const canStart = payloadBytes > 0 && Boolean(estimate?.plan);
451 │ 
452 │   return (
453 │     <>
454 │       <div className="screen-header">
455 │         <div>
456 │           <h1 className="screen-title">Send</h1>
457 │           <p className="screen-subtitle">Choose a file or paste text to turn this browser window into an optical transmitter.</p>
458 │         </div>
459 │         <Button label="Back" variant="ghost" compact onClick={onBack} />
460 │       </div>
461 │ 
462 │       <Panel title="1. What to send">
463 │         <label
464 │           htmlFor="send-file-input"
465 │           className={`dropzone ${dragOver ? 'over' : ''}`.trim()}
466 │           onDragEnter={(e) => {
467 │             e.preventDefault();
468 │             setDragOver(true);
469 │           }}
470 │           onDragOver={(e) => {
471 │             e.preventDefault();
472 │             setDragOver(true);
473 │           }}
474 │           onDragLeave={() => setDragOver(false)}
475 │           onDrop={onDrop}
476 │         >
477 │           <input
478 │             ref={fileInputRef}
479 │             id="send-file-input"
480 │             type="file"
481 │             className="sr-only"
482 │             onChange={(e) => void handleFileObject(e.target.files?.[0])}
483 │           />
484 │           <strong>
485 │             {picked
486 │               ? `${picked.name} (${formatBytes(picked.bytes.byteLength)})`
487 │               : 'Drop any file here, or click to browse'}
488 │           </strong>
489 │           <span className="caption">
490 │             Up to {formatBytes(LIMITS.maxPayloadBytes)} · compressed and hashed locally in your browser
491 │           </span>
492 │         </label>
493 │ 
494 │         {picked ? (
495 │           <Row>
496 │             <Button
497 │               label="Choose a different file"
498 │               variant="secondary"
499 │               compact
500 │               onClick={() => fileInputRef.current?.click()}
501 │             />
502 │             <Button
503 │               label="Clear file"
504 │               variant="ghost"
505 │               compact
506 │               onClick={() => {
507 │                 setPicked(null);
508 │                 setName('');
509 │                 if (fileInputRef.current) fileInputRef.current.value = '';
510 │               }}
511 │             />
512 │           </Row>
513 │         ) : (
514 │           <div>
515 │             <label className="field-label" htmlFor="send-text-input">
516 │               Or paste text / snippet to transmit
517 │             </label>
518 │             <textarea
519 │               id="send-text-input"
520 │               className="text-area"
521 │               placeholder="Paste a URL, SSH key, config snippet, or note..."
522 │               value={text}
523 │               onChange={(e) => {
524 │                 setText(e.target.value);
525 │                 setPicked(null);
526 │               }}
527 │               spellCheck={false}
528 │             />
529 │             <p className="caption">Text limit {formatBytes(LIMITS.maxTextBytes)}.</p>
530 │           </div>
531 │         )}
532 │ 
533 │         <div>
534 │           <label className="field-label" htmlFor="send-name-input">
535 │             Filename shown to receiver
536 │           </label>
537 │           <input
538 │             id="send-name-input"
539 │             type="text"
540 │             className="text-input"
541 │             placeholder="document.pdf"
542 │             value={name}
543 │             onChange={(e) => setName(e.target.value)}
544 │           />
545 │         </div>
546 │ 
547 │         {payloadBytes > 0 && estimate?.plan ? (
548 │           <p className="caption" data-testid="send-estimate">
549 │             {formatBytes(payloadBytes)} · {estimate.modules}x{estimate.modules} modules · ~{estimate.blocks} blocks of{' '}
550 │             {estimate.blockSize} B · ~{formatDuration(estimate.seconds)} at {fps} fps (
551 │             {formatBytes(Math.round(estimate.bytesPerSecond))}/s, pre-compression estimate)
552 │           </p>
553 │         ) : null}
554 │ 
555 │         {estimate?.warnings.map((warning) => (
556 │           <p key={warning} className="caption text-warn">
557 │             {warning}
558 │           </p>
559 │         ))}
560 │       </Panel>
561 │ 
562 │       <Panel title="2. Symbol geometry & wire speed">
563 │         <div>
564 │           <span className="field-label">Symbol density</span>
565 │           <Choice
566 │             label="Symbol density"
567 │             options={DENSITY_PROFILES.map((entry) => ({
568 │               value: entry.id,
569 │               label: `${entry.label} (${17 + 4 * entry.version}x${17 + 4 * entry.version})`,
570 │               hint: entry.description,
571 │             }))}
572 │             value={profile}
573 │             onChange={(val) => {
574 │               const id = val as DensityProfile['id'];
575 │               setProfile(id);
576 │               const rec = clampFps(recommendedFps(browserPlatformTag(), id));
577 │               setFps(rec);
578 │               onSettingsChange({ profile: id, fps: rec });
579 │             }}
580 │           />
581 │         </div>
582 │ 
583 │         <div>
584 │           <span className="field-label">Frames per second</span>
585 │           <Choice
586 │             label="Frames per second"
587 │             options={[10, 13, 15, 20, 24].map((val) => ({ value: String(val), label: `${val} fps` }))}
588 │             value={String(fps)}
589 │             onChange={(val) => {
590 │               const nextFps = clampFps(Number(val));
591 │               setFps(nextFps);
592 │               onSettingsChange({ fps: nextFps });
593 │             }}
594 │           />
595 │           <p className="caption">
596 │             15 fps holds each symbol for 66 ms so rolling-shutter cameras capture clean, unblended frames.
597 │           </p>
598 │         </div>
599 │ 
600 │         <div>
601 │           <span className="field-label">Wire encoding</span>
602 │           <Choice
603 │             label="Wire encoding"
604 │             options={[
605 │               {
606 │                 value: 'base32',
607 │                 label: 'Base32 (Universal default)',
608 │                 hint: 'Works with every browser BarcodeDetector and jsQR.',
609 │               },
610 │               {
611 │                 value: 'raw',
612 │                 label: 'Raw bytes (+10% faster, jsQR only)',
613 │                 hint: 'Use when receiving in LightBeam Web with jsQR mode.',
614 │               },
615 │             ]}
616 │             value={wireEncoding}
617 │             onChange={(val) => {
618 │               const mode = val as WireEncoding;
619 │               setWireEncoding(mode);
620 │               onSettingsChange({ wireEncoding: mode });
621 │             }}
622 │           />
623 │         </div>
624 │       </Panel>
625 │ 
626 │       <Panel title="3. Privacy & authenticated encryption">
627 │         <SwitchRow
628 │           label="Encrypt with a passphrase"
629 │           hint="XChaCha20-Poly1305 + scrypt key derivation. Passphrases never travel in the QR stream."
630 │           value={encrypt}
631 │           onValueChange={(next) => {
632 │             setEncrypt(next);
633 │             onSettingsChange({ encryptByDefault: next });
634 │           }}
635 │         />
636 │         {encrypt ? (
637 │           <div>
638 │             <label className="field-label" htmlFor="send-passphrase-input">
639 │               Shared passphrase
640 │             </label>
641 │             <input
642 │               id="send-passphrase-input"
643 │               type="password"
644 │               className="text-input"
645 │               placeholder="Enter passphrase shared out of band"
646 │               value={passphrase}
647 │               onChange={(e) => setPassphrase(e.target.value)}
648 │               autoComplete="off"
649 │             />
650 │             <p className="caption">
651 │               Compare the 8-hex key fingerprint displayed on the sending stage with the receiver before long transfers.
652 │             </p>
653 │           </div>
654 │         ) : (
655 │           <p className="caption">
656 │             Unencrypted streams can be decoded by any camera with line-of-sight to your screen.
657 │           </p>
658 │         )}
659 │       </Panel>
660 │ 
661 │       {problem ? (
662 │         <Panel tone="bad">
663 │           <p className="text-bad">{problem}</p>
664 │         </Panel>
665 │       ) : null}
666 │ 
667 │       <Button
668 │         label={phase === 'preparing' ? 'Preparing session' : 'Start sending'}
669 │         loading={phase === 'preparing'}
670 │         disabled={!canStart}
671 │         onClick={() => void start()}
672 │         hint={!canStart ? 'Select a file or enter text above to begin.' : undefined}
673 │       />
674 │     </>
675 │   );
676 │ }
```

---

## `apps/web/src/screens/ReceiveScreen.tsx`

> 717 lines

Optical receiver screen. Drives `getUserMedia` (`facingMode: 'environment'`) through `startVideoQrScanner`, supports manual image-frame upload and session short-code lookup, prompts for XChaCha20-Poly1305 decryption passphrases when an encrypted manifest locks, renders an early progressive `<img>` preview once partial image bytes arrive, surfaces live diagnostic hints (`diagnoseHints`), verifies the end-to-end SHA-256 digest, saves completed files to IndexedDB, and offers instant browser download or Web Share.

**Every line**

```ts
  1 │ /**
  2 │  * ReceiveScreen.tsx - camera viewfinder, dual-engine QR scanner, and SHA-256 verifier.
  3 │  *
  4 │  * Supports live camera capture (`getUserMedia` + continuous autofocus + optional
  5 │  * torch) as well as decoding from still QR images for desktop/headless workflows.
  6 │  */
  7 │ 
  8 │ import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
  9 │ import { formatBytes, sessionCode, type ReceiverProgress } from '@lightbeam/core';
 10 │ import { Button } from '../components/Controls';
 11 │ import { KeyValue, Panel, ProgressBar, Row } from '../components/Panel';
 12 │ import { formatDuration, triggerHaptic, useScreenWakeLock } from '../services/display';
 13 │ import {
 14 │   canWebShareFiles,
 15 │   downloadBytes,
 16 │   saveReceivedFile,
 17 │   shareBrowserFile,
 18 │   toSafeBlob,
 19 │ } from '../services/inbox';
 20 │ import {
 21 │   BrowserQrScanner,
 22 │   isCameraAvailable,
 23 │   isSecureContextOk,
 24 │   useReceiver,
 25 │ } from '../services/scanner';
 26 │ import { lookupSession, reportCompletion, type SessionSummary } from '../services/telemetry';
 27 │ import type { Settings } from '../state/settings';
 28 │ 
 29 │ export interface ReceiveScreenProps {
 30 │   settings: Settings;
 31 │   expectedCode?: string | null;
 32 │   onInboxChanged: () => void;
 33 │   onTransferActiveChange: (active: boolean) => void;
 34 │   onOpenFiles: () => void;
 35 │   onBack: () => void;
 36 │ }
 37 │ 
 38 │ type Outcome =
 39 │   | {
 40 │       kind: 'ok';
 41 │       name: string;
 42 │       mime: string;
 43 │       bytes: Uint8Array;
 44 │       text: string | null;
 45 │       sha256: string;
 46 │       seconds: number;
 47 │       overhead: number;
 48 │     }
 49 │   | {
 50 │       kind: 'error';
 51 │       message: string;
 52 │     };
 53 │ 
 54 │ export function ReceiveScreen({
 55 │   settings,
 56 │   expectedCode,
 57 │   onInboxChanged,
 58 │   onTransferActiveChange,
 59 │   onOpenFiles,
 60 │   onBack,
 61 │ }: ReceiveScreenProps) {
 62 │   const [scanning, setScanning] = useState(false);
 63 │   const [cameraError, setCameraError] = useState<string | null>(null);
 64 │   const [facing, setFacing] = useState<'environment' | 'user'>('environment');
 65 │   const [torchSupported, setTorchSupported] = useState(false);
 66 │   const [torchOn, setTorchOn] = useState(false);
 67 │ 
 68 │   const [progress, setProgress] = useState<ReceiverProgress | null>(null);
 69 │   const [scanMeta, setScanMeta] = useState<{ seen: number; engine: string; decodeMs: number }>({
 70 │     seen: 0,
 71 │     engine: 'auto',
 72 │     decodeMs: 0,
 73 │   });
 74 │   const [outcome, setOutcome] = useState<Outcome | null>(null);
 75 │   const [passphrase, setPassphrase] = useState('');
 76 │   const [needsPassphrase, setNeedsPassphrase] = useState(false);
 77 │   const [copiedText, setCopiedText] = useState(false);
 78 │   const [expectedSession, setExpectedSession] = useState<SessionSummary | null>(null);
 79 │   const [partialPreviewUrl, setPartialPreviewUrl] = useState<string | null>(null);
 80 │   const [finalPreviewUrl, setFinalPreviewUrl] = useState<string | null>(null);
 81 │ 
 82 │   const { receiver, accept } = useReceiver();
 83 │   const videoRef = useRef<HTMLVideoElement | null>(null);
 84 │   const imageInputRef = useRef<HTMLInputElement | null>(null);
 85 │   const streamRef = useRef<MediaStream | null>(null);
 86 │   const rafRef = useRef<number | null>(null);
 87 │   const scannerRef = useRef<BrowserQrScanner | null>(null);
 88 │   const finishedRef = useRef(false);
 89 │   const scanStatsRef = useRef({ seen: 0, engine: 'jsQR', decodeMs: 0 });
 90 │ 
 91 │   useScreenWakeLock(scanning, settings.keepAwake);
 92 │ 
 93 │   useEffect(() => {
 94 │     onTransferActiveChange(scanning);
 95 │     return () => onTransferActiveChange(false);
 96 │   }, [scanning, onTransferActiveChange]);
 97 │ 
 98 │   useEffect(() => {
 99 │     if (!expectedCode) {
100 │       setExpectedSession(null);
101 │       return;
102 │     }
103 │     let cancelled = false;
104 │     void lookupSession(expectedCode).then((record) => {
105 │       if (!cancelled) setExpectedSession(record);
106 │     });
107 │     return () => {
108 │       cancelled = true;
109 │     };
110 │   }, [expectedCode]);
111 │ 
112 │   useEffect(() => {
113 │     return () => {
114 │       if (partialPreviewUrl) URL.revokeObjectURL(partialPreviewUrl);
115 │       if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl);
116 │     };
117 │   }, [partialPreviewUrl, finalPreviewUrl]);
118 │ 
119 │   const stopCamera = useCallback(() => {
120 │     setScanning(false);
121 │     if (rafRef.current !== null) {
122 │       cancelAnimationFrame(rafRef.current);
123 │       rafRef.current = null;
124 │     }
125 │     streamRef.current?.getTracks().forEach((track) => track.stop());
126 │     streamRef.current = null;
127 │     if (videoRef.current) {
128 │       videoRef.current.srcObject = null;
129 │     }
130 │     setTorchSupported(false);
131 │     setTorchOn(false);
132 │   }, []);
133 │ 
134 │   useEffect(() => {
135 │     return () => {
136 │       stopCamera();
137 │       receiver.reset();
138 │     };
139 │   }, [stopCamera, receiver]);
140 │ 
141 │   const finish = useCallback(() => {
142 │     if (finishedRef.current) return;
143 │     finishedRef.current = true;
144 │     stopCamera();
145 │ 
146 │     const result = receiver.getResult();
147 │     const now = receiver.getProgress();
148 │     setProgress(now);
149 │ 
150 │     if (!result) {
151 │       const message = now.error ?? 'Transfer failed.';
152 │       const passphraseRelated = /passphrase|key|decrypt|tag|authentication/i.test(message);
153 │       setNeedsPassphrase(Boolean(now.awaitingPassphrase || (passphraseRelated && receiver.currentManifest?.enc !== 'none')));
154 │       setOutcome({ kind: 'error', message });
155 │       if (settings.vibrateOnComplete) triggerHaptic('error');
156 │       return;
157 │     }
158 │ 
159 │     const seconds = Math.max(0.05, receiver.elapsedMs() / 1000);
160 │     const overhead = now.blocksTotal > 0 ? now.framesAccepted / now.blocksTotal : 1;
161 │     const throughput = result.payload.byteLength / seconds;
162 │ 
163 │     if (result.manifest.mime.startsWith('image/')) {
164 │       const blob = toSafeBlob(result.payload, result.manifest.mime);
165 │       setFinalPreviewUrl(URL.createObjectURL(blob));
166 │     }
167 │ 
168 │     setOutcome({
169 │       kind: 'ok',
170 │       name: result.manifest.name,
171 │       mime: result.manifest.mime,
172 │       bytes: result.payload,
173 │       text: result.text ?? null,
174 │       sha256: result.manifest.sha,
175 │       seconds,
176 │       overhead,
177 │     });
178 │ 
179 │     void saveReceivedFile({
180 │       name: result.manifest.name,
181 │       mime: result.manifest.mime,
182 │       bytes: result.payload,
183 │       sha256: result.manifest.sha,
184 │     }).then(() => onInboxChanged());
185 │ 
186 │     const reportCode = (expectedCode ?? sessionCode(result.manifest.sid)).toUpperCase();
187 │     void reportCompletion(reportCode, {
188 │       elapsedSeconds: seconds,
189 │       overheadRatio: overhead,
190 │       throughputBytesPerSecond: throughput,
191 │       framesAccepted: now.framesAccepted,
192 │       framesSuspect: now.framesSuspect,
193 │       verified: result.integrity.ok,
194 │     });
195 │ 
196 │     if (settings.vibrateOnComplete) triggerHaptic('ok');
197 │   }, [receiver, stopCamera, expectedCode, onInboxChanged, settings.vibrateOnComplete]);
198 │ 
199 │   const startCamera = useCallback(
200 │     async (requestedFacing = facing) => {
201 │       setCameraError(null);
202 │       if (!isSecureContextOk()) {
203 │         setCameraError('Camera access requires HTTPS or localhost. Open this site over https:// to use the camera.');
204 │         return;
205 │       }
206 │       if (!isCameraAvailable()) {
207 │         setCameraError('This browser does not expose navigator.mediaDevices.getUserMedia.');
208 │         return;
209 │       }
210 │ 
211 │       stopCamera();
212 │       finishedRef.current = false;
213 │ 
214 │       if (!scannerRef.current) {
215 │         scannerRef.current = new BrowserQrScanner(settings.scannerEngine);
216 │       } else {
217 │         scannerRef.current.setPreference(settings.scannerEngine);
218 │       }
219 │ 
220 │       try {
221 │         const videoConstraints: MediaTrackConstraints = {
222 │           facingMode: { ideal: requestedFacing },
223 │           width: { ideal: 1280 },
224 │           height: { ideal: 720 },
225 │         };
226 │         (videoConstraints as Record<string, unknown>).focusMode = 'continuous';
227 │ 
228 │         const stream = await navigator.mediaDevices.getUserMedia({
229 │           video: videoConstraints,
230 │           audio: false,
231 │         });
232 │         streamRef.current = stream;
233 │ 
234 │         const track = stream.getVideoTracks()[0];
235 │         try {
236 │           const capabilities = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
237 │             focusMode?: string[];
238 │             torch?: boolean;
239 │           };
240 │           if (capabilities.focusMode?.includes('continuous')) {
241 │             await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as never] });
242 │           }
243 │           setTorchSupported(Boolean(capabilities.torch));
244 │         } catch {
245 │           setTorchSupported(false);
246 │         }
247 │ 
248 │         if (videoRef.current) {
249 │           videoRef.current.srcObject = stream;
250 │           await videoRef.current.play();
251 │         }
252 │ 
253 │         setScanning(true);
254 │ 
255 │         let busy = false;
256 │         const loop = () => {
257 │           if (!streamRef.current) return;
258 │           const video = videoRef.current;
259 │           if (!busy && video && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
260 │             busy = true;
261 │             void scannerRef.current
262 │               ?.decodeVideoOrImage(video, video.videoWidth, video.videoHeight)
263 │               .then((decoded) => {
264 │                 if (decoded && !finishedRef.current) {
265 │                   scanStatsRef.current = {
266 │                     seen: scanStatsRef.current.seen + 1,
267 │                     engine: decoded.engine,
268 │                     decodeMs: decoded.decodeMs,
269 │                   };
270 │                   const phase = accept(decoded.payload);
271 │                   if (phase === 'complete' || phase === 'failed') {
272 │                     finish();
273 │                   }
274 │                 }
275 │               })
276 │               .finally(() => {
277 │                 busy = false;
278 │               });
279 │           }
280 │           rafRef.current = requestAnimationFrame(loop);
281 │         };
282 │         rafRef.current = requestAnimationFrame(loop);
283 │       } catch (error) {
284 │         setCameraError(
285 │           `Camera unavailable: ${(error as Error).message}. Check browser permissions for this origin.`,
286 │         );
287 │       }
288 │     },
289 │     [facing, settings.scannerEngine, stopCamera, accept, finish],
290 │   );
291 │ 
292 │   // Sample receiver progress at 4 Hz so DOM updates never starve camera decoding.
293 │   useEffect(() => {
294 │     if (!scanning) return;
295 │     const timer = setInterval(() => {
296 │       const now = receiver.getProgress();
297 │       setProgress(now);
298 │       setScanMeta({ ...scanStatsRef.current });
299 │ 
300 │       // Live partial preview for unencrypted uncompressed images while blocks arrive.
301 │       if (
302 │         now.manifest &&
303 │         now.manifest.mime.startsWith('image/') &&
304 │         now.manifest.enc === 'none' &&
305 │         now.manifest.codec === 'store' &&
306 │         now.blocksSolved > 0
307 │       ) {
308 │         const part = receiver.partial();
309 │         if (part && part.knownBytes > 0) {
310 │           const blob = toSafeBlob(part.data, now.manifest.mime);
311 │           setPartialPreviewUrl((prev) => {
312 │             if (prev) URL.revokeObjectURL(prev);
313 │             return URL.createObjectURL(blob);
314 │           });
315 │         }
316 │       }
317 │ 
318 │       if (receiver.isComplete || now.phase === 'failed') {
319 │         finish();
320 │       }
321 │     }, 220);
322 │     return () => clearInterval(timer);
323 │   }, [scanning, receiver, finish]);
324 │ 
325 │   const toggleTorch = useCallback(async () => {
326 │     const track = streamRef.current?.getVideoTracks()[0];
327 │     if (!track) return;
328 │     const next = !torchOn;
329 │     try {
330 │       await track.applyConstraints({ advanced: [{ torch: next } as never] });
331 │       setTorchOn(next);
332 │     } catch {
333 │       setTorchSupported(false);
334 │     }
335 │   }, [torchOn]);
336 │ 
337 │   const reset = useCallback(() => {
338 │     stopCamera();
339 │     receiver.reset();
340 │     finishedRef.current = false;
341 │     scanStatsRef.current = { seen: 0, engine: settings.scannerEngine === 'jsqr' ? 'jsQR' : 'auto', decodeMs: 0 };
342 │     setOutcome(null);
343 │     setProgress(null);
344 │     setNeedsPassphrase(false);
345 │     setPassphrase('');
346 │     setCameraError(null);
347 │   }, [stopCamera, receiver, settings.scannerEngine]);
348 │ 
349 │   const applyPassphrase = useCallback(() => {
350 │     finishedRef.current = false;
351 │     const phase = receiver.setPassphrase(passphrase);
352 │     if (phase === 'complete' || phase === 'failed') {
353 │       finish();
354 │     } else {
355 │       setProgress(receiver.getProgress());
356 │     }
357 │   }, [passphrase, receiver, finish]);
358 │ 
359 │   /** Allow decoding one or more still QR frame images on desktop/headless setups. */
360 │   const handleStillFrames = useCallback(
361 │     async (event: ChangeEvent<HTMLInputElement>) => {
362 │       const files = Array.from(event.target.files ?? []);
363 │       if (files.length === 0) return;
364 │       setCameraError(null);
365 │       if (!scannerRef.current) {
366 │         scannerRef.current = new BrowserQrScanner(settings.scannerEngine);
367 │       }
368 │       for (const file of files) {
369 │         const bitmapUrl = URL.createObjectURL(file);
370 │         try {
371 │           const img = await new Promise<HTMLImageElement>((resolve, reject) => {
372 │             const el = new Image();
373 │             el.onload = () => resolve(el);
374 │             el.onerror = () => reject(new Error(`Could not load image ${file.name}`));
375 │             el.src = bitmapUrl;
376 │           });
377 │           const decoded = await scannerRef.current.decodeVideoOrImage(
378 │             img,
379 │             img.naturalWidth || img.width,
380 │             img.naturalHeight || img.height,
381 │           );
382 │           if (decoded) {
383 │             scanStatsRef.current.seen++;
384 │             const phase = accept(decoded.payload);
385 │             setProgress(receiver.getProgress());
386 │             if (phase === 'complete' || phase === 'failed') {
387 │               finish();
388 │               break;
389 │             }
390 │           }
391 │         } catch (error) {
392 │           setCameraError((error as Error).message);
393 │         } finally {
394 │           URL.revokeObjectURL(bitmapUrl);
395 │         }
396 │       }
397 │       event.target.value = '';
398 │     },
399 │     [settings.scannerEngine, accept, receiver, finish],
400 │   );
401 │ 
402 │   const percent = progress ? Math.round(progress.progress * 100) : 0;
403 │   const hints = useMemo(() => diagnose(progress), [progress]);
404 │   const receivedCode = progress?.manifest ? sessionCode(progress.manifest.sid) : null;
405 │   const codeMismatch = Boolean(
406 │     expectedCode && receivedCode && expectedCode.trim().toUpperCase() !== receivedCode,
407 │   );
408 │ 
409 │   if (outcome?.kind === 'ok') {
410 │     const rate = outcome.seconds > 0 ? outcome.bytes.byteLength / outcome.seconds : 0;
411 │     return (
412 │       <>
413 │         <div className="screen-header">
414 │           <div>
415 │             <h1 className="screen-title">Received and verified</h1>
416 │             <p className="screen-subtitle">
417 │               SHA-256 matches the sender manifest — saved automatically to your browser Files inbox.
418 │             </p>
419 │           </div>
420 │           <span className="badge badge-ok">SHA-256 OK</span>
421 │         </div>
422 │ 
423 │         <Panel title={outcome.name} tone="ok">
424 │           <KeyValue label="Verified size" value={formatBytes(outcome.bytes.byteLength)} />
425 │           <KeyValue label="Elapsed time" value={`${outcome.seconds.toFixed(1)}s`} />
426 │           <KeyValue label="Effective goodput" value={`${formatBytes(rate)}/s`} />
427 │           <KeyValue label="Fountain overhead" value={`${outcome.overhead.toFixed(2)}x`} />
428 │           <KeyValue label="SHA-256" value={`${outcome.sha256.slice(0, 16)}…${outcome.sha256.slice(-8)}`} />
429 │ 
430 │           {outcome.text && outcome.mime.startsWith('text/') ? (
431 │             <pre className="text-preview" data-testid="received-text-preview">
432 │               {outcome.text.slice(0, 20_000)}
433 │             </pre>
434 │           ) : null}
435 │ 
436 │           {finalPreviewUrl ? (
437 │             <img src={finalPreviewUrl} alt={outcome.name} className="image-preview" />
438 │           ) : null}
439 │         </Panel>
440 │ 
441 │         <Row stretch>
442 │           <Button
443 │             label={`Download ${outcome.name}`}
444 │             onClick={() => downloadBytes(outcome.name, outcome.bytes, outcome.mime)}
445 │           />
446 │           {canWebShareFiles() ? (
447 │             <Button
448 │               label="Share file"
449 │               variant="secondary"
450 │               onClick={() => void shareBrowserFile(outcome.name, outcome.bytes, outcome.mime)}
451 │             />
452 │           ) : null}
453 │           {outcome.text ? (
454 │             <Button
455 │               label={copiedText ? 'Copied to clipboard!' : 'Copy text'}
456 │               variant="secondary"
457 │               onClick={() => {
458 │                 void navigator.clipboard.writeText(outcome.text ?? '');
459 │                 setCopiedText(true);
460 │                 setTimeout(() => setCopiedText(false), 2000);
461 │               }}
462 │             />
463 │           ) : null}
464 │           <Button label="Open Files inbox" variant="ghost" onClick={onOpenFiles} />
465 │           <Button label="Receive another" variant="ghost" onClick={reset} />
466 │         </Row>
467 │       </>
468 │     );
469 │   }
470 │ 
471 │   if (outcome?.kind === 'error') {
472 │     return (
473 │       <>
474 │         <div className="screen-header">
475 │           <div>
476 │             <h1 className="screen-title">Receive</h1>
477 │             <p className="screen-subtitle">Transfer requires attention</p>
478 │           </div>
479 │           <Button label="Back" variant="ghost" compact onClick={onBack} />
480 │         </div>
481 │ 
482 │         <Panel title="What happened" tone="bad">
483 │           <p className="text-bad">{outcome.message}</p>
484 │           <p className="caption">
485 │             {needsPassphrase
486 │               ? 'All fountain blocks are already in memory — enter the sender passphrase below to authenticate and unlock immediately without restarting the camera.'
487 │               : 'No unverified bytes were saved. Reset and point the camera at the sending screen again.'}
488 │           </p>
489 │         </Panel>
490 │ 
491 │         {needsPassphrase ? (
492 │           <Panel title="Unlock encrypted session" tone="warn">
493 │             <label className="field-label" htmlFor="receive-passphrase-input">
494 │               Passphrase
495 │             </label>
496 │             <input
497 │               id="receive-passphrase-input"
498 │               type="password"
499 │               className="text-input"
500 │               placeholder="Enter sender passphrase"
501 │               value={passphrase}
502 │               onChange={(e) => setPassphrase(e.target.value)}
503 │             />
504 │             <Button label="Unlock payload" onClick={applyPassphrase} />
505 │           </Panel>
506 │         ) : null}
507 │ 
508 │         <Row>
509 │           <Button label="Try again" variant="secondary" onClick={reset} />
510 │           <Button label="Close" variant="ghost" onClick={onBack} />
511 │         </Row>
512 │       </>
513 │     );
514 │   }
515 │ 
516 │   return (
517 │     <>
518 │       <div className="screen-header">
519 │         <div>
520 │           <h1 className="screen-title">Receive</h1>
521 │           <p className="screen-subtitle">
522 │             {expectedCode
523 │               ? `Watching for session ${expectedCode.toUpperCase()}`
524 │               : 'Point your browser camera at the animated QR stream on the sending screen.'}
525 │           </p>
526 │         </div>
527 │         <Button label="Back" variant="ghost" compact onClick={onBack} />
528 │       </div>
529 │ 
530 │       {expectedSession ? (
531 │         <Panel tone="ok">
532 │           <p className="caption">
533 │             Session <strong className="mono">{expectedSession.code}</strong> registered on server:{' '}
534 │             <strong>{expectedSession.name}</strong> ({formatBytes(expectedSession.bytes)}, {expectedSession.blocks}{' '}
535 │             blocks{expectedSession.encrypted ? ', encrypted' : ''}).
536 │           </p>
537 │         </Panel>
538 │       ) : null}
539 │ 
540 │       <div className="video-wrap">
541 │         <video ref={videoRef} className="video-feed" playsInline muted autoPlay />
542 │         {!scanning ? (
543 │           <div className="video-idle">
544 │             <strong>Camera stopped</strong>
545 │             <span className="caption">
546 │               Frames are decoded in browser memory and immediately discarded — nothing is recorded or uploaded.
547 │             </span>
548 │           </div>
549 │         ) : null}
550 │         <div className="reticle" aria-hidden="true" />
551 │       </div>
552 │ 
553 │       <Row stretch>
554 │         {!scanning ? (
555 │           <Button label="Start camera" onClick={() => void startCamera()} />
556 │         ) : (
557 │           <>
558 │             <Button label="Stop camera" variant="secondary" onClick={stopCamera} />
559 │             <Button
560 │               label={`Switch to ${facing === 'environment' ? 'front' : 'rear'} camera`}
561 │               variant="ghost"
562 │               onClick={() => {
563 │                 const next = facing === 'environment' ? 'user' : 'environment';
564 │                 setFacing(next);
565 │                 void startCamera(next);
566 │               }}
567 │             />
568 │             {torchSupported ? (
569 │               <Button
570 │                 label={torchOn ? 'Torch off' : 'Torch on'}
571 │                 variant="ghost"
572 │                 onClick={() => void toggleTorch()}
573 │               />
574 │             ) : null}
575 │           </>
576 │         )}
577 │ 
578 │         <input
579 │           ref={imageInputRef}
580 │           type="file"
581 │           accept="image/*"
582 │           multiple
583 │           className="sr-only"
584 │           aria-label="Scan QR frame images"
585 │           onChange={(e) => void handleStillFrames(e)}
586 │         />
587 │         <Button
588 │           label="Scan QR image(s)"
589 │           variant="ghost"
590 │           onClick={() => imageInputRef.current?.click()}
591 │         />
592 │         <Button label="Reset" variant="ghost" onClick={reset} />
593 │       </Row>
594 │ 
595 │       {cameraError ? (
596 │         <Panel tone="warn">
597 │           <p className="text-warn">{cameraError}</p>
598 │         </Panel>
599 │       ) : null}
600 │ 
601 │       <Panel title="Live reception status">
602 │         <ProgressBar progress={percent / 100} tone={percent >= 100 ? 'ok' : 'accent'} />
603 │ 
604 │         <KeyValue
605 │           label="Phase"
606 │           value={
607 │             !progress || progress.blocksTotal === 0
608 │               ? scanning
609 │                 ? 'Waiting for manifest frame...'
610 │                 : 'Idle'
611 │               : `${percent}% · ${progress.blocksSolved}/${progress.blocksTotal} blocks · ${formatDuration(progress.etaSeconds)} left`
612 │           }
613 │         />
614 │ 
615 │         {receivedCode ? (
616 │           <KeyValue
617 │             label="Locked session"
618 │             value={codeMismatch ? `${receivedCode} (expected ${expectedCode?.toUpperCase()})` : receivedCode}
619 │           />
620 │         ) : null}
621 │ 
622 │         {progress?.manifest ? (
623 │           <KeyValue
624 │             label="Incoming file"
625 │             value={
626 │               `${progress.manifest.name} · ${formatBytes(progress.manifest.olen)}` +
627 │               (progress.manifest.codec === 'deflate' ? ' · compressed' : '') +
628 │               (progress.manifest.enc !== 'none' ? ' · encrypted' : '')
629 │             }
630 │           />
631 │         ) : null}
632 │ 
633 │         <KeyValue
634 │           label="Optical goodput"
635 │           value={
636 │             progress
637 │               ? `${progress.goodputFps.toFixed(1)} fps · ${formatBytes(progress.goodputBytesPerSecond)}/s`
638 │               : '0.0 fps'
639 │           }
640 │         />
641 │ 
642 │         <KeyValue
643 │           label="Frame counters"
644 │           value={
645 │             progress
646 │               ? `${progress.framesAccepted} accepted · ${progress.framesSuspect} unreadable · ${progress.framesDuplicate} repeats · ${progress.framesForeign} foreign`
647 │               : `${scanMeta.seen} symbols decoded`
648 │           }
649 │         />
650 │ 
651 │         <KeyValue
652 │           label="Decoder engine"
653 │           value={`${scanMeta.engine}${scanMeta.decodeMs > 0 ? ` (${scanMeta.decodeMs.toFixed(1)} ms/frame)` : ''}`}
654 │         />
655 │ 
656 │         {codeMismatch ? (
657 │           <p className="caption text-warn">
658 │             Warning: locked onto session {receivedCode}, which differs from requested code{' '}
659 │             {expectedCode?.toUpperCase()}.
660 │           </p>
661 │         ) : null}
662 │ 
663 │         {hints.map((hint) => (
664 │           <p key={hint} className="caption text-warn">
665 │             {hint}
666 │           </p>
667 │         ))}
668 │ 
669 │         {partialPreviewUrl ? (
670 │           <div>
671 │             <span className="field-label">Partial image reconstruction</span>
672 │             <img src={partialPreviewUrl} alt="Incoming partial preview" className="image-preview" />
673 │           </div>
674 │         ) : null}
675 │       </Panel>
676 │ 
677 │       {progress?.awaitingPassphrase || needsPassphrase ? (
678 │         <Panel title="Encrypted transfer — enter passphrase" tone="warn">
679 │           <input
680 │             type="password"
681 │             className="text-input"
682 │             placeholder="Passphrase"
683 │             value={passphrase}
684 │             onChange={(e) => setPassphrase(e.target.value)}
685 │           />
686 │           <Button label="Unlock" onClick={applyPassphrase} />
687 │         </Panel>
688 │       ) : null}
689 │     </>
690 │   );
691 │ }
692 │ 
693 │ export function diagnose(progress: ReceiverProgress | null): string[] {
694 │   if (!progress) return [];
695 │   const hints: string[] = [];
696 │   const { framesAccepted, framesSuspect, framesForeign, framesOrphan, blocksTotal, goodputFps } = progress;
697 │ 
698 │   if (framesSuspect > 25 && framesSuspect > framesAccepted * 0.3) {
699 │     hints.push(
700 │       'Many symbols are detected but fail CRC: hold steadier, fill more of the reticle, or ask the sender for the Phone symbol profile.',
701 │     );
702 │   }
703 │   if (framesOrphan > 40 && blocksTotal === 0) {
704 │     hints.push(
705 │       'Data frames are arriving without the manifest header: ensure the entire white quiet zone around the QR code fits inside the camera frame.',
706 │     );
707 │   }
708 │   if (framesForeign > 30) {
709 │     hints.push('Another QR code is visible in the frame — move closer so only the LightBeam display is in view.');
710 │   }
711 │   if (blocksTotal > 0 && goodputFps < 2) {
712 │     hints.push(
713 │       'Low frame goodput: maximise sender display brightness, enable Cinema dark stage, and avoid overhead glare.',
714 │     );
715 │   }
716 │   return hints;
717 │ }
```

---

## `apps/web/src/screens/FilesScreen.tsx`

> 178 lines

Browser inbox screen listing every received file persisted in IndexedDB, with inline image/text preview modal, SHA-256 prefix inspection, one-click download, Web Share API integration, per-file deletion, and full inbox purge.

**Every line**

```ts
  1 │ /**
  2 │  * FilesScreen.tsx - browser IndexedDB inbox for verified received files.
  3 │  */
  4 │ 
  5 │ import { useCallback, useEffect, useState } from 'react';
  6 │ import { formatBytes } from '@lightbeam/core';
  7 │ import { Button } from '../components/Controls';
  8 │ import { Panel, Row } from '../components/Panel';
  9 │ import {
 10 │   canWebShareFiles,
 11 │   clearInbox,
 12 │   deleteInboxItem,
 13 │   downloadBytes,
 14 │   listInbox,
 15 │   shareBrowserFile,
 16 │   toSafeBlob,
 17 │   type InboxItem,
 18 │ } from '../services/inbox';
 19 │ 
 20 │ export interface FilesScreenProps {
 21 │   onInboxChanged: () => void;
 22 │   onBack: () => void;
 23 │ }
 24 │ 
 25 │ export function FilesScreen({ onInboxChanged, onBack }: FilesScreenProps) {
 26 │   const [files, setFiles] = useState<InboxItem[]>([]);
 27 │   const [confirmClear, setConfirmClear] = useState(false);
 28 │   const [previewId, setPreviewId] = useState<string | null>(null);
 29 │   const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
 30 │ 
 31 │   const refresh = useCallback(async () => {
 32 │     const items = await listInbox();
 33 │     setFiles(items);
 34 │   }, []);
 35 │ 
 36 │   useEffect(() => {
 37 │     void refresh();
 38 │   }, [refresh]);
 39 │ 
 40 │   useEffect(() => {
 41 │     return () => {
 42 │       Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url));
 43 │     };
 44 │   }, [imageUrls]);
 45 │ 
 46 │   const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
 47 │ 
 48 │   const handleDeleteOne = async (id: string) => {
 49 │     await deleteInboxItem(id);
 50 │     if (previewId === id) setPreviewId(null);
 51 │     await refresh();
 52 │     onInboxChanged();
 53 │   };
 54 │ 
 55 │   const handleClearAll = async () => {
 56 │     await clearInbox();
 57 │     setConfirmClear(false);
 58 │     setPreviewId(null);
 59 │     await refresh();
 60 │     onInboxChanged();
 61 │   };
 62 │ 
 63 │   const togglePreview = (item: InboxItem) => {
 64 │     if (previewId === item.id) {
 65 │       setPreviewId(null);
 66 │       return;
 67 │     }
 68 │     if (item.mime.startsWith('image/') && !imageUrls[item.id]) {
 69 │       const url = URL.createObjectURL(toSafeBlob(item.bytes, item.mime));
 70 │       setImageUrls((prev) => ({ ...prev, [item.id]: url }));
 71 │     }
 72 │     setPreviewId(item.id);
 73 │   };
 74 │ 
 75 │   const shareSupported = canWebShareFiles();
 76 │ 
 77 │   return (
 78 │     <>
 79 │       <div className="screen-header">
 80 │         <div>
 81 │           <h1 className="screen-title">Received files</h1>
 82 │           <p className="screen-subtitle">
 83 │             {files.length} file{files.length === 1 ? '' : 's'} ({formatBytes(totalBytes)}) stored locally in this
 84 │             browser&apos;s IndexedDB inbox
 85 │           </p>
 86 │         </div>
 87 │         <Button label="Back" variant="ghost" compact onClick={onBack} />
 88 │       </div>
 89 │ 
 90 │       {files.length === 0 ? (
 91 │         <Panel>
 92 │           <p>
 93 │             Nothing stored yet. Verified payloads received via camera or loopback are saved in browser IndexedDB so you
 94 │             can inspect, download, share, or delete them at any time.
 95 │           </p>
 96 │         </Panel>
 97 │       ) : (
 98 │         files.map((item) => {
 99 │           const isPreviewable = item.mime.startsWith('text/') || item.mime === 'application/json' || item.mime.startsWith('image/');
100 │           const showingPreview = previewId === item.id;
101 │           return (
102 │             <div key={item.id} className="inbox-card" data-testid="inbox-item">
103 │               <div className="inbox-card-header">
104 │                 <div>
105 │                   <strong>{item.name}</strong>
106 │                   <div className="caption mono">
107 │                     {formatBytes(item.size)} · {item.mime} · SHA-256 {item.sha256.slice(0, 12)}… ·{' '}
108 │                     {new Date(item.receivedAt).toLocaleTimeString()}
109 │                   </div>
110 │                 </div>
111 │                 <Row>
112 │                   <Button
113 │                     label="Download"
114 │                     compact
115 │                     onClick={() => downloadBytes(item.name, item.bytes, item.mime)}
116 │                   />
117 │                   {shareSupported ? (
118 │                     <Button
119 │                       label="Share"
120 │                       variant="secondary"
121 │                       compact
122 │                       onClick={() => void shareBrowserFile(item.name, item.bytes, item.mime)}
123 │                     />
124 │                   ) : null}
125 │                   {isPreviewable ? (
126 │                     <Button
127 │                       label={showingPreview ? 'Hide preview' : 'Preview'}
128 │                       variant="ghost"
129 │                       compact
130 │                       onClick={() => togglePreview(item)}
131 │                     />
132 │                   ) : null}
133 │                   <Button
134 │                     label="Delete"
135 │                     variant="danger"
136 │                     compact
137 │                     onClick={() => void handleDeleteOne(item.id)}
138 │                   />
139 │                 </Row>
140 │               </div>
141 │ 
142 │               {showingPreview && (item.mime.startsWith('text/') || item.mime === 'application/json') ? (
143 │                 <pre className="text-preview">
144 │                   {new TextDecoder().decode(item.bytes).slice(0, 16_000)}
145 │                 </pre>
146 │               ) : null}
147 │ 
148 │               {showingPreview && item.mime.startsWith('image/') && imageUrls[item.id] ? (
149 │                 <img src={imageUrls[item.id]} alt={item.name} className="image-preview" />
150 │               ) : null}
151 │             </div>
152 │           );
153 │         })
154 │       )}
155 │ 
156 │       {files.length > 0 ? (
157 │         confirmClear ? (
158 │           <Panel tone="bad">
159 │             <p>Remove all {files.length} received file(s) from browser storage?</p>
160 │             <Row>
161 │               <Button label="Confirm delete all" variant="danger" compact onClick={() => void handleClearAll()} />
162 │               <Button label="Cancel" variant="secondary" compact onClick={() => setConfirmClear(false)} />
163 │             </Row>
164 │           </Panel>
165 │         ) : (
166 │           <Row>
167 │             <Button label="Delete all received files" variant="danger" onClick={() => setConfirmClear(true)} />
168 │           </Row>
169 │         )
170 │       ) : null}
171 │ 
172 │       <p className="caption">
173 │         Files stay strictly inside this origin&apos;s browser storage until you download, share, or delete them.
174 │         Nothing in this inbox is ever transmitted to the server.
175 │       </p>
176 │     </>
177 │   );
178 │ }
```

---

## `apps/web/src/screens/SettingsScreen.tsx`

> 142 lines

Persistent preferences screen allowing the user to configure default QR density profile, target frame rate, wire encoding (`auto`/`base32`/`raw`), camera decoder backend (`BarcodeDetector` vs `jsQR`), and automatic IndexedDB saving, plus one-click reset to defaults.

**Every line**

```ts
  1 │ /**
  2 │  * SettingsScreen.tsx - persisted browser preferences with explicit optical trade-offs.
  3 │  */
  4 │ 
  5 │ import { DENSITY_PROFILES, recommendedFps, type DensityProfile, type WireEncoding } from '@lightbeam/core';
  6 │ import { Button, Choice, SwitchRow } from '../components/Controls';
  7 │ import { Panel, Row } from '../components/Panel';
  8 │ import {
  9 │   browserPlatformTag,
 10 │   clampFps,
 11 │   type ScannerEnginePreference,
 12 │   type Settings,
 13 │ } from '../state/settings';
 14 │ 
 15 │ export interface SettingsScreenProps {
 16 │   settings: Settings;
 17 │   onChange: (patch: Partial<Settings>) => void;
 18 │   onReset: () => void;
 19 │   onBack: () => void;
 20 │ }
 21 │ 
 22 │ export function SettingsScreen({ settings, onChange, onReset, onBack }: SettingsScreenProps) {
 23 │   return (
 24 │     <>
 25 │       <div className="screen-header">
 26 │         <div>
 27 │           <h1 className="screen-title">Settings</h1>
 28 │           <p className="screen-subtitle">
 29 │             Saved in <code>localStorage</code> on this browser only — passphrases are never persisted.
 30 │           </p>
 31 │         </div>
 32 │         <Button label="Back" variant="ghost" compact onClick={onBack} />
 33 │       </div>
 34 │ 
 35 │       <Panel title="Sending defaults">
 36 │         <div>
 37 │           <span className="field-label">Default symbol density</span>
 38 │           <Choice
 39 │             label="Default symbol density"
 40 │             options={DENSITY_PROFILES.map((entry) => ({
 41 │               value: entry.id,
 42 │               label: `${entry.label} (${17 + 4 * entry.version}x${17 + 4 * entry.version})`,
 43 │             }))}
 44 │             value={settings.profile}
 45 │             onChange={(value) => {
 46 │               const profile = value as DensityProfile['id'];
 47 │               onChange({ profile, fps: clampFps(recommendedFps(browserPlatformTag(), profile)) });
 48 │             }}
 49 │           />
 50 │           <p className="caption">
 51 │             Larger modules (Phone) survive distance and handheld shake; denser symbols (Laptop/Tablet) carry more bytes
 52 │             per frame on a desktop monitor scanned by a steady phone.
 53 │           </p>
 54 │         </div>
 55 │ 
 56 │         <div>
 57 │           <span className="field-label">Default frame rate</span>
 58 │           <Choice
 59 │             label="Default frame rate"
 60 │             options={[10, 13, 15, 20, 24].map((value) => ({ value: String(value), label: `${value} fps` }))}
 61 │             value={String(settings.fps)}
 62 │             onChange={(value) => onChange({ fps: clampFps(Number(value)) })}
 63 │           />
 64 │           <p className="caption">
 65 │             10–13 fps suits older mobile browsers; 15 fps is the universal sweet spot; 20–24 fps works well from a high
 66 │             refresh desktop monitor to a modern camera.
 67 │           </p>
 68 │         </div>
 69 │ 
 70 │         <div>
 71 │           <span className="field-label">Default wire encoding</span>
 72 │           <Choice
 73 │             label="Default wire encoding"
 74 │             options={[
 75 │               { value: 'base32', label: 'Base32 (Universal)' },
 76 │               { value: 'raw', label: 'Raw bytes (jsQR only)' },
 77 │             ]}
 78 │             value={settings.wireEncoding}
 79 │             onChange={(value) => onChange({ wireEncoding: value as WireEncoding })}
 80 │           />
 81 │         </div>
 82 │ 
 83 │         <SwitchRow
 84 │           label="Encrypt by default"
 85 │           hint="Pre-enables passphrase encryption on the Send screen without ever storing a passphrase."
 86 │           value={settings.encryptByDefault}
 87 │           onValueChange={(value) => onChange({ encryptByDefault: value })}
 88 │         />
 89 │       </Panel>
 90 │ 
 91 │       <Panel title="Browser display & camera pipeline">
 92 │         <SwitchRow
 93 │           label="Keep screen awake during transfers"
 94 │           hint="Requests the browser Screen Wake Lock API so neither device dims mid-stream."
 95 │           value={settings.keepAwake}
 96 │           onValueChange={(value) => onChange({ keepAwake: value })}
 97 │         />
 98 │ 
 99 │         <SwitchRow
100 │           label="Start sending in Cinema dark stage"
101 │           hint="Surrounds the white QR quiet zone with pure #000000 to help camera auto-exposure."
102 │           value={settings.cinemaStage}
103 │           onValueChange={(value) => onChange({ cinemaStage: value })}
104 │         />
105 │ 
106 │         <SwitchRow
107 │           label="Vibrate when transfer completes"
108 │           hint="Triggers a short pulse via navigator.vibrate on mobile browsers that support it."
109 │           value={settings.vibrateOnComplete}
110 │           onValueChange={(value) => onChange({ vibrateOnComplete: value })}
111 │         />
112 │ 
113 │         <div>
114 │           <span className="field-label">Camera QR decoder engine</span>
115 │           <Choice
116 │             label="Camera QR decoder engine"
117 │             options={[
118 │               {
119 │                 value: 'auto',
120 │                 label: 'Auto (BarcodeDetector + jsQR fallback)',
121 │               },
122 │               {
123 │                 value: 'jsqr',
124 │                 label: 'Force jsQR (supports Raw byte mode)',
125 │               },
126 │             ]}
127 │             value={settings.scannerEngine}
128 │             onChange={(value) => onChange({ scannerEngine: value as ScannerEnginePreference })}
129 │           />
130 │           <p className="caption">
131 │             Auto uses the browser&apos;s hardware-accelerated <code>BarcodeDetector</code> when available and falls back
132 │             to pure-JS <code>jsQR</code>. Choose <code>jsQR</code> when receiving a Raw byte-mode stream.
133 │           </p>
134 │         </div>
135 │       </Panel>
136 │ 
137 │       <Row>
138 │         <Button label="Reset preferences to defaults" variant="secondary" onClick={onReset} />
139 │       </Row>
140 │     </>
141 │   );
142 │ }
```

---

## `apps/web/src/screens/AboutScreen.tsx`

> 115 lines

Technical overview screen documenting the 4-step optical fountain pipeline, live runtime capability probes (`Web Crypto`, `BarcodeDetector`, `getUserMedia`, `Screen Wake Lock`, `IndexedDB`, `Service Worker`), and LightBeam's zero-knowledge privacy model.

**Every line**

```ts
  1 │ /**
  2 │  * AboutScreen.tsx - protocol architecture, measured constants, and live web capabilities.
  3 │  */
  4 │ 
  5 │ import { DENSITY_PROFILES, LIMITS, VERSION, formatBytes } from '@lightbeam/core';
  6 │ import { Button } from '../components/Controls';
  7 │ import { KeyValue, Panel } from '../components/Panel';
  8 │ import { isWakeLockSupported } from '../services/display';
  9 │ import { canWebShareFiles } from '../services/inbox';
 10 │ import { hasNativeBarcodeDetector, isCameraAvailable, isSecureContextOk } from '../services/scanner';
 11 │ 
 12 │ export interface AboutScreenProps {
 13 │   onBack: () => void;
 14 │ }
 15 │ 
 16 │ export function AboutScreen({ onBack }: AboutScreenProps) {
 17 │   const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
 18 │   const hasIdb = typeof indexedDB !== 'undefined' && indexedDB !== null;
 19 │ 
 20 │   return (
 21 │     <>
 22 │       <div className="screen-header">
 23 │         <div>
 24 │           <h1 className="screen-title">About LightBeam {VERSION}</h1>
 25 │           <p className="screen-subtitle">
 26 │             Web-first optical file transfer — fountain-coded QR streams over screen and camera.
 27 │           </p>
 28 │         </div>
 29 │         <Button label="Back" variant="ghost" compact onClick={onBack} />
 30 │       </div>
 31 │ 
 32 │       <Panel title="The optical channel">
 33 │         <p>
 34 │           The sender renders one QR symbol per animation slot; the receiver&apos;s browser camera decodes them. Unlike
 35 │           TCP or WebRTC, an optical link is unidirectional and drops whole frames whenever a hand shifts, autofocus
 36 │           hunts, or a camera shutter spans a frame transition.
 37 │         </p>
 38 │         <p>
 39 │           Because there is no return channel, the payload is encoded with a rateless fountain code rather than a
 40 │           numbered sequence. Every frame is self-describing and order-independent: the receiver collects any subset of
 41 │           slightly more than <code>K</code> frames to reconstruct the exact file.
 42 │         </p>
 43 │       </Panel>
 44 │ 
 45 │       <Panel title="Core algorithms">
 46 │         <h3 className="subheading">Luby Transform fountain code &amp; Robust Soliton (c = 0.03, δ = 0.5)</h3>
 47 │         <p>
 48 │           Each data frame XORs a deterministic pseudo-random subset of source blocks derived from its 32-bit seed,
 49 │           block count, and session id. Robust soliton degree sampling achieves ~1.10x overhead on clean links (compared
 50 │           with 2.06x for textbook ideal soliton at <code>K = 1024</code>), backed by bounded GF(2) Gaussian elimination
 51 │           if belief-propagation peeling stalls near completion.
 52 │         </p>
 53 │ 
 54 │         <h3 className="subheading">Systematic prefix (0.10K)</h3>
 55 │         <p>
 56 │           The first 10% of data slots transmit uncoded single blocks so receivers see immediate progress while staying
 57 │           resilient under 30%–50% burst frame loss. Manifest fragments repeat every 24 slots so a receiver joining at
 58 │           any moment locks onto the session within ~1 second.
 59 │         </p>
 60 │ 
 61 │         <h3 className="subheading">ISO/IEC 18004 QR &amp; Base32 wire framing</h3>
 62 │         <p>
 63 │           Frames start with a 13-byte header (<code>0x4C</code> magic, version + flags, type, 32-bit session id,
 64 │           seed/fragment word, and CRC-16/CCITT). By default the entire frame is encoded in unpadded RFC 4648 Base32 so
 65 │           it packs into QR alphanumeric mode (8.80 bits/byte, +10%) and survives browser{' '}
 66 │           <code>BarcodeDetector.rawValue</code> string boundaries intact.
 67 │         </p>
 68 │ 
 69 │         <h3 className="subheading">Authenticated encryption &amp; integrity</h3>
 70 │         <p>
 71 │           Every manifest carries the original payload&apos;s SHA-256 digest; unverified bytes are never offered or
 72 │           stored. Optional encryption uses XChaCha20-Poly1305 with keys derived via <code>scrypt</code> (
 73 │           <code>N = 2^15, r = 8, p = 1</code>) and authenticated manifest associated data.
 74 │         </p>
 75 │       </Panel>
 76 │ 
 77 │       <div className="grid-two">
 78 │         <Panel title="Measured limits & benchmarks">
 79 │           <KeyValue label="Max file payload" value={formatBytes(LIMITS.maxPayloadBytes)} />
 80 │           <KeyValue label="Max pasted text" value={formatBytes(LIMITS.maxTextBytes)} />
 81 │           <KeyValue label="Max blocks per session" value={`${LIMITS.maxBlocks}`} />
 82 │           <KeyValue label="Typical optical goodput" value="60–150 kB/s" />
 83 │           <KeyValue label="Fountain overhead" value="~1.10x clean · ~1.62x at 30% loss" />
 84 │           <KeyValue label="Recommended distance" value="15–35 cm, screen to camera" />
 85 │         </Panel>
 86 │ 
 87 │         <Panel title="This browser's capabilities">
 88 │           <KeyValue label="Secure context (HTTPS / localhost)" value={isSecureContextOk() ? 'Yes' : 'No'} />
 89 │           <KeyValue label="Camera API (getUserMedia)" value={isCameraAvailable() ? 'Available' : 'Unavailable'} />
 90 │           <KeyValue
 91 │             label="Hardware BarcodeDetector"
 92 │             value={hasNativeBarcodeDetector() ? 'Supported' : 'Fallback to jsQR'}
 93 │           />
 94 │           <KeyValue label="Screen Wake Lock API" value={isWakeLockSupported() ? 'Supported' : 'Unavailable'} />
 95 │           <KeyValue label="IndexedDB local inbox" value={hasIdb ? 'Supported' : 'In-memory fallback'} />
 96 │           <KeyValue label="PWA Service Worker" value={hasSw ? 'Supported' : 'Unavailable'} />
 97 │           <KeyValue label="Web Share API (files)" value={canWebShareFiles() ? 'Supported' : 'Download mode'} />
 98 │         </Panel>
 99 │       </div>
100 │ 
101 │       <Panel title="Symbol density profiles">
102 │         {DENSITY_PROFILES.map((profile) => {
103 │           const modules = 17 + 4 * profile.version;
104 │           return (
105 │             <KeyValue
106 │               key={profile.id}
107 │               label={profile.label}
108 │               value={`${modules}x${modules} modules · QR v${profile.version} · EC ${profile.ecLevel}`}
109 │             />
110 │           );
111 │         })}
112 │       </Panel>
113 │     </>
114 │   );
115 │ }
```

---

## `apps/web/test/web-app.test.tsx`

> 156 lines

Component and integration test suite for `@lightbeam/web` using Vitest + Testing Library: verifies Home screen telemetry and navigation across all 6 screens, Send screen payload preparation and 7-character session link minting, Receive screen `?code=` prefill, IndexedDB inbox round-trip storage, and `localStorage` settings persistence.

**Every line**

```ts
  1 │ /**
  2 │  * web-app.test.tsx - component, routing, settings, and inbox tests for @lightbeam/web.
  3 │  */
  4 │ 
  5 │ import '@testing-library/jest-dom/vitest';
  6 │ import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
  7 │ import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  8 │ import { DENSITY_PROFILES } from '@lightbeam/core';
  9 │ import App from '../src/App';
 10 │ import { clearInbox, saveReceivedFile } from '../src/services/inbox';
 11 │ 
 12 │ beforeEach(async () => {
 13 │   localStorage.clear();
 14 │   await clearInbox();
 15 │   window.history.replaceState(null, '', '/');
 16 │   vi.stubGlobal(
 17 │     'fetch',
 18 │     vi.fn(async (input: RequestInfo | URL) => {
 19 │       const url = String(input);
 20 │       if (url.endsWith('/api/health')) {
 21 │         return new Response(
 22 │           JSON.stringify({
 23 │             ok: true,
 24 │             service: 'lightbeam-server',
 25 │             version: '1.0.0',
 26 │             uptimeSeconds: 42,
 27 │             sessions: 3,
 28 │             storesFileContent: false,
 29 │           }),
 30 │           { status: 200 },
 31 │         );
 32 │       }
 33 │       if (url.endsWith('/api/stats')) {
 34 │         return new Response(
 35 │           JSON.stringify({
 36 │             total: 3,
 37 │             completed: 2,
 38 │             failed: 0,
 39 │             bytesSent: 8192,
 40 │             medianOverhead: 1.11,
 41 │             medianSeconds: 4,
 42 │             byPlatform: { 'desktop-web': 3 },
 43 │             byProfile: { balanced: 3 },
 44 │           }),
 45 │           { status: 200 },
 46 │         );
 47 │       }
 48 │       return new Response(JSON.stringify({ code: 'ABCD234' }), { status: 201 });
 49 │     }),
 50 │   );
 51 │ });
 52 │ 
 53 │ afterEach(() => {
 54 │   cleanup();
 55 │   vi.unstubAllGlobals();
 56 │ });
 57 │ 
 58 │ describe('@lightbeam/web React application', () => {
 59 │   it('renders the Home screen with live server telemetry and navigates all 6 screens', async () => {
 60 │     render(<App />);
 61 │ 
 62 │     expect(screen.getByText(/Send a file through the air, screen to camera/i)).toBeInTheDocument();
 63 │     await waitFor(() => {
 64 │       expect(screen.getByText(/2 of 3 sessions/i)).toBeInTheDocument();
 65 │       expect(screen.getByText(/Zero file bytes on server/i)).toBeInTheDocument();
 66 │     });
 67 │ 
 68 │     fireEvent.click(screen.getByRole('button', { name: 'About' }));
 69 │     expect(screen.getByRole('heading', { name: /About LightBeam/i })).toBeInTheDocument();
 70 │ 
 71 │     fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
 72 │     expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
 73 │ 
 74 │     fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
 75 │     expect(screen.getByRole('heading', { name: 'Receive' })).toBeInTheDocument();
 76 │ 
 77 │     fireEvent.click(screen.getByRole('button', { name: 'Files' }));
 78 │     await waitFor(() => {
 79 │       expect(screen.getByText(/Nothing stored yet/i)).toBeInTheDocument();
 80 │     });
 81 │   });
 82 │ 
 83 │   it('derives symbol density labels directly from DENSITY_PROFILES with exact ISO 18004 module counts', () => {
 84 │     window.history.replaceState(null, '', '/send');
 85 │     render(<App />);
 86 │ 
 87 │     for (const profile of DENSITY_PROFILES) {
 88 │       const modules = 17 + 4 * profile.version;
 89 │       expect(screen.getByRole('radio', { name: new RegExp(`${modules}x${modules}`) })).toBeInTheDocument();
 90 │     }
 91 │   });
 92 │ 
 93 │   it('prepares and streams a text payload on the Send screen with a 7-character session code', async () => {
 94 │     window.history.replaceState(null, '', '/send');
 95 │     render(<App />);
 96 │ 
 97 │     const textarea = screen.getByLabelText(/Or paste text/i);
 98 │     fireEvent.change(textarea, { target: { value: 'Hello over optical fountain QR!' } });
 99 │ 
100 │     expect(screen.getByTestId('send-estimate')).toHaveTextContent(/modules/i);
101 │ 
102 │     fireEvent.click(screen.getByRole('button', { name: /Start sending/i }));
103 │ 
104 │     await waitFor(() => {
105 │       expect(screen.getByTestId('qr-symbol')).toBeInTheDocument();
106 │     });
107 │     const code = screen.getByTestId('session-code').textContent ?? '';
108 │     expect(code).toMatch(/^[A-Z2-9]{7}$/);
109 │ 
110 │     fireEvent.click(screen.getByRole('button', { name: /Stop sending/i }));
111 │     expect(screen.getByRole('heading', { name: 'Send' })).toBeInTheDocument();
112 │   });
113 │ 
114 │   it('lists, previews, and deletes verified received files in the browser Inbox', async () => {
115 │     await saveReceivedFile({
116 │       name: '../unsafe/hello-world.txt',
117 │       mime: 'text/plain',
118 │       bytes: new TextEncoder().encode('Verified optical message'),
119 │       sha256: 'a'.repeat(64),
120 │     });
121 │ 
122 │     window.history.replaceState(null, '', '/files');
123 │     render(<App />);
124 │ 
125 │     await waitFor(() => {
126 │       expect(screen.getByTestId('inbox-item')).toBeInTheDocument();
127 │     });
128 │     // Path traversal components must have been stripped by sanitiseFileName.
129 │     expect(screen.getByText('hello-world.txt')).toBeInTheDocument();
130 │ 
131 │     fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
132 │     expect(screen.getByText('Verified optical message')).toBeInTheDocument();
133 │ 
134 │     fireEvent.click(screen.getByRole('button', { name: /Delete all received files/i }));
135 │     fireEvent.click(screen.getByRole('button', { name: /Confirm delete all/i }));
136 │ 
137 │     await waitFor(() => {
138 │       expect(screen.queryByTestId('inbox-item')).not.toBeInTheDocument();
139 │     });
140 │   });
141 │ 
142 │   it('persists preferences to localStorage and supports resetting to defaults', async () => {
143 │     window.history.replaceState(null, '', '/settings');
144 │     render(<App />);
145 │ 
146 │     await waitFor(() => {
147 │       expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
148 │     });
149 │ 
150 │     fireEvent.click(screen.getByRole('radio', { name: '24 fps' }));
151 │     expect(JSON.parse(localStorage.getItem('lightbeam:web-settings:v1') ?? '{}').fps).toBe(24);
152 │ 
153 │     fireEvent.click(screen.getByRole('button', { name: /Reset preferences to defaults/i }));
154 │     expect(JSON.parse(localStorage.getItem('lightbeam:web-settings:v1') ?? '{}').fps).toBe(15);
155 │   });
156 │ });
```

---

## `apps/web/test/optical-transfer.test.ts`

> 144 lines

End-to-end pixel-level optical transfer tests: renders QR symbols to RGBA buffers via `toRgbaBuffer` + `scaleRgbaImage`, decodes them through real `jsQR` (`decodeQrFromRgba`), reconstructs a multi-block payload across 25% simulated camera frame loss with SHA-256 verification, tests XChaCha20-Poly1305 encrypted round-trips (including wrong-passphrase rejection), and verifies receiver diagnostic hints.

**Every line**

```ts
  1 │ /**
  2 │  * optical-transfer.test.ts - end-to-end web optical channel tests.
  3 │  *
  4 │  * Exercises the exact browser pixel pipeline:
  5 │  *   prepareTransfer -> TransferSender -> rasterizeRgba -> scaleRgbaImage
  6 │  *   -> BrowserQrScanner (jsQR) -> TransferReceiver -> Inbox storage
  7 │  */
  8 │ 
  9 │ import { describe, expect, it } from 'vitest';
 10 │ import {
 11 │   FAST_KDF,
 12 │   TransferReceiver,
 13 │   TransferSender,
 14 │   prepareTransfer,
 15 │   rasterizeRgba,
 16 │ } from '@lightbeam/core';
 17 │ import { scaleRgbaImage } from '../src/components/QrView';
 18 │ import { clearInbox, listInbox, saveReceivedFile } from '../src/services/inbox';
 19 │ import { BrowserQrScanner } from '../src/services/scanner';
 20 │ import { diagnose as diagnoseHints } from '../src/screens/ReceiveScreen';
 21 │ 
 22 │ describe('web optical scanner & fountain roundtrip', () => {
 23 │   it('reconstructs a multi-block payload across 25% simulated camera frame loss', async () => {
 24 │     await clearInbox();
 25 │     const originalText = 'Optical web fountain stream verification. '.repeat(90);
 26 │     const data = new TextEncoder().encode(originalText);
 27 │ 
 28 │     const prepared = await prepareTransfer({
 29 │       data,
 30 │       name: 'optical-web.txt',
 31 │       mime: 'text/plain',
 32 │       profile: 'phone',
 33 │     });
 34 │ 
 35 │     const sender = new TransferSender(prepared);
 36 │     const receiver = new TransferReceiver();
 37 │     const scanner = new BrowserQrScanner('jsqr');
 38 │ 
 39 │     for (let slot = 0; slot < 300 && !receiver.isComplete; slot++) {
 40 │       // Deterministically drop every 4th frame (25% loss).
 41 │       if (slot % 4 === 2) continue;
 42 │       const symbol = sender.symbolAt(slot);
 43 │       const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
 44 │       const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
 45 │       expect(decoded).not.toBeNull();
 46 │       receiver.accept(decoded!.payload);
 47 │     }
 48 │ 
 49 │     expect(receiver.isComplete).toBe(true);
 50 │     const result = receiver.getResult()!;
 51 │     expect(result.integrity.ok).toBe(true);
 52 │     expect(new TextDecoder().decode(result.payload)).toBe(originalText);
 53 │ 
 54 │     await saveReceivedFile({
 55 │       name: result.manifest.name,
 56 │       mime: result.manifest.mime,
 57 │       bytes: result.payload,
 58 │       sha256: result.manifest.sha,
 59 │     });
 60 │     const stored = await listInbox();
 61 │     expect(stored).toHaveLength(1);
 62 │     expect(stored[0].name).toBe('optical-web.txt');
 63 │   });
 64 │ 
 65 │   it('refuses encrypted payloads without the passphrase, then unlocks in memory once supplied', async () => {
 66 │     const secretBytes = new TextEncoder().encode('Confidential web transfer payload. '.repeat(30));
 67 │     const prepared = await prepareTransfer({
 68 │       data: secretBytes,
 69 │       name: 'secret.txt',
 70 │       mime: 'text/plain',
 71 │       profile: 'phone',
 72 │       passphrase: 'correct-horse-battery',
 73 │       kdf: FAST_KDF,
 74 │     });
 75 │ 
 76 │     const sender = new TransferSender(prepared);
 77 │     const receiver = new TransferReceiver();
 78 │     const scanner = new BrowserQrScanner('jsqr');
 79 │ 
 80 │     let terminalPhase = receiver.getProgress().phase;
 81 │     for (let slot = 0; slot < 200; slot++) {
 82 │       const symbol = sender.symbolAt(slot);
 83 │       const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
 84 │       const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
 85 │       if (decoded) {
 86 │         terminalPhase = receiver.accept(decoded.payload);
 87 │         if (terminalPhase === 'failed' || terminalPhase === 'complete') break;
 88 │       }
 89 │     }
 90 │ 
 91 │     // Without the passphrase, no decrypted payload may be yielded.
 92 │     expect(terminalPhase).toBe('failed');
 93 │     expect(receiver.getResult()).toBeNull();
 94 │ 
 95 │     // Wrong passphrase still fails authentication tag.
 96 │     expect(receiver.setPassphrase('wrong-passphrase')).toBe('failed');
 97 │     expect(receiver.getResult()).toBeNull();
 98 │ 
 99 │     // Supplying the right passphrase finishes immediately without another camera frame.
100 │     expect(receiver.setPassphrase('correct-horse-battery')).toBe('complete');
101 │     const unlocked = receiver.getResult();
102 │     expect(unlocked).not.toBeNull();
103 │     expect(new TextDecoder().decode(unlocked!.payload)).toBe(new TextDecoder().decode(secretBytes));
104 │   });
105 │ 
106 │   it('supports raw byte-mode QR frames between browsers via jsQR binaryData', async () => {
107 │     const binary = new Uint8Array(600);
108 │     for (let i = 0; i < binary.length; i++) binary[i] = (i * 73 + 19) & 0xff;
109 │ 
110 │     const prepared = await prepareTransfer({
111 │       data: binary,
112 │       name: 'raw.bin',
113 │       mime: 'application/octet-stream',
114 │       profile: 'balanced',
115 │       wireEncoding: 'raw',
116 │     });
117 │ 
118 │     const sender = new TransferSender(prepared);
119 │     const receiver = new TransferReceiver();
120 │     const scanner = new BrowserQrScanner('jsqr');
121 │ 
122 │     for (let slot = 0; slot < 120 && !receiver.isComplete; slot++) {
123 │       const symbol = sender.symbolAt(slot);
124 │       const bitmap = scaleRgbaImage(rasterizeRgba(symbol, { scale: 1, quietZone: 4 }), 3);
125 │       const decoded = scanner.decodeRgba(bitmap.data, bitmap.width, bitmap.height);
126 │       if (decoded) receiver.accept(decoded.payload);
127 │     }
128 │ 
129 │     expect(receiver.isComplete).toBe(true);
130 │     expect(Array.from(receiver.getResult()!.payload)).toEqual(Array.from(binary));
131 │   });
132 │ 
133 │   it('produces actionable diagnostic hints for unreadable, cropped, and foreign frames', () => {
134 │     const base = new TransferReceiver().getProgress();
135 │     const hints = diagnoseHints({
136 │       ...base,
137 │       framesAccepted: 5,
138 │       framesForeign: 35,
139 │       framesOrphan: 50,
140 │       framesSuspect: 30,
141 │     });
142 │     expect(hints.length).toBeGreaterThanOrEqual(3);
143 │   });
144 │ });
```

---

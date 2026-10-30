# Setup & Development Guide

LightBeam Web is a self-contained TypeScript monorepo built with **npm workspaces**. There are no native C++ addons, external databases, or cloud SDKs required.

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | `>= 20.0.0` | Uses native Web Crypto (`globalThis.crypto`), `fetch`, and ESM |
| **npm** | `>= 10.0.0` | Ships with Node 20; manages workspaces (`packages/core`, `apps/web`, `apps/server`) |
| **Modern Browser** | Chrome / Edge / Safari / Firefox | Secure context (`https://` or `http://localhost`) required for `getUserMedia` camera access |

---

## 2. Install & Build

From the repository root:

```bash
npm install
npm run build
```

What `npm run build` produces:
1. **`npm run build:core`** — Compiles `packages/core/src` to `packages/core/dist` (`tsc -p tsconfig.build.json`) with `.d.ts` declarations and source maps.
2. **`npm run build:web`** — Runs `vite build` in `apps/web`, bundling the React 18 PWA, stylesheet, icons, manifest, and Service Worker directly into `apps/server/public/`.
3. **`npm run build:server`** — Runs `apps/server/scripts/build.mjs` (`esbuild`), bundling `apps/server/src/server.ts` and `@lightbeam/core` into a single zero-dependency `apps/server/dist/server.js`.

---

## 3. Running LightBeam Web

### Unified Production Mode (Single Port)

```bash
npm start
```

Starts `apps/server/dist/server.js` on `http://0.0.0.0:8787`, serving:
- The compiled React PWA (`/` and SPA routes `/send`, `/receive`, `/files`, `/settings`, `/about`)
- Short redirect routes (`/s` -> `/send`, `/r` -> `/receive`, `/f` -> `/files`, `/docs` -> `/about`, preserving `?code=XXXXXXX`)
- Session metadata & telemetry API (`/api/health`, `/api/stats`, `/api/sessions`)

### Two-Process Hot-Reload Development

During active UI work, run the API server and Vite HMR dev server in two terminals:

```bash
# Terminal 1: unified API & short-code server on 0.0.0.0:8787
npm run dev:server

# Terminal 2: Vite HMR server on 0.0.0.0:5173 (proxies /api, /s, /r -> :8787)
npm run dev
```

---

## 4. Workspace Scripts Reference

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite HMR dev server (`apps/web`) on `0.0.0.0:5173` |
| `npm run dev:server` | Start `@lightbeam/server` in watch mode (`tsx watch`) on `0.0.0.0:8787` |
| `npm run build` | Build `@lightbeam/core`, `@lightbeam/web`, and `@lightbeam/server` in order |
| `npm start` | Run the compiled unified server (`node apps/server/dist/server.js`) |
| `npm run typecheck` | Run `tsc --noEmit` across all three workspaces |
| `npm test` | Run all unit/integration suites (`core`, `web`, `server`) + code-reference sync check |
| `npm run test:core` | Run the 81 `@lightbeam/core` protocol, QR, crypto, and fountain tests |
| `npm run test:web` | Run the `@lightbeam/web` React UI and pixel-level `jsQR` optical round-trip tests |
| `npm run test:server` | Run the `@lightbeam/server` redirect, API, security-header, and SPA tests |
| `npm run test:docs` | Verify every line in `docs/CODE-{CORE,WEB,SERVER,PROJECT}.md` matches the source tree |
| `npm run icons` | Regenerate PWA PNG icons in `apps/web/public/` via `tools/make-icons.mjs` |
| `npm run gen:qr-tables` | Regenerate `packages/core/src/qr/tables.ts` from ISO/IEC 18004 polynomials |
| `npm run diag:core` | Run a full Node compress -> fountain -> QR -> receiver -> SHA-256 diagnostic |

---

## 5. Server Environment Variables

`@lightbeam/server` works out of the box with zero configuration and accepts these optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` exposes container and live-preview interfaces) |
| `PORT` | `8787` | Listening TCP port |
| `PUBLIC_DIR` | `apps/server/public` | Directory containing the built `@lightbeam/web` SPA assets |
| `DATA_DIR` | *(unset — in-memory)* | Directory for atomic JSON persistence of session counters (`sessions.json`) |
| `FRAME_OPTIONS` | *(unset — embeddable)* | Optional `X-Frame-Options` header value (`SAMEORIGIN` or `DENY`) |

---

## 6. Browser Camera Access & HTTPS

Browsers restrict `navigator.mediaDevices.getUserMedia` to **Secure Contexts**:
- `http://localhost:8787` and `http://127.0.0.1:8787` work directly over HTTP.
- Accessing LightBeam Web from a second device over LAN or the public internet requires **HTTPS** (for example via the included [`deploy/Caddyfile`](../deploy/Caddyfile) or a cloud preview proxy).
- Even without a physical camera, you can always test the full optical pipeline using:
  1. The **Optical Loopback Workbench** on the Home screen (`/`), or
  2. **Decode image file** on the Receive screen (`/receive`) to scan saved QR screenshots.

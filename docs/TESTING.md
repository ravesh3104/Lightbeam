# Testing & Verification

Every layer of LightBeam Web is tested deterministically under **Vitest** without requiring a physical webcam, external network access, or headless browser binaries.

Run the entire verification suite with:

```bash
npm test
```

`npm test` runs four sequential gates:
1. `npm run test:core` — **81 tests** in `packages/core`
2. `npm run test:web` — **9 tests** in `apps/web`
3. `npm run test:server` — **9 tests** in `apps/server`
4. `npm run test:docs` — **95-file line-by-line documentation verification** via `tools/make-code-reference.mjs`

Run `npm run typecheck` alongside `npm test` to enforce strict TypeScript compilation across all workspaces.

---

## 1. `@lightbeam/core` Suite (`packages/core/test/`)

| Test File | What It Verifies |
| --- | --- |
| `qr-encoder.test.ts` | Galois field arithmetic, Reed-Solomon syndromes, alphanumeric/byte segment packing, mask selection, ISO/IEC 18004 capacity bounds across versions 1–40, and pixel round-trips decoded by an independent QR reader (`jsQR`). |
| `fountain.test.ts` | Robust soliton CDF normalization, deterministic `xorshift128+` neighbor sampling, peeling-decoder convergence across `k = 1 … 1024`, duplicate/corrupt frame rejection, and overhead bounds under simulated bursty frame loss. |
| `transfer-e2e.test.ts` | End-to-end `prepareTransfer` -> `TransferSender` -> `TransferReceiver` transfers: 25% packet loss recovery, early progressive image preview (`partialPayload`), XChaCha20-Poly1305 passphrase round-trips & wrong-passphrase rejection, foreign-session filtering, corrupt-payload SHA-256 rejection, and raw vs. base32 wire encodings. |
| `utf8.test.ts` | RFC 3629 UTF-8 encoding/decoding across ASCII, multi-byte BMP,astral planes (emoji surrogate pairs), overlong sequences, truncated tails, and `installUtf8Polyfill`. |

---

## 2. `@lightbeam/web` Suite (`apps/web/test/`)

| Test File | What It Verifies |
| --- | --- |
| `web-app.test.tsx` | Mounts the full React `<App />` in `jsdom`: verifies Home screen `/api/stats` telemetry rendering, History API navigation across all 6 screens (`Home`, `Send`, `Receive`, `Files`, `Settings`, `About`), preparing & streaming a text note on `SendScreen` while minting a 7-character session short-code, `/receive?code=...` query prefill, IndexedDB inbox save/list/delete round-trips, and `localStorage` settings persistence + reset. |
| `optical-transfer.test.ts` | True pixel-level browser optical simulation: encodes multi-block payloads with `TransferSender`, renders QR symbols to RGBA pixel buffers (`toRgbaBuffer` + `scaleRgbaImage`), drops 25% of frames, decodes each surviving image with `jsQR` (`decodeQrFromRgba`), reconstructs & verifies SHA-256 in `TransferReceiver`, exercises encrypted passphrase unlocking, and checks `diagnoseHints`. |

---

## 3. `@lightbeam/server` Suite (`apps/server/test/`)

| Test File | What It Verifies |
| --- | --- |
| `redirects.test.ts` | Short-link resolution (`/s` -> `/send`, `/r` -> `/receive`, `/f` -> `/files`, `/docs` -> `/about`), trailing-slash normalization, and `null` pass-through for SPA and API paths. |
| `api.test.ts` | Pure `handleApi` and `SessionStore` coverage: `/api/health`, `/api/stats`, `POST /api/sessions` validation & bounds, case-insensitive short-code retrieval, completion telemetry, and `400`/`404`/`413` error handling. |
| `server-spa.test.ts` | Live TCP socket HTTP tests against `createAppServer`: SPA `index.html` serving on `/`, `/send`, and `/receive`, security headers (`CSP`, `X-Content-Type-Options`, `Referrer-Policy`), `/r?code=K7M4P9Q` query preservation, live session API round-trips, and `403 Forbidden` rejection of encoded path traversal (`/assets/%2e%2e/...`). |
| `core-link-check.ts` | Standalone Node diagnostic (`npm run diag:core`) running a complete QR + fountain transfer and printing frame-by-frame receiver state transitions. |

---

## 4. Self-Verifying Code Reference (`npm run test:docs`)

`tools/make-code-reference.mjs` checks `docs/CODE-CORE.md`, `docs/CODE-WEB.md`, `docs/CODE-SERVER.md`, and `docs/CODE-PROJECT.md` against the live repository:
- Every tracked file must appear in the exact declared order.
- Every line count and every single source line in the Markdown code fences must match the file on disk byte-for-byte.
- Running `node tools/make-code-reference.mjs --strict` additionally verifies that **every tracked file has a written architectural walkthrough** (0 pending placeholders).

Whenever you edit a source file, resync its reference listing with:

```bash
node tools/make-code-reference.mjs --sync core     # or: web | server | project
npm run test:docs
```

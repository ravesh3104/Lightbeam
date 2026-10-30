# Architecture

LightBeam Web is structured as a strict three-package TypeScript monorepo where **cryptographic protocol math**, **browser UI & optical I/O**, and **HTTP hosting & zero-knowledge metadata** are cleanly separated.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                              Browser Client                               │
│                            (@lightbeam/web)                               │
│                                                                           │
│  ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────┐  │
│  │   SendScreen.tsx    │   │  ReceiveScreen.tsx  │   │ FilesScreen.tsx │  │
│  │  • Drag & drop/text │   │  • getUserMedia     │   │ • IndexedDB     │  │
│  │  • WakeLock + F/S   │   │  • BarcodeDetector  │   │ • Safe Blob DL  │  │
│  │  • rAF QrCanvas     │   │    + jsQR fallback  │   │ • Web Share API │  │
│  └──────────┬──────────┘   └──────────┬──────────┘   └────────▲────────┘  │
│             │                         │                       │           │
│             ▼                         ▼                       │           │
│  ┌────────────────────────────────────────────────────────────┴────────┐  │
│  │                          @lightbeam/core                            │  │
│  │  prepareTransfer -> Deflate -> XChaCha20-Poly1305 -> LT Fountain    │  │
│  │  ISO 18004 QR Encoder <-> Base32 / Raw Framing <-> Peeling Decoder  │  │
│  │  CRC-16 Header Gate • CRC-32 Manifest • End-to-End SHA-256 Gate     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Optional JSON metadata only
                                │ (NEVER file bytes or passphrases)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         Unified Node HTTP Server                          │
│                           (@lightbeam/server)                             │
│                                                                           │
│  • Serves built React PWA (apps/server/public) + SPA History fallback     │
│  • Short URLs: /s -> /send, /r -> /receive (preserving ?code=XXXXXXX)     │
│  • Zero-knowledge session registry (/api/sessions, /api/stats, /health)   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 1. `@lightbeam/core` — Platform-Agnostic Optical Engine

`packages/core` has **zero DOM or Node I/O dependencies**. It speaks purely in `Uint8Array`, strings, and deterministic state machines:

- **`qr/`** — From-scratch ISO/IEC 18004 QR encoder supporting versions 1–40, all four error-correction levels (`L`, `M`, `Q`, `H`), optimal alphanumeric/byte segmentation, Galois field `GF(256)` Reed-Solomon parity, all 8 mask patterns scored by the four standard penalty rules, and output renderers (`toRgbaBuffer`, `toSvgPath`, `toAscii`).
- **`fountain/`** — Luby Transform (`LT`) rateless erasure codec using a tuned **Robust Soliton** distribution (`c = 0.03, δ = 0.5`), deterministic `xorshift128+` PRNG seeded per frame, a `0.10·k` systematic prefix schedule, and an incremental `O(1)`-per-edge Belief-Propagation peeling decoder over `GF(2)`.
- **`crypto/`** —
  - `crc16Ccitt` on every 13-byte frame header to drop misread symbols before they can poison the peeling graph.
  - `crc32` on manifest fragments.
  - `XChaCha20-Poly1305` authenticated encryption with `scrypt` (`N = 2^15, r = 8, p = 1`) key derivation, binding manifest identity fields as AEAD Associated Data (`AAD`) and exposing an 8-hex-character human-verifiable key fingerprint.
  - `sha256Hex` over the original uncompressed plaintext, verified before any received payload is released.
- **`protocol/` & `transfer/`** — Session planner (`compact` 49×49, `balanced` 77×77, `dense` 97×97), multi-fragment JSON manifest framing, `TransferSender`, and `TransferReceiver`.

---

## 2. `@lightbeam/web` — React 18 + Vite Progressive Web App

`apps/web` wraps `@lightbeam/core` in a responsive, offline-capable browser application with six primary screens (`Home`, `Send`, `Receive`, `Files`, `Settings`, `About`):

1. **Crisp GPU QR Rendering (`components/QrView.tsx`)**
   Anti-aliased `<canvas>` drawing blurs module boundaries at 15–24 fps. `QrCanvas` writes a `1 px = 1 QR module` buffer via `putImageData` and lets the browser compositor scale it to screen dimensions with `image-rendering: pixelated`. When 2D canvas is unavailable (e.g., `jsdom` tests), `QrView` falls back automatically to a single run-length-encoded `<svg><path /></svg>`.
2. **Dual-Engine Camera Scanning (`services/scanner.ts`)**
   Queries `BarcodeDetector.getSupportedFormats()` at runtime to use native OS/GPU QR decoding on Chromium, Safari, and mobile browsers, and falls back transparently to `jsQR` over a downscaled (`<= 720px`) `willReadFrequently` canvas in Firefox and desktop environments without Shape Detection.
3. **Display Persistence (`services/display.ts`)**
   Acquires the W3C Screen Wake Lock (`navigator.wakeLock.request('screen')`) while streaming and re-acquires it across tab visibility transitions, paired with Fullscreen API support on the QR stage.
4. **IndexedDB File Inbox (`services/inbox.ts`)**
   Verified payloads are stored locally in IndexedDB (`lightbeam-inbox`) with SHA-256 digests and transfer telemetry. Downloads copy `Uint8Array` slices into fresh `ArrayBuffer` instances (`toSafeBlob`) before minting temporary `URL.createObjectURL` links.
5. **Offline PWA Shell (`public/sw.js` & `manifest.webmanifest`)**
   Caches the compiled SPA shell and static assets so two devices can load LightBeam once and subsequently run optical transfers in complete airplane-mode / air-gapped environments.
6. **Optical Loopback Workbench (`components/LoopbackBench.tsx`)**
   Runs a real pixel-level optical transfer (`TransferSender` -> `toRgbaBuffer` -> `scaleRgbaImage` -> configurable frame drop -> `jsQR` -> `TransferReceiver`) live in the browser UI.

---

## 3. `@lightbeam/server` — Unified Zero-Knowledge Web Server

`apps/server` is built solely on Node's built-in `node:http`, `node:fs`, `node:path`, and `node:crypto` modules and bundles via `esbuild` into a single `dist/server.js` artifact:

- **Static & SPA Serving**: Serves `apps/server/public/` with `Cache-Control: public, max-age=31536000, immutable` on content-hashed Vite bundles and `Cache-Control: no-cache` on `index.html`, `sw.js`, and SPA routes (`/send`, `/receive`, `/files`, `/settings`, `/about`).
- **Path-Traversal Defense**: Rejects raw request paths containing `..` or NUL bytes (`%2e%2e`, `%00`) with `403 Forbidden` *before* WHATWG `new URL()` path normalization, and double-checks resolved filesystem paths against `publicDir`.
- **Short Links**: `/s` -> `/send`, `/r` -> `/receive`, `/f` -> `/files`, and `/docs` -> `/about` (`302`), preserving query strings like `/r?code=K7M4P9Q`.
- **Zero-Knowledge Session Registry (`SessionStore`)**:
  - `POST /api/sessions` accepts *only* non-sensitive session descriptors (`fileName`, `mimeType`, `byteLength`, `blocks`, `profileId`, `fps`, `encrypted`, `codec`) and mints a 7-character session short-code with a 2-hour TTL (bounded at 500 active entries).
  - `GET /api/sessions/:code` lets a receiver inspect expected transfer parameters before scanning.
  - `POST /api/sessions/:code/complete` and `GET /api/stats` track aggregate transfer counts and bytes verified.
  - **Strict Privacy Invariant**: Neither payload bytes, QR frames, encryption keys, salts, nor passphrases ever cross the network.

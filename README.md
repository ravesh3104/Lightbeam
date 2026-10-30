# LightBeam Web

**Air-gapped optical file and text transfer in any modern browser — powered by Luby Transform fountain-coded animated QR streams.**

LightBeam Web turns one browser screen into a high-speed animated QR fountain transmitter and any second browser camera into a rateless optical receiver. No pairing, no Wi-Fi LAN discovery, no Bluetooth, and **zero file bytes or passphrases ever sent to a server**.

---

## Highlights

- **100% Web Architecture (`@lightbeam/core` + `@lightbeam/web` + `@lightbeam/server`)** — React 18 + Vite Progressive Web App served by a zero-dependency Node 20 HTTP server.
- **Rateless Luby Transform Fountain Coding** — Files are compressed (`fflate` Deflate), optionally encrypted (`XChaCha20-Poly1305` + `scrypt`), sliced into `k` blocks, and streamed as independent fountain-coded QR frames. Missed frames, camera focus hunts, and joining mid-stream require zero retransmission requests.
- **Dual Browser Optical Pipeline** —
  - **Transmitter (`QrCanvas`)**: 1-pixel-per-module HTML5 `<canvas>` upscaled on the GPU with `image-rendering: pixelated`, plus Screen Wake Lock and fullscreen stage mode.
  - **Receiver (`scanner.ts`)**: Hardware-accelerated Shape Detection `BarcodeDetector` where supported, with automatic pure-JS `jsQR` fallback (`getUserMedia` + image-frame upload).
- **In-Browser Optical Loopback Workbench** — Test a real pixel-rendered -> loss-injected -> `jsQR`-decoded -> SHA-256-verified optical transfer right inside a single browser tab on the Home screen.
- **Client-Side IndexedDB Inbox** — Received files are verified against an end-to-end SHA-256 digest before storage in IndexedDB, with instant preview, browser download, and Web Share API support.
- **Zero-Knowledge Session Short-Codes** — Optional 7-character session codes (`/r?code=XXXXXXX`) let a receiver pre-view non-sensitive session metadata (filename, size, block count, encryption flag) while payload bytes travel strictly screen-to-camera.

---

## Repository Layout

```text
lightbeam/
├── packages/
│   └── core/          # @lightbeam/core — ISO 18004 QR encoder, LT fountain codec,
│                      #   XChaCha20-Poly1305 AEAD, SHA-256/CRC, sender & receiver FSMs
├── apps/
│   ├── web/           # @lightbeam/web — React 18 + Vite PWA (6 screens, IndexedDB inbox,
│   │                  #   BarcodeDetector/jsQR camera scanner, QrCanvas, LoopbackBench)
│   └── server/        # @lightbeam/server — Unified Node 20 HTTP server (SPA shell,
│                      #   /s & /r short links, /api/sessions & /api/stats, security headers)
├── tools/
│   ├── gen-qr-tables.mjs       # Generates ISO 18004 QR tables in packages/core
│   ├── make-icons.mjs          # Pure-Node PNG icon generator for apps/web/public
│   ├── make-code-reference.mjs # Verifies docs/CODE-*.md against every source line
│   └── diag/                   # Channel & fountain-code measurement scripts
├── deploy/            # Multi-stage Dockerfile, docker-compose.yml, Caddyfile, systemd unit
└── docs/              # SETUP, ARCHITECTURE, ALGORITHMS, TESTING, and CODE-{CORE,WEB,SERVER,PROJECT}
```

---

## Quick Start

Requires **Node.js 20+** and **npm 10+**.

```bash
# 1. Install workspace dependencies
npm install

# 2. Build @lightbeam/core, @lightbeam/web (into apps/server/public), and @lightbeam/server
npm run build

# 3. Start the unified web server on http://0.0.0.0:8787
npm start
```

Open `http://localhost:8787` in any browser:
- **`/`** — Home dashboard, session short-code lookup, live server telemetry, and interactive Optical Loopback Workbench
- **`/send`** (`/s`) — Drag-and-drop file or text transmitter with density/FPS controls, passphrase encryption, and animated QR stream
- **`/receive`** (`/r`) — Live camera QR scanner (`BarcodeDetector` / `jsQR`), image-frame decoder, early image preview, and SHA-256 verification
- **`/files`** (`/f`) — Client-side IndexedDB inbox of verified received files
- **`/settings`** — Persistent browser preferences (`localStorage`)
- **`/about`** (`/docs`) — Protocol architecture, browser capability matrix, and zero-knowledge guarantees

### Hot-Reload Development

Run the Node API server (`:8787`) and Vite dev server (`:5173`, proxying `/api`, `/s`, `/r`) side by side:

```bash
npm run dev:server   # Terminal 1 — @lightbeam/server on 0.0.0.0:8787
npm run dev          # Terminal 2 — Vite HMR server on 0.0.0.0:5173
```

---

## Verification & Tests

```bash
npm run typecheck    # Strict TypeScript check across core, web, and server
npm test             # Full suite: core (81) + web (9) + server (9) + code-reference verification
npm run diag:core    # End-to-end Node optical round-trip smoke check
```

---

## Documentation

- [`GETTING-STARTED.md`](GETTING-STARTED.md) — Step-by-step quickstart, single-tab & two-device walkthroughs, and cheat sheet
- [`docs/SETUP.md`](docs/SETUP.md) — Local setup, scripts, environment variables, and camera HTTPS notes
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — End-to-end web system architecture, data flow, and security boundaries
- [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) — Deep dive into LT fountain coding, robust soliton tuning, QR encoding, base32 framing, and XChaCha20-Poly1305
- [`docs/TESTING.md`](docs/TESTING.md) — Unit, component, pixel-optical, HTTP integration, and documentation-sync test suites
- [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — Docker Compose, Caddy automatic HTTPS, and bare-metal `systemd` deployment
- **Verified Line-by-Line Code Reference**:
  - [`docs/CODE-CORE.md`](docs/CODE-CORE.md) — `packages/core` (28 files)
  - [`docs/CODE-WEB.md`](docs/CODE-WEB.md) — `apps/web` (29 files)
  - [`docs/CODE-SERVER.md`](docs/CODE-SERVER.md) — `apps/server` (12 files)
  - [`docs/CODE-PROJECT.md`](docs/CODE-PROJECT.md) — root workspace, `tools/`, and `deploy/` (26 files)

---

## License

[MIT](LICENSE)

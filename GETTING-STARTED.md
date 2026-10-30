# Getting Started with LightBeam Web

Welcome to **LightBeam Web** — an air-gapped, browser-based optical file and text transfer application. One screen displays a fountain-coded animated QR stream; any camera-equipped browser scans it and reconstructs the original file with end-to-end SHA-256 verification and optional XChaCha20-Poly1305 passphrase encryption.

No file bytes or passphrases ever leave your devices or touch the server.

---

## 1. Prerequisites

- **Node.js `>= 20.10`** (`node -v`)
- **npm `>= 10.0`** (`npm -v`)
- Any modern desktop or mobile browser (**Chrome, Edge, Safari, or Firefox**)

---

## 2. Install & Run in 3 Commands

Open a terminal in the repository root (`lightbeam-web/`) and run:

```bash
# 1. Install workspace dependencies (@lightbeam/core, @lightbeam/web, @lightbeam/server)
npm install

# 2. Build the core engine, the React + Vite PWA, and the unified Node server
npm run build

# 3. Launch the unified web server on http://0.0.0.0:8787
npm start
```

Now open **`http://localhost:8787`** in your browser.

---

## 3. Try Your First Optical Transfer

You can test LightBeam Web **immediately on a single computer** (no second device or webcam required) or **across two real devices**.

### Option A — Single-Tab Optical Loopback (30 Seconds, No Camera Needed)
1. Open **`http://localhost:8787/`** (**Home** screen).
2. Scroll to the **Optical Loopback Workbench** panel.
3. Adjust the **Simulated camera frame loss** slider (for example, `25%`) and click **Run optical loopback**.
4. Watch LightBeam compress a payload, encode Luby Transform fountain blocks into real RGBA QR images, drop 25% of frames, decode surviving pixels through `jsQR`, peel the fountain graph, and verify the **SHA-256** digest live in your browser.

### Option B — Single-Device Screenshot / Image Test (No Webcam Needed)
1. Go to **`http://localhost:8787/send`** (**Send** tab).
2. Switch to **Text note**, enter a short message (fits in 1–2 QR frames), and click **Prepare & start streaming**.
3. Pause or screenshot the QR stage (or right-click / save an image of the QR code).
4. Open **`http://localhost:8787/receive`** (**Receive** tab) and use **Decode QR image file** to feed captured QR images directly into the receiver.

### Option C — Two Real Devices (Screen $\rightarrow$ Camera)
1. **Sender device**:
   - Open **`/send`**, drop a file (up to 64 MB) or type a text note.
   - *(Optional)* Enter an **Encryption passphrase** and verify the 8-character key fingerprint.
   - Choose a **Density profile**:
     - `Compact` (`49×49`) — easiest for handheld phones or 30–50 cm distance
     - `Balanced` (`77×77`, default) — ideal for laptop/desktop screen $\rightarrow$ phone at 15–30 cm
     - `Dense` (`97×97`) — steady close-range displays (10–20 cm)
   - Click **Prepare & start streaming** (use **Fullscreen stage** for maximum QR clarity; Screen Wake Lock keeps the display awake automatically).
2. **Receiver device**:
   - Point the second device's browser at **`/receive`** (or scan/open the optional `/r?code=XXXXXXX` link to pre-view filename and block count).
   - Click **Start camera** and hold the QR stream steady inside the viewfinder reticle.
   - Watch solved blocks climb to `100%`. Once **SHA-256** matches, download the file, share it via the Web Share API, or open it anytime from the **`/files`** IndexedDB inbox.

> **Important Camera Note (HTTPS):** Browsers allow `getUserMedia` camera access on `http://localhost` and `http://127.0.0.1`, but **require HTTPS** when opening `/receive` from another phone or laptop over LAN/internet. Use the included `deploy/Caddyfile` or a local TLS tunnel (e.g., `caddy`, `mkcert`, or `cloudflared`) when testing across two devices.

---

## 4. Hot-Reload Development Workflow

When actively editing the React UI (`apps/web`) or server API (`apps/server`), run two terminals:

```bash
# Terminal 1 — Node API & session short-code server on http://0.0.0.0:8787
npm run dev:server

# Terminal 2 — Vite HMR dev server on http://0.0.0.0:5173 (proxies /api, /s, /r -> :8787)
npm run dev
```

Open **`http://localhost:5173`** for instant React Hot Module Replacement backed by the live server on `:8787`.

---

## 5. Common Commands Cheat Sheet

| Task | Command |
| --- | --- |
| Install all workspaces | `npm install` |
| Full production build (`core` + `web` + `server`) | `npm run build` |
| Start production web server (`:8787`) | `npm start` |
| Vite frontend dev server (`:5173` with HMR) | `npm run dev` |
| Node backend watch server (`:8787`) | `npm run dev:server` |
| Typecheck all packages (`tsc --noEmit`) | `npm run typecheck` |
| Run all tests + verify code docs | `npm test` |
| Run `@lightbeam/core` unit/e2e tests (81 tests) | `npm run test:core` |
| Run `@lightbeam/web` UI + pixel QR tests (9 tests) | `npm run test:web` |
| Run `@lightbeam/server` HTTP/SPA tests (9 tests) | `npm run test:server` |
| Verify `docs/CODE-*.md` against source files | `npm run test:docs` |
| Regenerate PWA PNG icons (`apps/web/public/`) | `npm run gen:icons` |
| Run CLI optical round-trip smoke test | `npm run diag:core` |

---

## 6. Project Structure at a Glance

```text
lightbeam-web/
├── GETTING-STARTED.md     # This quickstart guide
├── README.md              # Project overview
├── package.json           # Root npm workspaces & scripts
├── packages/
│   └── core/              # @lightbeam/core — QR encoder, LT fountain codec, AEAD crypto,
│                          #   compression, planner, TransferSender & TransferReceiver
├── apps/
│   ├── web/               # @lightbeam/web — React 18 + Vite PWA (Home, Send, Receive,
│   │                      #   Files Inbox, Settings, About, QrCanvas, BarcodeDetector/jsQR)
│   └── server/            # @lightbeam/server — Zero-dependency Node 20 HTTP server
│                          #   serving SPA shell, /s & /r short links, and /api/sessions
├── tools/                 # Icon generator, QR table generator, code-doc verifier, diagnostics
├── deploy/                # Dockerfile, docker-compose.yml, Caddyfile, systemd unit, DEPLOY.md
└── docs/                  # SETUP.md, ARCHITECTURE.md, ALGORITHMS.md, TESTING.md, CODE-*.md
```

---

## 7. Production Deployment (Docker / HTTPS)

### Docker Compose (Fastest)

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

This builds a minimal multi-stage Node 20 Alpine image containing the compiled React PWA (`public/`) and self-contained server (`dist/server.js`), exposing port `8787` with a `/api/health` healthcheck and persistent volume for anonymous session stats.

For automatic Let's Encrypt HTTPS with **Caddy** or bare-metal Linux **`systemd`** installation, see [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

---

## 8. Where to Read Next

- **System Design & Privacy Boundaries**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Fountain Codes, Soliton Math & Crypto**: [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md)
- **Environment Variables & Local Tooling**: [`docs/SETUP.md`](docs/SETUP.md)
- **Test Suites & Code-Doc Sync**: [`docs/TESTING.md`](docs/TESTING.md)

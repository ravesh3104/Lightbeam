# Deploying LightBeam Web

LightBeam ships as a unified Node web server (`@lightbeam/server`) hosting the
built React + Vite Progressive Web App (`@lightbeam/web`). File bytes and
passphrases **never** pass through the server — transfers travel optically from
one device's display to another device's browser camera, and once visited the
PWA's Service Worker caches the app shell so it continues working offline.

---

## 0. Browser Camera Requirement: HTTPS

Browsers expose `navigator.mediaDevices.getUserMedia` only in **secure contexts**:
- `http://localhost:8787` or `http://127.0.0.1:8787` (local single-machine testing)
- Any `https://` origin (required when opening the Receiver page on a second device over Wi-Fi or the internet)

Use the included Caddy reverse proxy (`deploy/Caddyfile`) for automatic Let's Encrypt TLS on public domains or `tls internal` on isolated LANs.

---

## 1. Docker Compose (Recommended)

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Verify health:

```bash
curl -s http://localhost:8787/api/health
```

```json
{
  "ok": true,
  "service": "lightbeam-server",
  "version": "1.0.0",
  "uptimeSeconds": 8,
  "sessions": 0,
  "storesFileContent": false
}
```

### Runtime Container Contents

| Path | Purpose |
| --- | --- |
| `/app/server.js` | Self-contained ESM bundle (`@lightbeam/server` + `@lightbeam/core`) |
| `/app/public/` | Vite-built React PWA (`index.html`, `/assets/*`, `sw.js`, `manifest.webmanifest`, icons) |
| `/data/sessions.json` | Atomic JSON session registry (metadata & anonymous telemetry only) |

---

## 2. Bare Metal with `systemd`

```bash
npm ci
npm run build

sudo useradd --system --home /var/lib/lightbeam --shell /usr/sbin/nologin lightbeam
sudo mkdir -p /opt/lightbeam /var/lib/lightbeam
sudo cp apps/server/dist/server.js /opt/lightbeam/
sudo cp -r apps/server/public /opt/lightbeam/
sudo chown -R lightbeam:lightbeam /var/lib/lightbeam

sudo cp deploy/lightbeam.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lightbeam
```

---

## 3. Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Listening TCP port |
| `HOST` | `0.0.0.0` | Bind interface (`127.0.0.1` behind a local reverse proxy) |
| `SESSION_FILE` | `apps/server/data/sessions.json` | Path to the JSON session registry |
| `FRAME_OPTIONS` | *(unset)* | Optional `X-Frame-Options` header (e.g. `SAMEORIGIN` or `DENY`) |

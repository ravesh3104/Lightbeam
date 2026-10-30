# syntax=docker/dockerfile:1
#
# LightBeam unified web server and React PWA.
#
# Multi-stage build: Stage 1 builds @lightbeam/core, bundles the React + Vite
# PWA into apps/server/public, and bundles the Node backend into a single
# self-contained dist/server.js. Stage 2 copies only server.js and public/
# into a lean Node 20 runtime with zero node_modules.

FROM node:20-bookworm-slim AS build

WORKDIR /build
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/

RUN npm install --ignore-scripts --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
COPY apps/server apps/server

RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    SESSION_FILE=/data/sessions.json

WORKDIR /app
COPY --from=build /build/apps/server/dist/server.js ./server.js
COPY --from=build /build/apps/server/public ./public

VOLUME ["/data"]
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

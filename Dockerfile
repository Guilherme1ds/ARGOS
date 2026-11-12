# syntax=docker/dockerfile:1
# ARGOS numa imagem só: a API Node.js também serve a web (WEB_DIST_DIR), no mesmo domínio.
# Banco SQLite, fotos e cópias de segurança ficam no volume /data (nunca dentro da imagem).
# Passo a passo de publicação: docs/publicar-no-ar.md

FROM node:24-bookworm-slim AS build
# Só para o caso raro de faltar binário pronto do better-sqlite3 na plataforma (compila da fonte).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm ci --prefix backend --no-audit --no-fund \
 && npm ci --prefix frontend --no-audit --no-fund
COPY backend backend
COPY frontend frontend
# A web chama /api do próprio site (mesmo domínio: o cookie de sessão SameSite=Lax funciona).
RUN npm run build --prefix backend \
 && VITE_API_URL=/api npm run build --prefix frontend \
 && npm prune --omit=dev --prefix backend --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3333 \
    DATABASE_URL=/data/argos.sqlite \
    UPLOAD_DIR=/data/uploads \
    MIGRATION_BACKUP_DIR=/data/backups/pre-migration \
    WEB_DIST_DIR=/app/web \
    TRUST_PROXY=1
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist /app/web
# O processo roda sem root; o volume nasce com o dono certo.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data"]
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3333/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# SIGTERM: a API termina as requisições em curso e fecha o SQLite antes de sair.
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]

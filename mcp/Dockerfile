# MCP TOTVS FMP — Streamable HTTP + OAuth 2.1
# Build:  docker build -t fmp/mcp-apitotvs .
# Run:    docker run -p 3300:3300 --env-file .env fmp/mcp-apitotvs

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# data/ guarda os clients OAuth registrados (monte um volume para persistir)
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- http://127.0.0.1:${PORT:-3300}/healthz || exit 1
CMD ["node", "dist/server.js"]

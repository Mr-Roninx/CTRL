# ==============================================================================
# CTRL Multi-Stage Enterprise Dockerfile
# Base: Node.js 24 Alpine with Non-Root Security Hardening
# ==============================================================================

# --- Stage 1: Build Dependencies ---
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY docs/ ./docs/
COPY public/ ./public/

RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Create non-root system user and group and writable data directory
RUN addgroup -S -g 1001 ctrl && \
    adduser -S -u 1001 -G ctrl ctrl && \
    mkdir -p /app/data && \
    chown -R ctrl:ctrl /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled files and static storefronts
COPY --from=builder --chown=ctrl:ctrl /app/dist ./dist
COPY --from=builder --chown=ctrl:ctrl /app/package.json ./
COPY --from=builder --chown=ctrl:ctrl /app/public ./public

ENV DATABASE_PATH=/app/data/ctrl.db

# Ensure all files in /app are owned by ctrl
RUN chown -R ctrl:ctrl /app

# Switch to non-root user
USER ctrl

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]

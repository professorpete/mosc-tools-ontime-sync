# Mosc-tools — Ontime Show Flow Sync
# Build:  docker build -t mosc-tools-ontime-sync .
# Run:    docker run -d --name ontimesync -p 5000:5000 -v ontimesync-data:/app/data mosc-tools-ontime-sync
FROM node:20-slim

# better-sqlite3 is a native module; node:20-slim needs a toolchain to build it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist

ENV NODE_ENV=production
ENV PORT=5000
# Keep the SQLite file on a mounted volume so targets/settings/sync log survive upgrades.
ENV SHOWFLOW_DB=/app/data/data.db
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 5000
CMD ["node", "dist/index.cjs"]

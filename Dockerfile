# 多階段構建
# Stage 1: 構建前端
ARG APP_VERSION=0.8.0
ARG APP_GIT_SHA=dev
ARG YTDLP_VERSION=2026.03.17

FROM node:20-slim AS frontend-builder
ARG APP_VERSION
ARG APP_GIT_SHA
ENV APP_VERSION=${APP_VERSION}
ENV APP_GIT_SHA=${APP_GIT_SHA}
WORKDIR /app
COPY package.json ./package.json
COPY frontend/package*.json ./frontend/
COPY src/utils/app-metadata.ts ./src/utils/app-metadata.ts
WORKDIR /app/frontend
RUN npm ci
WORKDIR /app
COPY frontend/ ./frontend/
ENV NODE_ENV=production
RUN cd frontend && npm run build

# Stage 2: 構建後端
FROM oven/bun:1 AS backend-builder
ARG APP_VERSION
ARG APP_GIT_SHA
WORKDIR /app
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV APP_GIT_SHA=${APP_GIT_SHA}
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
COPY tsconfig.json ./
RUN bun build src/index.ts --outdir dist --target bun

# Stage 3: 最終映像
FROM oven/bun:1-slim
ARG APP_VERSION
ARG APP_GIT_SHA
ARG YTDLP_VERSION
WORKDIR /app

# 安裝 mpv，並使用可控版本的 yt-dlp binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    mpv \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|amd64) ytdlp_asset="yt-dlp_linux" ;; \
      aarch64|arm64) ytdlp_asset="yt-dlp_linux_aarch64" ;; \
      armv7l|armhf) ytdlp_asset="yt-dlp_linux_armv7l" ;; \
      *) echo "Unsupported architecture for yt-dlp binary: $arch" >&2; exit 1 ;; \
    esac; \
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${ytdlp_asset}" -o /usr/local/bin/yt-dlp; \
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS" -o /tmp/yt-dlp-SHA2-256SUMS; \
    expected_sha="$(awk -v asset="$ytdlp_asset" '$2 == asset || $2 == "*"asset {print $1}' /tmp/yt-dlp-SHA2-256SUMS)"; \
    test -n "$expected_sha"; \
    echo "${expected_sha}  /usr/local/bin/yt-dlp" | sha256sum -c -; \
    rm /tmp/yt-dlp-SHA2-256SUMS; \
    chmod +x /usr/local/bin/yt-dlp; \
    yt-dlp --version

# 複製構建產物
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY package.json ./

# 複製舊版 HTML5 前端（保留作為後備）
COPY public/ ./public/

# 環境變數
ENV NODE_ENV=production
ENV LOG_LEVEL=INFO
ENV APP_VERSION=${APP_VERSION}
ENV APP_GIT_SHA=${APP_GIT_SHA}
ENV SYNC_STATE_DB_PATH=/data/sync-state.sqlite

LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${APP_GIT_SHA}"

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]

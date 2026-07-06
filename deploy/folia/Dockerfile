# syntax=docker/dockerfile:1
# Folia web（chthollyphile/folia-major, AGPL-3.0）打補丁建置：
# - 0001：WS / progress URL 改為依頁面 origin 推導（配合 nginx 反代到 bot 的 9863）
# - 0002：enableNowPlayingStage 預設開啟（零設定開箱即用）
# 補丁對應的修改原始碼公開於本 repo 的 deploy/folia/patches/，符合 AGPL-3.0 散布條件。

# 固定 Folia commit；單一事實來源為 deploy/folia/FOLIA_COMMIT，CI 會斷言兩者一致
ARG FOLIA_COMMIT=7d05426738837890005180cd74b503ce5400ede9

FROM node:20-slim AS builder
ARG FOLIA_COMMIT
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init . \
    && git remote add origin https://github.com/chthollyphile/folia-major.git \
    && git fetch --depth 1 origin "${FOLIA_COMMIT}" \
    && git checkout FETCH_HEAD
COPY patches/ /patches/
# 上游漂移時建置大聲失敗（刻意）：套不上就升級 pin 並重生補丁
RUN git apply --verbose /patches/*.patch
RUN npm ci --no-audit --no-fund \
    && npm run build

FROM nginx:alpine
COPY --from=builder /src/dist /usr/share/nginx/html
COPY --from=builder /src/LICENSE /usr/share/nginx/html/LICENSE.txt
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

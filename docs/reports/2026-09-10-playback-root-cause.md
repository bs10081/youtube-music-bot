# YouTube 播放故障：根因與 0.11.1 修復驗證

調查日期：2026-09-10。基線：`a4c79d0`（root version `0.11.0`）。修復版本：`0.11.1`。

## 結論與證據強度

主要問題是播放器 client／媒體存取相容性，不是缺少 YouTube Data API key。yt-dlp 上游已記錄：自 2026-08-17 起，`android_vr` 1.65.10 的格式會收到 403，並已將其從預設 client 移除。[1] 本專案卻在程式預設、Compose 與 mpv hook 同時強制該 profile，Docker 亦停在 yt-dlp `2026.03.17`。

本次已完成本機實網、應用程式與回歸測試。**尚未連線生產主機取得 effective environment、image digest、故障當時日誌，不能宣稱這是生產環境的唯一原因或已完成生產驗收。** 生產出口 IP 的 bot 判定、cookies、音訊裝置仍可能另有問題。

### 故障放大因素

- 原 `MusicService` 優先呼叫 youtubei.js direct decipher，但專案沒有配置自訂 evaluator。修復不注入 `eval`／`new Function`，改由 yt-dlp 處理抽流，youtubei.js 保留搜尋與中繼資料職責。
- 原 `PlayerService` 在 2.5 秒沒有確認時仍回報成功；IPC 連線失敗、僅收到 `file-loaded`、提前 exit 0，也可能造成誤判。回歸測試先重現失敗，再完成修正。
- IPC 使用每次 socket chunk 直接拆 JSON，可能丟失跨 chunk 的播放進度；首次 observe 事件也可能早於 confirmation timer 設定。本次均有回歸測試。
- `yt-dlp -g` 成功不代表 URL 可用，`/api/health` 僅為 liveness，不能證明 YouTube 可播放。
- Watchtower 更新映像不會更改舊容器環境變數；只改預設常數不足以修復既有部署。

## 修復內容

| 範圍 | 0.11.1 行為 |
|---|---|
| yt-dlp profile | 預設 `youtube:player_client=default`；精確匹配舊 `android_vr` 預設時自動遷移，其他自訂設定原樣保留 |
| 抽流 | `MusicService.getStreamUrl()` 使用 yt-dlp，保留快取與 in-flight 去重 |
| mpv fallback | 使用同一組 extractor args／cookies，並遵守 `YTDLP_PATH`；是重新解析路徑，不是獨立上游備援 |
| 播放確認 | 必須收到正數 `time-pos`；30 秒無進度、IPC 失敗、載入錯誤或未確認就退出均拒絕 |
| IPC | 保留未完成 JSON chunk；先建立 confirmation，再開始連線，避免首個進度事件遺失 |
| youtubei.js | 17.0.1 → 18.0.0；實網搜尋成功 |
| Docker yt-dlp | 2026.03.17 → 2026.08.19（官方發行版）[2] |
| Docker JS runtime | 加入官方 Deno 2.9.6 多架構 binary，image digest 固定；yt-dlp 官方 standalone binary 提供 EJS |
| Bun | CI／Docker 固定 1.3.14，與本機驗證版本一致 |
| 其他相依套件 | Hono 4.13.7、ws 8.21.3；移除未使用的 youtube-ext／undici；前端只更新相容版本 |
| 可觀測性 | `/api/system/info` 增加 Deno 狀態；runtime 探測加 5 秒逾時 |
| smoke test | 新增 `bun run check:playback`：抽流 → HTTP Range／媒體 bytes → mpv 無聲短解碼；失敗 exit 非零，不輸出 signed URL |
| 發布 | Docker workflow 先等待 reusable CI 通過，新增 root package version tag；避免 CI concurrency 互相取消 |

## 本機驗證紀錄

### 測試與建置

- 原始基線：239 tests passed；前端建置成功。
- 修復後：257 tests passed、0 failed（40 files）；`bun run typecheck` 通過。
- 後端與 probe bundle 建置成功：`dist/index.js`、`dist/check-playback.js`。
- 前端 `npm run build` 通過（Vite 7.3.6）；仍有既有 bundle >500 kB 警告。
- `actionlint .github/workflows/ci.yml .github/workflows/docker-image.yml` 通過。
- `hadolint --failure-threshold error Dockerfile` 通過；DL4006／SC3040 shell 警告已對照基線，並非本次新增。
- `docker compose config --quiet` 通過。
- `bun audit`：0 known vulnerabilities。
- 前端相容升級後 `npm audit`：剩 5 個 moderate 相依節點，源於 node-vibrant → Jimp → file-type 的同一條相依鏈；未使用破壞性 `audit fix --force`，未宣稱完全無漏洞。

### 實網媒體驗證

命令：

```sh
bun run check:playback dQw4w9WgXcQ D2HoBIh3zJ4 jNQXAC9IVRw
```

| Video ID | client / itag | HTTP Range | Content-Type | mpv |
|---|---|---:|---|---:|
| dQw4w9WgXcQ | VISIONOS / 251 | 206 | audio/webm | exit 0 |
| D2HoBIh3zJ4 | VISIONOS / 251 | 206 | audio/webm | exit 0 |
| jNQXAC9IVRw | VISIONOS / 251 | 206 | audio/webm | exit 0 |

最初使用的 `BaW_jenozKc` 回報 `This video is unavailable`、yt-dlp exit 1；確認為不可用影片後，改用 README 既有音樂影片 `D2HoBIh3zJ4`，保留此失敗紀錄，不將其隱藏為成功。

### WebUI／API

- 開發後端：`http://127.0.0.1:3000`；前端：`http://127.0.0.1:5174`，均實際回 HTTP 200。
- Header 顯示 `v0.11.1`、WebSocket 已連線。
- youtubei.js 搜尋 `Rick Astley Never Gonna Give You Up` 有正常音樂結果。
- 透過 WebUI 加入歌曲 `lYBUbBu4W08`，實際播放進度由 44.263235 秒增加到 46.353966 秒，duration 213.581 秒。
- UI 暫停後 API `isPlaying=false`，位置保持 112.395667 秒；恢復後 `isPlaying=true` 且進度增加至 182.258017 秒。測試音量維持 0，**不宣稱聽到實際喇叭聲音**。

### 容器驗證

最終原始碼的 Linux ARM64 映像已實際建置並執行成功。Deno 2.9.6、yt-dlp 2026.08.19、mpv 0.40.0 均可執行。yt-dlp verbose 診斷確認 `yt_dlp_ejs-0.8.0` 與 `JS runtimes: deno-2.9.6`。

容器實際啟動於 `http://127.0.0.1:3300`，首頁、`/api/health`、`/api/system/info` 全部 HTTP 200；API version 為 0.11.1，依賴版本與映像相符。驗證映像的 gitSha 為明確標示的 `local-verify`，不是發布 commit 的 SHA。

特別用 `YTDLP_EXTRACTOR_ARGS=youtube:player_client=android_vr` 啟動容器內 smoke test，回報有效 profile 為 `default`；上述三支影片全部 HTTP 206、audio/webm、mpv exit 0。此結果證明舊 exact default 的容器環境遷移有效。

本機驗證平台為 Linux ARM64；Linux AMD64 的結果須以本次 GitHub Actions 多架構建置完成狀態為準。

## GitHub Actions 與 Docker 發布機制

依據 `.github/workflows/docker-image.yml`、`.github/workflows/ci.yml`、`docker-compose.yml` 的實際設定：

1. push 到 `main` 或 `codex/dev` 自動觸發 Docker workflow；也支援 `workflow_dispatch`。
2. 先通過 CI（後端型別檢查／測試、前端建置、Dockerfile lint），再建置 `linux/amd64`、`linux/arm64`。
3. 發布至 **Docker Hub `bs10081/youtube-music-bot`**，不是 GHCR。
4. main 發布 `latest`、`main`、`sha-<commit>`、root package version（此版 `0.11.1`）；其他分支不更新 main／latest。
5. PR 只檢查，不登入 Docker Hub，也不發布映像。
6. Secrets 為既有 `DOCKERHUB_USERNAME` 與 `DOCKERHUB_TOKEN`。本次不讀出或修改憑證。
7. Compose 仍使用 latest，且 Watchtower 每 300 秒檢查；因此推送 main 後，生產可能自動升級。這不是確認生產已升級的證據。

本報告的本機驗證不替代新 commit 的 Actions 結果。必須另行確認實際 run 的成功狀態、registry manifest 與 root version，才能宣稱新映像已發布。

## 生產驗收與回復

1. 記錄正在執行的 image ID／digest、`/api/system/info`，保留舊 digest 供 rollback。不要把 cookies、完整 env 或 signed media URL 貼到公開紀錄。
2. 更新 Compose 的 `YTDLP_EXTRACTOR_ARGS` 為 `youtube:player_client=default`。舊 exact default 雖有程式遷移，仍建議同步部署檔。
3. 新映像發布後，依部署方式 pull/recreate（macOS 音訊部署沿用既有 override），確認版本為 0.11.1、yt-dlp 2026.08.19、Deno 可用。
4. 在生產容器內執行：

   ```sh
   docker compose exec -T youtube-music-bot \
     bun run dist/check-playback.js dQw4w9WgXcQ D2HoBIh3zJ4 jNQXAC9IVRw
   ```

5. 用 WebUI 點歌，確認實際聲音、暫停／恢復、切歌、歌詞、佇列；mpv null output smoke test 不能證明 ALSA／PulseAudio／CoreAudio 的實體輸出正常。
6. 若需人工控制升級，改用特定 image digest 並停用該服務的 Watchtower label；若回退，需同時確認舊映像不會重新使用已失效 client。
7. 若新版仍出現 403／驗證要求，再依生產出口 IP、影片狀態、cookies／PO Token 調查，不以關閉驗證或執行未隔離的遠端 JavaScript 代替修復。

## Sources

[1] https://github.com/yt-dlp/yt-dlp/pull/17461 — yt-dlp removes retired android_vr default client
[2] https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19 — yt-dlp 2026.08.19

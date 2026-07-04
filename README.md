# YouTube Music 點歌機器人 WebUI

一個基於 Web 的 YouTube Music 點歌系統，用戶可以透過瀏覽器搜尋、點歌和控制播放，音訊則透過連接的音箱輸出。

## 功能特色

- 🔍 **搜尋歌曲**：透過歌曲名稱、歌手或 YouTube 連結搜尋
- 🎵 **點歌系統**：加入歌曲到播放清單
- 🎮 **播放控制**：播放/暫停、下一首、音量調整
- 📋 **播放清單**：查看和管理排隊中的歌曲
- 📝 **同步歌詞**：即時顯示歌詞（支援 LRC 格式）
- 🔄 **即時同步**：透過 WebSocket 即時更新所有客戶端的狀態
- 🔉 **音量平衡**：依 YouTube loudness metadata 自動衰減偏 loud 的歌曲，不會提高主音量或額外放大較安靜的曲目
- 💾 **持久化同步 Session**：容器重啟後保留配對關係，不需要重新配對
- 🏷️ **版本可見性**：前端 Header 與後端 API 會顯示目前系統版本與 Git SHA

## 播放技術原理

目前播放鏈路採用「多層 fallback」設計，目標是在 YouTube 對不同 IP、不同 client profile 行為不一致時，仍盡量保持可播放。

### 後端播放流程

1. 前端透過 `POST /api/queue`、`POST /api/mix` 或 radio 補歌，把 `Track` 送進 `QueueService`
2. `QueueService.playNext()` 取出下一首歌，先呼叫 `MusicService.getStreamUrl(videoId)`
3. `MusicService.getStreamUrl()` 先嘗試 `youtubei.js`
4. 如果 `youtubei.js` 拿不到有效 audio URL，會 fallback 到 `yt-dlp -g`
5. 後端拿到最終的直連音訊 URL 後，呼叫 `PlayerService.playUrl()`
6. `PlayerService` 啟動 `mpv --no-video` 播放該 URL，並透過 mpv IPC 監聽進度、暫停、EOF
7. 如果直連 URL 播放失敗，才退回 `PlayerService.play(videoId)`，讓 mpv 自己處理 YouTube URL

### 為什麼這樣設計

- `youtubei.js` 理論上最快，因為不需要額外啟動 CLI
- `yt-dlp -g` 在實務上更抗 YouTube 的 bot 判定，尤其在樹莓派或家用網路 IP 上
- `mpv` 直開 YouTube URL 仍保留作最後保底，避免單一路徑失效時完全不能播

### 關鍵服務責任

- [music.service.ts](src/services/music.service.ts)
  負責搜尋、歌詞、mix、串流 URL 提取
- [queue.service.ts](src/services/queue.service.ts)
  負責 queue、mix、radio、播放策略與 fallback 決策
- [player.service.ts](src/services/player.service.ts)
  負責 mpv 行程、IPC 狀態同步、pause/resume/seek/stop
- [ytdlp.ts](src/utils/ytdlp.ts)
  負責 `yt-dlp` extractor args 與 cookies 設定

### 與 anti-bot 有關的設定

可以透過環境變數調整 `yt-dlp` 行為：

```bash
YTDLP_EXTRACTOR_ARGS="youtube:player_client=android_vr"
YTDLP_COOKIES_FILE="/app/secrets/youtube-cookies.txt"
```

- `YTDLP_EXTRACTOR_ARGS`
  用來指定 YouTube extractor profile，預設為 `youtube:player_client=android_vr`
- `YTDLP_COOKIES_FILE`
  當 YouTube 對目前 IP 要求人類驗證時，可掛入已登入帳號匯出的 cookies 檔

### Folia Now Playing bridge（選配）

可將本服務作為 [Folia](https://github.com/chthollyphile/folia-major) 的外部播放源：啟用後會在獨立 port 提供 Widdit now-playing-service 相容的 WebSocket（`/api/ws/lyric`，推送 `Track` / `Lyric` / `PlayerPauseState` / `PlayerProgress` / `PlayerProgressReplay` 事件）與進度查詢端點（`GET /api/query/progress`），Folia 的 Stage 模式即可同步顯示目前播放的曲目、封面與 LRC 歌詞。

```bash
FOLIA_BRIDGE=true   # 啟用 bridge（預設關閉）
FOLIA_PORT=9863     # Folia 端 hardcode 9863，通常不需更改
FOLIA_HOST=127.0.0.1 # 協定無認證，預設只綁 loopback；跨機需明確設定
```

實作位於 [folia-bridge.ts](src/websocket/folia-bridge.ts)，與既有 `/ws` 頻道完全獨立。

## 系統架構

```
┌─────────────────┐                    ┌─────────────────┐
│   手機/電腦      │    WebSocket       │   後端 Server   │
│   瀏覽器        │ ◄────────────────► │   (Bun/Hono)    │
├─────────────────┤                    ├─────────────────┤
│ - 搜尋歌曲       │                    │ - 管理播放清單   │
│ - 點歌          │                    │ - youtubei.js   │
│ - 看播放清單     │                    │ - mpv 播放      │
│ - 播放控制       │                    │                 │
│ - 顯示歌詞       │                    │                 │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                │ mpv (--no-video)
                                                ▼
                                       ┌─────────────────┐
                                       │   音箱 / 喇叭    │
                                       └─────────────────┘
```

## 技術棧

### 後端
- **Runtime**: Bun
- **Backend**: Hono (Web 框架)
- **播放器**: mpv (音訊播放)
- **YouTube API**: youtubei.js
- **歌詞**: LRCLIB API
- **即時通訊**: WebSocket

### 前端
- **React 19** - UI 框架
- **TypeScript** - 類型安全
- **Vite** - 構建工具
- **Tailwind CSS v4** - 樣式框架
- **Zustand** - 狀態管理
- **COSS UI** - 設計系統

## 安裝需求

### 1. 安裝 Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 2. 安裝 mpv 播放器

```bash
# macOS
brew install mpv

# Ubuntu/Debian
sudo apt install mpv

# Windows
# 從 https://mpv.io 下載並安裝
```

### 3. 安裝專案依賴

```bash
# 後端依賴
bun install

# 前端依賴
cd frontend && npm install && cd ..
```

## 使用方式

### 開發模式

**方式一：分別啟動（推薦）**

```bash
# 終端 1：啟動後端
bun run dev

# 終端 2：啟動前端
npm run dev:frontend
```

前端會在 http://localhost:5174 啟動，並自動代理 API 到後端 http://localhost:3000。

**方式二：僅啟動後端（使用舊版 HTML5 前端）**

```bash
bun run dev
# 訪問 http://localhost:3000 使用基礎 HTML5 版本
```

### 生產模式

```bash
# 1. 構建前端和後端
npm run build:all

# 2. 啟動生產服務器
npm run start
```

生產模式下訪問 http://localhost:3000 即可使用完整功能的 React 前端。

## Docker 部署（樹莓派）

本專案支援透過 Docker 部署到樹莓派，提供簡單的容器化部署方案。

### 已提供的 Docker Hub 映像

目前已經有預先建好的映像可直接使用：

```bash
bs10081/youtube-music-bot:latest
```

如果你只是想快速啟動，不需要自己先安裝 Bun、Node.js 或 buildx，直接 pull 這個 image 就可以。

### 前置需求

- 樹莓派（推薦 64 位元系統，如 Raspberry Pi OS 64-bit）
- Docker 和 Docker Compose 已安裝
- 音頻設備正常運作

### 新手快速開始

#### 方式 0：直接用 `docker run`

這是最快的方式，適合先確認服務有沒有正常跑起來。

```bash
docker run -d \
  --name youtube-music-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  --device /dev/snd:/dev/snd \
  -e NODE_ENV=production \
  -e LOG_LEVEL=INFO \
  bs10081/youtube-music-bot:latest
```

啟動後直接開瀏覽器看：

```bash
http://<你的主機IP>:3000
```

查看日誌：

```bash
docker logs -f youtube-music-bot
```

停止與刪除：

```bash
docker stop youtube-music-bot
docker rm youtube-music-bot
```

#### 方式 0-2：直接用 `docker compose`

如果你比較習慣用 compose，先建立一份 `docker-compose.yml`：

```yaml
services:
  youtube-music-bot:
    image: bs10081/youtube-music-bot:latest
    container_name: youtube-music-bot
    restart: unless-stopped
    ports:
      - "3000:3000"
    devices:
      - /dev/snd:/dev/snd
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=INFO
      - SYNC_STATE_DB_PATH=/data/sync-state.sqlite
      - YTDLP_EXTRACTOR_ARGS=youtube:player_client=android_vr
    volumes:
      - sync-state:/data

volumes:
  sync-state:
```

啟動：

```bash
docker compose up -d
```

更新到最新版本：

```bash
docker compose pull
docker compose up -d
```

`/data/sync-state.sqlite` 會保存同步 session 與裝置撤銷狀態，因此只要不要刪掉 volume，容器重啟或重新建立後都不需要重新配對。

如果之後遇到 YouTube anti-bot 變嚴，可以再加 cookies 掛載：

```yaml
services:
  youtube-music-bot:
    image: bs10081/youtube-music-bot:latest
    volumes:
      - ./secrets:/app/secrets:ro
    environment:
      - YTDLP_EXTRACTOR_ARGS=youtube:player_client=android_vr
      - YTDLP_COOKIES_FILE=/app/secrets/youtube-cookies.txt
```

### 部署方式

#### 方式一：在樹莓派上直接構建

```bash
# 1. 複製專案到樹莓派
git clone <your-repo-url> youtube-music-bot
cd youtube-music-bot

# 2. 構建並啟動服務
docker compose up -d

# 3. 查看日誌
docker compose logs -f
```

#### 方式二：跨架構構建（在 Mac/PC 上）

這個方式適合在 Mac 或 PC 上構建 ARM64 映像，然後傳輸到樹莓派。

**步驟 1：在 Mac/PC 上構建 ARM64 映像**

```bash
# 設置 buildx 構建器（首次需要）
docker buildx create --name arm-builder --use

# 構建 ARM64 映像並保存為 tar
docker buildx build --platform linux/arm64 \
  -t youtube-music-bot:latest \
  --output type=docker,dest=youtube-music-bot-arm64.tar .
```

**步驟 2：傳輸映像到樹莓派**

```bash
# 使用 scp 傳輸（替換 <樹莓派IP>）
scp youtube-music-bot-arm64.tar pi@<樹莓派IP>:~/

# 或使用 rsync（支援斷點續傳）
rsync -avP youtube-music-bot-arm64.tar pi@<樹莓派IP>:~/

# 同時傳輸 docker-compose.yml
scp docker-compose.yml pi@<樹莓派IP>:~/youtube-music-bot/
```

**步驟 3：在樹莓派上載入並啟動**

```bash
# SSH 進入樹莓派
ssh pi@<樹莓派IP>

# 載入 Docker 映像
docker load -i youtube-music-bot-arm64.tar

# 啟動服務
cd ~/youtube-music-bot
docker compose up -d

# 查看日誌
docker compose logs -f
```

#### 方式三：正式環境建議流程（GitHub + Docker Hub + 樹莓派）

這是目前實際使用的部署方式，適合日常更新生產環境。

如果你是第一次從舊版升級到 `0.2.0` 之後的版本，舊瀏覽器本地資料裡還沒有 `deviceToken`，現有同步裝置可能需要重新配對一次；完成一次後，後續容器重啟就不應再要求重新配對。

**步驟 1：本地驗證**

```bash
bun run typecheck
bun test src/__tests__
npm run build:frontend
npm run build
```

**步驟 2：提交並推送**

```bash
git add -A
git commit -m "fix: your-change-summary"
git push origin main
```

**步驟 3：建置 ARM64 映像並推送到 Docker Hub**

如果你本機已經有設定好 `buildx` builder，可以直接用下面這段：

```bash
GIT_SHA=$(git rev-parse --short HEAD)

docker buildx build \
  --builder multiplatform-builder \
  --platform linux/arm64 \
  -t bs10081/youtube-music-bot:$GIT_SHA \
  -t bs10081/youtube-music-bot:latest \
  --push .
```

如果你還沒有 builder，先建立一次：

```bash
docker buildx create --name multiplatform-builder --use
docker buildx inspect --bootstrap
```

**步驟 4：在樹莓派更新 compose 使用的 image tag**

假設 SSH alias 是 `moli-music`，而部署目錄是 `~/Host`：

```bash
GIT_SHA=$(git rev-parse --short HEAD)

ssh moli-music '
  cp ~/Host/docker-compose.yml ~/Host/docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S) &&
  sed -i "s|image: bs10081/youtube-music-bot:.*|image: bs10081/youtube-music-bot:'"$GIT_SHA"'|" ~/Host/docker-compose.yml &&
  cd ~/Host &&
  docker compose pull &&
  docker compose up -d &&
  docker compose ps
'
```

**步驟 5：檢查部署後日誌**

```bash
ssh moli-music '
  cd ~/Host &&
  docker compose logs --tail=120 youtube-music-bot
'
```

如果要直接驗證點歌 API：

```bash
ssh moli-music 'python3 - <<'"'"'PY'"'"'
import json
import urllib.request

payload = {
    "track": {
        "videoId": "D2HoBIh3zJ4",
        "title": "抽纸",
        "artist": "衛蘭",
        "duration": 229,
        "thumbnail": "https://img.youtube.com/vi/D2HoBIh3zJ4/mqdefault.jpg",
    }
}

req = urllib.request.Request(
    "http://localhost:3000/api/queue",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(req, timeout=15) as response:
    print(response.read().decode())
PY'
```

### 驗證部署

1. 訪問 `http://<樹莓派IP>:3000`
2. 搜尋並加入歌曲到播放清單
3. 確認音頻從樹莓派連接的音箱輸出

### Docker 管理指令

```bash
# 啟動服務
docker compose up -d

# 停止服務
docker compose down

# 重新啟動服務
docker compose restart

# 查看日誌
docker compose logs -f

# 更新映像並重啟
docker compose pull
docker compose up -d
```

### 音頻配置說明

**ALSA（預設）**：
Docker Compose 配置已掛載 `/dev/snd`，支援直接使用 ALSA 音頻設備。

**PulseAudio（進階）**：
如果樹莓派使用 PulseAudio，請編輯 `docker-compose.yml`，取消註解 PulseAudio 相關配置：

```yaml
volumes:
  - /run/user/1000/pulse:/run/user/1000/pulse
environment:
  - PULSE_SERVER=unix:/run/user/1000/pulse/native
```

### 疑難排解

**音頻無輸出？**
1. 確認音頻設備已正確掛載：`ls -l /dev/snd`
2. 檢查容器是否有音頻設備訪問權限
3. 測試 mpv 是否正常：`docker exec youtube-music-bot mpv --version`

**無法連接服務？**
1. 確認服務正在運行：`docker compose ps`
2. 檢查防火牆設定：`sudo ufw status`
3. 查看詳細日誌：`docker compose logs -f`

## 常見錯誤與 Debug 方式

### 1. `Sign in to confirm you’re not a bot`

這通常表示：

- 目前出口 IP 被 YouTube 風控
- `mpv` 內建的 YouTube 抽流路徑被擋
- 需要 cookies 或不同 extractor profile

**先做這個檢查：**

```bash
docker compose exec -T youtube-music-bot \
  yt-dlp --no-warnings --no-playlist -g -f bestaudio/best \
  --extractor-args "youtube:player_client=android_vr" \
  "https://www.youtube.com/watch?v=D2HoBIh3zJ4"
```

如果這裡能拿到 `googlevideo.com` 的 URL，代表 `yt-dlp` fallback 仍然可用，問題通常不在最底層連線。

如果這裡也失敗：

- 嘗試掛 `YTDLP_COOKIES_FILE`
- 嘗試更新 `yt-dlp`
- 嘗試更換 `YTDLP_EXTRACTOR_ARGS`
- 檢查目前網路 IP 是否被更嚴格限制

### 2. `No suitable audio stream found`

這通常是 `youtubei.js` 這條路拿不到可用 audio format。

這不一定是致命錯誤，因為系統會自動 fallback 到 `yt-dlp -g`。真正要看的不是這一行本身，而是後面有沒有：

- `Primary stream extraction failed, trying yt-dlp CLI fallback`
- `Stream URL obtained via yt-dlp CLI`
- `Playback started successfully via direct stream URL`

### 3. `mpv exited with code 2`

這通常表示：

- `mpv` 收到的來源 URL 無法播放
- `mpv` 直開 YouTube URL 時被 bot 驗證擋下
- URL 過期或格式不支援

**建議檢查順序：**

1. 看前面是 `playUrl()` 還是 `play(videoId)`
2. 如果是 `play(videoId)`，表示已經走到最後 fallback，通常代表前面的直連 URL 路徑也失敗了
3. 如果是 `playUrl()`，把同一條 URL 拿去容器內直接測：

```bash
docker compose exec -T youtube-music-bot \
  mpv --no-video "<DIRECT_STREAM_URL>"
```

### 4. `IPC connected successfully` 但之後沒有聲音

這表示：

- mpv 行程已經起來
- IPC 已建立
- 但不代表音訊一定真的成功播放到尾

要繼續看後面的 log 是否出現：

- `Property change {"name":"duration"...}`
- `Property change {"name":"pause","data":false}`
- `mpv process exited {"code":2...}`

如果很快就 exit，通常還是來源 URL、音訊設備或 bot 驗證問題。

### 5. `yt-dlp executable not found`

表示容器或主機內沒有 `yt-dlp`。

檢查：

```bash
docker compose exec -T youtube-music-bot which yt-dlp
docker compose exec -T youtube-music-bot yt-dlp --version
```

本專案的 [Dockerfile](Dockerfile) 已經在 runtime image 中安裝 `yt-dlp`。

### 6. JSON Parse error: `Expected '}'`

這通常不是後端播放 bug，而是手動測 API 時 shell quoting 壞掉。

如果要在 SSH 內測 API，建議直接用 Python 送 JSON，而不是在 shell 內手刻巢狀引號。

### Debug 建議順序

當「歌曲不會播放」時，建議按這個順序排查：

1. 看服務是否正常啟動

```bash
docker compose ps
docker compose logs --tail=120 youtube-music-bot
```

2. 看 `yt-dlp` 是否能拿到直連 URL

```bash
docker compose exec -T youtube-music-bot \
  yt-dlp --no-warnings --no-playlist -g -f bestaudio/best \
  --extractor-args "youtube:player_client=android_vr" \
  "https://www.youtube.com/watch?v=<VIDEO_ID>"
```

3. 看 `mpv` 是否能播放直連 URL

```bash
docker compose exec -T youtube-music-bot mpv --no-video "<DIRECT_STREAM_URL>"
```

4. 看後端實際走的是哪條路

你要在 log 中找到這幾個關鍵訊號：

- `Fetching direct stream URL for playback`
- `Primary stream extraction failed, trying yt-dlp CLI fallback`
- `Stream URL obtained via yt-dlp CLI`
- `Playback started successfully via direct stream URL`

5. 如果還是不穩，再加入 cookies

```yaml
environment:
  - YTDLP_EXTRACTOR_ARGS=youtube:player_client=android_vr
  - YTDLP_COOKIES_FILE=/app/secrets/youtube-cookies.txt
volumes:
  - ./secrets:/app/secrets:ro
```

## GitHub Actions 自動建置 Docker Image

專案已提供 GitHub Actions workflow 來自動建置 Docker image：

- `push` 到 `main` 時：自動 build 並 push 到 Docker Hub
- `pull_request` 時：只驗證 Dockerfile 能不能成功 build，不 push
- `workflow_dispatch` 時：可手動觸發

Workflow 檔案位置：

- [.github/workflows/docker-image.yml](.github/workflows/docker-image.yml)

### 需要設定的 GitHub Secrets

到 GitHub repository 的 `Settings -> Secrets and variables -> Actions`，新增：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

建議 `DOCKERHUB_TOKEN` 使用 Docker Hub 的 access token，不要直接用帳號密碼。

### 自動產生的 tag 規則

在 `main` 分支 push 時，workflow 會推這些標籤：

- `latest`
- `main`
- `sha-<commit>`

這樣正式環境可以固定拉 `latest`，也可以針對某次部署鎖定特定 SHA tag。

### 存取 WebUI

1. 開啟瀏覽器訪問 `http://localhost:3000`
2. 使用搜尋功能找到想聽的歌曲
3. 點擊搜尋結果加入播放清單
4. 系統會自動開始播放，音訊從連接的音箱輸出
5. 可以使用多台裝置同時控制播放

## API 文件

### REST API

#### `GET /api/search?q={query}`
搜尋歌曲。

**回應範例**:
```json
{
  "success": true,
  "data": [
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "duration": 212,
      "thumbnail": "https://..."
    }
  ]
}
```

#### `POST /api/queue`
加入歌曲到播放清單。

**請求範例**:
```json
{
  "track": {
    "videoId": "dQw4w9WgXcQ",
    "title": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "duration": 212,
    "thumbnail": "https://..."
  }
}
```

#### `GET /api/queue`
取得播放清單。

#### `DELETE /api/queue/{index}`
從播放清單移除歌曲。

#### `GET /api/state`
取得目前播放狀態。

#### `GET /api/system/info`
取得系統版本資訊，會回傳：

```json
{
  "success": true,
  "data": {
    "appVersion": "0.7.10",
    "gitSha": "abc1234",
    "buildVersion": "0.7.10+abc1234",
    "environment": "production"
  }
}
```

#### `GET /api/lyrics`
取得目前歌曲的歌詞。

### WebSocket API

**連接**: `ws://localhost:3000/ws`

#### 伺服器 → 客戶端

```javascript
// 播放狀態更新
{
  "type": "playback_state",
  "state": {
    "isPlaying": true,
    "currentTrack": { ... },
    "position": 45.2,
    "duration": 212,
    "volume": 70,
    "queue": [ ... ]
  }
}

// 播放清單更新
{
  "type": "queue_updated",
  "queue": [ ... ]
}

// 歌詞
{
  "type": "lyrics",
  "lyrics": [
    { "time": 0, "text": "..." },
    ...
  ]
}
```

#### 客戶端 → 伺服器

```javascript
// 播放/暫停
{ "type": "play" }
{ "type": "pause" }

// 下一首
{ "type": "skip" }

// 音量
{ "type": "volume", "value": 80 }
```

## 檔案結構

```
youtube-music-bot/
├── package.json
├── tsconfig.json
├── README.md
├── src/                      # 後端程式碼
│   ├── index.ts              # 入口點
│   ├── server.ts             # Hono server + WebSocket
│   ├── routes/
│   │   └── api.ts            # REST API 路由
│   ├── services/
│   │   ├── music.service.ts  # YouTube Music 服務
│   │   ├── player.service.ts # mpv 播放器控制
│   │   └── queue.service.ts  # 播放清單佇列
│   ├── websocket/
│   │   └── handler.ts        # WebSocket 事件處理
│   └── types/
│       └── index.ts          # 類型定義
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── components/       # React 組件
│   │   ├── hooks/            # 自定義 Hooks
│   │   ├── stores/           # Zustand 狀態管理
│   │   ├── services/         # API 服務層
│   │   └── types/            # 前端類型定義
│   └── dist/                 # 構建產物（生產模式）
└── public/                   # 舊版 HTML5 前端（保留）
    ├── index.html
    ├── style.css
    └── app.js
```

## 常見問題

### mpv 找不到？

確保 mpv 已安裝並在 PATH 中：

```bash
which mpv
mpv --version
```

如果 mpv 在自訂路徑，可設定環境變數：

```bash
export MPV_PATH=/path/to/mpv
```

### 無法播放歌曲？

1. 檢查網路連線
2. 確認 mpv 正常運作：`mpv https://www.youtube.com/watch?v=dQw4w9WgXcQ`
3. 查看伺服器日誌是否有錯誤訊息

### WebSocket 連接失敗？

1. 確認伺服器正在運行
2. 檢查防火牆設定
3. 如果使用代理，確保 WebSocket 連接未被阻擋

## 授權

MIT License

## 已知問題 / TODO

### YouTube.js 直接串流 URL 無法獲取 (2026-03)

**問題描述**：
YouTube API 返回的 `streaming_data` 中，`url`、`signature_cipher`、`cipher` 屬性皆為 `undefined`，導致無法直接獲取串流 URL。

**影響**：
- 目前多數情況會自動 fallback 到 `yt-dlp -g` 再交給 `mpv` 播放
- 理想情況下直接使用 youtubei.js 提取的 URL 可減少延遲至約 0.5 秒

**相關 Issue**：
- [LuanRT/YouTube.js#1123](https://github.com/LuanRT/YouTube.js/issues/1123) - "Video unavailable for SABR, leading to no valid URL to decipher"

**狀態**：等待 YouTube.js 更新修復

**Workaround**：目前系統會自動 fallback 到 `yt-dlp -g` 取得直連音訊 URL；若還是失敗，最後才退回 mpv 直開 YouTube URL。

---

## 作者

基於 [youtube-music-cli](https://github.com/involvex/youtube-music-cli) 專案開發

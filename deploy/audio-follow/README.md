# audio-follow — 讓音訊輸出跟隨 macOS 系統設定

容器部署時,bot 的 mpv 經 `PULSE_SERVER` 把聲音送到 host 的 Homebrew
PulseAudio。PulseAudio 為每個 CoreAudio 裝置各建一個 sink,而它的
default sink **不會**跟隨 macOS 系統輸出切換——本 watcher 補上這件事。

## 運作方式

每 2 秒(可調):

1. `GET $BOT_URL/api/audio/output` 查 bot 模式
   - `manual`(WebUI 手動選了裝置)或 bot 離線 → 本輪不動作
2. `SwitchAudioSource -c -t output` 取得 macOS 目前預設輸出裝置
3. 以 sink `Description` 比對出對應的 PulseAudio sink
4. 對齊 default sink + 把播放中的串流搬過去(冪等,無變更不記 log)

## 安裝

```sh
brew install switchaudio-osx   # pulseaudio 應已隨容器音訊橋接裝好

# 視實際環境編輯 plist 內的 script 路徑與 BOT_URL
cp com.youtube-music-bot.audio-follow.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.youtube-music-bot.audio-follow.plist
```

## 驗證

```sh
tail -f ~/Library/Logs/youtube-music-bot-audio-follow.log
# 播放音樂時到「系統設定 → 聲音」切換輸出裝置,
# ~2 秒內應看到 "default sink -> ..." 與 "moved sink-input ..." 各一行
/opt/homebrew/bin/pactl get-default-sink   # 應顯示對應新裝置的 sink
```

## 移除

```sh
launchctl bootout gui/$(id -u)/com.youtube-music-bot.audio-follow
rm ~/Library/LaunchAgents/com.youtube-music-bot.audio-follow.plist
```

## 環境變數(plist `EnvironmentVariables` 可覆寫)

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `BOT_URL` | `auto` | `auto` = 每輪從 `container list` 解析 bot 容器 IP(Apple Container);其他部署改固定位址如 `http://127.0.0.1:3000` |
| `BOT_CONTAINER_NAME` | `youtube-music-bot` | `auto` 模式比對的容器名稱 |
| `BOT_PORT` | `3000` | `auto` 模式組 URL 用的埠 |
| `POLL_INTERVAL` | `2` | 輪詢間隔(秒) |
| `BREW_PREFIX` | `/opt/homebrew` | Homebrew 前綴(Intel Mac 為 `/usr/local`) |

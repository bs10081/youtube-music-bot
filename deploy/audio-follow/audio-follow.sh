#!/bin/sh
# audio-follow.sh — 讓 PulseAudio 跟隨 macOS 系統音訊輸出
#
# 背景:bot 在容器內以 mpv --ao=pulse 播放,經 PULSE_SERVER 連到 host 的
# Homebrew PulseAudio。PulseAudio 的 default sink 不會跟隨 macOS 系統輸出
# 切換,本 watcher 負責同步:輪詢 macOS 預設輸出裝置,對齊 PulseAudio 的
# default sink 並搬移播放中的串流。
#
# 模式協調:每輪先向 bot 查詢 GET /api/audio/output;
#   - mode=manual(使用者在 WebUI 手動選了裝置)→ 本輪不動作
#   - bot 無回應(容器沒開)→ 本輪不動作(fail-safe)
#
# 依賴:brew install pulseaudio switchaudio-osx
# launchd 環境 PATH 極簡,一律用絕對路徑。

set -u

BREW_PREFIX="${BREW_PREFIX:-/opt/homebrew}"
PACTL="${PACTL:-$BREW_PREFIX/bin/pactl}"
SWITCH_AUDIO_SOURCE="${SWITCH_AUDIO_SOURCE:-$BREW_PREFIX/bin/SwitchAudioSource}"
CONTAINER_CLI="${CONTAINER_CLI:-$BREW_PREFIX/bin/container}"
# BOT_URL=auto:每輪從 `container list` 解析 bot 容器 IP(重建後 IP 會變,寫死會失效)
BOT_URL="${BOT_URL:-auto}"
BOT_CONTAINER_NAME="${BOT_CONTAINER_NAME:-youtube-music-bot}"
BOT_PORT="${BOT_PORT:-3000}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

resolved_bot_url=""

resolve_bot_url() {
  if [ "$BOT_URL" != "auto" ]; then
    resolved_bot_url="$BOT_URL"
    return 0
  fi
  [ -x "$CONTAINER_CLI" ] || return 1
  bot_ip=$("$CONTAINER_CLI" list 2>/dev/null | awk -v name="$BOT_CONTAINER_NAME" '$1 == name { sub(/\/.*/, "", $6); print $6; exit }')
  [ -n "$bot_ip" ] || return 1
  resolved_bot_url="http://$bot_ip:$BOT_PORT"
}

log "audio-follow watcher started (bot=$BOT_URL, interval=${POLL_INTERVAL}s)"

missing_dep_warned=0

while true; do
  sleep "$POLL_INTERVAL"

  # 依賴檢查(可能事後才安裝,缺少時只警告一次、持續重試)
  if [ ! -x "$PACTL" ] || [ ! -x "$SWITCH_AUDIO_SOURCE" ]; then
    if [ "$missing_dep_warned" -eq 0 ]; then
      log "WARN missing pactl or SwitchAudioSource under $BREW_PREFIX/bin; run: brew install pulseaudio switchaudio-osx"
      missing_dep_warned=1
    fi
    continue
  fi
  missing_dep_warned=0

  # 1) 查 bot 模式:manual 或 bot 離線 → 本輪跳過(fail-safe)
  if [ -z "$resolved_bot_url" ]; then
    resolve_bot_url || continue
  fi
  mode_response=$(curl -sf -m 2 "$resolved_bot_url/api/audio/output" 2>/dev/null) || {
    # 失敗時清除快取,下一輪重新解析(容器重建後 IP 可能已變)
    resolved_bot_url=""
    continue
  }
  case "$mode_response" in
    *'"mode":"system"'*) ;;
    *) continue ;;
  esac

  # 2) macOS 目前的預設輸出裝置名稱
  macos_device=$("$SWITCH_AUDIO_SOURCE" -c -t output 2>/dev/null) || continue
  [ -n "$macos_device" ] || continue

  # 3) 以 Description 比對出對應的 PulseAudio sink 名稱
  #    (module-coreaudio-detect 的 sink Description 即 CoreAudio 裝置名)
  target_sink=$("$PACTL" list sinks 2>/dev/null | awk -F': ' -v dev="$macos_device" '
    /^\tName:/ { name = $2 }
    /^\tDescription:/ { if ($2 == dev) { print name; exit } }
  ')
  if [ -z "$target_sink" ]; then
    # PulseAudio 可能還沒為新裝置建 sink(module-coreaudio-detect 需要時間)
    continue
  fi

  # 4) 對齊 default sink(冪等:一致就不動、不記 log)
  current_sink=$("$PACTL" get-default-sink 2>/dev/null) || continue
  if [ "$current_sink" != "$target_sink" ]; then
    if "$PACTL" set-default-sink "$target_sink" 2>/dev/null; then
      log "default sink -> $target_sink ($macos_device)"
    else
      log "WARN failed to set default sink to $target_sink"
      continue
    fi
  fi

  # 5) 把不在目標 sink 上的串流搬過去(冪等)
  target_index=$("$PACTL" list short sinks 2>/dev/null | awk -v n="$target_sink" '$2 == n { print $1; exit }')
  [ -n "$target_index" ] || continue

  "$PACTL" list short sink-inputs 2>/dev/null | awk -v s="$target_index" '$2 != s { print $1 }' | while read -r input_index; do
    if "$PACTL" move-sink-input "$input_index" "$target_sink" 2>/dev/null; then
      log "moved sink-input #$input_index -> $target_sink"
    fi
  done
done

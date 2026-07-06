import type { ServerWebSocket } from "bun";
import type { WSMessage } from "../types/index.ts";
import { getQueueService } from "../services/queue.service.ts";
import { getAudioOutputService } from "../services/audio-output.service.ts";
import { log } from "../utils/logger.ts";

// 所有連接的客戶端
const clients = new Set<ServerWebSocket<unknown>>();
let websocketInitialized = false;

/**
 * 廣播訊息給所有客戶端
 */
export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  log.debug("Broadcasting message", {
    type: message.type,
    clientCount: clients.size,
    dataLength: data.length,
  });
  for (const client of clients) {
    client.send(data);
  }
}

/**
 * WebSocket 訊息處理
 */
export function handleWebSocketMessage(
  ws: ServerWebSocket<unknown>,
  message: string,
): void {
  try {
    const data = JSON.parse(message) as WSMessage;
    const queueService = getQueueService();

    switch (data.type) {
      case "play":
        queueService.play();
        break;

      case "pause":
        queueService.pause();
        break;

      case "skip":
        queueService.skip();
        break;

      case "volume":
        if ("value" in data && typeof data.value === "number") {
          queueService.setVolume(data.value);
        }
        break;

      case "seek":
        if ("value" in data && typeof data.value === "number") {
          // 驗證數值合理性
          if (Number.isFinite(data.value) && data.value >= 0) {
            queueService.seekTo(data.value);
          } else {
            log.warn("Invalid seek value received", { value: data.value });
          }
        }
        break;

      default:
        log.debug("Unknown message type", { type: data.type });
    }
  } catch (error) {
    log.error("Failed to handle WebSocket message", {
      error: error instanceof Error ? error.message : String(error),
      message,
    });
  }
}

/**
 * WebSocket 連接開啟
 */
export function handleWebSocketOpen(ws: ServerWebSocket<unknown>): void {
  clients.add(ws);
  log.info("WebSocket client connected", { totalClients: clients.size });

  // 發送目前播放狀態給新連接的客戶端
  const queueService = getQueueService();
  const state = queueService.getState();

  ws.send(
    JSON.stringify({
      type: "playback_state",
      state,
    } as WSMessage),
  );

  // 發送目前音訊輸出狀態(容器部署才有 sink 資料;失敗不影響連線)
  getAudioOutputService()
    .getStatus()
    .then((status) => {
      ws.send(JSON.stringify({ type: "audio_output", status } as WSMessage));
    })
    .catch((error) => {
      log.warn("Failed to fetch audio output status for new client", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  // 如果當前有歌曲在播放，也發送歌詞
  if (state.currentTrack) {
    queueService
      .getLyrics()
      .then((lyrics) => {
        ws.send(
          JSON.stringify({
            type: "lyrics",
            lyrics,
          } as WSMessage),
        );
      })
      .catch((error) => {
        log.error("Failed to fetch lyrics for new client", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

/**
 * WebSocket 連接關閉
 */
export function handleWebSocketClose(ws: ServerWebSocket<unknown>): void {
  clients.delete(ws);
  log.info("WebSocket client disconnected", { totalClients: clients.size });
}

/**
 * 初始化 WebSocket 廣播
 */
export function initializeWebSocket(): void {
  if (websocketInitialized) {
    return;
  }

  const queueService = getQueueService();

  // 監聽佇列變更
  queueService.onQueueChange((queue) => {
    broadcast({
      type: "queue_updated",
      queue,
    });
  });

  // 追蹤上一次的 track ID，避免重複獲取歌詞
  let lastTrackId: string | null = null;

  // 監聽播放狀態變更
  queueService.onStateChange((state) => {
    log.debug("State change detected", {
      isPlaying: state.isPlaying,
      currentTrack: state.currentTrack?.title ?? null,
      queueLength: state.queue.length,
    });

    broadcast({
      type: "playback_state",
      state,
    });

    // 當 track 變更時才獲取歌詞
    const currentTrackId = state.currentTrack?.videoId ?? null;
    if (currentTrackId && currentTrackId !== lastTrackId) {
      lastTrackId = currentTrackId;
      queueService
        .getLyrics()
        .then((lyrics) => {
          broadcast({
            type: "lyrics",
            lyrics,
          });
        })
        .catch((error) => {
          log.error("Failed to fetch lyrics on track change", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else if (!currentTrackId) {
      lastTrackId = null;
    }
  });

  queueService.onProgressChange((progress) => {
    broadcast({
      type: "playback_progress",
      progress,
    });
  });

  queueService.onTrackLoading(({ track, message }) => {
    broadcast({
      type: "track_loading",
      track,
      message,
    });
  });

  queueService.onTrackReady((track) => {
    broadcast({
      type: "track_ready",
      track,
    });
  });

  // 監聽歌詞變更
  queueService.onLyricsChange((lyrics) => {
    broadcast({
      type: "lyrics",
      lyrics,
    });
  });

  queueService.onPlayError(({ error, track }) => {
    broadcast({
      type: "play_error",
      error,
      track,
    });
  });

  // 音訊輸出變更(WebUI 手動切換或 host watcher 跟隨系統)→ 廣播給所有客戶端
  getAudioOutputService().onChange((status) => {
    broadcast({
      type: "audio_output",
      status,
    });
  });

  websocketInitialized = true;
  log.info("WebSocket broadcasting initialized");
}

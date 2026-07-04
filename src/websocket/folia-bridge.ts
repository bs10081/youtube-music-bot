import type { Server, ServerWebSocket } from "bun";
import type {
  LyricLine,
  PlaybackState,
  Track,
} from "../types/index.ts";
import { getQueueService } from "../services/queue.service.ts";
import { serializeLrc } from "../utils/lrc.ts";
import { log } from "../utils/logger.ts";

// Folia(Widdit now-playing-service 協定)的 wire 格式。
// 這是外部協定,刻意不併入 types/index.ts 的 WSMessage union。
// 單位注意:Track.duration 與 seekbarCurrentPosition 送「秒」(Folia 端自動判別/轉換),
// PlayerProgress.progress 送「毫秒」(Folia 端直接視為 ms)。
export interface FoliaTrackData {
  author: string;
  title: string;
  album?: string;
  cover?: string;
  duration: number;
  id: string;
}

export interface FoliaLyricData {
  source: string;
  title: string;
  author: string;
  hasLyric: boolean;
  hasTranslatedLyric: boolean;
  hasKaraokeLyric: boolean;
  lrc: string | null;
}

export interface FoliaPauseStateData {
  hasSong: boolean;
  isPaused: boolean;
  seekbarCurrentPosition: number;
  statePercent: number;
}

export type FoliaEvent =
  | { event: "Track"; data: FoliaTrackData }
  | { event: "Lyric"; data: FoliaLyricData }
  | { event: "PlayerPauseState"; data: FoliaPauseStateData }
  | { event: "PlayerProgress"; data: { progress: number } }
  | { event: "PlayerProgressReplay"; data: Record<string, never> };

const DEFAULT_FOLIA_PORT = 9863;
const DEFAULT_FOLIA_HOST = "127.0.0.1";
// 倒退超過 2 秒才視為 seek-back(遲滯量,避免 mpv 時間戳抖動誤發 Replay)
const REPLAY_BACKWARD_JUMP_MS = 2000;

const foliaClients = new Set<ServerWebSocket<unknown>>();
let bridgeInitialized = false;
let foliaServer: Server<undefined> | null = null;
let lastTrackId: string | null = null;
let lastProgressMs = 0;

export function isFoliaBridgeEnabled(): boolean {
  const raw = process.env.FOLIA_BRIDGE?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function resolveFoliaPort(): number {
  const raw = Number.parseInt(process.env.FOLIA_PORT || "", 10);
  return Number.isFinite(raw) && raw > 0 && raw < 65536
    ? raw
    : DEFAULT_FOLIA_PORT;
}

// 協定無認證,預設只綁 loopback;要跨機需明確設定 FOLIA_HOST
export function resolveFoliaHost(): string {
  return process.env.FOLIA_HOST?.trim() || DEFAULT_FOLIA_HOST;
}

export function toFoliaTrack(track: Track): FoliaTrackData {
  return {
    author: track.artist,
    title: track.title,
    ...(track.album ? { album: track.album.name } : {}),
    ...(track.thumbnail ? { cover: track.thumbnail } : {}),
    duration: track.duration,
    id: track.videoId,
  };
}

export function toFoliaPauseState(state: PlaybackState): FoliaPauseStateData {
  const statePercent =
    state.duration > 0
      ? Math.min(1, Math.max(0, state.position / state.duration))
      : 0;
  return {
    hasSong: state.currentTrack !== null,
    isPaused: !state.isPlaying,
    seekbarCurrentPosition: Math.max(0, state.position),
    statePercent,
  };
}

export function toFoliaProgressMs(positionSeconds: number): number {
  return Math.round(Math.max(0, positionSeconds) * 1000);
}

export function buildFoliaLyric(
  track: Track,
  lines: LyricLine[],
): FoliaLyricData {
  const lrc = serializeLrc(lines);
  return {
    source: "lrclib",
    title: track.title,
    author: track.artist,
    hasLyric: lrc.length > 0,
    hasTranslatedLyric: false,
    hasKaraokeLyric: false,
    lrc: lrc.length > 0 ? lrc : null,
  };
}

export function shouldEmitReplay(
  previousMs: number,
  nextMs: number,
  isSameTrack: boolean,
): boolean {
  return isSameTrack && nextMs < previousMs - REPLAY_BACKWARD_JUMP_MS;
}

function sendToClient(ws: ServerWebSocket<unknown>, message: FoliaEvent): void {
  ws.send(JSON.stringify(message));
}

function broadcastFolia(message: FoliaEvent): void {
  if (foliaClients.size === 0) {
    return;
  }
  const data = JSON.stringify(message);
  for (const client of foliaClients) {
    client.send(data);
  }
}

/**
 * Folia 連線開啟:主動推送目前狀態 snapshot(協定無 handshake,server push)
 */
export function handleFoliaOpen(ws: ServerWebSocket<unknown>): void {
  foliaClients.add(ws);
  log.info("Folia client connected", { totalClients: foliaClients.size });

  const queueService = getQueueService();
  const state = queueService.getState();
  const track = state.currentTrack;

  if (track) {
    sendToClient(ws, { event: "Track", data: toFoliaTrack(track) });
  }
  sendToClient(ws, {
    event: "PlayerPauseState",
    data: toFoliaPauseState(state),
  });
  if (track) {
    sendToClient(ws, {
      event: "PlayerProgress",
      data: { progress: toFoliaProgressMs(state.position) },
    });
    queueService
      .getLyrics()
      .then((lyrics) => {
        sendToClient(ws, {
          event: "Lyric",
          data: buildFoliaLyric(track, lyrics),
        });
      })
      .catch((error) => {
        log.error("Folia bridge: failed to fetch lyrics for new client", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

export function handleFoliaClose(ws: ServerWebSocket<unknown>): void {
  foliaClients.delete(ws);
  log.info("Folia client disconnected", { totalClients: foliaClients.size });
}

/**
 * 訂閱 queueService 事件並轉譯為 Folia 事件。
 * 平行於 handler.ts 的訂閱(回呼為陣列多訂閱者),不影響既有 /ws 頻道。
 */
export function initializeFoliaBridge(): void {
  if (bridgeInitialized) {
    return;
  }

  const queueService = getQueueService();

  queueService.onStateChange((state) => {
    const trackId = state.currentTrack?.videoId ?? null;
    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      lastProgressMs = 0;
      const track = state.currentTrack;
      if (track) {
        broadcastFolia({ event: "Track", data: toFoliaTrack(track) });
        broadcastFolia({ event: "PlayerProgressReplay", data: {} });
        // 先同步清掉舊歌詞,再非同步補上新歌詞;
        // fetch 期間可能又換歌,回來後比對 trackId 不符即丟棄
        broadcastFolia({ event: "Lyric", data: buildFoliaLyric(track, []) });
        queueService
          .getLyrics()
          .then((lyrics) => {
            if (lastTrackId === trackId && lyrics.length > 0) {
              broadcastFolia({
                event: "Lyric",
                data: buildFoliaLyric(track, lyrics),
              });
            }
          })
          .catch((error) => {
            log.error("Folia bridge: failed to fetch lyrics on track change", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }
    }
    broadcastFolia({
      event: "PlayerPauseState",
      data: toFoliaPauseState(state),
    });
  });

  queueService.onProgressChange((progress) => {
    const ms = toFoliaProgressMs(progress.position);
    if (shouldEmitReplay(lastProgressMs, ms, progress.trackId === lastTrackId)) {
      broadcastFolia({ event: "PlayerProgressReplay", data: {} });
    }
    lastProgressMs = ms;
    broadcastFolia({ event: "PlayerProgress", data: { progress: ms } });
  });

  queueService.onLyricsChange((lyrics) => {
    const track = getQueueService().getState().currentTrack;
    if (track) {
      broadcastFolia({
        event: "Lyric",
        data: buildFoliaLyric(track, lyrics as LyricLine[]),
      });
    }
  });

  bridgeInitialized = true;
  log.info("Folia bridge initialized");
}

/**
 * 在獨立 port(預設 9863,Folia hardcode)起第二個 Bun.serve。
 * bind 失敗時只記錄錯誤不拋出——bridge 是 best-effort,不能拖垮主服務。
 */
export function startFoliaServer(): Server<undefined> | null {
  if (foliaServer) {
    return foliaServer;
  }

  const port = resolveFoliaPort();
  const hostname = resolveFoliaHost();

  try {
    foliaServer = Bun.serve({
      port,
      hostname,
      fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname === "/api/ws/lyric") {
          const success = server.upgrade(req);
          return success
            ? undefined
            : new Response("WebSocket upgrade failed", { status: 500 });
        }

        // Folia nowPlayingClock 的 RTT 漂移校正(選配,7 秒輪詢)
        if (url.pathname === "/api/query/progress" && req.method === "GET") {
          const state = getQueueService().getState();
          return Response.json({
            progress: toFoliaProgressMs(state.position),
          });
        }

        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          handleFoliaOpen(ws);
        },
        message() {
          // Folia 是 receive-only,不會送訊息;忽略任何 inbound
        },
        close(ws) {
          handleFoliaClose(ws);
        },
      },
    });
    log.info("Folia bridge listening", { hostname, port });
    return foliaServer;
  } catch (error) {
    log.error("Folia bridge: failed to bind port; bridge disabled", {
      error: error instanceof Error ? error.message : String(error),
      hostname,
      port,
    });
    foliaServer = null;
    return null;
  }
}

export function stopFoliaServer(): void {
  // force close:立即斷開已連線的 Folia client,讓對方 UI 即時反映離線
  foliaServer?.stop(true);
  foliaServer = null;
  foliaClients.clear();
}

export interface FoliaBridgeStatus {
  enabled: boolean;
  host: string;
  port: number;
  clients: number;
  wsUrl: string;
}

export function getFoliaBridgeStatus(): FoliaBridgeStatus {
  const host = resolveFoliaHost();
  const port = resolveFoliaPort();
  return {
    enabled: foliaServer !== null,
    host,
    port,
    clients: foliaClients.size,
    wsUrl: `ws://${host}:${port}/api/ws/lyric`,
  };
}

/**
 * Runtime 啟用(WebUI 開關用):訂閱只註冊一次,listener 可反覆開關
 */
export function enableFoliaBridge(): FoliaBridgeStatus {
  initializeFoliaBridge();
  startFoliaServer();
  return getFoliaBridgeStatus();
}

export function disableFoliaBridge(): FoliaBridgeStatus {
  stopFoliaServer();
  return getFoliaBridgeStatus();
}

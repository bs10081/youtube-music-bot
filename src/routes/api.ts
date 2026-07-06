import { Hono } from "hono";
import type { ApiResponse, PlaybackSettings, Track } from "../types/index.ts";
import { getMusicService } from "../services/music.service.ts";
import { getQueueService } from "../services/queue.service.ts";
import { getDiscoverService } from "../services/discover.service.ts";
import { getReleaseNotesService } from "../services/release-notes.service.ts";
import {
  getSyncService,
  type SyncDeviceInput,
  SyncServiceError,
} from "../services/sync.service.ts";
import { getAppMetadata } from "../utils/app-metadata.ts";
import {
  getArtworkProxyHeaders,
  isAllowedArtworkUrl,
  parseArtworkUrl,
} from "../utils/artwork-proxy.ts";
import { getRuntimeDependencyStatus } from "../utils/runtime-dependencies.ts";
import {
  disableFoliaBridge,
  enableFoliaBridge,
  getFoliaBridgeStatus,
} from "../websocket/folia-bridge.ts";
import {
  AudioOutputError,
  getAudioOutputService,
} from "../services/audio-output.service.ts";

const api = new Hono();

type SyncDeviceRequest = {
  id: string;
  name?: string | null;
  reportedName?: string | null;
  kind: "desktop" | "mobile";
  metadata?: {
    platformFamily?: string | null;
    platformVersion?: string | null;
    architecture?: string | null;
    browserName?: string | null;
    browserVersion?: string | null;
    model?: string | null;
  } | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSyncDevice(device: SyncDeviceRequest | null | undefined): SyncDeviceInput | null {
  if (!device) {
    return null;
  }

  const id = normalizeText(device.id);
  const reportedName = normalizeText(device.reportedName);
  const legacyName = normalizeText(device.name);

  if (!id || (!reportedName && !legacyName)) {
    return null;
  }

  return {
    id,
    kind: device.kind === "mobile" ? "mobile" : "desktop",
    reportedName,
    name: legacyName,
    metadata: device.metadata
      ? {
          platformFamily: normalizeText(device.metadata.platformFamily),
          platformVersion: normalizeText(device.metadata.platformVersion),
          architecture: normalizeText(device.metadata.architecture),
          browserName: normalizeText(device.metadata.browserName),
          browserVersion: normalizeText(device.metadata.browserVersion),
          model: normalizeText(device.metadata.model),
        }
      : null,
  };
}

function parseRequester(value: unknown): Track["requestedBy"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const requester = value as {
    profileId?: unknown;
    profileName?: unknown;
  };
  const profileId = normalizeText(requester.profileId);
  const profileName = normalizeText(requester.profileName);

  if (!profileId || !profileName) {
    return undefined;
  }

  return {
    profileId,
    profileName,
  };
}

function recordDiscoverTrackRequests(tracks: Track[]): void {
  try {
    getDiscoverService().recordTrackRequests(tracks);
  } catch (error) {
    console.error("Failed to record discover track requests:", error);
  }
}

function toSyncErrorResponse(error: unknown): {
  status: 404 | 409 | 500;
  body: ApiResponse;
} {
  if (error instanceof SyncServiceError) {
    if (
      error.code === "INVALID_PAIR_CODE" ||
      error.code === "SYNC_DEVICE_NOT_FOUND"
    ) {
      return {
        status: 404,
        body: {
          success: false,
          error: error.message,
          code: error.code,
        },
      };
    }

    return {
      status: error.code === "SYNC_SESSION_NOT_FOUND" ? 404 : 409,
      body: {
        success: false,
        error: error.message,
        code: error.code,
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: "Failed to process sync request",
    },
  };
}

/**
 * GET /api/artwork-proxy?url={imageUrl}
 * 代理允許來源的封面圖片，供前端 palette fallback 使用
 */
api.get("/artwork-proxy", async (c) => {
  const rawUrl = c.req.query("url");
  const artworkUrl = parseArtworkUrl(rawUrl);

  if (!artworkUrl) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: 'Query parameter "url" is required',
      },
      400,
    );
  }

  if (!isAllowedArtworkUrl(artworkUrl)) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Artwork URL is not allowed",
      },
      400,
    );
  }

  try {
    const upstream = await fetch(artworkUrl, {
      headers: {
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok || !upstream.body) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Failed to fetch artwork",
        },
        502,
      );
    }

    const contentType = upstream.headers.get("Content-Type");
    if (!contentType?.startsWith("image/")) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Upstream response is not an image",
        },
        502,
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: getArtworkProxyHeaders(contentType),
    });
  } catch (error) {
    console.error("Failed to proxy artwork:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to fetch artwork",
      },
      502,
    );
  }
});

/**
 * GET /api/search?q={query}
 * 搜尋歌曲或支援的 YouTube 連結
 */
api.get("/search", async (c) => {
  const query = c.req.query("q");

  if (!query) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: 'Query parameter "q" is required',
      },
      400,
    );
  }

  try {
    const musicService = getMusicService();
    const tracks = await musicService.search(query, 20);

    return c.json<ApiResponse>({
      success: true,
      data: tracks,
    });
  } catch (error) {
    console.error("Search failed:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to search",
      },
      500,
    );
  }
});

/**
 * POST /api/queue
 * 點歌（加入播放清單）
 */
api.post("/queue", async (c) => {
  try {
    const body = await c.req.json<{
      track: Track;
      requestedBy?: Track["requestedBy"];
    }>();

    if (!body.track || !body.track.videoId) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "track is required",
        },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.addToQueue(body.track, {
      requestedBy: parseRequester(body.requestedBy),
    });
    recordDiscoverTrackRequests([body.track]);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Added to queue" },
    });
  } catch (error) {
    console.error("Failed to add to queue:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to add to queue",
      },
      500,
    );
  }
});

/**
 * POST /api/queue/batch
 * 批次加入歌曲到播放清單
 */
api.post("/queue/batch", async (c) => {
  try {
    const body = await c.req.json<{
      tracks: Track[];
      requestedBy?: Track["requestedBy"];
    }>();

    if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "tracks is required",
        },
        400,
      );
    }

    const normalizedTracks = body.tracks.filter((track) => Boolean(track?.videoId));
    if (normalizedTracks.length === 0) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "tracks is required",
        },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.appendTracksToQueue(normalizedTracks, "manual", {
      requestedBy: parseRequester(body.requestedBy),
    });
    recordDiscoverTrackRequests(normalizedTracks);

    return c.json<ApiResponse>({
      success: true,
      data: {
        message: `Added ${normalizedTracks.length} tracks to queue`,
        count: normalizedTracks.length,
      },
    });
  } catch (error) {
    console.error("Failed to batch add to queue:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to add tracks to queue",
      },
      500,
    );
  }
});

/**
 * POST /api/mix
 * 創建混合播放清單
 */
api.post("/mix", async (c) => {
  try {
    const body = await c.req.json<{
      track: Track;
      requestedBy?: Track["requestedBy"];
    }>();

    if (!body.track || !body.track.videoId) {
      return c.json<ApiResponse>(
        { success: false, error: "track is required" },
        400,
      );
    }

    const queueService = getQueueService();
    const tracks = await queueService.createMixFromTrack(body.track, {
      requestedBy: parseRequester(body.requestedBy),
    });
    recordDiscoverTrackRequests([body.track]);

    return c.json<ApiResponse>({
      success: true,
      data: {
        message: `Added ${tracks.length} tracks to queue`,
        count: tracks.length,
        tracks,
      },
    });
  } catch (error) {
    console.error("Failed to create mix:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to create mix" },
      500,
    );
  }
});

/**
 * POST /api/radio/enable
 * 開啟無限播放電臺模式
 */
api.post("/radio/enable", (c) => {
  try {
    const queueService = getQueueService();
    queueService.enableRadio();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Radio enabled" },
    });
  } catch (error) {
    console.error("Failed to enable radio:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to enable radio" },
      500,
    );
  }
});

/**
 * POST /api/radio/disable
 * 關閉無限播放電臺模式
 */
api.post("/radio/disable", (c) => {
  try {
    const queueService = getQueueService();
    queueService.disableRadio();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Radio disabled" },
    });
  } catch (error) {
    console.error("Failed to disable radio:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to disable radio" },
      500,
    );
  }
});

/**
 * POST /api/radio/toggle
 * 切換無限播放電臺模式
 */
api.post("/radio/toggle", (c) => {
  try {
    const queueService = getQueueService();
    queueService.toggleRadio();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Radio toggled" },
    });
  } catch (error) {
    console.error("Failed to toggle radio:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to toggle radio" },
      500,
    );
  }
});

/**
 * GET /api/folia/status
 * 取得 Folia Now Playing bridge 目前狀態
 */
api.get("/folia/status", (c) => {
  return c.json<ApiResponse>({
    success: true,
    data: getFoliaBridgeStatus(),
  });
});

/**
 * POST /api/folia/enable
 * 啟用 Folia Now Playing bridge(runtime 開關,與 FOLIA_BRIDGE 環境變數並存)
 */
api.post("/folia/enable", (c) => {
  try {
    const status = enableFoliaBridge();

    if (!status.enabled) {
      // startFoliaServer 內部已記錄 bind 失敗原因(常見:port 被占用)
      return c.json<ApiResponse>(
        {
          success: false,
          error: `Failed to start Folia bridge on port ${status.port} (port in use?)`,
        },
        500,
      );
    }

    return c.json<ApiResponse>({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Failed to enable Folia bridge:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to enable Folia bridge" },
      500,
    );
  }
});

/**
 * POST /api/folia/disable
 * 停用 Folia Now Playing bridge 並斷開已連線的 client
 */
api.post("/folia/disable", (c) => {
  try {
    return c.json<ApiResponse>({
      success: true,
      data: disableFoliaBridge(),
    });
  } catch (error) {
    console.error("Failed to disable Folia bridge:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to disable Folia bridge" },
      500,
    );
  }
});

/**
 * GET /api/audio/outputs
 * 列出可用音訊輸出(PulseAudio sinks)與目前模式/預設輸出
 */
api.get("/audio/outputs", async (c) => {
  try {
    const status = await getAudioOutputService().getStatus({ refresh: true });
    return c.json<ApiResponse>({ success: true, data: status });
  } catch (error) {
    console.error("Failed to list audio outputs:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to list audio outputs" },
      500,
    );
  }
});

/**
 * GET /api/audio/output
 * 輕量狀態查詢(host watcher 每 2 秒輪詢);順便刷新 sink 快取,
 * 外部變更(watcher 切了系統輸出)會在此觸發 audio_output WS 廣播
 */
api.get("/audio/output", async (c) => {
  try {
    const status = await getAudioOutputService().getStatus();
    return c.json<ApiResponse>({
      success: true,
      data: { mode: status.mode, sink: status.defaultSink },
    });
  } catch (error) {
    console.error("Failed to get audio output:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to get audio output" },
      500,
    );
  }
});

/**
 * POST /api/audio/output
 * 切換音訊輸出:{ mode: "system" } 交回 host watcher 跟隨 macOS,
 * { mode: "manual", sink } 立即切換到指定 sink(含播放中串流)
 */
api.post("/audio/output", async (c) => {
  try {
    const body = await c.req.json<{ mode?: string; sink?: string }>();
    const service = getAudioOutputService();

    if (body.mode === "system") {
      return c.json<ApiResponse>({
        success: true,
        data: await service.setSystemMode(),
      });
    }

    if (body.mode === "manual") {
      if (typeof body.sink !== "string" || body.sink.trim().length === 0) {
        return c.json<ApiResponse>(
          { success: false, error: "manual mode requires a sink name" },
          400,
        );
      }
      return c.json<ApiResponse>({
        success: true,
        data: await service.setManualSink(body.sink.trim()),
      });
    }

    return c.json<ApiResponse>(
      { success: false, error: 'mode must be "system" or "manual"' },
      400,
    );
  } catch (error) {
    if (error instanceof AudioOutputError) {
      const httpStatus =
        error.code === "SINK_NOT_FOUND"
          ? 404
          : error.code === "NOT_SUPPORTED"
            ? 400
            : 500;
      return c.json<ApiResponse>(
        { success: false, error: error.message, code: error.code },
        httpStatus,
      );
    }
    console.error("Failed to set audio output:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to set audio output" },
      500,
    );
  }
});

/**
 * POST /api/sync/session
 * 建立或恢復同步 session
 */
api.post("/sync/session", async (c) => {
  try {
    const body = await c.req.json<{
      sessionId?: string | null;
      deviceToken?: string | null;
      profileId: string;
      profileName?: string | null;
      device: SyncDeviceRequest;
    }>();
    const device = parseSyncDevice(body.device);

    if (!body.profileId || !device) {
      return c.json<ApiResponse>(
        { success: false, error: "profileId and device are required" },
        400,
      );
    }

    const syncService = getSyncService();
    const session = syncService.createOrResumeSession({
      sessionId: body.sessionId,
      deviceToken: body.deviceToken,
      profileId: body.profileId,
      profileName: body.profileName,
      device,
    });

    return c.json<ApiResponse>({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Failed to create sync session:", error);
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * POST /api/sync/pair
 * 透過 pair code 加入現有 session
 */
api.post("/sync/pair", async (c) => {
  try {
    const body = await c.req.json<{
      pairCode: string;
      profileId: string;
      device: SyncDeviceRequest;
    }>();
    const device = parseSyncDevice(body.device);

    if (!body.pairCode || !body.profileId || !device) {
      return c.json<ApiResponse>(
        { success: false, error: "pairCode, profileId and device are required" },
        400,
      );
    }

    const syncService = getSyncService();
    const session = syncService.pairToSession({
      pairCode: body.pairCode,
      profileId: body.profileId,
      device,
    });

    return c.json<ApiResponse>({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Failed to pair sync session:", error);
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * PATCH /api/sync/session/profile
 * 更新同步 session 的使用者名稱
 */
api.patch("/sync/session/profile", async (c) => {
  try {
    const body = await c.req.json<{
      sessionId: string;
      profileName: string;
    }>();

    if (!body.sessionId || typeof body.profileName !== "string") {
      return c.json<ApiResponse>(
        { success: false, error: "sessionId and profileName are required" },
        400,
      );
    }

    const syncService = getSyncService();
    const profile = syncService.updateProfileName(
      body.sessionId,
      body.profileName,
    );
    getQueueService().renameRequesterProfile(
      profile.profileId,
      profile.profileName,
    );
    return c.json<ApiResponse>({
      success: true,
      data: profile,
    });
  } catch (error) {
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * GET /api/sync/devices?sessionId={sessionId}
 * 取得同步裝置列表
 */
api.get("/sync/devices", (c) => {
  const sessionId = c.req.query("sessionId");

  if (!sessionId) {
    return c.json<ApiResponse>(
      { success: false, error: "sessionId is required" },
      400,
    );
  }

  try {
    const devices = getSyncService().getDevices(sessionId);
    return c.json<ApiResponse>({
      success: true,
      data: { devices },
    });
  } catch (error) {
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * PATCH /api/sync/devices/:deviceId
 * 更新裝置顯示名稱
 */
api.patch("/sync/devices/:deviceId", async (c) => {
  const deviceId = c.req.param("deviceId");

  try {
    const body = await c.req.json<{ sessionId: string; name: string }>();

    if (!deviceId || !body.sessionId || typeof body.name !== "string") {
      return c.json<ApiResponse>(
        { success: false, error: "sessionId and name are required" },
        400,
      );
    }

    const devices = getSyncService().renameDevice(
      body.sessionId,
      deviceId,
      body.name,
    );
    return c.json<ApiResponse>({
      success: true,
      data: { devices },
    });
  } catch (error) {
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * DELETE /api/sync/devices/:deviceId?sessionId={sessionId}
 * 移除同步裝置
 */
api.delete("/sync/devices/:deviceId", (c) => {
  const sessionId = c.req.query("sessionId");
  const deviceId = c.req.param("deviceId");

  if (!sessionId || !deviceId) {
    return c.json<ApiResponse>(
      { success: false, error: "sessionId and deviceId are required" },
      400,
    );
  }

  try {
    getSyncService().removeDevice(sessionId, deviceId);
    return c.json<ApiResponse>({
      success: true,
      data: { message: "Device removed" },
    });
  } catch (error) {
    const response = toSyncErrorResponse(error);
    return c.json<ApiResponse>(response.body, response.status);
  }
});

/**
 * GET /api/queue
 * 取得播放清單
 */
api.get("/queue", (c) => {
  const queueService = getQueueService();
  const queue = queueService.getQueue();

  return c.json<ApiResponse>({
    success: true,
    data: queue,
  });
});

/**
 * POST /api/queue/reorder
 * 重新排序播放清單
 */
api.post("/queue/reorder", async (c) => {
  try {
    const body = await c.req.json<{ fromIndex: number; toIndex: number }>();
    const { fromIndex, toIndex } = body;

    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "fromIndex and toIndex must be integers",
        },
        400,
      );
    }

    const queueService = getQueueService();
    queueService.reorderQueue(fromIndex, toIndex);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Queue reordered" },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Invalid queue index",
        },
        400,
      );
    }

    console.error("Failed to reorder queue:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to reorder queue",
      },
      500,
    );
  }
});

/**
 * POST /api/library/playlists/:playlistId/play
 * 立即播放本地歌單內容
 */
api.post("/library/playlists/:playlistId/play", async (c) => {
  try {
    const body = await c.req.json<{
      tracks: Track[];
      requestedBy?: Track["requestedBy"];
    }>();

    if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
      return c.json<ApiResponse>(
        { success: false, error: "tracks is required" },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.replaceQueueWithTracks(body.tracks, "playlist", {
      requestedBy: parseRequester(body.requestedBy),
    });

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Playlist playback started" },
    });
  } catch (error) {
    console.error("Failed to play playlist:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to play playlist" },
      500,
    );
  }
});

/**
 * POST /api/library/playlists/:playlistId/queue
 * 將本地歌單內容加入目前播放佇列
 */
api.post("/library/playlists/:playlistId/queue", async (c) => {
  try {
    const body = await c.req.json<{
      tracks: Track[];
      requestedBy?: Track["requestedBy"];
    }>();

    if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
      return c.json<ApiResponse>(
        { success: false, error: "tracks is required" },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.appendTracksToQueue(body.tracks, "playlist", {
      requestedBy: parseRequester(body.requestedBy),
    });

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Playlist added to queue" },
    });
  } catch (error) {
    console.error("Failed to queue playlist:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to queue playlist" },
      500,
    );
  }
});

/**
 * DELETE /api/queue
 * 清空待播佇列
 */
api.delete("/queue", (c) => {
  try {
    const queueService = getQueueService();
    const count = queueService.clearQueue();

    return c.json<ApiResponse>({
      success: true,
      data: {
        message: "Queue cleared",
        count,
      },
    });
  } catch (error) {
    console.error("Failed to clear queue:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to clear queue",
      },
      500,
    );
  }
});

/**
 * DELETE /api/queue/:index
 * 從播放清單移除歌曲
 */
api.delete("/queue/:index", (c) => {
  const index = parseInt(c.req.param("index"), 10);

  if (isNaN(index) || index < 0) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Invalid index",
      },
      400,
    );
  }

  try {
    const queueService = getQueueService();
    queueService.removeFromQueue(index);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Removed from queue" },
    });
  } catch (error) {
    console.error("Failed to remove from queue:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to remove from queue",
      },
      500,
    );
  }
});

/**
 * GET /api/health
 * 健康檢查端點,供 docker-compose healthcheck 與監控使用
 */
api.get("/health", (c) => {
  const metadata = getAppMetadata();
  return c.json<ApiResponse>({
    success: true,
    data: {
      status: "ok",
      version: metadata.appVersion,
      gitSha: metadata.gitSha,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});

/**
 * GET /api/system/info
 * 取得系統版本資訊
 */
api.get("/system/info", (c) =>
  c.json<ApiResponse>({
    success: true,
    data: {
      ...getAppMetadata(),
      runtimeDependencies: getRuntimeDependencyStatus(),
    },
  }),
);

/**
 * GET /api/system/release-notes
 * 從 GitHub Releases 取得版本說明，必要時 fallback 到本機資料
 */
api.get("/system/release-notes", async (c) => {
  try {
    const metadata = getAppMetadata();
    const releaseNotes = await getReleaseNotesService().getReleaseNotes(
      metadata.appVersion,
    );

    return c.json<ApiResponse>({
      success: true,
      data: releaseNotes,
    });
  } catch (error) {
    console.error("Failed to load release notes:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to load release notes",
      },
      500,
    );
  }
});

/**
 * GET /api/discover/markets
 * 取得可用市場與本站熱門點播
 */
api.get("/discover/markets", async (c) => {
  try {
    const discoverService = getDiscoverService();
    return c.json<ApiResponse>({
      success: true,
      data: await discoverService.getMarketsResponse(),
    });
  } catch (error) {
    console.error("Failed to get discover markets:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to load discover markets",
      },
      500,
    );
  }
});

/**
 * GET /api/discover/feed?market=TW&mood={moodKey}
 * 取得指定市場的 Discover feed
 */
api.get("/discover/feed", async (c) => {
  try {
    const market = c.req.query("market");
    const mood = c.req.query("mood");
    const discoverService = getDiscoverService();
    const feed = await discoverService.getFeed(market, mood);

    return c.json<ApiResponse>({
      success: true,
      data: feed,
    });
  } catch (error) {
    console.error("Failed to get discover feed:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to load discover feed",
      },
      500,
    );
  }
});

/**
 * POST /api/discover/track/queue
 * 將 Discover 單曲加入播放佇列
 */
api.post("/discover/track/queue", async (c) => {
  try {
    const body = await c.req.json<{
      track: Track;
      requestedBy?: Track["requestedBy"];
    }>();

    if (!body.track?.videoId) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "track is required",
        },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.addToQueue(body.track, {
      requestedBy: parseRequester(body.requestedBy),
    });
    recordDiscoverTrackRequests([body.track]);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Discover track added to queue" },
    });
  } catch (error) {
    console.error("Failed to queue discover track:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to queue discover track",
      },
      500,
    );
  }
});

/**
 * POST /api/discover/collection/queue
 * 將 Discover 專輯或播放清單加入播放佇列
 */
api.post("/discover/collection/queue", async (c) => {
  try {
    const body = await c.req.json<{
      kind: "album" | "playlist";
      id: string;
      requestedBy?: Track["requestedBy"];
    }>();

    const collectionId = normalizeText(body.id);
    if (!collectionId || (body.kind !== "album" && body.kind !== "playlist")) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "kind and id are required",
        },
        400,
      );
    }

    const musicService = getMusicService();
    const tracks =
      body.kind === "album"
        ? (await musicService.getAlbum(collectionId))?.tracks ?? []
        : await musicService.getPlaylistTracks(collectionId);

    if (tracks.length === 0) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Collection could not be resolved",
        },
        404,
      );
    }

    const queueService = getQueueService();
    await queueService.appendTracksToQueue(tracks, "manual", {
      requestedBy: parseRequester(body.requestedBy),
    });
    recordDiscoverTrackRequests(tracks);

    return c.json<ApiResponse>({
      success: true,
      data: {
        message: `Added ${tracks.length} tracks to queue`,
        count: tracks.length,
      },
    });
  } catch (error) {
    console.error("Failed to queue discover collection:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to queue discover collection",
      },
      500,
    );
  }
});

/**
 * GET /api/playlists/:playlistId
 * 取得播放清單與曲目資訊
 */
api.get("/playlists/:playlistId", async (c) => {
  const playlistId = normalizeText(c.req.param("playlistId"));

  if (!playlistId) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "playlistId is required",
      },
      400,
    );
  }

  try {
    const musicService = getMusicService();
    const playlist = await musicService.getPlaylistDetails(playlistId);

    if (!playlist) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Playlist not found",
        },
        404,
      );
    }

    return c.json<ApiResponse>({
      success: true,
      data: playlist,
    });
  } catch (error) {
    console.error("Failed to get playlist:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to get playlist",
      },
      500,
    );
  }
});

/**
 * GET /api/albums/:albumId
 * 取得專輯與曲目資訊
 */
api.get("/albums/:albumId", async (c) => {
  const albumId = normalizeText(c.req.param("albumId"));

  if (!albumId) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "albumId is required",
      },
      400,
    );
  }

  try {
    const musicService = getMusicService();
    const album = await musicService.getAlbum(albumId);

    if (!album) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Album not found",
        },
        404,
      );
    }

    return c.json<ApiResponse>({
      success: true,
      data: album,
    });
  } catch (error) {
    console.error("Failed to get album:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to get album",
      },
      500,
    );
  }
});

/**
 * GET /api/artists/:artistId
 * 取得歌手頁資訊
 */
api.get("/artists/:artistId", async (c) => {
  const artistId = normalizeText(c.req.param("artistId"));

  if (!artistId) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "artistId is required",
      },
      400,
    );
  }

  try {
    const musicService = getMusicService();
    const artist = await musicService.getArtistDetails(artistId);

    if (!artist) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Artist not found",
        },
        404,
      );
    }

    return c.json<ApiResponse>({
      success: true,
      data: artist,
    });
  } catch (error) {
    console.error("Failed to get artist:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to get artist",
      },
      500,
    );
  }
});

/**
 * POST /api/albums/:albumId/queue
 * 將整張專輯加入目前播放佇列
 */
api.post("/albums/:albumId/queue", async (c) => {
  const albumId = normalizeText(c.req.param("albumId"));

  if (!albumId) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: "albumId is required",
      },
      400,
    );
  }

  try {
    const body = await c.req.json<{
      tracks: Track[];
      requestedBy?: Track["requestedBy"];
    }>();

    if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
      return c.json<ApiResponse>(
        { success: false, error: "tracks is required" },
        400,
      );
    }

    const queueService = getQueueService();
    await queueService.appendTracksToQueue(body.tracks, "manual", {
      requestedBy: parseRequester(body.requestedBy),
    });

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Album added to queue" },
    });
  } catch (error) {
    console.error("Failed to queue album:", error);
    return c.json<ApiResponse>(
      { success: false, error: "Failed to queue album" },
      500,
    );
  }
});

/**
 * GET /api/state
 * 取得目前播放狀態
 */
api.get("/state", (c) => {
  const queueService = getQueueService();
  const state = queueService.getState();

  return c.json<ApiResponse>({
    success: true,
    data: state,
  });
});

/**
 * GET /api/lyrics
 * 取得目前播放歌曲的歌詞
 */
api.get("/lyrics", async (c) => {
  try {
    const queueService = getQueueService();
    const lyrics = await queueService.getLyrics();

    return c.json<ApiResponse>({
      success: true,
      data: lyrics,
    });
  } catch (error) {
    console.error("Failed to get lyrics:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to get lyrics",
      },
      500,
    );
  }
});

/**
 * POST /api/play
 * 繼續播放
 */
api.post("/play", (c) => {
  try {
    const queueService = getQueueService();
    queueService.play();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Playing" },
    });
  } catch (error) {
    console.error("Failed to play:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to play",
      },
      500,
    );
  }
});

/**
 * POST /api/pause
 * 暫停播放
 */
api.post("/pause", (c) => {
  try {
    const queueService = getQueueService();
    queueService.pause();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Paused" },
    });
  } catch (error) {
    console.error("Failed to pause:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to pause",
      },
      500,
    );
  }
});

/**
 * POST /api/skip
 * 跳過當前歌曲
 */
api.post("/skip", (c) => {
  try {
    const queueService = getQueueService();
    queueService.skip();

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Skipped" },
    });
  } catch (error) {
    console.error("Failed to skip:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to skip",
      },
      500,
    );
  }
});

/**
 * POST /api/volume
 * 調整音量
 */
api.post("/volume", async (c) => {
  try {
    const body = await c.req.json<{ volume: number }>();

    if (
      typeof body.volume !== "number" ||
      body.volume < 0 ||
      body.volume > 100
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Volume must be between 0 and 100",
        },
        400,
      );
    }

    const queueService = getQueueService();
    queueService.setVolume(body.volume);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Volume updated" },
    });
  } catch (error) {
    console.error("Failed to set volume:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to set volume",
      },
      500,
    );
  }
});

/**
 * POST /api/playback/settings
 * 更新播放設定
 */
api.post("/playback/settings", async (c) => {
  try {
    const body = await c.req.json<Partial<PlaybackSettings>>();

    if (
      (body.crossfadeEnabled !== undefined &&
        typeof body.crossfadeEnabled !== "boolean") ||
      (body.crossfadeDurationSeconds !== undefined &&
        (typeof body.crossfadeDurationSeconds !== "number" ||
          !Number.isFinite(body.crossfadeDurationSeconds))) ||
      (body.volumeNormalizationEnabled !== undefined &&
        typeof body.volumeNormalizationEnabled !== "boolean") ||
      (body.crossfadeEnabled === undefined &&
        body.crossfadeDurationSeconds === undefined &&
        body.volumeNormalizationEnabled === undefined)
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Playback settings payload is invalid",
        },
        400,
      );
    }

    const queueService = getQueueService();
    const playbackSettings = queueService.setPlaybackSettings(body);

    return c.json<ApiResponse<PlaybackSettings>>({
      success: true,
      data: playbackSettings,
    });
  } catch (error) {
    console.error("Failed to update playback settings:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to update playback settings",
      },
      500,
    );
  }
});

/**
 * POST /api/seek
 * 跳轉播放位置
 */
api.post("/seek", async (c) => {
  try {
    const body = await c.req.json<{ position: number }>();

    if (typeof body.position !== "number" || body.position < 0) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: "Position must be a non-negative number",
        },
        400,
      );
    }

    const queueService = getQueueService();
    queueService.seekTo(body.position);

    return c.json<ApiResponse>({
      success: true,
      data: { message: "Seeked" },
    });
  } catch (error) {
    console.error("Failed to seek:", error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: "Failed to seek",
      },
      500,
    );
  }
});

export default api;

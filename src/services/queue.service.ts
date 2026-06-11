import type {
  QueueOrigin,
  Track,
  PlaybackState,
  PlaybackProgress,
  PlaybackSettings,
} from "../types/index.ts";
import { getPlayerService } from "./player.service.ts";
import { getMusicService } from "./music.service.ts";
import { pushRecentTrackId, selectRadioCandidates } from "./radio.helpers.ts";
import { log } from "../utils/logger.ts";

type QueueChangeCallback = (queue: Track[]) => void;
type PlaybackStateCallback = (state: PlaybackState) => void;
type PlaybackProgressCallback = (progress: PlaybackProgress) => void;
type LyricsChangeCallback = (lyrics: any[]) => void;
type TrackLoadingCallback = (payload: {
  track: Track | null;
  message?: string;
}) => void;
type TrackReadyCallback = (track: Track) => void;
type PlayErrorCallback = (payload: {
  error: string;
  track: Track | null;
}) => void;

const PROGRESS_BROADCAST_INTERVAL_MS = 250;
const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  crossfadeEnabled: true,
  crossfadeDurationSeconds: 4,
  volumeNormalizationEnabled: true,
};
const MIN_CROSSFADE_DURATION_SECONDS = 1;
const MAX_CROSSFADE_DURATION_SECONDS = 8;
const MIN_CROSSFADE_START_POSITION_SECONDS = 5;
const CROSSFADE_START_TOLERANCE_SECONDS = 0.35;
const MAX_CROSSFADE_TRIGGER_LEAD_SECONDS = 1;

class QueueService {
  private static instance: QueueService | undefined;
  private mixRequestId = 0;
  private radioRequestId = 0;
  private preloadRequestId = 0;
  private queue: Track[] = [];
  private currentTrack: Track | null = null;
  private lastPlayedTrack: Track | null = null;
  private currentPosition = 0;
  private currentDuration = 0;
  private isPaused = false;
  private radioEnabled = false;
  private playbackSettings: PlaybackSettings = {
    ...DEFAULT_PLAYBACK_SETTINGS,
  };
  private recentRadioTrackIds: string[] = [];
  private radioFillPromise: Promise<void> | null = null;
  private preloadPromise: Promise<boolean> | null = null;
  private preloadTrackId: string | null = null;
  private crossfadeStartedForTrackId: string | null = null;
  private crossfadeTransitionPromise: Promise<void> | null = null;
  private lastEofTimestamp = 0; // 記錄 EOF 時間，用於抑制假 pause 事件
  private queueChangeCallbacks: QueueChangeCallback[] = [];
  private stateChangeCallbacks: PlaybackStateCallback[] = [];
  private progressChangeCallbacks: PlaybackProgressCallback[] = [];
  private lyricsChangeCallbacks: LyricsChangeCallback[] = [];
  private trackLoadingCallbacks: TrackLoadingCallback[] = [];
  private trackReadyCallbacks: TrackReadyCallback[] = [];
  private playErrorCallbacks: PlayErrorCallback[] = [];
  private pendingProgressTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastProgressBroadcastAt = 0;
  private lastProgressPayload: PlaybackProgress | null = null;

  private constructor() {
    // 監聽播放器事件
    const player = getPlayerService();
    player.onEvent((event) => {
      let shouldBroadcastProgress = false;
      let shouldBroadcastState = false;

      if (event.timePos !== undefined) {
        this.currentPosition = event.timePos;
        shouldBroadcastProgress = true;
      }
      if (event.duration !== undefined) {
        this.currentDuration = event.duration;
        shouldBroadcastProgress = true;
      }

      // EOF 處理
      if (event.eof === true) {
        this.lastEofTimestamp = Date.now(); // 記錄 EOF 時間
        log.info("Track ended, playing next...");
        void this.playNext();
        return;
      }

      // Pause 處理 - 抑制 EOF 後 2 秒內的假暫停
      if (event.paused !== undefined) {
        // mpv 進入 idle 模式時會發送 pause: true
        // 抑制 EOF 後 2 秒內的 pause 事件，防止覆蓋 isPlaying 狀態
        const timeSinceEof = Date.now() - this.lastEofTimestamp;
        if (event.paused && timeSinceEof < 2000) {
          log.debug("Ignoring pause event after EOF", {
            timeSinceEof,
            threshold: 2000,
          });
          return; // 直接返回，不處理也不廣播
        }
        this.isPaused = event.paused;
        shouldBroadcastState = true;
        shouldBroadcastProgress = true;
      }

      if (shouldBroadcastState) {
        this.broadcastState();
      }

      if (shouldBroadcastProgress) {
        this.broadcastProgress({ force: shouldBroadcastState });
        void this.maybeStartCrossfade();
      }
    });
  }

  static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  static resetInstanceForTests(): void {
    if (QueueService.instance) {
      QueueService.instance.resetForTests();
    }
    QueueService.instance = undefined;
  }

  /**
   * 註冊佇列變更回調
   */
  onQueueChange(callback: QueueChangeCallback): void {
    this.queueChangeCallbacks.push(callback);
  }

  /**
   * 註冊播放狀態變更回調
   */
  onStateChange(callback: PlaybackStateCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * 註冊播放進度變更回調
   */
  onProgressChange(callback: PlaybackProgressCallback): void {
    this.progressChangeCallbacks.push(callback);
  }

  /**
   * 註冊歌詞變更回調
   */
  onLyricsChange(callback: LyricsChangeCallback): void {
    this.lyricsChangeCallbacks.push(callback);
  }

  onTrackLoading(callback: TrackLoadingCallback): void {
    this.trackLoadingCallbacks.push(callback);
  }

  onTrackReady(callback: TrackReadyCallback): void {
    this.trackReadyCallbacks.push(callback);
  }

  onPlayError(callback: PlayErrorCallback): void {
    this.playErrorCallbacks.push(callback);
  }

  /**
   * 廣播佇列變更
   */
  private broadcastQueueChange(): void {
    for (const callback of this.queueChangeCallbacks) {
      callback([...this.queue]);
    }
  }

  /**
   * 廣播狀態變更
   */
  private broadcastState(): void {
    const state = this.getState();

    for (const callback of this.stateChangeCallbacks) {
      callback(state);
    }
  }

  private broadcastProgress(options: { force?: boolean } = {}): void {
    const progress = this.getProgress();
    const hasMeaningfulChange = !isSameProgress(
      this.lastProgressPayload,
      progress,
    );

    if (!hasMeaningfulChange) {
      if (this.pendingProgressTimeout) {
        clearTimeout(this.pendingProgressTimeout);
        this.pendingProgressTimeout = null;
      }
      return;
    }

    const emit = () => {
      this.pendingProgressTimeout = null;
      const latestProgress = this.getProgress();

      if (isSameProgress(this.lastProgressPayload, latestProgress)) {
        return;
      }

      this.lastProgressPayload = latestProgress;
      this.lastProgressBroadcastAt = Date.now();

      for (const callback of this.progressChangeCallbacks) {
        callback(latestProgress);
      }
    };

    if (options.force) {
      if (this.pendingProgressTimeout) {
        clearTimeout(this.pendingProgressTimeout);
        this.pendingProgressTimeout = null;
      }
      emit();
      return;
    }

    const elapsed = Date.now() - this.lastProgressBroadcastAt;
    if (elapsed >= PROGRESS_BROADCAST_INTERVAL_MS) {
      emit();
      return;
    }

    if (this.pendingProgressTimeout) {
      return;
    }

    this.pendingProgressTimeout = setTimeout(
      emit,
      PROGRESS_BROADCAST_INTERVAL_MS - elapsed,
    );
  }

  private broadcastPlayError(error: string, track: Track | null): void {
    for (const callback of this.playErrorCallbacks) {
      callback({ error, track });
    }
  }

  private broadcastTrackLoading(track: Track | null, message?: string): void {
    for (const callback of this.trackLoadingCallbacks) {
      callback({ track, message });
    }
  }

  private broadcastTrackReady(track: Track): void {
    for (const callback of this.trackReadyCallbacks) {
      callback(track);
    }
  }

  private syncCurrentDurationFromPlayer(): boolean {
    const activeDuration = getPlayerService().getActiveDuration();
    if (
      typeof activeDuration !== "number" ||
      !Number.isFinite(activeDuration) ||
      activeDuration <= 0 ||
      this.currentDuration === activeDuration
    ) {
      return false;
    }

    this.currentDuration = activeDuration;
    return true;
  }

  /**
   * 加入歌曲到播放清單
   */
  async addToQueue(
    track: Track,
    options: { requestedBy?: Track["requestedBy"] } = {},
  ): Promise<void> {
    const requester = this.resolveRequester(options.requestedBy, track);
    const normalizedTrack = this.withRequester(track, requester);
    this.insertManualTracks([normalizedTrack]);

    log.info("Added to queue", {
      videoId: normalizedTrack.videoId,
      title: normalizedTrack.title,
      artist: normalizedTrack.artist,
      requestedBy: normalizedTrack.requestedBy?.profileId ?? null,
    });
    this.broadcastQueueChange();

    // 如果目前沒有播放，自動開始播放
    // 使用雙重檢查：currentTrack 為 null 且播放器未在播放
    const playerIsPlaying = getPlayerService().isCurrentlyPlaying();
    const shouldAutoPlay = this.currentTrack === null && !playerIsPlaying;

    log.info("Auto-play check", {
      currentTrack: this.currentTrack?.title ?? "null",
      playerIsPlaying,
      shouldAutoPlay,
      queueLength: this.queue.length,
    });

    if (shouldAutoPlay) {
      log.info("Auto-starting playback for newly added track");
      await this.playNext();
      return;
    }

    this.maybeHydrateRadioQueue();
    void this.syncNextTrackPreload();
  }

  /**
   * 創建混合播放清單
   * 清空佇列，立即開始播放 Mix
   */
  async createMixFromTrack(
    baseTrack: Track,
    options: { requestedBy?: Track["requestedBy"] } = {},
  ): Promise<Track[]> {
    const requester = this.resolveRequester(options.requestedBy, baseTrack);
    const normalizedBaseTrack = this.withRequester(baseTrack, requester);

    log.info("Creating mix", {
      baseTrack: normalizedBaseTrack.title,
      requestedBy: normalizedBaseTrack.requestedBy?.profileId ?? null,
    });
    const mixRequestId = ++this.mixRequestId;

    // 停止當前播放
    await getPlayerService().stop();
    this.clearPendingPreload();
    this.resetCrossfadeState();

    // 清空佇列
    this.queue = [];
    this.currentTrack = null;
    this.currentPosition = 0;
    this.currentDuration = 0;
    this.isPaused = false;
    this.broadcastQueueChange();
    this.broadcastState();

    // 先加入基礎歌曲
    this.queue.push(this.withOrigin(normalizedBaseTrack, "mix"));

    log.info("Mix created, starting playback", {
      addedTracks: this.queue.length,
    });
    this.broadcastQueueChange();

    // 先開始播放 base song，不等待推薦歌曲回來。
    await this.playNext();

    // 再背景補上推薦歌曲。
    let mixTracks: Track[] = [];
    try {
      mixTracks = await getMusicService().getMixTracks(
        normalizedBaseTrack.videoId,
        10,
      );

      // 如果期間又建立了新的 mix，就丟棄舊結果避免污染 queue。
      if (mixRequestId !== this.mixRequestId) {
        log.info("Discarding stale mix tracks", {
          baseTrack: normalizedBaseTrack.title,
          mixRequestId,
          currentMixRequestId: this.mixRequestId,
        });
        return [normalizedBaseTrack];
      }

      if (mixTracks.length > 0) {
        const normalizedMixTracks = mixTracks.map((track) =>
          this.withOrigin(this.withRequester(track, requester), "mix"),
        );
        this.queue.push(...normalizedMixTracks);
        this.broadcastQueueChange();
        void this.syncNextTrackPreload();

        // 若 base song 已結束且播放器空閒，補上的 mix 要能自動接續播放。
        if (this.currentTrack === null && !getPlayerService().isCurrentlyPlaying()) {
          await this.playNext();
        }
      }
    } catch (error) {
      log.warn("Failed to get mix tracks, playing base track only", { error });
    }

    return [
      normalizedBaseTrack,
      ...mixTracks.map((track) => this.withRequester(track, requester)),
    ];
  }

  /**
   * 從播放清單移除歌曲
   */
  removeFromQueue(index: number): void {
    if (index >= 0 && index < this.queue.length) {
      const removed = this.queue.splice(index, 1);
      log.info("Removed from queue", { videoId: removed[0]?.videoId });
      this.broadcastQueueChange();
      this.broadcastState();
      this.maybeHydrateRadioQueue();
      void this.syncNextTrackPreload({ force: true });
    }
  }

  /**
   * 清空待播佇列，保留目前正在播放的歌曲
   */
  clearQueue(): number {
    const clearedCount = this.queue.length;

    this.queue = [];
    this.clearPendingPreload();
    this.resetCrossfadeState();

    if (clearedCount === 0) {
      return 0;
    }

    log.info("Cleared queue", { clearedCount });
    this.broadcastQueueChange();
    this.broadcastState();

    return clearedCount;
  }

  /**
   * 重新排序播放清單
   */
  reorderQueue(fromIndex: number, toIndex: number): void {
    const isValidIndex = (index: number) =>
      Number.isInteger(index) && index >= 0 && index < this.queue.length;

    if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) {
      throw new RangeError("Invalid queue index");
    }

    if (fromIndex === toIndex) {
      return;
    }

    const [movedTrack] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, movedTrack);

    log.info("Reordered queue", {
      videoId: movedTrack?.videoId,
      fromIndex,
      toIndex,
    });

    this.broadcastQueueChange();
    this.broadcastState();
    this.maybeHydrateRadioQueue();
    void this.syncNextTrackPreload({ force: true });
  }

  /**
   * 播放下一首
   */
  async playNext(): Promise<void> {
    log.info("playNext called", {
      queueLength: this.queue.length,
      currentTrack: this.currentTrack?.title ?? "null",
      isPaused: this.isPaused,
    });
    this.resetCrossfadeState();

    if (this.queue.length === 0) {
      if (this.radioEnabled) {
        this.broadcastTrackLoading(null, "正在準備下一首...");
      }

      const filled = await this.ensureRadioTracks({
        immediatePlayback: true,
        seedTrack: this.resolveAutoMixSeedTrack(),
      });

      if (filled && this.queue.length > 0) {
        return this.playNext();
      }

      log.info("Queue is empty, stopping playback");
      if (this.currentTrack) {
        this.lastPlayedTrack = this.currentTrack;
        this.rememberRecentlyPlayed(this.currentTrack.videoId);
      }
      this.clearPendingPreload();
      this.currentTrack = null;
      this.currentPosition = 0;
      this.currentDuration = 0;
      this.isPaused = false;
      getPlayerService().stop();
      this.broadcastState();
      return;
    }

    const outgoingTrack = this.currentTrack;
    const nextTrack = this.queue[0]!;
    const player = getPlayerService();

    if (outgoingTrack) {
      this.lastPlayedTrack = outgoingTrack;
      this.rememberRecentlyPlayed(outgoingTrack.videoId);
    }

    let activatedPreloaded = false;
    if (player.isTrackPreloaded(nextTrack.videoId)) {
      activatedPreloaded = await player.playPreloaded(nextTrack.videoId);
    }

    if (!activatedPreloaded && outgoingTrack) {
      // 手動切歌時要先停止舊播放器，再切換 currentTrack，
      // 否則舊歌在串流解析期間送出的 time-pos 會被誤標成新歌進度。
      player.stop();
    }

    // 從佇列取出下一首
    this.queue.shift();
    this.preloadPromise = null;
    this.preloadTrackId = null;
    this.currentTrack = nextTrack;
    this.currentPosition = 0;
    this.currentDuration = nextTrack.duration;
    this.isPaused = false;

    if (activatedPreloaded) {
      this.syncCurrentDurationFromPlayer();
    }

    log.info("Playing next track", { title: nextTrack.title });

    // 廣播變更
    this.broadcastQueueChange();
    this.broadcastState();
    this.maybeHydrateRadioQueue();

    // 獲取並廣播歌詞
    this.fetchAndBroadcastLyrics();

    if (activatedPreloaded) {
      this.broadcastProgress({ force: true });
      this.broadcastTrackReady(nextTrack);
      void this.syncNextTrackPreload({ force: true });
      return;
    }

    this.broadcastTrackLoading(nextTrack);

    try {
      log.info("Fetching direct stream URL for playback", {
        videoId: nextTrack.videoId,
      });
      const streamResult = await getMusicService().getStreamUrl(nextTrack.videoId);
      log.info("Direct stream URL obtained", {
        source: streamResult.source,
        bitrate: streamResult.bitrate,
        urlLength: streamResult.url.length,
      });
      await player.playUrl(streamResult.url, {
        trackId: nextTrack.videoId,
      });
      const didSyncDuration = this.syncCurrentDurationFromPlayer();
      log.info("Playback started successfully via direct stream URL", {
        source: streamResult.source,
      });
      if (didSyncDuration) {
        this.broadcastState();
        this.broadcastProgress({ force: true });
      }
      this.broadcastTrackReady(nextTrack);
      void this.syncNextTrackPreload({ force: true });
    } catch (playError) {
      // Fallback：若直連串流失敗，再退回 mpv 直接處理 YouTube URL。
      log.warn("Direct stream playback failed, falling back to YouTube URL", {
        error:
          playError instanceof Error ? playError.message : String(playError),
        stack: playError instanceof Error ? playError.stack : undefined,
        videoId: nextTrack.videoId,
      });

      try {
        await player.play(nextTrack.videoId);
        const didSyncDuration = this.syncCurrentDurationFromPlayer();
        log.info("Fallback playback started successfully via YouTube URL");
        if (didSyncDuration) {
          this.broadcastState();
          this.broadcastProgress({ force: true });
        }
        this.broadcastTrackReady(nextTrack);
        void this.syncNextTrackPreload({ force: true });
      } catch (fallbackError) {
        const errorMessage = `Failed to play track: ${nextTrack.title}. Error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;

        log.error("Both direct stream playback and YouTube URL fallback failed", {
          playError:
            playError instanceof Error ? playError.message : String(playError),
          fallbackError:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          videoId: nextTrack.videoId,
          trackTitle: nextTrack.title,
        });

        // 恢復佇列並重置狀態，避免歌曲因自動播放失敗而直接消失。
        this.queue.unshift(nextTrack);
        this.currentTrack = null;
        this.currentPosition = 0;
        this.currentDuration = 0;
        this.isPaused = false;
        this.broadcastQueueChange();
        this.broadcastState();
        this.broadcastPlayError(errorMessage, nextTrack);
        void this.syncNextTrackPreload({ force: true });

        // 拋出錯誤，讓調用者知道播放失敗
        throw new Error(errorMessage);
      }
    }
  }

  /**
   * 開始/恢復播放
   */
  play(): void {
    if (!this.currentTrack) {
      log.debug("Ignoring play request without an active track");
      return;
    }

    if (!this.isPaused && getPlayerService().isCurrentlyPlaying()) {
      return;
    }

    this.isPaused = false;
    getPlayerService().resume();
    this.broadcastState();
    this.broadcastProgress({ force: true });
    void this.maybeStartCrossfade();
  }

  /**
   * 暫停播放
   */
  pause(): void {
    if (!this.currentTrack) {
      log.debug("Ignoring pause request without an active track");
      return;
    }

    if (this.isPaused) {
      return;
    }

    this.isPaused = true;
    getPlayerService().pause();
    this.broadcastState();
    this.broadcastProgress({ force: true });
  }

  /**
   * 暫停/繼續播放
   */
  togglePlayPause(): void {
    if (this.isPaused) {
      this.play();
    } else {
      this.pause();
    }
  }

  /**
   * 跳過當前歌曲
   */
  skip(): void {
    log.info("Skipping current track");
    void this.playNext();
  }

  setPlaybackSettings(
    settings: Partial<PlaybackSettings>,
  ): PlaybackSettings {
    const nextSettings = normalizePlaybackSettings({
      ...this.playbackSettings,
      ...settings,
    });

    if (arePlaybackSettingsEqual(this.playbackSettings, nextSettings)) {
      return { ...this.playbackSettings };
    }

    const volumeNormalizationChanged =
      this.playbackSettings.volumeNormalizationEnabled !==
      nextSettings.volumeNormalizationEnabled;
    this.playbackSettings = nextSettings;
    this.broadcastState();

    if (volumeNormalizationChanged) {
      getPlayerService().setVolumeNormalizationEnabled(
        nextSettings.volumeNormalizationEnabled,
      );
    }

    void this.syncNextTrackPreload({ force: true });
    return { ...this.playbackSettings };
  }

  enableRadio(): void {
    if (this.radioEnabled) {
      return;
    }

    this.radioEnabled = true;
    this.broadcastState();
    this.broadcastProgress({ force: true });
    this.maybeHydrateRadioQueue({ force: true });
  }

  disableRadio(): void {
    if (!this.radioEnabled) {
      return;
    }

    this.radioEnabled = false;
    this.broadcastState();
    this.broadcastProgress({ force: true });
  }

  toggleRadio(): void {
    if (this.radioEnabled) {
      this.disableRadio();
      return;
    }

    this.enableRadio();
  }

  /**
   * 設定音量
   */
  setVolume(volume: number): void {
    getPlayerService().setVolume(volume);
    this.broadcastState();
  }

  /**
   * 跳轉到指定位置
   */
  seekTo(position: number): void {
    // 驗證輸入和邊界
    if (!Number.isFinite(position) || position < 0) {
      log.warn("Invalid seek position", { position });
      return;
    }

    if (!this.currentTrack) {
      log.warn("Cannot seek: no current track");
      return;
    }

    // 限制在當前歌曲的 duration 範圍內
    const clampedPosition =
      Number.isFinite(this.currentDuration) && this.currentDuration > 0
        ? Math.min(position, this.currentDuration)
        : position;

    log.debug("Seeking to position", { position: clampedPosition });
    this.currentPosition = clampedPosition;
    getPlayerService().seek(clampedPosition);
    this.broadcastProgress({ force: true });
    this.crossfadeStartedForTrackId = null;
    void this.maybeStartCrossfade();
  }

  /**
   * 取得播放清單
   */
  getQueue(): Track[] {
    return [...this.queue];
  }

  /**
   * 取得目前播放狀態
   */
  getState(): PlaybackState {
    return {
      isPlaying: this.getIsPlaying(),
      currentTrack: this.currentTrack,
      position: this.currentPosition,
      duration: this.currentDuration,
      volume: getPlayerService().getVolume(),
      queue: [...this.queue],
      radioEnabled: this.radioEnabled,
      lastPlayedTrack: this.lastPlayedTrack,
      playbackSettings: { ...this.playbackSettings },
    };
  }

  getProgress(): PlaybackProgress {
    return {
      trackId: this.currentTrack?.videoId ?? null,
      position: this.currentPosition,
      duration: this.currentDuration,
      isPlaying: this.getIsPlaying(),
    };
  }

  async replaceQueueWithTracks(
    tracks: Track[],
    origin: QueueOrigin = "playlist",
    options: { requestedBy?: Track["requestedBy"] } = {},
  ): Promise<void> {
    await getPlayerService().stop();
    this.clearPendingPreload();
    this.resetCrossfadeState();
    const requester = this.resolveRequester(options.requestedBy, null, tracks);

    this.queue = tracks.map((track) =>
      this.withOrigin(this.withRequester(track, requester), origin),
    );
    this.currentTrack = null;
    this.currentPosition = 0;
    this.currentDuration = 0;
    this.isPaused = false;

    this.broadcastQueueChange();
    this.broadcastState();

    if (this.queue.length > 0) {
      await this.playNext();
    }
  }

  async appendTracksToQueue(
    tracks: Track[],
    origin: QueueOrigin = "playlist",
    options: { requestedBy?: Track["requestedBy"] } = {},
  ): Promise<void> {
    if (tracks.length === 0) {
      return;
    }
    const requester = this.resolveRequester(options.requestedBy, null, tracks);

    this.insertManualTracks(
      tracks.map((track) =>
        this.withOrigin(this.withRequester(track, requester), origin),
      ),
      origin === "manual" || origin === "playlist",
    );
    this.broadcastQueueChange();
    this.broadcastState();

    const playerIsPlaying = getPlayerService().isCurrentlyPlaying();
    const shouldAutoPlay = this.currentTrack === null && !playerIsPlaying;

    if (shouldAutoPlay) {
      await this.playNext();
      return;
    }

    this.maybeHydrateRadioQueue();
    void this.syncNextTrackPreload();
  }

  renameRequesterProfile(profileId: string, profileName: string): void {
    const normalizedProfileId = profileId.trim();
    const normalizedProfileName = profileName.trim();

    if (!normalizedProfileId || !normalizedProfileName) {
      return;
    }

    let didChange = false;

    const renamedQueue = this.queue.map((track) => {
      const nextTrack =
        this.withRenamedRequester(
        track,
        normalizedProfileId,
        normalizedProfileName,
        ) ?? track;

      if (nextTrack !== track) {
        didChange = true;
      }

      return nextTrack;
    });
    const renamedCurrentTrack = this.withRenamedRequester(
      this.currentTrack,
      normalizedProfileId,
      normalizedProfileName,
    );
    const renamedLastPlayedTrack = this.withRenamedRequester(
      this.lastPlayedTrack,
      normalizedProfileId,
      normalizedProfileName,
    );

    if (renamedCurrentTrack !== this.currentTrack) {
      didChange = true;
    }

    if (renamedLastPlayedTrack !== this.lastPlayedTrack) {
      didChange = true;
    }

    if (!didChange) {
      return;
    }

    this.queue = renamedQueue;
    this.currentTrack = renamedCurrentTrack;
    this.lastPlayedTrack = renamedLastPlayedTrack;
    this.broadcastQueueChange();
    this.broadcastState();
    void this.syncNextTrackPreload();
  }

  /**
   * 取得歌詞
   */
  async getLyrics() {
    if (!this.currentTrack) {
      return [];
    }

    const musicService = getMusicService();
    return await musicService.getLyrics(
      this.currentTrack.title,
      this.currentTrack.artist,
      this.currentTrack.duration,
    );
  }

  /**
   * 獲取並廣播歌詞（異步）
   */
  private fetchAndBroadcastLyrics(): void {
    // 使用異步方式獲取歌詞，避免阻塞播放
    this.getLyrics()
      .then((lyrics) => {
        // 透過回調通知歌詞變更
        for (const callback of this.lyricsChangeCallbacks) {
          callback(lyrics);
        }
        log.debug("Lyrics broadcasted", { lyricsCount: lyrics.length });
      })
      .catch((error) => {
        log.error("Failed to fetch lyrics", { error });
      });
  }

  private resetCrossfadeState(): void {
    this.crossfadeStartedForTrackId = null;
    this.crossfadeTransitionPromise = null;
  }

  private clearPendingPreload(trackId?: string): void {
    this.preloadRequestId += 1;
    this.preloadPromise = null;

    if (!trackId || this.preloadTrackId === trackId) {
      this.preloadTrackId = null;
    }

    getPlayerService().cancelPreload(trackId);
  }

  private async syncNextTrackPreload(
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const nextTrack = this.queue[0] ?? null;
    const player = getPlayerService();

    if (!nextTrack) {
      this.clearPendingPreload();
      return false;
    }

    if (!options.force && player.isTrackPreloaded(nextTrack.videoId)) {
      this.preloadTrackId = nextTrack.videoId;
      return true;
    }

    if (options.force && player.isTrackPreloaded(nextTrack.videoId)) {
      this.clearPendingPreload(nextTrack.videoId);
    }

    if (
      !options.force &&
      this.preloadPromise &&
      this.preloadTrackId === nextTrack.videoId
    ) {
      return this.preloadPromise;
    }

    if (this.preloadTrackId && this.preloadTrackId !== nextTrack.videoId) {
      this.clearPendingPreload();
    }

    const requestId = ++this.preloadRequestId;
    this.preloadTrackId = nextTrack.videoId;

    const request = (async () => {
      try {
        log.info("Preloading next track", {
          videoId: nextTrack.videoId,
          title: nextTrack.title,
        });

        const streamResult = await getMusicService().getStreamUrl(nextTrack.videoId);
        if (
          requestId !== this.preloadRequestId ||
          this.queue[0]?.videoId !== nextTrack.videoId
        ) {
          return false;
        }

        const ready = await player.preloadUrl(nextTrack.videoId, streamResult.url);
        if (
          !ready ||
          requestId !== this.preloadRequestId ||
          this.queue[0]?.videoId !== nextTrack.videoId
        ) {
          player.cancelPreload(nextTrack.videoId);
          return false;
        }

        this.preloadTrackId = nextTrack.videoId;
        log.info("Next track preloaded", {
          videoId: nextTrack.videoId,
          source: streamResult.source,
        });
        return true;
      } catch (error) {
        if (requestId === this.preloadRequestId) {
          log.warn("Failed to preload next track", {
            error: error instanceof Error ? error.message : String(error),
            videoId: nextTrack.videoId,
            title: nextTrack.title,
          });
        }
        return false;
      } finally {
        if (requestId === this.preloadRequestId) {
          this.preloadPromise = null;
          if (!player.isTrackPreloaded(nextTrack.videoId)) {
            this.preloadTrackId = null;
          }
        }
      }
    })();

    this.preloadPromise = request;
    return request;
  }

  private async maybeStartCrossfade(): Promise<void> {
    if (
      this.crossfadeTransitionPromise ||
      !this.playbackSettings.crossfadeEnabled ||
      !this.currentTrack ||
      this.isPaused
    ) {
      return;
    }

    const nextTrack = this.queue[0] ?? null;
    if (!nextTrack) {
      return;
    }

    const crossfadeDurationSeconds =
      this.playbackSettings.crossfadeDurationSeconds;
    const crossfadeTriggerLeadSeconds = Math.min(
      MAX_CROSSFADE_TRIGGER_LEAD_SECONDS,
      Math.max(0.25, crossfadeDurationSeconds * 0.25),
    );
    const timeRemaining = this.currentDuration - this.currentPosition;

    if (
      !Number.isFinite(this.currentDuration) ||
      this.currentDuration <= 0 ||
      !Number.isFinite(timeRemaining) ||
      timeRemaining < 0
    ) {
      return;
    }

    if (
      this.currentPosition <
      Math.max(MIN_CROSSFADE_START_POSITION_SECONDS, crossfadeDurationSeconds)
    ) {
      return;
    }

    if (
      timeRemaining >
      crossfadeDurationSeconds +
        crossfadeTriggerLeadSeconds +
        CROSSFADE_START_TOLERANCE_SECONDS
    ) {
      return;
    }

    if (this.crossfadeStartedForTrackId === this.currentTrack.videoId) {
      return;
    }

    if (!getPlayerService().isTrackPreloaded(nextTrack.videoId)) {
      void this.syncNextTrackPreload();
      return;
    }

    this.crossfadeStartedForTrackId = this.currentTrack.videoId;
    this.crossfadeTransitionPromise = this.startCrossfadeToNextTrack(
      nextTrack,
    ).finally(() => {
      this.crossfadeTransitionPromise = null;
    });

    await this.crossfadeTransitionPromise;
  }

  private async startCrossfadeToNextTrack(nextTrack: Track): Promise<void> {
    const outgoingTrack = this.currentTrack;
    if (!outgoingTrack || this.queue[0]?.videoId !== nextTrack.videoId) {
      this.crossfadeStartedForTrackId = null;
      return;
    }

    const didStart = await getPlayerService().crossfadeToPreloaded(
      nextTrack.videoId,
      this.playbackSettings.crossfadeDurationSeconds * 1000,
    );
    if (!didStart) {
      this.crossfadeStartedForTrackId = null;
      void this.syncNextTrackPreload({ force: true });
      return;
    }

    this.lastPlayedTrack = outgoingTrack;
    this.rememberRecentlyPlayed(outgoingTrack.videoId);
    this.queue.shift();
    this.preloadPromise = null;
    this.preloadTrackId = null;
    this.currentTrack = nextTrack;
    this.currentPosition = 0;
    this.currentDuration = nextTrack.duration;
    this.isPaused = false;
    this.crossfadeStartedForTrackId = null;
    this.syncCurrentDurationFromPlayer();

    this.broadcastQueueChange();
    this.broadcastState();
    this.broadcastProgress({ force: true });
    this.broadcastTrackReady(nextTrack);
    this.fetchAndBroadcastLyrics();
    this.maybeHydrateRadioQueue();
    void this.syncNextTrackPreload({ force: true });
  }

  resetForTests(): void {
    this.mixRequestId = 0;
    this.radioRequestId = 0;
    this.preloadRequestId = 0;
    this.queue = [];
    this.currentTrack = null;
    this.lastPlayedTrack = null;
    this.currentPosition = 0;
    this.currentDuration = 0;
    this.isPaused = false;
    this.radioEnabled = false;
    this.playbackSettings = {
      ...DEFAULT_PLAYBACK_SETTINGS,
    };
    this.recentRadioTrackIds = [];
    this.radioFillPromise = null;
    this.preloadPromise = null;
    this.preloadTrackId = null;
    this.crossfadeStartedForTrackId = null;
    this.crossfadeTransitionPromise = null;
    this.lastEofTimestamp = 0;
    this.queueChangeCallbacks = [];
    this.stateChangeCallbacks = [];
    this.progressChangeCallbacks = [];
    this.lyricsChangeCallbacks = [];
    this.trackLoadingCallbacks = [];
    this.trackReadyCallbacks = [];
    this.playErrorCallbacks = [];
    this.lastProgressBroadcastAt = 0;
    this.lastProgressPayload = null;

    if (this.pendingProgressTimeout) {
      clearTimeout(this.pendingProgressTimeout);
      this.pendingProgressTimeout = null;
    }

    getPlayerService().cancelPreload();
  }

  private getIsPlaying(): boolean {
    return !this.isPaused && this.currentTrack !== null;
  }

  private withOrigin(track: Track, origin: QueueOrigin): Track {
    return {
      ...track,
      queueOrigin: origin,
      radioGenerated: origin === "radio",
    };
  }

  private withRequester(
    track: Track,
    requestedBy?: Track["requestedBy"],
  ): Track {
    if (!isValidRequester(requestedBy)) {
      return track;
    }

    if (
      track.requestedBy?.profileId === requestedBy.profileId &&
      track.requestedBy.profileName === requestedBy.profileName
    ) {
      return track;
    }

    return {
      ...track,
      requestedBy,
    };
  }

  private withRenamedRequester(
    track: Track | null,
    profileId: string,
    profileName: string,
  ): Track | null {
    if (
      !track?.requestedBy ||
      track.requestedBy.profileId !== profileId ||
      track.requestedBy.profileName === profileName
    ) {
      return track;
    }

    return {
      ...track,
      requestedBy: {
        ...track.requestedBy,
        profileName,
      },
    };
  }

  private resolveRequester(
    requestedBy?: Track["requestedBy"],
    sourceTrack: Track | null = null,
    sourceTracks: Track[] = [],
  ): Track["requestedBy"] | undefined {
    if (isValidRequester(requestedBy)) {
      return requestedBy;
    }

    const sourceRequester = sourceTrack?.requestedBy;
    if (isValidRequester(sourceRequester)) {
      return sourceRequester;
    }

    for (const track of sourceTracks) {
      if (isValidRequester(track.requestedBy)) {
        return track.requestedBy;
      }
    }

    return undefined;
  }

  private insertManualTracks(
    tracks: Track[],
    prioritizeAheadOfRadio: boolean = true,
  ): void {
    const normalizedTracks = tracks.map((track) =>
      this.withOrigin(track, track.queueOrigin ?? "manual"),
    );

    if (!prioritizeAheadOfRadio) {
      this.queue.push(...normalizedTracks);
      return;
    }

    const firstRadioIndex = this.queue.findIndex((track) => track.radioGenerated);

    if (firstRadioIndex === -1) {
      this.queue.push(...normalizedTracks);
      return;
    }

    this.queue.splice(firstRadioIndex, 0, ...normalizedTracks);
  }

  private maybeHydrateRadioQueue(options: { force?: boolean } = {}): void {
    if (!this.radioEnabled) {
      return;
    }

    const lowWatermark = 3;
    if (!options.force && this.queue.length > lowWatermark) {
      return;
    }

    void this.ensureRadioTracks({
      immediatePlayback: false,
      seedTrack: this.resolveAutoMixSeedTrack(),
    });
  }

  private resolveAutoMixSeedTrack(): Track | null {
    return this.queue.at(-1) ?? this.currentTrack ?? this.lastPlayedTrack;
  }

  private async ensureRadioTracks(options: {
    immediatePlayback: boolean;
    seedTrack: Track | null;
  }): Promise<boolean> {
    if (!this.radioEnabled) {
      return false;
    }

    if (this.radioFillPromise) {
      await this.radioFillPromise;
      return this.queue.length > 0;
    }

    const seedTrack = options.seedTrack;
    if (!seedTrack?.videoId) {
      return false;
    }

    const existingTrackIds = new Set(
      [this.currentTrack, this.lastPlayedTrack, ...this.queue]
        .filter((track): track is Track => Boolean(track))
        .map((track) => track.videoId),
    );

    const requestId = ++this.radioRequestId;
    this.radioFillPromise = (async () => {
      try {
        const mixTracks = await getMusicService().getMixTracks(seedTrack.videoId, 8);

        if (requestId !== this.radioRequestId || !this.radioEnabled) {
          return;
        }

        const nextTracks = selectRadioCandidates(
          mixTracks,
          existingTrackIds,
          this.recentRadioTrackIds,
          5,
        ).map((track) => this.withOrigin(track, "radio"));

        if (nextTracks.length === 0) {
          return;
        }

        this.queue.push(...nextTracks);
        this.broadcastQueueChange();
        this.broadcastState();
        void this.syncNextTrackPreload();

        if (
          options.immediatePlayback &&
          this.currentTrack === null &&
          !getPlayerService().isCurrentlyPlaying() &&
          this.queue.length > 0
        ) {
          await this.playNext();
        }
      } catch (error) {
        log.warn("Failed to hydrate radio queue", {
          error: error instanceof Error ? error.message : String(error),
          seedTrack: seedTrack.title,
        });
      } finally {
        this.radioFillPromise = null;
      }
    })();

    await this.radioFillPromise;
    return this.queue.length > 0;
  }

  private rememberRecentlyPlayed(videoId: string): void {
    this.recentRadioTrackIds = pushRecentTrackId(
      this.recentRadioTrackIds,
      videoId,
      20,
    );
  }
}

function isSameProgress(
  left: PlaybackProgress | null,
  right: PlaybackProgress,
): boolean {
  if (!left) {
    return false;
  }

  return (
    left.trackId === right.trackId &&
    left.position === right.position &&
    left.duration === right.duration &&
    left.isPlaying === right.isPlaying
  );
}

function normalizePlaybackSettings(
  settings: PlaybackSettings,
): PlaybackSettings {
  const nextDuration = Number.isFinite(settings.crossfadeDurationSeconds)
    ? Math.round(settings.crossfadeDurationSeconds)
    : DEFAULT_PLAYBACK_SETTINGS.crossfadeDurationSeconds;

  return {
    crossfadeEnabled: Boolean(settings.crossfadeEnabled),
    crossfadeDurationSeconds: Math.max(
      MIN_CROSSFADE_DURATION_SECONDS,
      Math.min(MAX_CROSSFADE_DURATION_SECONDS, nextDuration),
    ),
    volumeNormalizationEnabled: Boolean(settings.volumeNormalizationEnabled),
  };
}

function arePlaybackSettingsEqual(
  left: PlaybackSettings,
  right: PlaybackSettings,
): boolean {
  return (
    left.crossfadeEnabled === right.crossfadeEnabled &&
    left.crossfadeDurationSeconds === right.crossfadeDurationSeconds &&
    left.volumeNormalizationEnabled === right.volumeNormalizationEnabled
  );
}

function isValidRequester(
  requestedBy: Track["requestedBy"] | undefined,
): requestedBy is NonNullable<Track["requestedBy"]> {
  return Boolean(
    requestedBy?.profileId?.trim() && requestedBy.profileName?.trim(),
  );
}

export function getQueueService(): QueueService {
  return QueueService.getInstance();
}

export function __resetQueueServiceForTests(): void {
  QueueService.resetInstanceForTests();
}

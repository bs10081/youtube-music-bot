import { create } from "zustand";
import type {
  AudioOutputStatus,
  ConnectionStatus,
  PlaybackState,
  PlaybackProgress,
  SearchResult,
  Track,
  LyricLine,
} from "@/types";

let loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;

interface PlayerStore {
  // 連線狀態
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // 播放狀態
  playbackState: PlaybackState;
  setPlaybackState: (state: PlaybackState) => void;
  updatePlaybackState: (partial: Partial<PlaybackState>) => void;
  updatePlaybackProgress: (progress: PlaybackProgress) => void;

  // 載入狀態
  isLoadingTrack: boolean;
  loadingMessage: string | null;
  setLoadingTrack: (loading: boolean, message?: string) => void;

  // 音訊輸出(WS audio_output 廣播同步)
  audioOutput: AudioOutputStatus | null;
  setAudioOutput: (status: AudioOutputStatus) => void;

  // 歌詞
  lyrics: LyricLine[];
  setLyrics: (lyrics: LyricLine[]) => void;

  // 搜尋結果
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  clearSearchResults: () => void;

  // 手機版搜尋狀態
  isMobileSearchOpen: boolean;
  setMobileSearchOpen: (open: boolean) => void;

  // 手機版 TabBar 狀態
  mobileActiveTab: "search" | "discover" | "library";
  setMobileActiveTab: (tab: "search" | "discover" | "library") => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  // 連線狀態
  connectionStatus: "disconnected",
  setConnectionStatus: (status) =>
    set((state) =>
      state.connectionStatus === status ? state : { connectionStatus: status },
    ),

  // 播放狀態
  playbackState: {
    isPlaying: false,
    currentTrack: null,
    position: 0,
    duration: 0,
    volume: 50,
    queue: [],
    radioEnabled: false,
    lastPlayedTrack: null,
    playbackSettings: {
      crossfadeEnabled: true,
      crossfadeDurationSeconds: 4,
      volumeNormalizationEnabled: true,
    },
  },
  setPlaybackState: (nextState) =>
    set((state) =>
      isSamePlaybackState(state.playbackState, nextState)
        ? state
        : { playbackState: nextState },
    ),
  updatePlaybackState: (partial) =>
    set((state) => {
      const nextPlaybackState = {
        ...state.playbackState,
        ...partial,
      };

      return isSamePlaybackState(state.playbackState, nextPlaybackState)
        ? state
        : { playbackState: nextPlaybackState };
    }),
  updatePlaybackProgress: (progress) =>
    set((state) => {
      const currentTrackId = state.playbackState.currentTrack?.videoId ?? null;
      if (progress.trackId !== currentTrackId) {
        return state;
      }

      if (
        state.playbackState.position === progress.position &&
        state.playbackState.duration === progress.duration &&
        state.playbackState.isPlaying === progress.isPlaying
      ) {
        return state;
      }

      return {
        playbackState: {
          ...state.playbackState,
          position: progress.position,
          duration: progress.duration,
          isPlaying: progress.isPlaying,
        },
      };
    }),

  // 載入狀態
  isLoadingTrack: false,
  loadingMessage: null,
  setLoadingTrack: (loading, message) => {
    if (loadingTimeoutId) {
      clearTimeout(loadingTimeoutId);
      loadingTimeoutId = null;
    }

    set((state) => {
      const nextMessage = message || null;

      if (
        state.isLoadingTrack === loading &&
        state.loadingMessage === nextMessage
      ) {
        return state;
      }

      return {
        isLoadingTrack: loading,
        loadingMessage: nextMessage,
      };
    });

    // 如果開始載入，設定 10 秒超時自動清除
    if (loading) {
      loadingTimeoutId = setTimeout(() => {
        // 如果 10 秒後仍在載入，自動清除
        if (usePlayerStore.getState().isLoadingTrack) {
          set({ isLoadingTrack: false, loadingMessage: null });
        }
        loadingTimeoutId = null;
      }, 10000);
    }
  },

  // 音訊輸出
  audioOutput: null,
  setAudioOutput: (status) => set({ audioOutput: status }),

  // 歌詞
  lyrics: [],
  setLyrics: (lyrics) =>
    set((state) => (state.lyrics === lyrics ? state : { lyrics })),

  // 搜尋結果
  searchResults: [],
  setSearchResults: (results) =>
    set((state) =>
      state.searchResults === results ? state : { searchResults: results },
    ),
  clearSearchResults: () =>
    set((state) =>
      state.searchResults.length === 0 ? state : { searchResults: [] },
    ),

  // 手機版搜尋狀態
  isMobileSearchOpen: false,
  setMobileSearchOpen: (open) =>
    set((state) =>
      state.isMobileSearchOpen === open
        ? state
        : { isMobileSearchOpen: open },
    ),

  // 手機版 TabBar 狀態
  mobileActiveTab: "search",
  setMobileActiveTab: (tab) =>
    set((state) =>
      state.mobileActiveTab === tab ? state : { mobileActiveTab: tab },
    ),
}));

function areTracksEqual(left: Track | null, right: Track | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.videoId === right.videoId &&
    left.title === right.title &&
    left.artist === right.artist &&
    left.duration === right.duration &&
    left.thumbnail === right.thumbnail &&
    left.album?.id === right.album?.id &&
    left.album?.name === right.album?.name &&
    areRequestersEqual(left.requestedBy, right.requestedBy) &&
    left.queueOrigin === right.queueOrigin &&
    left.radioGenerated === right.radioGenerated
  );
}

function areRequestersEqual(
  left: Track["requestedBy"] | undefined,
  right: Track["requestedBy"] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.profileId === right.profileId && left.profileName === right.profileName
  );
}

function areQueuesEqual(left: Track[], right: Track[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areTracksEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function isSamePlaybackState(
  left: PlaybackState,
  right: PlaybackState,
): boolean {
  return (
    left.isPlaying === right.isPlaying &&
    left.position === right.position &&
    left.duration === right.duration &&
    left.volume === right.volume &&
    left.radioEnabled === right.radioEnabled &&
    left.playbackSettings.crossfadeEnabled ===
      right.playbackSettings.crossfadeEnabled &&
    left.playbackSettings.crossfadeDurationSeconds ===
      right.playbackSettings.crossfadeDurationSeconds &&
    left.playbackSettings.volumeNormalizationEnabled ===
      right.playbackSettings.volumeNormalizationEnabled &&
    areTracksEqual(left.currentTrack, right.currentTrack) &&
    areTracksEqual(left.lastPlayedTrack, right.lastPlayedTrack) &&
    areQueuesEqual(left.queue, right.queue)
  );
}

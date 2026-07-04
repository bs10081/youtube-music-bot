import { create } from "zustand";
import type { Track } from "@/types";
import type {
  FavoriteTrack,
  HistoryEntry,
  LibrarySnapshot,
  PairedDevice,
  Playlist,
  PlaylistTrackEntry,
  SavedMix,
  SyncDeviceKind,
  SyncDeviceMetadata,
  SyncSessionDevice,
  SyncedLibraryPayload,
} from "@/types/library";
import {
  createInitialLibrarySnapshot,
  loadLibrarySnapshot,
  saveLibrarySnapshot,
} from "@/services/library-db";
import {
  mergeLibraryPayload,
  mergePairedDevices,
  pruneTombstones,
} from "@/utils/librarySync";
import { getCurrentRequester } from "@/utils/requester";
import { reorderItems } from "@/utils/reorder";

const MAX_HISTORY_ENTRIES = 1000;
const MAX_SAVED_MIXES = 50;

interface LibraryStore {
  ready: boolean;
  snapshot: LibrarySnapshot | null;
  playlistPickerTrack: Track | null;
  selectedPlaylistId: string | null;
  syncStatus: "idle" | "connecting" | "connected" | "error";
  syncPairCode: string | null;
  syncError: string | null;
  initialize: () => Promise<void>;
  openPlaylistPicker: (track: Track) => void;
  closePlaylistPicker: () => void;
  selectPlaylist: (playlistId: string | null) => void;
  setSyncStatus: (
    status: LibraryStore["syncStatus"],
    options?: { pairCode?: string | null; error?: string | null },
  ) => void;
  updatePairedDevices: (devices: SyncSessionDevice[]) => Promise<void>;
  updateProfileName: (profileName: string) => Promise<void>;
  refreshCurrentDevice: (device: {
    kind: SyncDeviceKind;
    reportedName: string;
    metadata: SyncDeviceMetadata | null;
  }) => Promise<void>;
  applySyncSession: (session: {
    sessionId: string;
    profileId: string;
    profileName?: string;
    devices: SyncSessionDevice[];
    deviceToken: string;
    pairCode?: string | null;
  }) => Promise<void>;
  mergeRemoteSnapshot: (payload: SyncedLibraryPayload) => Promise<void>;
  removeSyncSession: () => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, entryId: string) => Promise<void>;
  reorderPlaylistTracks: (
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ) => Promise<void>;
  toggleFavorite: (track: Track) => Promise<void>;
  addHistoryEntry: (track: Track) => Promise<void>;
  saveMix: (seedTrack: Track, tracks: Track[]) => Promise<void>;
  deleteSavedMix: (mixId: string) => Promise<void>;
}

function normalizeTrack(track: Track): Track {
  return {
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: track.thumbnail,
  };
}

async function persistSnapshot(
  recipe: (snapshot: LibrarySnapshot) => LibrarySnapshot,
  options: { touchUpdatedAt?: boolean } = {},
): Promise<void> {
  const currentSnapshot =
    useLibraryStore.getState().snapshot ?? createInitialLibrarySnapshot();
  const nextSnapshot = recipe(currentSnapshot);
  const shouldTouchUpdatedAt = options.touchUpdatedAt ?? true;
  const persistedSnapshot = shouldTouchUpdatedAt
    ? {
        ...nextSnapshot,
        updatedAt: new Date().toISOString(),
      }
    : nextSnapshot;

  await saveLibrarySnapshot(persistedSnapshot);
  useLibraryStore.setState({ snapshot: persistedSnapshot, ready: true });
}

function upsertPlaylist(playlists: Playlist[], playlist: Playlist): Playlist[] {
  return playlists.map((item) => (item.id === playlist.id ? playlist : item));
}

// pruneTombstones 以「最新在前」做上限裁切,upsert 路徑是 append 順序,先排序再修剪。
function pruneUpsertedTombstones<T extends { removedAt: string }>(
  items: T[],
): T[] {
  return pruneTombstones(
    [...items].sort((left, right) => right.removedAt.localeCompare(left.removedAt)),
    (item) => item.removedAt,
  );
}

function upsertRemovedFavorite(
  items: LibrarySnapshot["removedFavorites"],
  videoId: string,
  removedAt: string,
) {
  const current = items ?? [];
  const existingIndex = current.findIndex((item) => item.videoId === videoId);

  if (existingIndex === -1) {
    return pruneUpsertedTombstones([...current, { videoId, removedAt }]);
  }

  return current.map((item, index) =>
    index === existingIndex
      ? {
          ...item,
          removedAt: item.removedAt >= removedAt ? item.removedAt : removedAt,
        }
      : item,
  );
}

function upsertDeletedPlaylist(
  items: LibrarySnapshot["deletedPlaylists"],
  playlistId: string,
  removedAt: string,
) {
  const current = items ?? [];
  const existingIndex = current.findIndex((item) => item.id === playlistId);

  if (existingIndex === -1) {
    return pruneUpsertedTombstones([...current, { id: playlistId, removedAt }]);
  }

  return current.map((item, index) =>
    index === existingIndex
      ? {
          ...item,
          removedAt: item.removedAt >= removedAt ? item.removedAt : removedAt,
        }
      : item,
  );
}

function upsertDeletedSavedMix(
  items: LibrarySnapshot["deletedSavedMixes"],
  mixId: string,
  removedAt: string,
) {
  const current = items ?? [];
  const existingIndex = current.findIndex((item) => item.id === mixId);

  if (existingIndex === -1) {
    return pruneUpsertedTombstones([...current, { id: mixId, removedAt }]);
  }

  return current.map((item, index) =>
    index === existingIndex
      ? {
          ...item,
          removedAt: item.removedAt >= removedAt ? item.removedAt : removedAt,
        }
      : item,
  );
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  ready: false,
  snapshot: null,
  playlistPickerTrack: null,
  selectedPlaylistId: null,
  syncStatus: "idle",
  syncPairCode: null,
  syncError: null,
  initialize: async () => {
    if (get().ready) {
      return;
    }

    const snapshot = await loadLibrarySnapshot();
    set({ snapshot, ready: true });
  },
  setSyncStatus: (syncStatus, options) =>
    set({
      syncStatus,
      syncPairCode: options?.pairCode ?? useLibraryStore.getState().syncPairCode,
      syncError: options?.error ?? null,
    }),
  updatePairedDevices: async (devices) => {
    await persistSnapshot(
      (snapshot) => ({
        ...snapshot,
        pairedDevices: mergePairedDevices(
          snapshot.deviceId,
          snapshot.pairedDevices,
          devices,
        ),
      }),
      { touchUpdatedAt: false },
    );
  },
  updateProfileName: async (profileName) => {
    await persistSnapshot(
      (snapshot) => ({
        ...snapshot,
        profileName: profileName.trim() || snapshot.profileName,
      }),
      { touchUpdatedAt: false },
    );
  },
  refreshCurrentDevice: async (device) => {
    const reportedName = device.reportedName.trim() || "Desktop · Unknown";
    await persistSnapshot(
      (snapshot) => ({
        ...snapshot,
        pairedDevices: snapshot.pairedDevices.map((pairedDevice) => {
          if (pairedDevice.id !== snapshot.deviceId) {
            return pairedDevice;
          }

          const displayName = pairedDevice.customName ?? reportedName;

          return {
            ...pairedDevice,
            name: displayName,
            reportedName,
            displayName,
            kind: device.kind,
            metadata: device.metadata,
          };
        }),
      }),
      { touchUpdatedAt: false },
    );
  },
  applySyncSession: async (session) => {
    await persistSnapshot(
      (snapshot) => ({
        ...snapshot,
        profileId: session.profileId,
        profileName: session.profileName?.trim() || snapshot.profileName,
        syncSessionId: session.sessionId,
        syncDeviceToken: session.deviceToken,
        pairedDevices: mergePairedDevices(
          snapshot.deviceId,
          snapshot.pairedDevices,
          session.devices,
        ),
      }),
      { touchUpdatedAt: false },
    );

    set({
      syncPairCode: session.pairCode ?? useLibraryStore.getState().syncPairCode,
      syncStatus: "connected",
      syncError: null,
    });
  },
  mergeRemoteSnapshot: async (payload) => {
    await persistSnapshot(
      (snapshot) => mergeLibraryPayload(snapshot, payload),
      { touchUpdatedAt: false },
    );
  },
  removeSyncSession: async () => {
    await persistSnapshot(
      (snapshot) => ({
        ...snapshot,
        syncSessionId: null,
        syncDeviceToken: null,
        pairedDevices: snapshot.pairedDevices.filter((device) => device.isCurrentDevice),
      }),
      { touchUpdatedAt: false },
    );

    set({
      syncStatus: "idle",
      syncPairCode: null,
      syncError: null,
    });
  },
  openPlaylistPicker: (track) => set({ playlistPickerTrack: normalizeTrack(track) }),
  closePlaylistPicker: () => set({ playlistPickerTrack: null }),
  selectPlaylist: (playlistId) => set({ selectedPlaylistId: playlistId }),
  createPlaylist: async (name) => {
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      name: name.trim() || "未命名歌單",
      tracks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await persistSnapshot((snapshot) => ({
      ...snapshot,
      playlists: [playlist, ...snapshot.playlists],
    }));

    set({ selectedPlaylistId: playlist.id });
    return playlist;
  },
  renamePlaylist: async (playlistId, name) => {
    await persistSnapshot((snapshot) => ({
      ...snapshot,
      playlists: snapshot.playlists.map((playlist) =>
        playlist.id === playlistId
          ? {
              ...playlist,
              name: name.trim() || playlist.name,
              updatedAt: new Date().toISOString(),
            }
          : playlist,
      ),
    }));
  },
  deletePlaylist: async (playlistId) => {
    const removedAt = new Date().toISOString();
    await persistSnapshot((snapshot) => ({
      ...snapshot,
      playlists: snapshot.playlists.filter((playlist) => playlist.id !== playlistId),
      deletedPlaylists: upsertDeletedPlaylist(
        snapshot.deletedPlaylists,
        playlistId,
        removedAt,
      ),
    }));

    if (get().selectedPlaylistId === playlistId) {
      set({ selectedPlaylistId: null });
    }
  },
  addTrackToPlaylist: async (playlistId, track) => {
    const entry: PlaylistTrackEntry = {
      id: crypto.randomUUID(),
      track: normalizeTrack(track),
      addedAt: new Date().toISOString(),
    };

    await persistSnapshot((snapshot) => ({
      ...snapshot,
      playlists: snapshot.playlists.map((playlist) =>
        playlist.id === playlistId
          ? {
              ...playlist,
              tracks: [...playlist.tracks, entry],
              updatedAt: new Date().toISOString(),
            }
          : playlist,
      ),
    }));
  },
  removeTrackFromPlaylist: async (playlistId, entryId) => {
    await persistSnapshot((snapshot) => ({
      ...snapshot,
      playlists: snapshot.playlists.map((playlist) =>
        playlist.id === playlistId
          ? {
              ...playlist,
              tracks: playlist.tracks.filter((entry) => entry.id !== entryId),
              updatedAt: new Date().toISOString(),
            }
          : playlist,
      ),
    }));
  },
  reorderPlaylistTracks: async (playlistId, fromIndex, toIndex) => {
    await persistSnapshot((snapshot) => {
      const playlist = snapshot.playlists.find((item) => item.id === playlistId);

      if (!playlist) {
        return snapshot;
      }

      const nextPlaylist: Playlist = {
        ...playlist,
        tracks: reorderItems(playlist.tracks, fromIndex, toIndex),
        updatedAt: new Date().toISOString(),
      };

      return {
        ...snapshot,
        playlists: upsertPlaylist(snapshot.playlists, nextPlaylist),
      };
    });
  },
  toggleFavorite: async (track) => {
    const normalizedTrack = normalizeTrack(track);
    await persistSnapshot((snapshot) => {
      const existingFavorite = snapshot.favorites.find(
        (favorite) => favorite.videoId === normalizedTrack.videoId,
      );
      const changedAt = new Date().toISOString();

      if (existingFavorite) {
        return {
          ...snapshot,
          favorites: snapshot.favorites.filter(
            (favorite) => favorite.videoId !== normalizedTrack.videoId,
          ),
          removedFavorites: upsertRemovedFavorite(
            snapshot.removedFavorites,
            normalizedTrack.videoId,
            changedAt,
          ),
        };
      }

      const favorite: FavoriteTrack = {
        videoId: normalizedTrack.videoId,
        track: normalizedTrack,
        createdAt: changedAt,
        updatedAt: changedAt,
      };

      return {
        ...snapshot,
        favorites: [favorite, ...snapshot.favorites],
        removedFavorites: (snapshot.removedFavorites ?? []).filter(
          (item) => item.videoId !== normalizedTrack.videoId,
        ),
      };
    });
  },
  addHistoryEntry: async (track) => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      track: normalizeTrack(track),
      playedAt: new Date().toISOString(),
    };

    await persistSnapshot((snapshot) => ({
      ...snapshot,
      history: [
        entry,
        ...snapshot.history.filter(
          (historyEntry) => historyEntry.track.videoId !== track.videoId,
        ),
      ].slice(0, MAX_HISTORY_ENTRIES),
    }));
  },
  saveMix: async (seedTrack, tracks) => {
    const savedMix: SavedMix = {
      id: crypto.randomUUID(),
      seedTrack: normalizeTrack(seedTrack),
      tracks: tracks.map((track) => normalizeTrack(track)),
      createdAt: new Date().toISOString(),
    };

    await persistSnapshot((snapshot) => ({
      ...snapshot,
      savedMixes: [savedMix, ...snapshot.savedMixes].slice(0, MAX_SAVED_MIXES),
    }));
  },
  deleteSavedMix: async (mixId) => {
    const removedAt = new Date().toISOString();
    await persistSnapshot((snapshot) => ({
      ...snapshot,
      savedMixes: snapshot.savedMixes.filter((savedMix) => savedMix.id !== mixId),
      deletedSavedMixes: upsertDeletedSavedMix(
        snapshot.deletedSavedMixes,
        mixId,
        removedAt,
      ),
    }));
  },
}));

export function getCurrentDevice(snapshot: LibrarySnapshot | null): PairedDevice | null {
  if (!snapshot) {
    return null;
  }

  return (
    snapshot.pairedDevices.find((device) => device.isCurrentDevice) ?? null
  );
}

export { getCurrentRequester };

import { describe, expect, test } from "bun:test";
import {
  mergeLibraryPayload,
  mergePairedDevices,
  toSyncedLibraryPayload,
} from "../../frontend/src/utils/librarySync.ts";
import type { LibrarySnapshot } from "../../frontend/src/types/library.ts";

const trackOne = {
  videoId: "track-1",
  title: "Track 1",
  artist: "Artist 1",
  duration: 180,
};

// 墓碑有 90 天 TTL(pruneTombstones),涉及墓碑保留的測試必須用相對現在的時間,
// 固定日期會隨時間過期導致測試腐化。
const HOUR_MS = 60 * 60 * 1000;
const hoursAgoIso = (hours: number) =>
  new Date(Date.now() - hours * HOUR_MS).toISOString();

const baseSnapshot: LibrarySnapshot = {
  profileId: "profile-a",
  profileName: "Profile A",
  deviceId: "device-a",
  updatedAt: "2026-03-15T00:00:00.000Z",
  syncSessionId: "session-a",
  syncDeviceToken: "device-token-a",
  favorites: [],
  history: [],
  savedMixes: [],
  playlists: [],
  removedFavorites: [],
  deletedPlaylists: [],
  deletedSavedMixes: [],
  pairedDevices: [
    {
      id: "device-a",
      name: "Desktop A",
      reportedName: "Desktop A",
      customName: null,
      displayName: "Desktop A",
      kind: "desktop",
      metadata: null,
      pairedAt: "2026-03-15T00:00:00.000Z",
      isCurrentDevice: true,
      status: "available",
      connected: true,
      lastSeenAt: "2026-03-15T00:00:00.000Z",
    },
  ],
};

describe("library sync helpers", () => {
  test("should merge favorites and playlists from another device", () => {
    const merged = mergeLibraryPayload(baseSnapshot, {
      ...toSyncedLibraryPayload(baseSnapshot),
      favorites: [
        {
          videoId: "track-1",
          track: trackOne,
          createdAt: "2026-03-15T01:00:00.000Z",
          updatedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      playlists: [
        {
          id: "playlist-1",
          name: "Favorites",
          tracks: [],
          createdAt: "2026-03-15T01:00:00.000Z",
          updatedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    });

    expect(merged.favorites).toHaveLength(1);
    expect(merged.playlists).toHaveLength(1);
    expect(merged.updatedAt).toBe("2026-03-15T01:00:00.000Z");
  });

  test("should remove favorite when tombstone is newer", () => {
    const currentSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      favorites: [
        {
          videoId: "track-1",
          track: trackOne,
          createdAt: "2026-03-15T01:00:00.000Z",
          updatedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    };

    const merged = mergeLibraryPayload(currentSnapshot, {
      ...toSyncedLibraryPayload(baseSnapshot),
      updatedAt: hoursAgoIso(1),
      removedFavorites: [
        {
          videoId: "track-1",
          removedAt: hoursAgoIso(1),
        },
      ],
    });

    expect(merged.favorites).toHaveLength(0);
    expect(merged.removedFavorites).toHaveLength(1);
  });

  test("should keep favorite when favorite update is newer than tombstone", () => {
    const currentSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      removedFavorites: [
        {
          videoId: "track-1",
          removedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    };

    const merged = mergeLibraryPayload(currentSnapshot, {
      ...toSyncedLibraryPayload(baseSnapshot),
      updatedAt: "2026-03-15T02:00:00.000Z",
      favorites: [
        {
          videoId: "track-1",
          track: trackOne,
          createdAt: "2026-03-15T02:00:00.000Z",
          updatedAt: "2026-03-15T02:00:00.000Z",
        },
      ],
    });

    expect(merged.favorites).toHaveLength(1);
    expect(merged.favorites[0]?.videoId).toBe("track-1");
  });

  test("should remove playlist when tombstone is newer", () => {
    const currentSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      playlists: [
        {
          id: "playlist-1",
          name: "Favorites",
          tracks: [],
          createdAt: "2026-03-15T01:00:00.000Z",
          updatedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    };

    const merged = mergeLibraryPayload(currentSnapshot, {
      ...toSyncedLibraryPayload(baseSnapshot),
      updatedAt: hoursAgoIso(1),
      deletedPlaylists: [
        {
          id: "playlist-1",
          removedAt: hoursAgoIso(1),
        },
      ],
    });

    expect(merged.playlists).toHaveLength(0);
    expect(merged.deletedPlaylists).toHaveLength(1);
  });

  test("should remove saved mix when tombstone is newer", () => {
    const currentSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      savedMixes: [
        {
          id: "mix-1",
          seedTrack: trackOne,
          tracks: [trackOne],
          createdAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    };

    const merged = mergeLibraryPayload(currentSnapshot, {
      ...toSyncedLibraryPayload(baseSnapshot),
      updatedAt: hoursAgoIso(1),
      deletedSavedMixes: [
        {
          id: "mix-1",
          removedAt: hoursAgoIso(1),
        },
      ],
    });

    expect(merged.savedMixes).toHaveLength(0);
    expect(merged.deletedSavedMixes).toHaveLength(1);
  });

  test("should not resurrect favorite after other device echoes merged snapshot", () => {
    const preDeleteSnapshot: LibrarySnapshot = {
      ...baseSnapshot,
      favorites: [
        {
          videoId: "track-1",
          track: trackOne,
          createdAt: "2026-03-15T01:00:00.000Z",
          updatedAt: "2026-03-15T01:00:00.000Z",
        },
      ],
      updatedAt: "2026-03-15T01:00:00.000Z",
    };

    const deviceAAfterDelete: LibrarySnapshot = {
      ...preDeleteSnapshot,
      favorites: [],
      removedFavorites: [
        {
          videoId: "track-1",
          removedAt: hoursAgoIso(1),
        },
      ],
      updatedAt: hoursAgoIso(1),
    };

    const deviceBAfterMerge = mergeLibraryPayload(
      preDeleteSnapshot,
      toSyncedLibraryPayload(deviceAAfterDelete),
    );
    expect(deviceBAfterMerge.favorites).toHaveLength(0);

    const deviceAAfterEcho = mergeLibraryPayload(
      deviceAAfterDelete,
      toSyncedLibraryPayload(deviceBAfterMerge),
    );
    expect(deviceAAfterEcho.favorites).toHaveLength(0);
  });

  test("should project server devices into paired devices with current marker", () => {
    const devices = mergePairedDevices(baseSnapshot.deviceId, [], [
      {
        id: "device-a",
        name: "Desktop A",
        reportedName: "Desktop A",
        customName: null,
        displayName: "Desktop A",
        kind: "desktop",
        metadata: null,
        connected: true,
        pairedAt: "2026-03-15T00:00:00.000Z",
        lastSeenAt: "2026-03-15T00:00:00.000Z",
      },
      {
        id: "device-b",
        name: "Phone B",
        reportedName: "Phone B",
        customName: null,
        displayName: "Phone B",
        kind: "mobile",
        metadata: null,
        connected: false,
        pairedAt: "2026-03-15T00:10:00.000Z",
        lastSeenAt: "2026-03-15T00:20:00.000Z",
      },
    ]);

    expect(devices[0]?.isCurrentDevice).toBe(true);
    expect(devices[1]?.connected).toBe(false);
  });
});

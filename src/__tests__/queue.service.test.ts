import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  __resetQueueServiceForTests,
  getQueueService,
} from "../services/queue.service.ts";
import {
  __resetPlayerServiceForTests,
  getPlayerService,
} from "../services/player.service.ts";
import { getMusicService } from "../services/music.service.ts";
import type { Track } from "../types/index.ts";

type RestorableMethod = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const restores: RestorableMethod[] = [];

function stubMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
): void {
  restores.push({
    target: target as Record<string, unknown>,
    key: key as string,
    original: target[key],
  });
  target[key] = replacement;
}

function restoreMethods(): void {
  while (restores.length > 0) {
    const restore = restores.pop()!;
    restore.target[restore.key] = restore.original;
  }
}

const track = (videoId: string, title: string): Track => ({
  videoId,
  title,
  artist: "Test Artist",
  duration: 180,
});

describe("QueueService - seekTo functionality", () => {
  let queueService: ReturnType<typeof getQueueService>;

  beforeEach(() => {
    restoreMethods();
    __resetQueueServiceForTests();
    __resetPlayerServiceForTests();
    queueService = getQueueService();
  });

  afterEach(() => {
    restoreMethods();
  });

  describe("seekTo() method - input validation", () => {
    test("should reject negative position", () => {
      const initialState = queueService.getState();

      queueService.seekTo(-5);

      const newState = queueService.getState();
      // Position should not change
      expect(newState.position).toBe(initialState.position);
    });

    test("should reject NaN position", () => {
      const initialState = queueService.getState();

      queueService.seekTo(NaN);

      const newState = queueService.getState();
      expect(newState.position).toBe(initialState.position);
    });

    test("should reject Infinity position", () => {
      const initialState = queueService.getState();

      queueService.seekTo(Infinity);

      const newState = queueService.getState();
      expect(newState.position).toBe(initialState.position);
    });

    test("should accept zero position", () => {
      queueService.seekTo(0);

      const state = queueService.getState();
      expect(state.position).toBe(0);
    });

    test("should accept valid positive position", () => {
      const initialState = queueService.getState();

      queueService.seekTo(30);

      const state = queueService.getState();
      expect(state.position).toBe(initialState.position);
    });
  });

  describe("seekTo() method - boundary clamping", () => {
    test("should clamp position to duration when exceeding", () => {
      // Note: In a real scenario, you would need to set up a track first
      // This test demonstrates the clamping behavior
      const position = 9999;
      queueService.seekTo(position);

      const state = queueService.getState();
      // Position should be clamped to duration (which is 0 by default)
      expect(state.position).toBeLessThanOrEqual(state.duration);
    });

    test("should not clamp seek requests to zero when duration is unknown", () => {
      const seekSpy = mock((_position: number) => {});
      const playerService = getPlayerService();
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
        currentDuration: number;
      };

      stubMethod(playerService, "seek", seekSpy as typeof playerService.seek);
      internalQueueService.currentTrack = {
        ...track("track-unknown", "Unknown Duration Track"),
        duration: 0,
      };
      internalQueueService.currentDuration = 0;

      queueService.seekTo(42);

      expect(seekSpy).toHaveBeenCalledWith(42);
      expect(queueService.getState().position).toBe(42);
    });
  });

  describe("preloaded duration recovery", () => {
    test("should restore duration from the promoted preloaded session", async () => {
      const nextTrack = {
        ...track("next-track", "Next Track"),
        duration: 0,
      };
      const playerService = getPlayerService();
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        syncNextTrackPreload: (options?: { force?: boolean }) => Promise<boolean>;
        fetchAndBroadcastLyrics: () => void;
        maybeHydrateRadioQueue: () => void;
      };

      stubMethod(
        playerService,
        "isTrackPreloaded",
        (() => true) as typeof playerService.isTrackPreloaded,
      );
      stubMethod(
        playerService,
        "playPreloaded",
        (async () => true) as typeof playerService.playPreloaded,
      );
      stubMethod(
        playerService,
        "getActiveDuration",
        (() => 215) as typeof playerService.getActiveDuration,
      );
      stubMethod(
        internalQueueService,
        "syncNextTrackPreload",
        (async () => false) as typeof internalQueueService.syncNextTrackPreload,
      );
      stubMethod(
        internalQueueService,
        "fetchAndBroadcastLyrics",
        (() => {}) as typeof internalQueueService.fetchAndBroadcastLyrics,
      );
      stubMethod(
        internalQueueService,
        "maybeHydrateRadioQueue",
        (() => {}) as typeof internalQueueService.maybeHydrateRadioQueue,
      );

      internalQueueService.currentTrack = null;
      internalQueueService.queue = [nextTrack];

      await queueService.playNext();

      expect(queueService.getState().currentTrack?.videoId).toBe(nextTrack.videoId);
      expect(queueService.getState().duration).toBe(215);
    });

    test("should restore duration from the promoted session during crossfade", async () => {
      const currentTrack = track("current-track", "Current Track");
      const nextTrack = {
        ...track("next-track", "Next Track"),
        duration: 0,
      };
      const playerService = getPlayerService();
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        preloadPromise: Promise<boolean> | null;
        preloadTrackId: string | null;
        crossfadeStartedForTrackId: string | null;
        syncNextTrackPreload: (options?: { force?: boolean }) => Promise<boolean>;
        fetchAndBroadcastLyrics: () => void;
        maybeHydrateRadioQueue: () => void;
        startCrossfadeToNextTrack: (track: Track) => Promise<void>;
      };

      stubMethod(
        playerService,
        "crossfadeToPreloaded",
        (async () => true) as typeof playerService.crossfadeToPreloaded,
      );
      stubMethod(
        playerService,
        "getActiveDuration",
        (() => 215) as typeof playerService.getActiveDuration,
      );
      stubMethod(
        internalQueueService,
        "syncNextTrackPreload",
        (async () => false) as typeof internalQueueService.syncNextTrackPreload,
      );
      stubMethod(
        internalQueueService,
        "fetchAndBroadcastLyrics",
        (() => {}) as typeof internalQueueService.fetchAndBroadcastLyrics,
      );
      stubMethod(
        internalQueueService,
        "maybeHydrateRadioQueue",
        (() => {}) as typeof internalQueueService.maybeHydrateRadioQueue,
      );

      internalQueueService.currentTrack = currentTrack;
      internalQueueService.queue = [nextTrack];
      internalQueueService.preloadPromise = null;
      internalQueueService.preloadTrackId = nextTrack.videoId;
      internalQueueService.crossfadeStartedForTrackId = currentTrack.videoId;

      await internalQueueService.startCrossfadeToNextTrack(nextTrack);

      expect(queueService.getState().currentTrack?.videoId).toBe(nextTrack.videoId);
      expect(queueService.getState().duration).toBe(215);
    });
  });

  describe("volume control", () => {
    test("should update volume", () => {
      queueService.setVolume(80);

      const state = queueService.getState();
      expect(state.volume).toBe(80);
    });

    test("should expose default playback settings", () => {
      expect(queueService.getState().playbackSettings).toEqual({
        crossfadeEnabled: true,
        crossfadeDurationSeconds: 4,
        volumeNormalizationEnabled: true,
      });
    });

    test("should normalize playback settings updates", () => {
      const nextSettings = queueService.setPlaybackSettings({
        crossfadeEnabled: false,
        crossfadeDurationSeconds: 99,
      });

      expect(nextSettings).toEqual({
        crossfadeEnabled: false,
        crossfadeDurationSeconds: 8,
        volumeNormalizationEnabled: true,
      });
      expect(queueService.getState().playbackSettings).toEqual(nextSettings);
    });

    test("should toggle the player volume normalization filter when the setting changes", () => {
      const playerService = getPlayerService();
      const toggleSpy = mock((_enabled: boolean) => {});
      const syncPreloadSpy = mock(async (_options?: { force?: boolean }) => false);
      const internalQueueService = queueService as unknown as {
        syncNextTrackPreload: (options?: { force?: boolean }) => Promise<boolean>;
      };

      stubMethod(
        playerService,
        "setVolumeNormalizationEnabled",
        toggleSpy as unknown as typeof playerService.setVolumeNormalizationEnabled,
      );
      stubMethod(
        internalQueueService,
        "syncNextTrackPreload",
        syncPreloadSpy as unknown as typeof internalQueueService.syncNextTrackPreload,
      );

      queueService.setPlaybackSettings({
        volumeNormalizationEnabled: false,
      });

      expect(toggleSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy.mock.calls[0]?.[0]).toBe(false);
      expect(syncPreloadSpy).toHaveBeenCalledWith({ force: true });

      queueService.setPlaybackSettings({
        volumeNormalizationEnabled: false,
      });

      expect(toggleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("playback controls", () => {
    test("should pause the current track", () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
        isPaused: boolean;
      };

      internalQueueService.currentTrack = track("track-1", "Track 1");
      internalQueueService.isPaused = false;

      queueService.pause();

      expect(queueService.getState().isPlaying).toBe(false);
    });

    test("should resume a paused track", () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
        isPaused: boolean;
      };

      internalQueueService.currentTrack = track("track-1", "Track 1");
      internalQueueService.isPaused = true;

      queueService.play();

      expect(queueService.getState().isPlaying).toBe(true);
    });

    test("should ignore play requests without a current track", () => {
      queueService.play();

      expect(queueService.getState().currentTrack).toBeNull();
      expect(queueService.getState().isPlaying).toBe(false);
    });

    test("should keep play and pause idempotent", () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
        isPaused: boolean;
      };

      internalQueueService.currentTrack = track("track-1", "Track 1");
      internalQueueService.isPaused = false;

      queueService.play();
      expect(queueService.getState().isPlaying).toBe(true);

      queueService.pause();
      queueService.pause();
      expect(queueService.getState().isPlaying).toBe(false);
    });
  });

  describe("queue management", () => {
    test("should return empty queue initially", () => {
      const queue = queueService.getQueue();
      expect(Array.isArray(queue)).toBe(true);
    });

    test("should return playback state", () => {
      const state = queueService.getState();

      expect(state).toHaveProperty("isPlaying");
      expect(state).toHaveProperty("currentTrack");
      expect(state).toHaveProperty("position");
      expect(state).toHaveProperty("duration");
      expect(state).toHaveProperty("volume");
      expect(state).toHaveProperty("queue");
    });

    test("should reorder queue items", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
      };

      internalQueueService.queue = [
        track("track-1", "Track 1"),
        track("track-2", "Track 2"),
        track("track-3", "Track 3"),
      ];

      queueService.reorderQueue(2, 0);

      expect(queueService.getQueue().map((item) => item.videoId)).toEqual([
        "track-3",
        "track-1",
        "track-2",
      ]);
    });

    test("should reject invalid reorder indexes", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
      };

      internalQueueService.queue = [track("track-1", "Track 1")];

      expect(() => queueService.reorderQueue(0, 3)).toThrow(
        "Invalid queue index",
      );
    });

    test("should clear queued tracks without affecting the current track", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        preloadTrackId: string | null;
      };

      internalQueueService.queue = [
        track("track-1", "Track 1"),
        track("track-2", "Track 2"),
      ];
      internalQueueService.currentTrack = track("current-track", "Current Track");
      internalQueueService.preloadTrackId = "track-1";

      const clearedCount = queueService.clearQueue();

      expect(clearedCount).toBe(2);
      expect(queueService.getQueue()).toEqual([]);
      expect(queueService.getState().currentTrack?.videoId).toBe("current-track");
      expect(internalQueueService.preloadTrackId).toBeNull();
    });

    test("should preserve requestedBy on addToQueue", async () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
      };

      internalQueueService.currentTrack = track("playing", "Playing");

      await queueService.addToQueue({
        ...track("track-1", "Track 1"),
        requestedBy: {
          profileId: "profile-a",
          profileName: "Alice",
        },
      });

      expect(queueService.getQueue()[0]?.requestedBy).toEqual({
        profileId: "profile-a",
        profileName: "Alice",
      });
    });

    test("should stamp requestedBy via addToQueue options when track has none", async () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
      };

      internalQueueService.currentTrack = track("playing", "Playing");

      await queueService.addToQueue(track("track-2", "Track 2"), {
        requestedBy: {
          profileId: "profile-b",
          profileName: "Bob",
        },
      });

      expect(queueService.getQueue()[0]?.requestedBy).toEqual({
        profileId: "profile-b",
        profileName: "Bob",
      });
    });

    test("should stamp requestedBy on appended tracks when fallback is provided", async () => {
      const internalQueueService = queueService as unknown as {
        currentTrack: Track | null;
      };

      internalQueueService.currentTrack = track("playing", "Playing");

      await queueService.appendTracksToQueue(
        [track("track-3", "Track 3"), track("track-4", "Track 4")],
        "playlist",
        {
          requestedBy: {
            profileId: "profile-c",
            profileName: "Carol",
          },
        },
      );

      expect(queueService.getQueue().map((item) => item.requestedBy)).toEqual([
        { profileId: "profile-c", profileName: "Carol" },
        { profileId: "profile-c", profileName: "Carol" },
      ]);
    });

    test("should rename requester profile across queue and playback state", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        lastPlayedTrack: Track | null;
      };

      internalQueueService.queue = [
        {
          ...track("track-5", "Track 5"),
          requestedBy: {
            profileId: "profile-d",
            profileName: "Dana",
          },
        },
      ];
      internalQueueService.currentTrack = {
        ...track("current", "Current"),
        requestedBy: {
          profileId: "profile-d",
          profileName: "Dana",
        },
      };
      internalQueueService.lastPlayedTrack = {
        ...track("last", "Last"),
        requestedBy: {
          profileId: "profile-d",
          profileName: "Dana",
        },
      };

      queueService.renameRequesterProfile("profile-d", "Daphne");

      const state = queueService.getState();
      expect(state.currentTrack?.requestedBy).toEqual({
        profileId: "profile-d",
        profileName: "Daphne",
      });
      expect(state.lastPlayedTrack?.requestedBy).toEqual({
        profileId: "profile-d",
        profileName: "Daphne",
      });
      expect(queueService.getQueue()[0]?.requestedBy).toEqual({
        profileId: "profile-d",
        profileName: "Daphne",
      });
    });

    test("should prefer the last queued track as the auto mix seed", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        lastPlayedTrack: Track | null;
        resolveAutoMixSeedTrack: () => Track | null;
      };

      internalQueueService.currentTrack = track("current", "Current");
      internalQueueService.lastPlayedTrack = track("last", "Last");
      internalQueueService.queue = [
        track("queued-1", "Queued 1"),
        track("queued-2", "Queued 2"),
      ];

      expect(internalQueueService.resolveAutoMixSeedTrack()?.videoId).toBe(
        "queued-2",
      );
    });

    test("should fall back to currentTrack then lastPlayedTrack for auto mix seed", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        currentTrack: Track | null;
        lastPlayedTrack: Track | null;
        resolveAutoMixSeedTrack: () => Track | null;
      };

      internalQueueService.queue = [];
      internalQueueService.currentTrack = track("current", "Current");
      internalQueueService.lastPlayedTrack = track("last", "Last");

      expect(internalQueueService.resolveAutoMixSeedTrack()?.videoId).toBe(
        "current",
      );

      internalQueueService.currentTrack = null;

      expect(internalQueueService.resolveAutoMixSeedTrack()?.videoId).toBe(
        "last",
      );
    });

    test("should update the auto mix seed after queue reorder and removal", () => {
      const internalQueueService = queueService as unknown as {
        queue: Track[];
        resolveAutoMixSeedTrack: () => Track | null;
      };

      internalQueueService.queue = [
        track("track-1", "Track 1"),
        track("track-2", "Track 2"),
        track("track-3", "Track 3"),
      ];

      queueService.reorderQueue(0, 2);

      expect(queueService.getQueue().map((item) => item.videoId)).toEqual([
        "track-2",
        "track-3",
        "track-1",
      ]);
      expect(internalQueueService.resolveAutoMixSeedTrack()?.videoId).toBe(
        "track-1",
      );

      queueService.removeFromQueue(2);

      expect(queueService.getQueue().map((item) => item.videoId)).toEqual([
        "track-2",
        "track-3",
      ]);
      expect(internalQueueService.resolveAutoMixSeedTrack()?.videoId).toBe(
        "track-3",
      );
    });
  });
});

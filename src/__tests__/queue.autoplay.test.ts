import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Track } from "../types/index.ts";
import {
  __resetMusicServiceForTests,
  getMusicService,
} from "../services/music.service.ts";
import {
  __resetPlayerServiceForTests,
  getPlayerService,
} from "../services/player.service.ts";
import {
  __resetQueueServiceForTests,
  getQueueService,
} from "../services/queue.service.ts";

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

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 200,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for autoplay to reach the expected state");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function suppressNextTrackPreload(
  queueService: ReturnType<typeof getQueueService>,
): void {
  const queue = queueService as unknown as {
    syncNextTrackPreload: (options?: { force?: boolean }) => Promise<boolean>;
  };

  stubMethod(queue, "syncNextTrackPreload", async () => false);
}

function stubTrackLoudness(
  musicService: ReturnType<typeof getMusicService>,
): void {
}

const searchedTrack: Track = {
  videoId: "search-track",
  title: "Search Song",
  artist: "Search Artist",
  duration: 215,
  thumbnail: "https://img.youtube.com/vi/search-track/mqdefault.jpg",
};

describe("QueueService autoplay after adding a searched track", () => {
  beforeEach(() => {
    restoreMethods();
    __resetMusicServiceForTests();
    __resetPlayerServiceForTests();
    __resetQueueServiceForTests();
  });

  afterEach(() => {
    restoreMethods();
    __resetMusicServiceForTests();
    __resetPlayerServiceForTests();
    __resetQueueServiceForTests();
  });

  test("should wait for autoplay to start before resolving addToQueue", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    const trackLoadingEvents: Array<{ track: Track | null; message?: string }> = [];
    const trackReadyEvents: Track[] = [];
    let resolvePlaybackStart: (() => void) | null = null;
    let addResolved = false;

    queueService.onTrackLoading((payload) => {
      trackLoadingEvents.push(payload);
    });
    queueService.onTrackReady((track) => {
      trackReadyEvents.push(track);
    });

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "isCurrentlyPlaying", () => false);
    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(
      playerService,
      "playUrl",
      () =>
        new Promise<void>((resolve) => {
          resolvePlaybackStart = resolve;
        }) as ReturnType<typeof playerService.playUrl>,
    );
    stubMethod(musicService, "getStreamUrl", async (videoId: string) => {
      expect(videoId).toBe(searchedTrack.videoId);
      return {
        url: `https://stream/${videoId}`,
        source: "youtubei" as const,
      };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const pendingAdd = queueService.addToQueue(searchedTrack).then(() => {
      addResolved = true;
    });

    await waitForCondition(() => resolvePlaybackStart !== null);

    expect(addResolved).toBe(false);
    expect(queueService.getState().currentTrack?.videoId).toBe(
      searchedTrack.videoId,
    );
    expect(trackLoadingEvents).toEqual([
      {
        track: {
          ...searchedTrack,
          queueOrigin: "manual",
          radioGenerated: false,
        },
      },
    ]);
    expect(trackReadyEvents).toEqual([]);

    if (!resolvePlaybackStart) {
      throw new Error("Expected playback start resolver to be assigned");
    }

    const resolvePlayback = resolvePlaybackStart as () => void;
    resolvePlayback();
    await pendingAdd;

    expect(addResolved).toBe(true);
    expect(queueService.getState().currentTrack?.videoId).toBe(
      searchedTrack.videoId,
    );
    expect(queueService.getQueue()).toEqual([]);
    expect(trackReadyEvents).toEqual([
      {
        ...searchedTrack,
        queueOrigin: "manual",
        radioGenerated: false,
      },
    ]);
  });

  test("should reject addToQueue when autoplay fails and keep the track queued", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    const trackLoadingEvents: Array<{ track: Track | null; message?: string }> = [];
    const trackReadyEvents: Track[] = [];
    const playErrors: Array<{ error: string; track: Track | null }> = [];

    queueService.onTrackLoading((payload) => {
      trackLoadingEvents.push(payload);
    });
    queueService.onTrackReady((track) => {
      trackReadyEvents.push(track);
    });
    queueService.onPlayError((payload) => {
      playErrors.push(payload);
    });

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "isCurrentlyPlaying", () => false);
    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async () => {
      throw new Error("youtube fallback failed");
    });
    stubMethod(playerService, "playUrl", async () => {
      throw new Error("stream playback failed");
    });
    stubMethod(musicService, "getStreamUrl", async () => {
      return {
        url: "https://stream/search-track",
        source: "youtubei" as const,
      };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    await expect(queueService.addToQueue(searchedTrack)).rejects.toThrow(
      "Failed to play track: Search Song. Error: youtube fallback failed",
    );

    expect(queueService.getState().currentTrack).toBeNull();
    expect(queueService.getQueue()).toEqual([
      {
        ...searchedTrack,
        queueOrigin: "manual",
        radioGenerated: false,
      },
    ]);
    expect(playErrors).toEqual([
      {
        error:
          "Failed to play track: Search Song. Error: youtube fallback failed",
        track: {
          ...searchedTrack,
          queueOrigin: "manual",
          radioGenerated: false,
        },
      },
    ]);
    expect(trackLoadingEvents).toEqual([
      {
        track: {
          ...searchedTrack,
          queueOrigin: "manual",
          radioGenerated: false,
        },
      },
    ]);
    expect(trackReadyEvents).toEqual([]);
  });
});

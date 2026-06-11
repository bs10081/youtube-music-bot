import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
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

const baseTrack: Track = {
  videoId: "base-track",
  title: "Base Song",
  artist: "Base Artist",
  duration: 180,
  thumbnail: "https://img.youtube.com/vi/base-track/mqdefault.jpg",
};

const mixTracks: Track[] = [
  {
    videoId: "mix-1",
    title: "Mix Song 1",
    artist: "Artist 1",
    duration: 200,
    thumbnail: "https://img.youtube.com/vi/mix-1/mqdefault.jpg",
  },
  {
    videoId: "mix-2",
    title: "Mix Song 2",
    artist: "Artist 2",
    duration: 220,
    thumbnail: "https://img.youtube.com/vi/mix-2/mqdefault.jpg",
  },
];

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

function expectMixTrack(track: Track, expectedTrack: Track): void {
  expect(track).toEqual({
    ...expectedTrack,
    queueOrigin: "mix",
    radioGenerated: false,
  });
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

describe("QueueService mix creation", () => {
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

  test("should create a mix, clear previous queue, and start playback", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    let stopCalls = 0;
    let playUrlCalls = 0;
    let getMixTracksCalls = 0;
    let getStreamUrlCalls = 0;

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {
      stopCalls++;
    });
    stubMethod(playerService, "isCurrentlyPlaying", () => true);
    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(playerService, "playUrl", async (url: string) => {
      playUrlCalls++;
      expect(url).toBe("https://stream/base-track");
    });
    stubMethod(musicService, "getMixTracks", async (videoId: string) => {
      getMixTracksCalls++;
      expect(videoId).toBe(baseTrack.videoId);
      return mixTracks;
    });
    stubMethod(musicService, "getStreamUrl", async (videoId: string) => {
      getStreamUrlCalls++;
      expect(videoId).toBe(baseTrack.videoId);
      return { url: "https://stream/base-track", source: "yt-dlp" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    await queueService.addToQueue({
      videoId: "old-track",
      title: "Old Song",
      artist: "Old Artist",
      duration: 123,
    });

    const tracks = await queueService.createMixFromTrack(baseTrack);
    const state = queueService.getState();

    expect(stopCalls).toBeGreaterThanOrEqual(1);
    expect(playUrlCalls).toBe(1);
    expect(getMixTracksCalls).toBe(1);
    expect(getStreamUrlCalls).toBe(1);
    expect(tracks).toEqual([baseTrack, ...mixTracks]);
    expectMixTrack(state.currentTrack!, baseTrack);
    expect(state.duration).toBe(baseTrack.duration);
    state.queue.forEach((track, index) => expectMixTrack(track, mixTracks[index]!));
    queueService.getQueue().forEach((track, index) =>
      expectMixTrack(track, mixTracks[index]!),
    );
  });

  test("should start playing the base track before mix suggestions finish loading", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    let resolveMixTracks: ((tracks: Track[]) => void) | null = null;
    let notifyMixFetchStarted: (() => void) | null = null;
    let playUrlCalls = 0;
    const mixFetchStarted = new Promise<void>((resolve) => {
      notifyMixFetchStarted = resolve;
    });

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(playerService, "playUrl", async (url: string) => {
      playUrlCalls++;
      expect(url).toBe("https://stream/base-track");
    });
    stubMethod(musicService, "getMixTracks", async () => {
      notifyMixFetchStarted?.();
      return await new Promise<Track[]>((resolve) => {
        resolveMixTracks = resolve;
      });
    });
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "youtubei" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const pendingMix = queueService.createMixFromTrack(baseTrack);

    await mixFetchStarted;

    expect(playUrlCalls).toBe(1);
    expectMixTrack(queueService.getState().currentTrack!, baseTrack);
    expect(queueService.getQueue()).toEqual([]);

    if (!resolveMixTracks) {
      throw new Error("Expected mix resolver to be assigned");
    }
    const resolver = resolveMixTracks as (tracks: Track[]) => void;
    resolver(mixTracks);

    const tracks = await pendingMix;
    expect(tracks).toEqual([baseTrack, ...mixTracks]);
    queueService.getQueue().forEach((track, index) =>
      expectMixTrack(track, mixTracks[index]!),
    );
  });

  test("should stamp requester metadata onto mix-created tracks", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "isCurrentlyPlaying", () => false);
    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(playerService, "playUrl", async () => {});
    stubMethod(musicService, "getMixTracks", async () => mixTracks);
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "yt-dlp" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const tracks = await queueService.createMixFromTrack(baseTrack, {
      requestedBy: {
        profileId: "profile-mix",
        profileName: "Mix Master",
      },
    });
    const state = queueService.getState();

    expect(tracks.map((track) => track.requestedBy)).toEqual([
      { profileId: "profile-mix", profileName: "Mix Master" },
      { profileId: "profile-mix", profileName: "Mix Master" },
      { profileId: "profile-mix", profileName: "Mix Master" },
    ]);
    expect(state.currentTrack?.requestedBy).toEqual({
      profileId: "profile-mix",
      profileName: "Mix Master",
    });
    expect(queueService.getQueue().map((track) => track.requestedBy)).toEqual([
      { profileId: "profile-mix", profileName: "Mix Master" },
      { profileId: "profile-mix", profileName: "Mix Master" },
    ]);
  });

  test("should fall back to the base track when fetching mix tracks fails", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    let playUrlCalls = 0;

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(playerService, "playUrl", async () => {
      playUrlCalls++;
    });
    stubMethod(musicService, "getMixTracks", async () => {
      throw new Error("up next failed");
    });
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "youtubei" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const tracks = await queueService.createMixFromTrack(baseTrack);
    const state = queueService.getState();

    expect(playUrlCalls).toBe(1);
    expect(tracks).toEqual([baseTrack]);
    expectMixTrack(state.currentTrack!, baseTrack);
    expect(state.queue).toEqual([]);
  });

  test("should detach the previous session before starting mix playback", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    let killCalls = 0;
    const oldProcess = {
      kill: () => {
        killCalls++;
        return true;
      },
    } as unknown as ChildProcess;
    const oldSession = {
      id: 1,
      purpose: "active" as const,
      source: { type: "stream" as const, value: "https://stream/old-track" },
      volumeMultiplier: 1,
      targetVolume: 70,
      process: oldProcess,
      ipcSocket: null,
      ipcPath: "/tmp/test-mpv.sock",
      ipcConnectRetries: 0,
      eofHandled: false,
      ready: true,
      trackId: "old-track",
      confirmation: null,
    };
    const player = playerService as unknown as {
      activeSession: typeof oldSession | null;
      isPlaying: boolean;
    };
    let playUrlCalls = 0;

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    player.activeSession = oldSession;
    player.isPlaying = true;

    stubMethod(playerService, "play", async () => {
      throw new Error("play() should not be used when playUrl() succeeds");
    });
    stubMethod(playerService, "playUrl", async (url: string) => {
      playUrlCalls++;
      expect(url).toBe("https://stream/base-track");
    });
    stubMethod(musicService, "getMixTracks", async () => mixTracks);
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "youtubei" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const tracks = await queueService.createMixFromTrack(baseTrack);

    expect(killCalls).toBe(1);
    expect(player.activeSession).toBeNull();
    expect(playUrlCalls).toBe(1);
    expect(tracks).toEqual([baseTrack, ...mixTracks]);
    expectMixTrack(queueService.getState().currentTrack!, baseTrack);
    queueService.getQueue().forEach((track, index) =>
      expectMixTrack(track, mixTracks[index]!),
    );
  });

  test("should fall back to YouTube URL playback when direct stream playback fails", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();
    let playCalls = 0;

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async (videoId: string) => {
      playCalls++;
      expect(videoId).toBe(baseTrack.videoId);
    });
    stubMethod(playerService, "playUrl", async () => {
      throw new Error("stream playback failed");
    });
    stubMethod(musicService, "getMixTracks", async () => mixTracks);
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "youtubei" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    const tracks = await queueService.createMixFromTrack(baseTrack);

    expect(playCalls).toBe(1);
    expect(tracks).toEqual([baseTrack, ...mixTracks]);
    expectMixTrack(queueService.getState().currentTrack!, baseTrack);
  });

  test("should reset current playback state when both playback strategies fail", async () => {
    const queueService = getQueueService();
    const playerService = getPlayerService();
    const musicService = getMusicService();

    suppressNextTrackPreload(queueService);
    stubTrackLoudness(musicService);

    stubMethod(playerService, "stop", async () => {});
    stubMethod(playerService, "play", async () => {
      throw new Error("youtube fallback failed");
    });
    stubMethod(playerService, "playUrl", async () => {
      throw new Error("stream playback failed");
    });
    stubMethod(musicService, "getMixTracks", async () => mixTracks);
    stubMethod(musicService, "getStreamUrl", async () => {
      return { url: "https://stream/base-track", source: "youtubei" as const };
    });
    stubMethod(musicService, "getLyrics", async () => []);

    await expect(queueService.createMixFromTrack(baseTrack)).rejects.toThrow(
      "Failed to play track: Base Song. Error: youtube fallback failed",
    );

    const state = queueService.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.isPlaying).toBe(false);
  });
});

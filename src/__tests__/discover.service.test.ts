import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DISCOVER_MARKET,
  DISCOVER_MARKETS,
  DiscoverService,
} from "../services/discover.service.ts";
import { getMusicService } from "../services/music.service.ts";
import type {
  DiscoverCollectionItem,
  DiscoverMarketCode,
  DiscoverSection,
  DiscoverTrackItem,
  Track,
} from "../types/index.ts";

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

function createTrack(videoId: string, title: string): Track {
  return {
    videoId,
    title,
    artist: "Test Artist",
    duration: 180,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  };
}

function createTrackItem(videoId: string, title: string): DiscoverTrackItem {
  const track = createTrack(videoId, title);
  return {
    kind: "track",
    id: videoId,
    title,
    artist: track.artist,
    thumbnail: track.thumbnail,
    duration: track.duration,
    presentation: "song",
    track,
  };
}

function createVideoTrackItem(
  videoId: string,
  title: string,
  artist = "Unknown",
): DiscoverTrackItem {
  return {
    kind: "track",
    id: videoId,
    title,
    artist,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    duration: 0,
    presentation: "video",
    track: {
      videoId,
      title,
      artist,
      duration: 0,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    },
  };
}

function createCollectionItem(
  id: string,
  title: string,
): DiscoverCollectionItem {
  return {
    kind: "playlist",
    id,
    title,
    artist: "Curator",
    thumbnail: "https://example.com/playlist.jpg",
    trackCount: 20,
    subtitle: "20 首歌曲",
  };
}

function createSection(
  id: string,
  title: string,
  item: DiscoverTrackItem | DiscoverCollectionItem,
): DiscoverSection {
  return {
    id,
    title,
    subtitle: "Section subtitle",
    items: [item],
  };
}

describe("DiscoverService", () => {
  let tempDir: string;
  let service: DiscoverService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "discover-service-"));
    service = new DiscoverService(join(tempDir, "discover.sqlite"));
  });

  afterEach(() => {
    restoreMethods();
    service.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns configured markets and top requested tracks", async () => {
    service.recordTrackRequests([
      createTrack("track-1", "Track One"),
      createTrack("track-2", "Track Two"),
      createTrack("track-1", "Track One"),
    ]);

    const response = await service.getMarketsResponse();

    expect(response.defaultMarket).toBe(DEFAULT_DISCOVER_MARKET);
    expect(response.markets).toEqual(DISCOVER_MARKETS);
    expect(response.markets).toHaveLength(8);
    expect(response.topRequested).toHaveLength(2);
    expect(response.topRequested[0]).toMatchObject({
      rank: 1,
      requestCount: 2,
      track: {
        videoId: "track-1",
        title: "Track One",
      },
    });
  });

  test("preserves an existing catalog duration when a later request reports 0", async () => {
    service.recordTrackRequests([
      createTrack("track-1", "Track One"),
    ]);
    service.recordTrackRequests([
      {
        ...createTrack("track-1", "Track One"),
        duration: 0,
      },
    ]);

    const response = await service.getMarketsResponse();

    expect(response.topRequested[0]?.track.duration).toBe(180);
  });

  test("hydrates missing durations for top requested tracks and persists the backfill", async () => {
    service.recordTrackRequests([
      {
        ...createTrack("track-1", "Track One"),
        duration: 0,
      },
    ]);

    let metadataCalls = 0;
    (
      service as unknown as {
        getDiscoverVideoMetadata: (
          market: DiscoverMarketCode,
          videoId: string,
        ) => Promise<{ duration?: number; artist?: string } | null>;
      }
    ).getDiscoverVideoMetadata = async (market, videoId) => {
      metadataCalls++;
      expect(market).toBe(DEFAULT_DISCOVER_MARKET);
      expect(videoId).toBe("track-1");
      return {
        duration: 215,
      };
    };

    const firstResponse = await service.getMarketsResponse();

    expect(firstResponse.topRequested[0]?.track.duration).toBe(215);
    expect(metadataCalls).toBe(1);

    (
      service as unknown as {
        getDiscoverVideoMetadata: (
          market: DiscoverMarketCode,
          videoId: string,
        ) => Promise<{ duration?: number; artist?: string } | null>;
      }
    ).getDiscoverVideoMetadata = async () => {
      metadataCalls++;
      return null;
    };

    const secondResponse = await service.getMarketsResponse();

    expect(secondResponse.topRequested[0]?.track.duration).toBe(215);
    expect(metadataCalls).toBe(1);
  });

  test("normalizes invalid market input back to TW", async () => {
    let requestedMarket: DiscoverMarketCode | undefined;

    (service as unknown as { getBaseFeed: (market: DiscoverMarketCode) => Promise<unknown> })
      .getBaseFeed = async (market) => {
      requestedMarket = market;
      return {
        market,
        moods: [],
        sections: [createSection("section-1", "熱門內容", createTrackItem("track-1", "Track One"))],
        warnings: [],
        fetchedAt: "2026-03-27T00:00:00.000Z",
      };
    };

    const response = await service.getFeed("not-a-market");

    expect(requestedMarket).toBe(DEFAULT_DISCOVER_MARKET);
    expect(response.market).toBe(DEFAULT_DISCOVER_MARKET);
  });

  test("falls back to the base feed when the mood key is invalid", async () => {
    const baseSection = createSection(
      "base-section",
      "熱門內容",
      createTrackItem("track-1", "Track One"),
    );

    (service as unknown as { getBaseFeed: () => Promise<unknown> }).getBaseFeed =
      async () => ({
        market: "TW",
        moods: [
          {
            key: "mood-1",
            label: "放鬆",
            endpoint: {
              browseId: "FEmusic_mood_relax",
            },
          },
        ],
        sections: [baseSection],
        warnings: ["base warning"],
        fetchedAt: "2026-03-27T00:00:00.000Z",
      });

    const response = await service.getFeed("TW", "missing-mood");

    expect(response.selectedMood).toBeNull();
    expect(response.sections).toEqual([baseSection]);
    expect(response.warnings).toEqual([
      "base warning",
      "Selected mood is no longer available. Showing market feed instead.",
    ]);
  });

  test("returns mood-specific sections when the mood key is still valid", async () => {
    const baseSection = createSection(
      "base-section",
      "熱門內容",
      createTrackItem("track-1", "Track One"),
    );
    const moodSection = createSection(
      "mood-section",
      "今晚派對",
      createCollectionItem("VLparty", "Party Mix"),
    );
    let receivedMoodKey: string | undefined;

    (service as unknown as { getBaseFeed: () => Promise<unknown> }).getBaseFeed =
      async () => ({
        market: "TW",
        moods: [
          {
            key: "mood-1",
            label: "派對",
            endpoint: {
              browseId: "FEmusic_mood_party",
            },
          },
        ],
        sections: [baseSection],
        warnings: ["base warning"],
        fetchedAt: "2026-03-27T00:00:00.000Z",
      });

    (
      service as unknown as {
        getMoodFeed: (
          market: DiscoverMarketCode,
          mood: { key: string; label: string },
        ) => Promise<unknown>;
      }
    ).getMoodFeed = async (_market, mood) => {
      receivedMoodKey = mood.key;
      return {
        sections: [moodSection],
        warnings: ["mood warning"],
        fetchedAt: "2026-03-27T00:05:00.000Z",
      };
    };

    const response = await service.getFeed("TW", "mood-1");

    expect(receivedMoodKey).toBe("mood-1");
    expect(response.selectedMood).toEqual({
      key: "mood-1",
      label: "派對",
    });
    expect(response.sections).toEqual([moodSection]);
    expect(response.warnings).toEqual(["base warning", "mood warning"]);
    expect(response.fetchedAt).toBe("2026-03-27T00:05:00.000Z");
  });

  test("prepends personalized sections to the base feed and skips them for mood feeds", async () => {
    service.recordTrackRequests([
      createTrack("seed-1", "Seed 1"),
      createTrack("seed-2", "Seed 2"),
      createTrack("seed-3", "Seed 3"),
    ]);

    const musicService = getMusicService();
    stubMethod(musicService, "getMixTracks", (async () => []) as
      typeof musicService.getMixTracks);

    const baseSection = createSection(
      "base-section",
      "熱門內容",
      createTrackItem("track-1", "Track One"),
    );
    const moodSection = createSection(
      "mood-section",
      "今晚派對",
      createCollectionItem("VLparty", "Party Mix"),
    );

    (service as unknown as { getBaseFeed: () => Promise<unknown> }).getBaseFeed =
      async () => ({
        market: "TW",
        moods: [
          {
            key: "mood-1",
            label: "派對",
            endpoint: {
              browseId: "FEmusic_mood_party",
            },
          },
        ],
        sections: [baseSection],
        warnings: [],
        fetchedAt: "2026-03-27T00:00:00.000Z",
      });
    (
      service as unknown as {
        getMoodFeed: (
          market: DiscoverMarketCode,
          mood: { key: string; label: string },
        ) => Promise<unknown>;
      }
    ).getMoodFeed = async () => ({
      sections: [moodSection],
      warnings: [],
      fetchedAt: "2026-03-27T00:05:00.000Z",
    });

    const baseResponse = await service.getFeed("TW");

    expect(baseResponse.sections[0]?.id).toBe("personal-recent");
    expect(baseResponse.sections[0]?.origin).toBe("personal");
    expect(baseResponse.sections.at(-1)).toEqual(baseSection);

    const moodResponse = await service.getFeed("TW", "mood-1");

    expect(moodResponse.sections).toEqual([moodSection]);
  });

  test("hydrates missing metadata for discover video items", async () => {
    const section = createSection(
      "video-section",
      "最新音樂影片",
      createVideoTrackItem("video-1", "Video One"),
    );
    let requestedVideoId: string | undefined;

    (
      service as unknown as {
        getMarketClient: () => Promise<{
          getBasicInfo: (
            videoId: string,
            options: { client: string },
          ) => Promise<{
            basic_info: { duration: number; author: string };
          }>;
        }>;
      }
    ).getMarketClient = async () => ({
      getBasicInfo: async (videoId, options) => {
        requestedVideoId = videoId;
        expect(options).toEqual({ client: "YTMUSIC" });
        return {
          basic_info: {
            duration: 277,
            author: "八三夭",
          },
        };
      },
    });

    const sections = await (
      service as unknown as {
        enrichDiscoverTrackMetadata: (
          market: DiscoverMarketCode,
          sections: DiscoverSection[],
        ) => Promise<DiscoverSection[]>;
      }
    ).enrichDiscoverTrackMetadata("TW", [section]);

    expect(requestedVideoId).toBe("video-1");
    expect(sections[0]?.items[0]).toEqual({
      kind: "track",
      id: "video-1",
      title: "Video One",
      artist: "八三夭",
      thumbnail: "https://img.youtube.com/vi/video-1/mqdefault.jpg",
      duration: 277,
      presentation: "video",
      track: {
        videoId: "video-1",
        title: "Video One",
        artist: "八三夭",
        duration: 277,
        thumbnail: "https://img.youtube.com/vi/video-1/mqdefault.jpg",
      },
    });
  });

  test("getRecentlyRequested orders by recency within the window", async () => {
    service.recordTrackRequests([
      createTrack("track-old", "Old Track"),
      createTrack("track-new", "New Track"),
    ]);

    const statsStore = (
      service as unknown as {
        statsStore: {
          getRecentlyRequested: (
            limit?: number,
            sinceDays?: number,
          ) => Array<{ track: Track; lastRequestedAt: string }>;
          db: {
            query: (sql: string) => {
              run: (...args: unknown[]) => void;
            };
          };
        };
      }
    ).statsStore;

    // 把 track-old 的點播時間推到視窗之外
    statsStore.db
      .query(
        "UPDATE discover_track_activity SET last_requested_at = ?1 WHERE video_id = ?2",
      )
      .run(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), "track-old");

    const entries = statsStore.getRecentlyRequested(10, 30);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.track.videoId).toBe("track-new");
  });

  test("builds personalized sections from local stats with mix recommendations", async () => {
    const requestedTracks = ["seed-1", "seed-2", "seed-3", "seed-4"].map(
      (id, index) => createTrack(id, `Seed ${index + 1}`),
    );
    service.recordTrackRequests(requestedTracks);

    const musicService = getMusicService();
    const mixCalls: string[] = [];
    stubMethod(musicService, "getMixTracks", (async (
      videoId: string,
      _limit?: number,
    ) => {
      mixCalls.push(videoId);
      return [
        createTrack(`mix-${videoId}-a`, `Mix of ${videoId} A`),
        createTrack(`mix-${videoId}-b`, `Mix of ${videoId} B`),
        createTrack("seed-1", "Seed 1"),
      ];
    }) as typeof musicService.getMixTracks);

    const sections = await (
      service as unknown as {
        getPersonalizedSections: () => Promise<DiscoverSection[]>;
      }
    ).getPersonalizedSections();

    expect(sections.map((section) => section.id)).toEqual([
      "personal-recent",
      "personal-for-you",
    ]);
    expect(sections[0]?.origin).toBe("personal");
    expect(sections[0]?.items.length).toBeGreaterThanOrEqual(3);

    const recommended = sections[1]!;
    expect(recommended.origin).toBe("personal");
    const recommendedIds = recommended.items.map((item) => item.id);
    // 種子與最近常聽的歌曲不應重複出現在推薦清單
    expect(recommendedIds).not.toContain("seed-1");
    expect(recommendedIds.length).toBeGreaterThanOrEqual(3);
    expect(mixCalls.length).toBeGreaterThan(0);
  });

  test("returns no personalized sections when stats are empty", async () => {
    const musicService = getMusicService();
    stubMethod(musicService, "getMixTracks", (async () => {
      throw new Error("should not be called");
    }) as typeof musicService.getMixTracks);

    const sections = await (
      service as unknown as {
        getPersonalizedSections: () => Promise<DiscoverSection[]>;
      }
    ).getPersonalizedSections();

    expect(sections).toEqual([]);
  });

  test("degrades gracefully when mix recommendations fail", async () => {
    service.recordTrackRequests([
      createTrack("seed-1", "Seed 1"),
      createTrack("seed-2", "Seed 2"),
      createTrack("seed-3", "Seed 3"),
    ]);

    const musicService = getMusicService();
    // getMixTracks 在實作中對錯誤回傳空陣列;這裡模擬全部種子皆無結果
    stubMethod(musicService, "getMixTracks", (async () => []) as
      typeof musicService.getMixTracks);

    const sections = await (
      service as unknown as {
        getPersonalizedSections: () => Promise<DiscoverSection[]>;
      }
    ).getPersonalizedSections();

    expect(sections.map((section) => section.id)).toEqual(["personal-recent"]);
  });
});

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { Innertube, Log, UniversalCache } from "youtubei.js";
import type {
  DiscoverCollectionItem,
  DiscoverFeedResponse,
  DiscoverItem,
  DiscoverMarket,
  DiscoverMarketCode,
  DiscoverMarketsResponse,
  DiscoverMood,
  DiscoverSection,
  DiscoverTrackItem,
  DiscoverTrackPresentation,
  TopRequestedEntry,
  Track,
} from "../types/index.ts";
import { getMusicService } from "./music.service.ts";
import { log } from "../utils/logger.ts";

const DISCOVER_FEED_CACHE_TTL_MS = 15 * 60 * 1000;
const DISCOVER_VIDEO_METADATA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_TOP_REQUESTED_LIMIT = 10;
const DEFAULT_RECENTLY_REQUESTED_LIMIT = 10;
const RECENTLY_REQUESTED_WINDOW_DAYS = 30;
const PERSONALIZED_SEED_COUNT = 3;
const PERSONALIZED_MIX_TRACKS_PER_SEED = 8;
const PERSONALIZED_SECTION_MAX_ITEMS = 20;
const PERSONALIZED_SECTION_MIN_ITEMS = 3;
const MOODS_AND_GENRES_BROWSE_ID = "FEmusic_moods_and_genres";

type DiscoverMarketConfig = DiscoverMarket & {
  location: string;
};

type DiscoverMoodInternal = DiscoverMood & {
  endpoint: {
    browseId: string;
    params?: string;
  };
};

type BaseFeedCacheEntry = {
  value: BaseFeedInternal;
  expiresAt: number;
};

type MoodFeedCacheEntry = {
  value: MoodFeedInternal;
  expiresAt: number;
};

type BaseFeedInternal = {
  market: DiscoverMarketCode;
  moods: DiscoverMoodInternal[];
  sections: DiscoverSection[];
  warnings: string[];
  fetchedAt: string;
};

type MoodFeedInternal = {
  sections: DiscoverSection[];
  warnings: string[];
  fetchedAt: string;
};

type DiscoverVideoMetadata = {
  duration?: number;
  artist?: string;
};

type DiscoverVideoMetadataCacheEntry = {
  value: DiscoverVideoMetadata;
  expiresAt: number;
};

type TrackCatalogRow = {
  video_id: string;
  title: string | null;
  artist: string | null;
  thumbnail: string | null;
  duration: number | null;
  updated_at: string;
};

type TrackActivityRow = {
  video_id: string;
  request_count: number;
  last_requested_at: string;
};

type JoinedTopRequestedRow = TrackCatalogRow & TrackActivityRow;
type TrackCatalogMetadataUpdate = {
  videoId: string;
  artist?: string;
  duration?: number;
};

const DISCOVER_MARKET_CONFIGS: readonly DiscoverMarketConfig[] = [
  { code: "TW", label: "台灣", lang: "zh-TW", location: "TW" },
  { code: "US", label: "美國", lang: "en-US", location: "US" },
  { code: "JP", label: "日本", lang: "ja-JP", location: "JP" },
  { code: "KR", label: "韓國", lang: "ko-KR", location: "KR" },
  { code: "GB", label: "英國", lang: "en-GB", location: "GB" },
  { code: "DE", label: "德國", lang: "de-DE", location: "DE" },
  { code: "BR", label: "巴西", lang: "pt-BR", location: "BR" },
  { code: "MX", label: "墨西哥", lang: "es-MX", location: "MX" },
];

export const DISCOVER_MARKETS: DiscoverMarket[] = DISCOVER_MARKET_CONFIGS.map(
  ({ code, label, lang }) => ({ code, label, lang }),
);

export const DEFAULT_DISCOVER_MARKET: DiscoverMarketCode = "TW";

function getDefaultDiscoverStatsDbPath(): string {
  if (process.env.DISCOVER_STATS_DB_PATH?.trim()) {
    return process.env.DISCOVER_STATS_DB_PATH.trim();
  }

  if (process.env.NODE_ENV === "production") {
    return "/data/discover-stats.sqlite";
  }

  return join(process.cwd(), ".data", "discover-stats.sqlite");
}

function normalizeTrackForStats(track: Track): Track | null {
  const videoId = track.videoId?.trim();
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title: track.title?.trim() || "Unknown",
    artist: track.artist?.trim() || "Unknown",
    duration: Number.isFinite(track.duration) ? track.duration : 0,
    thumbnail: track.thumbnail?.trim() || undefined,
    album: track.album,
  };
}

function normalizeStatsDuration(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}

function normalizeDiscoverMarketCode(
  value: string | null | undefined,
): DiscoverMarketCode {
  const normalized = value?.trim().toUpperCase();
  const matchedMarket = DISCOVER_MARKET_CONFIGS.find(
    (market) => market.code === normalized,
  );
  return matchedMarket?.code ?? DEFAULT_DISCOVER_MARKET;
}

function getMarketConfig(market: DiscoverMarketCode): DiscoverMarketConfig {
  return (
    DISCOVER_MARKET_CONFIGS.find((candidate) => candidate.code === market) ??
    DISCOVER_MARKET_CONFIGS[0]!
  );
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const withSimpleText = value as {
    simpleText?: unknown;
    text?: unknown;
    runs?: Array<{ text?: unknown }>;
    toString?: () => string;
  };

  if (typeof withSimpleText.simpleText === "string") {
    return withSimpleText.simpleText.trim() || undefined;
  }

  if (typeof withSimpleText.text === "string") {
    return withSimpleText.text.trim() || undefined;
  }

  if (Array.isArray(withSimpleText.runs)) {
    const combined = withSimpleText.runs
      .map((run) => (typeof run?.text === "string" ? run.text : ""))
      .join("")
      .trim();
    if (combined) {
      return combined;
    }
  }

  if (typeof withSimpleText.toString === "function") {
    const normalized = withSimpleText.toString().trim();
    if (normalized && normalized !== "[object Object]") {
      return normalized;
    }
  }

  return undefined;
}

function parseDurationText(input: string | undefined): number {
  if (!input) {
    return 0;
  }

  const parts = input
    .trim()
    .split(":")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) {
    return 0;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseCountValue(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getThumbnailUrlFromArray(
  thumbnails:
    | Array<{
        url?: string | null;
        width?: number | null;
        height?: number | null;
      }>
    | undefined,
): string | undefined {
  const candidates = (thumbnails || []).filter((thumbnail) =>
    Boolean(thumbnail?.url?.trim()),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  const sizedCandidates = candidates.filter(
    (thumbnail) =>
      Number.isFinite(thumbnail?.width) && Number.isFinite(thumbnail?.height),
  );

  if (sizedCandidates.length === 0) {
    return [...candidates].reverse()[0]?.url?.trim();
  }

  return [...sizedCandidates]
    .sort((left, right) => {
      const leftArea = Number(left.width) * Number(left.height);
      const rightArea = Number(right.width) * Number(right.height);
      return rightArea - leftArea;
    })[0]
    ?.url?.trim();
}

function getParsedThumbnailUrl(item: any): string | undefined {
  if (Array.isArray(item?.thumbnail)) {
    return getThumbnailUrlFromArray(item.thumbnail);
  }

  if (Array.isArray(item?.thumbnails)) {
    return getThumbnailUrlFromArray(item.thumbnails);
  }

  if (Array.isArray(item?.thumbnail?.contents)) {
    return getThumbnailUrlFromArray(item.thumbnail.contents);
  }

  return undefined;
}

function getRawThumbnailUrl(item: any): string | undefined {
  const thumbnails =
    item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    item?.thumbnail?.musicThumbnailRenderer?.thumbnails ||
    item?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    item?.thumbnail?.thumbnails;

  return Array.isArray(thumbnails) ? getThumbnailUrlFromArray(thumbnails) : undefined;
}

function getArtistsFromRuns(
  runs: Array<{
    text?: string;
    navigationEndpoint?: any;
    endpoint?: {
      payload?: {
        browseId?: string;
      };
    };
  }> | undefined,
): string[] {
  return (runs || [])
    .filter((run) => {
      const browseId =
        run?.navigationEndpoint?.browseEndpoint?.browseId ||
        run?.endpoint?.payload?.browseId;
      return typeof browseId === "string" && browseId.startsWith("UC");
    })
    .map((run) => run.text?.trim())
    .filter((name): name is string => Boolean(name));
}

function getArtistReferencesFromRuns(
  runs: Array<{
    text?: string;
    navigationEndpoint?: any;
    endpoint?: {
      payload?: {
        browseId?: string;
      };
    };
  }> | undefined,
): Array<{ name: string; id: string }> {
  return (runs || [])
    .map((run) => {
      const browseId =
        run?.navigationEndpoint?.browseEndpoint?.browseId ||
        run?.endpoint?.payload?.browseId;

      if (typeof browseId !== "string" || !browseId.startsWith("UC")) {
        return null;
      }

      const name = run.text?.trim();
      if (!name) {
        return null;
      }

      return {
        name,
        id: browseId,
      };
    })
    .filter((artist): artist is { name: string; id: string } => Boolean(artist));
}

function getParsedArtistReference(
  artist: any,
): { name?: string; id?: string } {
  const browseId =
    typeof artist?.channel_id === "string"
      ? artist.channel_id.trim()
      : typeof artist?.endpoint?.payload?.browseId === "string"
        ? artist.endpoint.payload.browseId.trim()
        : undefined;

  return {
    name: readText(artist?.name),
    id: browseId,
  };
}

function fallbackArtistFromSubtitle(subtitle: string | undefined): string {
  if (!subtitle) {
    return "Unknown";
  }

  const candidate = subtitle.split(/\s*[•·]\s*/)[0]?.trim();
  if (!candidate || candidate === "Song" || candidate === "播放清單") {
    return "Unknown";
  }

  return candidate;
}

function inferTrackPresentationFromThumbnail(
  thumbnail: string | undefined,
  hasAlbumLink: boolean,
): DiscoverTrackPresentation {
  if (hasAlbumLink) {
    return "song";
  }

  return thumbnail &&
    /(?:i\.ytimg\.com|img\.youtube\.com|ytimg\.com\/vi\/)/iu.test(thumbnail)
    ? "video"
    : "song";
}

function createDiscoverTrackItem(
  track: Track,
  presentation: DiscoverTrackPresentation = "song",
): DiscoverTrackItem {
  return {
    kind: "track",
    id: track.videoId,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId,
    thumbnail: track.thumbnail,
    duration: track.duration,
    presentation,
    track,
  };
}

function hasMeaningfulArtistName(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized !== "Unknown";
}

function getTrackDurationValue(item: DiscoverTrackItem): number {
  return item.duration > 0 ? item.duration : item.track.duration;
}

function needsDiscoverVideoMetadata(item: DiscoverTrackItem): boolean {
  if (item.presentation !== "video") {
    return false;
  }

  return (
    getTrackDurationValue(item) <= 0 ||
    !hasMeaningfulArtistName(item.artist) ||
    !hasMeaningfulArtistName(item.track.artist)
  );
}

function applyDiscoverVideoMetadata(
  item: DiscoverTrackItem,
  metadata: DiscoverVideoMetadata,
): DiscoverTrackItem {
  const resolvedDuration =
    item.duration > 0
      ? item.duration
      : item.track.duration > 0
        ? item.track.duration
        : metadata.duration || 0;
  const resolvedArtist =
    hasMeaningfulArtistName(item.artist) ? item.artist : metadata.artist || item.artist;
  const resolvedTrackArtist = hasMeaningfulArtistName(item.track.artist)
    ? item.track.artist
    : metadata.artist || item.track.artist;

  if (
    resolvedDuration === item.duration &&
    resolvedDuration === item.track.duration &&
    resolvedArtist === item.artist &&
    resolvedTrackArtist === item.track.artist
  ) {
    return item;
  }

  return {
    ...item,
    artist: resolvedArtist,
    duration: resolvedDuration,
    track: {
      ...item.track,
      artist: resolvedTrackArtist,
      duration: resolvedDuration,
    },
  };
}

function createDiscoverCollectionItem(input: {
  kind: "album" | "playlist";
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  thumbnail?: string;
  trackCount?: number;
  subtitle?: string;
}): DiscoverCollectionItem {
  return {
    kind: input.kind,
    id: input.id,
    title: input.title,
    artist: input.artist,
    artistId: input.artistId,
    thumbnail: input.thumbnail,
    trackCount: input.trackCount,
    subtitle: input.subtitle,
  };
}

function normalizeParsedCarouselItem(item: any): DiscoverItem | null {
  const itemType = item?.item_type;
  const title = readText(item?.title) || readText(item?.name);
  const id = readText(item?.id);

  if (!title || !id) {
    return null;
  }

  const thumbnail = getParsedThumbnailUrl(item);

  if (itemType === "song" || itemType === "video") {
    const artistReferences = (item?.artists || item?.authors || [])
      .map((artist: any) => getParsedArtistReference(artist))
      .filter((artist: { name?: string; id?: string }) => artist.name || artist.id);
    const authorReference = getParsedArtistReference(item?.author);

    const track: Track = {
      videoId: id,
      title,
      artist: artistReferences[0]?.name || authorReference.name || "Unknown",
      artistId: artistReferences[0]?.id || authorReference.id,
      duration: item?.duration?.seconds || 0,
      thumbnail,
      album: item?.album?.id && item?.album?.name
        ? {
            id: item.album.id,
            name: item.album.name,
          }
        : undefined,
    };

    return createDiscoverTrackItem(
      track,
      itemType === "video" ? "video" : "song",
    );
  }

  if (itemType === "album" || itemType === "playlist") {
    const artistReferences: Array<{ name?: string; id?: string }> = (item?.artists || [])
      .map((artist: any) => getParsedArtistReference(artist))
      .filter(
        (artist: { name?: string; id?: string }): artist is {
          name?: string;
          id?: string;
        } =>
          Boolean(artist.name || artist.id),
      );
    const authorReference = getParsedArtistReference(item?.author);
    const artist =
      authorReference.name ||
      artistReferences
        .map((artistReference) => artistReference.name)
        .filter((name): name is string => Boolean(name))
        .join(", ") ||
      fallbackArtistFromSubtitle(readText(item?.subtitle));

    return createDiscoverCollectionItem({
      kind: itemType,
      id,
      title,
      artist,
      artistId: authorReference.id || artistReferences[0]?.id,
      thumbnail,
      trackCount: parseCountValue(item?.item_count || item?.song_count),
      subtitle: readText(item?.subtitle),
    });
  }

  return null;
}

function normalizeRawResponsiveListItem(raw: any): DiscoverItem | null {
  const flexColumns = raw?.flexColumns || [];
  const fixedColumns = raw?.fixedColumns || [];
  const titleRuns =
    flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const secondaryRuns =
    flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const tertiaryRuns =
    flexColumns[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const navigationEndpoint = raw?.navigationEndpoint;
  const browseEndpoint = navigationEndpoint?.browseEndpoint;
  const pageType =
    browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  const videoId =
    raw?.playlistItemData?.videoId || navigationEndpoint?.watchEndpoint?.videoId;
  const title = readText({ runs: titleRuns });
  const thumbnail = getRawThumbnailUrl(raw);

  if (!title) {
    return null;
  }

  if (videoId) {
    const albumRun = [...(secondaryRuns || []), ...(tertiaryRuns || [])].find(
      (run) =>
        typeof run?.navigationEndpoint?.browseEndpoint?.browseId === "string" &&
        run.navigationEndpoint.browseEndpoint.browseId.startsWith("MPR"),
    );
    const durationText =
      (secondaryRuns || [])
        .map((run: { text?: string } | undefined) => run?.text)
        .find((text: string | undefined) =>
          typeof text === "string" && /^\d+(?::\d+)+$/.test(text),
        ) ||
      fixedColumns[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.find(
        (run: any) =>
          typeof run?.text === "string" && /^\d+(?::\d+)+$/.test(run.text),
      )?.text;
    const artistReferences = getArtistReferencesFromRuns(secondaryRuns).concat(
      getArtistReferencesFromRuns(tertiaryRuns),
    );

    const track: Track = {
      videoId,
      title,
      artist:
        artistReferences[0]?.name ||
        fallbackArtistFromSubtitle(readText({ runs: secondaryRuns })),
      artistId: artistReferences[0]?.id,
      duration: parseDurationText(durationText),
      thumbnail,
      album:
        albumRun?.navigationEndpoint?.browseEndpoint?.browseId && albumRun.text
          ? {
              id: albumRun.navigationEndpoint.browseEndpoint.browseId,
              name: albumRun.text,
            }
          : undefined,
    };

    return createDiscoverTrackItem(
      track,
      inferTrackPresentationFromThumbnail(thumbnail, Boolean(track.album)),
    );
  }

  if (
    pageType === "MUSIC_PAGE_TYPE_ALBUM" ||
    pageType === "MUSIC_PAGE_TYPE_PLAYLIST"
  ) {
    const id = browseEndpoint?.browseId;
    if (!id) {
      return null;
    }

    return createDiscoverCollectionItem({
      kind: pageType === "MUSIC_PAGE_TYPE_ALBUM" ? "album" : "playlist",
      id,
      title,
      artist:
        getArtistReferencesFromRuns(secondaryRuns)[0]?.name ||
        fallbackArtistFromSubtitle(readText({ runs: secondaryRuns })),
      artistId: getArtistReferencesFromRuns(secondaryRuns)[0]?.id,
      thumbnail,
      trackCount: parseCountValue(readText({ runs: secondaryRuns })),
      subtitle: readText({ runs: secondaryRuns }),
    });
  }

  return null;
}

function normalizeRawTwoRowItem(raw: any): DiscoverItem | null {
  const navigationEndpoint = raw?.navigationEndpoint;
  const browseEndpoint = navigationEndpoint?.browseEndpoint;
  const watchEndpoint = navigationEndpoint?.watchEndpoint;
  const pageType =
    browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  const title = readText(raw?.title);
  const subtitle = readText(raw?.subtitle);
  const thumbnail = getRawThumbnailUrl(raw);

  if (!title) {
    return null;
  }

  if (watchEndpoint?.videoId) {
    const track: Track = {
      videoId: watchEndpoint.videoId,
      title,
      artist: fallbackArtistFromSubtitle(subtitle),
      duration: 0,
      thumbnail,
    };
    return createDiscoverTrackItem(
      track,
      inferTrackPresentationFromThumbnail(thumbnail, false),
    );
  }

  if (
    pageType === "MUSIC_PAGE_TYPE_ALBUM" ||
    pageType === "MUSIC_PAGE_TYPE_PLAYLIST"
  ) {
    const id = browseEndpoint?.browseId;
    if (!id) {
      return null;
    }

    return createDiscoverCollectionItem({
      kind: pageType === "MUSIC_PAGE_TYPE_ALBUM" ? "album" : "playlist",
      id,
      title,
      artist: fallbackArtistFromSubtitle(subtitle),
      thumbnail,
      trackCount: parseCountValue(subtitle),
      subtitle,
    });
  }

  return null;
}

function normalizeRawMultiRowItem(raw: any): DiscoverItem | null {
  const endpoint = raw?.onTap?.browseEndpoint || raw?.onTap?.watchEndpoint;
  const browseEndpoint = raw?.onTap?.browseEndpoint;
  const pageType =
    browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  const title = readText(raw?.title);
  const subtitle = readText(raw?.subtitle);
  const thumbnail = getRawThumbnailUrl(raw);

  if (!title || !endpoint) {
    return null;
  }

  if (pageType === "MUSIC_PAGE_TYPE_ALBUM" || pageType === "MUSIC_PAGE_TYPE_PLAYLIST") {
    return createDiscoverCollectionItem({
      kind: pageType === "MUSIC_PAGE_TYPE_ALBUM" ? "album" : "playlist",
      id: browseEndpoint.browseId,
      title,
      artist: fallbackArtistFromSubtitle(subtitle),
      thumbnail,
      trackCount: parseCountValue(readText(raw?.secondTitle)),
      subtitle,
    });
  }

  return null;
}

function normalizeRawCarouselItem(rawContainer: any): DiscoverItem | null {
  if (rawContainer?.musicResponsiveListItemRenderer) {
    return normalizeRawResponsiveListItem(rawContainer.musicResponsiveListItemRenderer);
  }

  if (rawContainer?.musicTwoRowItemRenderer) {
    return normalizeRawTwoRowItem(rawContainer.musicTwoRowItemRenderer);
  }

  if (rawContainer?.musicMultiRowListItemRenderer) {
    return normalizeRawMultiRowItem(rawContainer.musicMultiRowListItemRenderer);
  }

  return null;
}

function normalizeSectionId(title: string, index: number): string {
  return `${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}-${index}`;
}

function normalizeParsedSections(sections: unknown[] | undefined): DiscoverSection[] {
  const normalizedSections: DiscoverSection[] = [];

  for (const [index, section] of (sections || []).entries()) {
    const headerTitle = readText((section as any)?.header?.title);
    if (!headerTitle) {
      continue;
    }

    const items = ((section as any)?.contents || [])
      .map((item: any) => normalizeParsedCarouselItem(item))
      .filter((item: DiscoverItem | null): item is DiscoverItem => Boolean(item));

    if (items.length === 0) {
      continue;
    }

    normalizedSections.push({
      id: normalizeSectionId(headerTitle, index),
      title: headerTitle,
      subtitle: readText((section as any)?.header?.strapline),
      items: dedupeDiscoverItems(items),
    });
  }

  return normalizedSections;
}

function collectRawCarousels(value: unknown, result: any[] = []): any[] {
  if (!value || typeof value !== "object") {
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRawCarousels(item, result);
    }
    return result;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "musicCarouselShelfRenderer" && nestedValue) {
      result.push(nestedValue);
    }

    collectRawCarousels(nestedValue, result);
  }

  return result;
}

function normalizeRawSections(responseData: unknown): DiscoverSection[] {
  const shelves = collectRawCarousels(responseData);
  const sections: DiscoverSection[] = [];

  for (const [index, shelf] of shelves.entries()) {
    const headerTitle = readText(
      shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title,
    );
    if (!headerTitle) {
      continue;
    }

    const items = (shelf?.contents || [])
      .map((item: any) => normalizeRawCarouselItem(item))
      .filter((item: DiscoverItem | null): item is DiscoverItem => Boolean(item));

    if (items.length === 0) {
      continue;
    }

    sections.push({
      id: normalizeSectionId(headerTitle, index),
      title: headerTitle,
      subtitle: readText(
        shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.strapline,
      ),
      items: dedupeDiscoverItems(items),
    });
  }

  return sections;
}

function dedupeDiscoverItems(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  const deduped: DiscoverItem[] = [];

  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function mergeDiscoverSections(
  primary: DiscoverSection[],
  fallback: DiscoverSection[],
): DiscoverSection[] {
  const seen = new Set(primary.map((section) => section.title));
  return [
    ...primary,
    ...fallback.filter((section) => !seen.has(section.title)),
  ];
}

function parseMoodButtonsFromResponse(responseData: any): DiscoverMoodInternal[] {
  const buttons: DiscoverMoodInternal[] = [];
  const seen = new Set<string>();

  function walk(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "musicNavigationButtonRenderer" && nestedValue) {
        const label = readText((nestedValue as any).buttonText);
        const browseEndpoint = (nestedValue as any).clickCommand?.browseEndpoint;

        if (label && browseEndpoint?.browseId) {
          const endpoint = {
            browseId: browseEndpoint.browseId,
            ...(typeof browseEndpoint.params === "string"
              ? { params: browseEndpoint.params }
              : {}),
          };
          const key = createHash("sha1")
            .update(`${label}:${JSON.stringify(endpoint)}`)
            .digest("hex")
            .slice(0, 12);

          if (!seen.has(key)) {
            seen.add(key);
            buttons.push({
              key,
              label,
              endpoint,
            });
          }
        }
      }

      walk(nestedValue);
    }
  }

  walk(responseData);
  return buttons;
}

function toPublicMood(mood: DiscoverMoodInternal): DiscoverMood {
  return {
    key: mood.key,
    label: mood.label,
  };
}

class DiscoverStatsStore {
  private readonly db: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true });
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discover_track_catalog (
        video_id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        thumbnail TEXT,
        duration INTEGER,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discover_track_activity (
        video_id TEXT PRIMARY KEY,
        request_count INTEGER NOT NULL DEFAULT 0,
        last_requested_at TEXT NOT NULL
      );
    `);
  }

  recordTrackRequests(tracks: Track[]): void {
    const normalizedTracks = tracks
      .map((track) => normalizeTrackForStats(track))
      .filter((track): track is Track => Boolean(track));

    if (normalizedTracks.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const transaction = this.db.transaction((items: Track[]) => {
      for (const track of items) {
        this.db
          .query(`
            INSERT INTO discover_track_catalog (
              video_id, title, artist, thumbnail, duration, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(video_id) DO UPDATE SET
              title = CASE
                WHEN excluded.title IS NOT NULL AND excluded.title <> 'Unknown'
                  THEN excluded.title
                ELSE discover_track_catalog.title
              END,
              artist = CASE
                WHEN excluded.artist IS NOT NULL AND excluded.artist <> 'Unknown'
                  THEN excluded.artist
                ELSE discover_track_catalog.artist
              END,
              thumbnail = COALESCE(excluded.thumbnail, discover_track_catalog.thumbnail),
              duration = CASE
                WHEN excluded.duration IS NOT NULL AND excluded.duration > 0
                  THEN excluded.duration
                ELSE discover_track_catalog.duration
              END,
              updated_at = excluded.updated_at
          `)
          .run(
            track.videoId,
            track.title,
            track.artist,
            track.thumbnail ?? null,
            track.duration,
            now,
          );

        this.db
          .query(`
            INSERT INTO discover_track_activity (
              video_id, request_count, last_requested_at
            )
            VALUES (?1, 1, ?2)
            ON CONFLICT(video_id) DO UPDATE SET
              request_count = discover_track_activity.request_count + 1,
              last_requested_at = excluded.last_requested_at
          `)
          .run(track.videoId, now);
      }
    });

    transaction(normalizedTracks);
  }

  updateTrackCatalogMetadata(update: TrackCatalogMetadataUpdate): void {
    const videoId = update.videoId.trim();
    if (!videoId) {
      return;
    }

    const artist = hasMeaningfulArtistName(update.artist)
      ? update.artist!.trim()
      : null;
    const duration = normalizeStatsDuration(update.duration);

    if (!artist && duration === null) {
      return;
    }

    this.db
      .query(`
        UPDATE discover_track_catalog
        SET
          artist = CASE
            WHEN ?2 IS NOT NULL THEN ?2
            ELSE artist
          END,
          duration = CASE
            WHEN ?3 IS NOT NULL THEN ?3
            ELSE duration
          END,
          updated_at = ?4
        WHERE video_id = ?1
      `)
      .run(videoId, artist, duration, new Date().toISOString());
  }

  getTopRequested(limit: number = DEFAULT_TOP_REQUESTED_LIMIT): TopRequestedEntry[] {
    const rows = this.db
      .query(`
        SELECT
          activity.video_id,
          activity.request_count,
          activity.last_requested_at,
          catalog.title,
          catalog.artist,
          catalog.thumbnail,
          catalog.duration,
          catalog.updated_at
        FROM discover_track_activity AS activity
        LEFT JOIN discover_track_catalog AS catalog
          ON catalog.video_id = activity.video_id
        ORDER BY activity.request_count DESC, activity.last_requested_at DESC
        LIMIT ?1
      `)
      .all(limit) as JoinedTopRequestedRow[];

    return rows.map((row, index) => ({
      rank: index + 1,
      requestCount: row.request_count,
      lastRequestedAt: row.last_requested_at,
      track: {
        videoId: row.video_id,
        title: row.title || "Unknown",
        artist: row.artist || "Unknown",
        duration: row.duration || 0,
        thumbnail: row.thumbnail || undefined,
      },
    }));
  }

  getRecentlyRequested(
    limit: number = DEFAULT_RECENTLY_REQUESTED_LIMIT,
    sinceDays: number = RECENTLY_REQUESTED_WINDOW_DAYS,
  ): TopRequestedEntry[] {
    const since = new Date(
      Date.now() - sinceDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rows = this.db
      .query(`
        SELECT
          activity.video_id,
          activity.request_count,
          activity.last_requested_at,
          catalog.title,
          catalog.artist,
          catalog.thumbnail,
          catalog.duration,
          catalog.updated_at
        FROM discover_track_activity AS activity
        LEFT JOIN discover_track_catalog AS catalog
          ON catalog.video_id = activity.video_id
        WHERE activity.last_requested_at >= ?1
        ORDER BY activity.last_requested_at DESC, activity.request_count DESC
        LIMIT ?2
      `)
      .all(since, limit) as JoinedTopRequestedRow[];

    return rows.map((row, index) => ({
      rank: index + 1,
      requestCount: row.request_count,
      lastRequestedAt: row.last_requested_at,
      track: {
        videoId: row.video_id,
        title: row.title || "Unknown",
        artist: row.artist || "Unknown",
        duration: row.duration || 0,
        thumbnail: row.thumbnail || undefined,
      },
    }));
  }

  close(): void {
    this.db.close();
  }
}

export class DiscoverService {
  private static instance: DiscoverService | undefined;

  private readonly statsStore: DiscoverStatsStore;
  private readonly clientCache = new Map<DiscoverMarketCode, Innertube>();
  private readonly clientInFlight = new Map<DiscoverMarketCode, Promise<Innertube>>();
  private readonly baseFeedCache = new Map<DiscoverMarketCode, BaseFeedCacheEntry>();
  private readonly baseFeedInFlight = new Map<
    DiscoverMarketCode,
    Promise<BaseFeedInternal>
  >();
  private readonly moodFeedCache = new Map<string, MoodFeedCacheEntry>();
  private readonly moodFeedInFlight = new Map<string, Promise<MoodFeedInternal>>();
  private readonly videoMetadataCache = new Map<
    string,
    DiscoverVideoMetadataCacheEntry
  >();
  private readonly videoMetadataInFlight = new Map<
    string,
    Promise<DiscoverVideoMetadata | null>
  >();
  private recommendationCache: {
    seedKey: string;
    items: DiscoverItem[];
    expiresAt: number;
  } | null = null;

  constructor(databasePath: string = getDefaultDiscoverStatsDbPath()) {
    this.statsStore = new DiscoverStatsStore(databasePath);
  }

  static getInstance(): DiscoverService {
    if (!DiscoverService.instance) {
      DiscoverService.instance = new DiscoverService();
    }

    return DiscoverService.instance;
  }

  static resetInstanceForTests(): void {
    DiscoverService.instance?.close();
    DiscoverService.instance = undefined;
  }

  async getMarketsResponse(): Promise<DiscoverMarketsResponse> {
    const topRequested = await this.enrichTopRequestedMetadata(
      this.statsStore.getTopRequested(),
    );

    return {
      markets: DISCOVER_MARKETS.map((market) => ({ ...market })),
      defaultMarket: DEFAULT_DISCOVER_MARKET,
      topRequested,
    };
  }

  recordTrackRequest(track: Track): void {
    this.recordTrackRequests([track]);
  }

  recordTrackRequests(tracks: Track[]): void {
    this.statsStore.recordTrackRequests(tracks);
  }

  private async enrichTopRequestedMetadata(
    entries: TopRequestedEntry[],
  ): Promise<TopRequestedEntry[]> {
    const pendingEntries = entries.filter(
      (entry) =>
        entry.track.duration <= 0 ||
        !hasMeaningfulArtistName(entry.track.artist),
    );

    if (pendingEntries.length === 0) {
      return entries;
    }

    const metadataByVideoId = new Map<string, DiscoverVideoMetadata>();
    const metadataResults = await Promise.all(
      pendingEntries.map(async (entry) => ({
        videoId: entry.track.videoId,
        metadata: await this.getDiscoverVideoMetadata(
          DEFAULT_DISCOVER_MARKET,
          entry.track.videoId,
        ),
      })),
    );

    for (const result of metadataResults) {
      if (result.metadata) {
        metadataByVideoId.set(result.videoId, result.metadata);
      }
    }

    return entries.map((entry) => {
      const metadata = metadataByVideoId.get(entry.track.videoId);
      if (!metadata) {
        return entry;
      }

      const resolvedDuration =
        entry.track.duration > 0
          ? entry.track.duration
          : metadata.duration || 0;
      const resolvedArtist = hasMeaningfulArtistName(entry.track.artist)
        ? entry.track.artist
        : metadata.artist || entry.track.artist;

      if (
        resolvedDuration === entry.track.duration &&
        resolvedArtist === entry.track.artist
      ) {
        return entry;
      }

      this.statsStore.updateTrackCatalogMetadata({
        videoId: entry.track.videoId,
        duration: resolvedDuration,
        artist: resolvedArtist,
      });

      return {
        ...entry,
        track: {
          ...entry.track,
          duration: resolvedDuration,
          artist: resolvedArtist,
        },
      };
    });
  }

  // 依本站點播統計產生個人化區塊;統計為空時回傳空陣列,讓畫面自然退回市場內容。
  private async getPersonalizedSections(): Promise<DiscoverSection[]> {
    const sections: DiscoverSection[] = [];

    try {
      const recentEntries = await this.enrichTopRequestedMetadata(
        this.statsStore.getRecentlyRequested(),
      );

      const recentItems = recentEntries.map((entry) =>
        createDiscoverTrackItem(entry.track),
      );

      if (recentItems.length >= PERSONALIZED_SECTION_MIN_ITEMS) {
        sections.push({
          id: "personal-recent",
          title: "最近常聽",
          subtitle: "根據這裡最近的點播紀錄",
          origin: "personal",
          items: recentItems,
        });
      }

      const recommendedItems = await this.getRecommendedItems(
        new Set(recentItems.map((item) => item.id)),
      );

      if (recommendedItems.length >= PERSONALIZED_SECTION_MIN_ITEMS) {
        sections.push({
          id: "personal-for-you",
          title: "為你推薦",
          subtitle: "從你最常點播的歌曲延伸",
          origin: "personal",
          items: recommendedItems,
        });
      }
    } catch (error) {
      log.warn("Failed to build personalized discover sections", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return sections;
  }

  private async getRecommendedItems(
    excludedIds: Set<string>,
  ): Promise<DiscoverItem[]> {
    const seeds = this.statsStore.getTopRequested(PERSONALIZED_SEED_COUNT);
    if (seeds.length === 0) {
      return [];
    }

    const seedKey = seeds.map((seed) => seed.track.videoId).join(",");
    const now = Date.now();

    if (
      this.recommendationCache &&
      this.recommendationCache.seedKey === seedKey &&
      this.recommendationCache.expiresAt > now
    ) {
      return this.recommendationCache.items.filter(
        (item) => !excludedIds.has(item.id),
      );
    }

    const seedVideoIds = new Set(seeds.map((seed) => seed.track.videoId));
    const musicService = getMusicService();
    // getMixTracks 失敗時回傳空陣列,單一種子失敗只會讓推薦變少,不會整段失敗。
    const mixResults = await Promise.all(
      seeds.map((seed) =>
        musicService.getMixTracks(
          seed.track.videoId,
          PERSONALIZED_MIX_TRACKS_PER_SEED,
        ),
      ),
    );

    const seenIds = new Set<string>();
    const items: DiscoverItem[] = [];

    for (const tracks of mixResults) {
      for (const track of tracks) {
        if (
          !track.videoId ||
          seedVideoIds.has(track.videoId) ||
          seenIds.has(track.videoId)
        ) {
          continue;
        }

        seenIds.add(track.videoId);
        items.push(createDiscoverTrackItem(track));

        if (items.length >= PERSONALIZED_SECTION_MAX_ITEMS) {
          break;
        }
      }

      if (items.length >= PERSONALIZED_SECTION_MAX_ITEMS) {
        break;
      }
    }

    this.recommendationCache = {
      seedKey,
      items,
      expiresAt: now + DISCOVER_FEED_CACHE_TTL_MS,
    };

    return items.filter((item) => !excludedIds.has(item.id));
  }

  async getFeed(
    marketInput: string | null | undefined,
    moodKey?: string | null,
  ): Promise<DiscoverFeedResponse> {
    const market = normalizeDiscoverMarketCode(marketInput);
    const baseFeed = await this.getBaseFeed(market);
    const publicMoods = baseFeed.moods.map(toPublicMood);
    const normalizedMoodKey = moodKey?.trim() || null;

    if (!normalizedMoodKey) {
      const personalizedSections = await this.getPersonalizedSections();
      return {
        market,
        moods: publicMoods,
        selectedMood: null,
        sections: [...personalizedSections, ...baseFeed.sections],
        warnings: [...baseFeed.warnings],
        fetchedAt: baseFeed.fetchedAt,
      };
    }

    const selectedMood = baseFeed.moods.find(
      (candidate) => candidate.key === normalizedMoodKey,
    );

    if (!selectedMood) {
      return {
        market,
        moods: publicMoods,
        selectedMood: null,
        sections: baseFeed.sections,
        warnings: [
          ...baseFeed.warnings,
          "Selected mood is no longer available. Showing market feed instead.",
        ],
        fetchedAt: baseFeed.fetchedAt,
      };
    }

    const moodFeed = await this.getMoodFeed(market, selectedMood);
    return {
      market,
      moods: publicMoods,
      selectedMood: toPublicMood(selectedMood),
      sections:
        moodFeed.sections.length > 0 ? moodFeed.sections : baseFeed.sections,
      warnings: [...baseFeed.warnings, ...moodFeed.warnings],
      fetchedAt: moodFeed.fetchedAt,
    };
  }

  private async getMarketClient(market: DiscoverMarketCode): Promise<Innertube> {
    const cachedClient = this.clientCache.get(market);
    if (cachedClient) {
      return cachedClient;
    }

    const inFlight = this.clientInFlight.get(market);
    if (inFlight) {
      return inFlight;
    }

    const marketConfig = getMarketConfig(market);
    const request = (async () => {
      Log.setLevel(Log.Level.ERROR);
      const client = await Innertube.create({
        lang: marketConfig.lang,
        location: marketConfig.location,
        retrieve_player: false,
        cache: new UniversalCache(
          true,
          join(process.cwd(), ".cache", "youtubei", "discover", market),
        ),
      });

      this.clientCache.set(market, client);
      this.clientInFlight.delete(market);
      return client;
    })().catch((error) => {
      this.clientInFlight.delete(market);
      throw error;
    });

    this.clientInFlight.set(market, request);
    return request;
  }

  private async enrichDiscoverTrackMetadata(
    market: DiscoverMarketCode,
    sections: DiscoverSection[],
  ): Promise<DiscoverSection[]> {
    const pendingVideoIds = [...new Set(
      sections
        .flatMap((section) => section.items)
        .filter(
          (item): item is DiscoverTrackItem =>
            item.kind === "track" && needsDiscoverVideoMetadata(item),
        )
        .map((item) => item.track.videoId)
        .filter((videoId) => Boolean(videoId?.trim())),
    )];

    if (pendingVideoIds.length === 0) {
      return sections;
    }

    const resolvedMetadata = new Map<string, DiscoverVideoMetadata>();
    const concurrency = 6;

    for (let index = 0; index < pendingVideoIds.length; index += concurrency) {
      const chunk = pendingVideoIds.slice(index, index + concurrency);
      const results = await Promise.all(
        chunk.map(async (videoId) => ({
          videoId,
          metadata: await this.getDiscoverVideoMetadata(market, videoId),
        })),
      );

      for (const result of results) {
        if (result.metadata) {
          resolvedMetadata.set(result.videoId, result.metadata);
        }
      }
    }

    if (resolvedMetadata.size === 0) {
      return sections;
    }

    return sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.kind !== "track") {
          return item;
        }

        const metadata = resolvedMetadata.get(item.track.videoId);
        if (!metadata) {
          return item;
        }

        return applyDiscoverVideoMetadata(item, metadata);
      }),
    }));
  }

  private async getDiscoverVideoMetadata(
    market: DiscoverMarketCode,
    videoId: string,
  ): Promise<DiscoverVideoMetadata | null> {
    const normalizedVideoId = videoId.trim();
    if (!normalizedVideoId) {
      return null;
    }

    const cachedEntry = this.videoMetadataCache.get(normalizedVideoId);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    if (cachedEntry) {
      this.videoMetadataCache.delete(normalizedVideoId);
    }

    const inFlight = this.videoMetadataInFlight.get(normalizedVideoId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const client = await this.getMarketClient(market);
        const info = await client.getBasicInfo(normalizedVideoId, {
          client: "YTMUSIC",
        });

        const duration =
          typeof info.basic_info?.duration === "number" &&
          Number.isFinite(info.basic_info.duration) &&
          info.basic_info.duration > 0
            ? info.basic_info.duration
            : undefined;
        const artist =
          typeof info.basic_info?.author === "string" &&
          hasMeaningfulArtistName(info.basic_info.author)
            ? info.basic_info.author.trim()
            : undefined;

        if (!duration && !artist) {
          return null;
        }

        const metadata: DiscoverVideoMetadata = {
          ...(duration ? { duration } : {}),
          ...(artist ? { artist } : {}),
        };

        this.videoMetadataCache.set(normalizedVideoId, {
          value: metadata,
          expiresAt: Date.now() + DISCOVER_VIDEO_METADATA_CACHE_TTL_MS,
        });

        return metadata;
      } catch (error) {
        log.warn("Failed to resolve discover video metadata", {
          error: error instanceof Error ? error.message : String(error),
          market,
          videoId: normalizedVideoId,
        });
        return null;
      } finally {
        this.videoMetadataInFlight.delete(normalizedVideoId);
      }
    })();

    this.videoMetadataInFlight.set(normalizedVideoId, request);
    return request;
  }

  private async getBaseFeed(market: DiscoverMarketCode): Promise<BaseFeedInternal> {
    const cachedEntry = this.baseFeedCache.get(market);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    if (cachedEntry) {
      this.baseFeedCache.delete(market);
    }

    const inFlight = this.baseFeedInFlight.get(market);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchBaseFeedData(market)
      .then((value) => {
        this.baseFeedCache.set(market, {
          value,
          expiresAt: Date.now() + DISCOVER_FEED_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.baseFeedInFlight.delete(market);
      });

    this.baseFeedInFlight.set(market, request);
    return request;
  }

  private async fetchBaseFeedData(
    market: DiscoverMarketCode,
  ): Promise<BaseFeedInternal> {
    const warnings: string[] = [];
    const client = await this.getMarketClient(market);
    let moods: DiscoverMoodInternal[] = [];
    let sections: DiscoverSection[] = [];

    try {
      const explore = await client.music.getExplore();
      moods = await this.fetchMoodOptions(client, explore);
      sections = normalizeParsedSections(explore.sections);
    } catch (error) {
      warnings.push("Failed to load explore feed for this market.");
      log.warn("Failed to fetch discover explore feed", {
        error: error instanceof Error ? error.message : String(error),
        market,
      });
    }

    if (sections.length < 3) {
      try {
        const homeFeed = await client.music.getHomeFeed();
        const fallbackSections = normalizeParsedSections(homeFeed.sections);
        sections = mergeDiscoverSections(sections, fallbackSections);
      } catch (error) {
        warnings.push("Failed to load supplemental home feed for this market.");
        log.warn("Failed to fetch discover home feed", {
          error: error instanceof Error ? error.message : String(error),
          market,
        });
      }
    }

    sections = await this.enrichDiscoverTrackMetadata(market, sections);

    return {
      market,
      moods,
      sections,
      warnings,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchMoodOptions(
    client: Innertube,
    explore: { top_buttons?: Array<any> | undefined },
  ): Promise<DiscoverMoodInternal[]> {
    const moodsButton = explore.top_buttons?.find(
      (button) => button?.endpoint?.payload?.browseId === MOODS_AND_GENRES_BROWSE_ID,
    );

    if (!moodsButton?.endpoint) {
      return [];
    }

    const response = await moodsButton.endpoint.call(client.actions, {
      client: "YTMUSIC",
    });
    return parseMoodButtonsFromResponse((response as { data?: unknown }).data);
  }

  private async getMoodFeed(
    market: DiscoverMarketCode,
    mood: DiscoverMoodInternal,
  ): Promise<MoodFeedInternal> {
    const cacheKey = `${market}:${mood.key}`;
    const cachedEntry = this.moodFeedCache.get(cacheKey);

    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    if (cachedEntry) {
      this.moodFeedCache.delete(cacheKey);
    }

    const inFlight = this.moodFeedInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchMoodFeedData(market, mood)
      .then((value) => {
        this.moodFeedCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + DISCOVER_FEED_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.moodFeedInFlight.delete(cacheKey);
      });

    this.moodFeedInFlight.set(cacheKey, request);
    return request;
  }

  private async fetchMoodFeedData(
    market: DiscoverMarketCode,
    mood: DiscoverMoodInternal,
  ): Promise<MoodFeedInternal> {
    const client = await this.getMarketClient(market);

    try {
      const response = await client.actions.execute("/browse", {
        ...mood.endpoint,
        client: "YTMUSIC",
      });
      const sections = await this.enrichDiscoverTrackMetadata(
        market,
        normalizeRawSections(response.data),
      );

      return {
        sections,
        warnings: [],
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.warn("Failed to fetch discover mood feed", {
        error: error instanceof Error ? error.message : String(error),
        market,
        mood: mood.label,
      });
      return {
        sections: [],
        warnings: [
          "Failed to load the selected mood feed. Showing market feed instead.",
        ],
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  close(): void {
    this.statsStore.close();
  }
}

export function getDiscoverService(): DiscoverService {
  return DiscoverService.getInstance();
}

export function __resetDiscoverServiceForTests(): void {
  DiscoverService.resetInstanceForTests();
}

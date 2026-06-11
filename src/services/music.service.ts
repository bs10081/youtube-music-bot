import { Innertube, Log, UniversalCache } from "youtubei.js";
import { spawn } from "node:child_process";
import type {
  AlbumDetails,
  ArtistDetails,
  ArtistSection,
  DiscoverCollectionItem,
  DiscoverItem,
  DiscoverTrackItem,
  PlaylistDetails,
  Track,
  TrackAlbum,
  LyricLine,
  StreamUrlResult,
  SearchResult,
  TrackSearchResult,
  CollectionSearchResult,
  SearchCollectionKind,
} from "../types/index.ts";
import { log } from "../utils/logger.ts";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  getYtDlpCommandTimeoutMs,
  getYtDlpCliArgs,
  getYtDlpExecutable,
  getYtDlpFailureHint,
  getYtDlpMetadataArgs,
  parseYtDlpStreamUrlOutput,
} from "../utils/ytdlp.ts";
import {
  parseYouTubeUrl,
  type ParsedYouTubeUrl,
  type ParsedYouTubeCollection,
} from "../utils/youtube-url.ts";

// 確保緩存目錄存在
const cacheDir = join(process.cwd(), ".cache", "youtubei");
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
}

// 初始化 YouTube 客戶端
let ytClient: Innertube | null = null;

async function getClient() {
  if (!ytClient) {
    Log.setLevel(Log.Level.ERROR);
    log.info("Initializing YouTube client");

    ytClient = await Innertube.create({
      retrieve_player: true,
      cache: new UniversalCache(true, cacheDir),
    });

    log.info("YouTube client initialized", {
      hasPlayer: !!ytClient.session?.player,
    });
  }
  return ytClient;
}

type MixPanelItem = {
  video_id?: string;
  id?: string;
  title?: string | { text?: string };
  artists?: Array<{ name?: string }>;
  author?: string | { name?: string };
  duration?: number | { seconds?: number };
};

type MusicItemArtist = {
  name?: string;
};

type MusicItemAlbum = {
  id?: string;
  name?: string;
};

type MusicItemThumbnail =
  | string
  | {
      contents?: Array<{ url?: string | null }>;
    }
  | null;

type MusicSearchItem = {
  id?: string;
  title?: string;
  artists?: MusicItemArtist[];
  album?: MusicItemAlbum;
  duration?: number | { seconds?: number };
  thumbnail?: MusicItemThumbnail;
};

type SearchVideoItem = {
  id?: string;
  video_id?: string;
  title?: string | { text?: string };
  author?: string | { name?: string };
  duration?: number | { seconds?: number };
  thumbnails?: Array<{ url?: string }>;
};

type ThumbnailLike =
  | Array<{ url?: string | null }>
  | {
      contents?: Array<{ url?: string | null }>;
    }
  | null
  | undefined;

type YtDlpEntry = {
  id?: string;
  url?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string | null }>;
};

type YtDlpMetadata = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  creator?: string;
  playlist_uploader?: string;
  album?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string | null }>;
  entries?: Array<YtDlpEntry | null>;
  playlist_count?: number | string;
};

type MusicEntityArtist = {
  name?: string;
  channel_id?: string;
  endpoint?: {
    payload?: {
      browseId?: string;
    };
  };
};

function getMixTrackArtistName(item: MixPanelItem): string {
  if (Array.isArray(item.artists)) {
    const names = item.artists
      .map((artist) => artist?.name?.trim())
      .filter((name): name is string => Boolean(name));

    if (names.length > 0) {
      return names.join(", ");
    }
  }

  if (typeof item.author === "string" && item.author.trim()) {
    return item.author;
  }

  if (
    typeof item.author === "object" &&
    typeof item.author?.name === "string" &&
    item.author.name.trim()
  ) {
    return item.author.name;
  }

  return "Unknown";
}

export function normalizeMixTracks(
  contents: unknown[],
  seedVideoId: string,
  limit: number,
): Track[] {
  const tracks: Track[] = [];

  for (const item of contents) {
    const video = item as MixPanelItem;
    const itemVideoId = video.video_id || video.id;

    if (!itemVideoId || itemVideoId === seedVideoId) {
      continue;
    }

    const title =
      typeof video.title === "string" ? video.title : video.title?.text;
    if (!title || !title.trim()) {
      continue;
    }

    const duration =
      typeof video.duration === "number"
        ? video.duration
        : video.duration?.seconds || 0;

    tracks.push({
      videoId: itemVideoId,
      title,
      artist: getMixTrackArtistName(video),
      duration,
      thumbnail: `https://img.youtube.com/vi/${itemVideoId}/mqdefault.jpg`,
    });

    if (tracks.length >= limit) {
      break;
    }
  }

  return tracks;
}

function getDurationSeconds(
  duration: number | { seconds?: number } | undefined,
): number {
  if (typeof duration === "number") {
    return duration;
  }

  return duration?.seconds || 0;
}

function getThumbnailUrl(
  thumbnail: MusicItemThumbnail | undefined,
  fallbackUrl?: string,
): string | undefined {
  if (typeof thumbnail === "string" && thumbnail.trim()) {
    return thumbnail;
  }

  if (!thumbnail || typeof thumbnail !== "object") {
    return fallbackUrl;
  }

  const url = thumbnail.contents
    ?.find((item: { url?: string | null }) => item?.url?.trim())
    ?.url?.trim();
  return url || fallbackUrl;
}

function getAlbumSummary(album: MusicItemAlbum | undefined): TrackAlbum | undefined {
  const albumId = album?.id?.trim();
  const albumName = album?.name?.trim();

  if (!albumId || !albumName) {
    return undefined;
  }

  return {
    id: albumId,
    name: albumName,
  };
}

export function normalizeMusicSearchItem(item: MusicSearchItem): Track | null {
  const videoId = item.id?.trim();

  if (!videoId) {
    return null;
  }

  const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  return {
    videoId,
    title: item.title || "Unknown",
    artist: getItemArtistName(item.artists),
    duration: getDurationSeconds(item.duration),
    thumbnail: getThumbnailUrl(item.thumbnail, fallbackThumbnail),
    album: getAlbumSummary(item.album),
  };
}

function getItemArtistName(
  artists: MusicItemArtist[] | undefined,
  fallback: string = "Unknown",
): string {
  const names = artists
    ?.map((artist) => artist?.name?.trim())
    .filter((name): name is string => Boolean(name));

  if (names && names.length > 0) {
    return names.join(", ");
  }

  return fallback;
}

function getHeaderText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (value && typeof value === "object") {
    const maybeText = value as {
      text?: unknown;
      toString?: () => string;
    };

    if (typeof maybeText.text === "string") {
      const normalized = maybeText.text.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (typeof maybeText.toString === "function") {
      const normalized = maybeText.toString().trim();
      if (normalized.length > 0 && normalized !== "[object Object]") {
        return normalized;
      }
    }
  }

  return undefined;
}

function getHeaderAuthorName(header: unknown): string | undefined {
  if (!header || typeof header !== "object") {
    return undefined;
  }

  const authorName = (header as { author?: { name?: string } }).author?.name;
  if (typeof authorName !== "string") {
    return undefined;
  }

  const normalized = authorName.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getBrowseIdFromEndpointLike(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const directBrowseId = (value as { browseId?: unknown }).browseId;
  if (typeof directBrowseId === "string" && directBrowseId.trim()) {
    return directBrowseId.trim();
  }

  const endpointBrowseId = (
    value as {
      endpoint?: {
        payload?: {
          browseId?: unknown;
        };
      };
      navigationEndpoint?: {
        browseEndpoint?: {
          browseId?: unknown;
        };
      };
    }
  ).endpoint?.payload?.browseId;
  if (typeof endpointBrowseId === "string" && endpointBrowseId.trim()) {
    return endpointBrowseId.trim();
  }

  const navigationBrowseId = (
    value as {
      endpoint?: {
        payload?: {
          browseId?: unknown;
        };
      };
      navigationEndpoint?: {
        browseEndpoint?: {
          browseId?: unknown;
        };
      };
    }
  ).navigationEndpoint?.browseEndpoint?.browseId;
  if (typeof navigationBrowseId === "string" && navigationBrowseId.trim()) {
    return navigationBrowseId.trim();
  }

  return undefined;
}

function getArtistReferenceFromEntity(
  value: unknown,
): { name?: string; id?: string } {
  if (!value || typeof value !== "object") {
    return {};
  }

  return {
    name:
      getHeaderText((value as { name?: unknown }).name) ||
      getHeaderText(
        value as {
          title?: unknown;
          text?: unknown;
        },
      ),
    id: getBrowseIdFromEndpointLike(value),
  };
}

function pickArtistReference(
  ...references: Array<{ name?: string; id?: string }>
): { name?: string; id?: string } {
  for (const reference of references) {
    if (reference.name || reference.id) {
      return reference;
    }
  }

  return {};
}

function getPrimaryArtistReference(
  artists: Array<MusicEntityArtist | null | undefined> | undefined,
  fallback: { name?: string; id?: string } = {},
): { name?: string; id?: string } {
  for (const artist of artists || []) {
    const name = getHeaderText(artist?.name);
    const id = getBrowseIdFromEndpointLike(artist);

    if (name || id) {
      return {
        name,
        id,
      };
    }
  }

  return fallback;
}

function getAlbumHeaderArtistReference(
  header: unknown,
): { name?: string; id?: string } {
  if (!header || typeof header !== "object") {
    return {};
  }

  const authorReference = getArtistReferenceFromEntity(
    (header as { author?: unknown }).author,
  );
  if (authorReference.name || authorReference.id) {
    return authorReference;
  }

  const straplineReference = getArtistReferenceFromEntity(
    (header as {
      strapline_text_one?: unknown;
      straplineTextOne?: unknown;
    }).strapline_text_one,
  );
  if (straplineReference.name || straplineReference.id) {
    return straplineReference;
  }

  return getArtistReferenceFromEntity(
    (header as {
      strapline_text_one?: unknown;
      straplineTextOne?: unknown;
    }).straplineTextOne,
  );
}

function getAlbumHeaderArtistName(header: unknown): string | undefined {
  return getAlbumHeaderArtistReference(header).name;
}

function getHeaderThumbnailUrl(header: unknown): string | undefined {
  if (!header || typeof header !== "object") {
    return undefined;
  }

  const withThumbnail = header as {
    thumbnail?: { contents?: Array<{ url?: string }> } | null;
    thumbnails?: Array<{ url?: string }>;
  };

  const responsiveThumbnail = getThumbnailFromList(withThumbnail.thumbnail);
  if (responsiveThumbnail) {
    return responsiveThumbnail;
  }

  const detailThumbnail = getThumbnailFromList(withThumbnail.thumbnails);
  return detailThumbnail || undefined;
}

function getThumbnailFromList(
  thumbnails: ThumbnailLike,
  fallbackUrl?: string,
): string | undefined {
  if (!thumbnails) {
    return fallbackUrl;
  }

  if (Array.isArray(thumbnails)) {
    const validThumbnails = thumbnails.filter((item) => item?.url?.trim());

    if (validThumbnails.length === 0) {
      return fallbackUrl;
    }

    const sizedThumbnails = validThumbnails.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "width" in item &&
        "height" in item &&
        Number.isFinite((item as { width?: number | null }).width) &&
        Number.isFinite((item as { height?: number | null }).height),
    );

    const thumbnailUrl =
      sizedThumbnails.length > 0
        ? [...sizedThumbnails]
            .sort((left, right) => {
              const leftArea =
                Number((left as { width?: number | null }).width) *
                Number((left as { height?: number | null }).height);
              const rightArea =
                Number((right as { width?: number | null }).width) *
                Number((right as { height?: number | null }).height);
              return rightArea - leftArea;
            })[0]
            ?.url?.trim()
        : [...validThumbnails].reverse()[0]?.url?.trim();

    return thumbnailUrl || fallbackUrl;
  }

  return getThumbnailUrl(thumbnails, fallbackUrl);
}

function createArtistTrackItem(track: Track): DiscoverTrackItem {
  return {
    kind: "track",
    id: track.videoId,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId,
    thumbnail: track.thumbnail,
    duration: track.duration,
    presentation:
      track.album?.id || track.album?.name
        ? "song"
        : track.thumbnail && /(?:i\.ytimg\.com|img\.youtube\.com|ytimg\.com\/vi\/)/iu.test(track.thumbnail)
          ? "video"
          : "song",
    track,
  };
}

function createArtistCollectionItem(input: {
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

function normalizeArtistSectionId(title: string, index: number): string {
  return `artist-${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}-${index}`;
}

function normalizeArtistSectionItem(
  item: any,
  fallbackArtist: { name: string; id?: string },
): DiscoverItem | null {
  const itemType = getHeaderText(item?.item_type || item?.itemType)?.toLowerCase();
  const title = getHeaderText(item?.title) || getHeaderText(item?.name);
  const id = getHeaderText(item?.id);

  if (!title || !id) {
    return null;
  }

  const thumbnail =
    getThumbnailFromList(item?.thumbnail, undefined) ||
    getThumbnailFromList(item?.thumbnails, undefined);

  if (
    itemType === "song" ||
    itemType === "video" ||
    itemType === "non_music_track"
  ) {
    const artistReference = pickArtistReference(
      getPrimaryArtistReference(item?.artists),
      getPrimaryArtistReference(item?.authors),
      getArtistReferenceFromEntity(item?.author),
    );
    const track: Track = {
      videoId: id,
      title,
      artist: artistReference.name || fallbackArtist.name || "Unknown",
      artistId: artistReference.id || fallbackArtist.id,
      duration: getDurationSeconds(item?.duration),
      thumbnail: thumbnail || getVideoThumbnail(id),
      album:
        item?.album?.id && item?.album?.name
          ? {
              id: item.album.id,
              name: item.album.name,
            }
          : undefined,
    };

    return createArtistTrackItem(track);
  }

  if (itemType === "album" || itemType === "playlist") {
    const authorReference = pickArtistReference(
      getPrimaryArtistReference(item?.artists),
      getArtistReferenceFromEntity(item?.author),
    );
    const subtitle = [
      getHeaderText(item?.subtitle),
      getHeaderText(item?.year),
    ]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .join(" • ");

    return createArtistCollectionItem({
      kind: itemType,
      id,
      title,
      artist: authorReference.name || fallbackArtist.name || "Unknown",
      artistId: authorReference.id || fallbackArtist.id,
      thumbnail,
      trackCount: parseCountValue(item?.item_count),
      subtitle: subtitle || undefined,
    });
  }

  return null;
}

function normalizeArtistSection(
  section: any,
  index: number,
  fallbackArtist: { name: string; id?: string },
): ArtistSection | null {
  const title = getHeaderText(section?.header?.title) || getHeaderText(section?.title);
  if (!title) {
    return null;
  }

  const items = (section?.contents || [])
    .map((item: any) => normalizeArtistSectionItem(item, fallbackArtist))
    .filter((item: DiscoverItem | null): item is DiscoverItem => Boolean(item));

  if (items.length === 0) {
    return null;
  }

  return {
    id: normalizeArtistSectionId(title, index),
    title,
    subtitle:
      getHeaderText(section?.header?.strapline) ||
      getHeaderText(section?.bottom_text),
    items,
  };
}

function getAuthorName(
  value: unknown,
  fallback: string = "Unknown",
): string {
  const textValue = getHeaderText(value);
  if (textValue) {
    return textValue;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
  }

  if (value && typeof value === "object") {
    const maybeAuthor = value as {
      name?: unknown;
      toString?: () => string;
    };

    if (typeof maybeAuthor.name === "string" && maybeAuthor.name.trim()) {
      return maybeAuthor.name.trim();
    }

    if (typeof maybeAuthor.toString === "function") {
      const normalized = maybeAuthor.toString().trim();
      if (normalized.length > 0 && normalized !== "[object Object]") {
        return normalized;
      }
    }
  }

  return fallback;
}

function getCollectionArtistFromSubtitle(value: unknown): string | undefined {
  const subtitle = getHeaderText(value);
  if (!subtitle) {
    return undefined;
  }

  const candidate = subtitle.split(/\s*[•·]\s*/)[0]?.trim();
  if (!candidate) {
    return undefined;
  }

  if (/^\d+(\s*(首|首歌曲|songs?|tracks?|videos?|items?))?$/i.test(candidate)) {
    return undefined;
  }

  return candidate;
}

export function resolveCollectionArtist(input: {
  kind: SearchCollectionKind;
  author?: unknown;
  subtitle?: unknown;
  metadataArtist?: string;
  metadataUploader?: string;
  metadataChannel?: string;
  metadataCreator?: string;
  metadataPlaylistUploader?: string;
  fallbackTrackArtist?: string;
}): string {
  const candidates = [
    getAuthorName(input.author, ""),
    input.metadataArtist?.trim(),
    input.metadataUploader?.trim(),
    input.metadataChannel?.trim(),
    input.metadataCreator?.trim(),
    input.metadataPlaylistUploader?.trim(),
    getCollectionArtistFromSubtitle(input.subtitle),
  ];

  for (const candidate of candidates) {
    if (candidate && candidate !== "Unknown") {
      return candidate;
    }
  }

  if (
    input.kind === "mix" &&
    input.fallbackTrackArtist &&
    input.fallbackTrackArtist !== "Unknown"
  ) {
    return input.fallbackTrackArtist;
  }

  return "Unknown";
}

function getVideoThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function toTrackSearchResult(track: Track): TrackSearchResult {
  return {
    kind: "track",
    id: track.videoId,
    title: track.title,
    artist: track.artist,
    thumbnail: track.thumbnail,
    duration: track.duration,
    track,
  };
}

function toCollectionSearchResult(input: {
  kind: SearchCollectionKind;
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  trackCount: number;
  tracks: Track[];
  truncated: boolean;
  subtitle?: string;
}): CollectionSearchResult {
  return {
    kind: input.kind,
    id: input.id,
    title: input.title,
    artist: input.artist,
    thumbnail: input.thumbnail,
    trackCount: input.trackCount,
    tracks: input.tracks,
    truncated: input.truncated,
    subtitle: input.subtitle,
  };
}

function normalizeSearchVideo(video: SearchVideoItem): Track | null {
  const videoId = video.id?.trim() || video.video_id?.trim();
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title:
      typeof video.title === "string"
        ? video.title
        : getHeaderText(video.title) || "Unknown",
    artist: getAuthorName(video.author),
    duration: getDurationSeconds(video.duration),
    thumbnail: getThumbnailFromList(video.thumbnails, getVideoThumbnail(videoId)),
  };
}

function normalizePlaylistTrack(
  item: {
    id?: string;
    title?: unknown;
    author?: unknown;
    thumbnails?: Array<{ url?: string | null }>;
    duration?: { seconds?: number };
    is_playable?: boolean;
  },
  fallbackAlbum?: TrackAlbum,
): Track | null {
  const videoId = item.id?.trim();
  if (!videoId || item.is_playable === false) {
    return null;
  }

  return {
    videoId,
    title: getHeaderText(item.title) || "Unknown",
    artist: getAuthorName(item.author),
    duration: item.duration?.seconds || 0,
    thumbnail: getThumbnailFromList(item.thumbnails, getVideoThumbnail(videoId)),
    album: fallbackAlbum,
  };
}

function normalizeTrackFromBasicInfo(info: unknown, fallbackVideoId: string): Track {
  const basicInfo = (info as {
    basic_info?: {
      id?: string;
      title?: string;
      author?: string;
      duration?: number;
      channel?: { name?: string | null } | null;
      thumbnail?: Array<{ url?: string | null }>;
    };
  }).basic_info;

  const videoId = basicInfo?.id?.trim() || fallbackVideoId;
  const fallbackThumbnail = getVideoThumbnail(videoId);

  return {
    videoId,
    title: basicInfo?.title?.trim() || "Unknown",
    artist:
      basicInfo?.author?.trim() ||
      basicInfo?.channel?.name?.trim() ||
      "Unknown",
    duration: basicInfo?.duration || 0,
    thumbnail: getThumbnailFromList(basicInfo?.thumbnail, fallbackThumbnail),
  };
}

function normalizeTrackFromYtDlpEntry(
  entry: YtDlpEntry,
  fallbackAlbum?: TrackAlbum,
): Track | null {
  const parsedUrl = entry.url?.trim() ? parseYouTubeUrl(entry.url.trim()) : null;
  const videoId = entry.id?.trim() || parsedUrl?.videoId;
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title: entry.title?.trim() || "Unknown",
    artist:
      entry.artist?.trim() ||
      entry.uploader?.trim() ||
      entry.channel?.trim() ||
      "Unknown",
    duration: entry.duration || 0,
    thumbnail:
      entry.thumbnail?.trim() ||
      getThumbnailFromList(entry.thumbnails, getVideoThumbnail(videoId)),
    album: fallbackAlbum,
  };
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

  const count = Number.parseInt(digits, 10);
  return Number.isFinite(count) ? count : undefined;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

// 解析 LRC 格式歌詞
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const rawLine of lrc.split("\n")) {
    const match = lineRegex.exec(rawLine.trim());
    if (match) {
      const minutes = parseInt(match[1]!, 10);
      const seconds = parseInt(match[2]!, 10);
      const centiseconds = parseInt(match[3]!.padEnd(3, "0"), 10);
      const time = minutes * 60 + seconds + centiseconds / 1000;
      const text = match[4]!.trim();
      lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

const STREAM_URL_CACHE_TTL_MS = 10 * 60 * 1000;

export type YtDlpCommandResult = {
  stdout: string;
  stderr: string;
};

export type YtDlpCommandErrorDetails = {
  executable: string;
  args: string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cause?: unknown;
};

export class YtDlpCommandError extends Error {
  readonly details: YtDlpCommandErrorDetails;

  constructor(message: string, details: YtDlpCommandErrorDetails) {
    super(message);
    this.name = "YtDlpCommandError";
    this.details = details;
  }
}

class MusicService {
  private searchCache = new Map<string, SearchResult[]>();
  private lyricsCache = new Map<string, LyricLine[]>();
  private streamUrlCache = new Map<
    string,
    { result: StreamUrlResult; expiresAt: number }
  >();
  private streamUrlInFlight = new Map<string, Promise<StreamUrlResult>>();

  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    const cacheKey = `${normalizedQuery}:${limit}`;
    const collectionTrackLimit = 200;

    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey)!;
    }

    try {
      const parsedUrl = parseYouTubeUrl(normalizedQuery);
      if (parsedUrl) {
        const resolvedResults = await this.resolveUrlSearch(
          parsedUrl,
          collectionTrackLimit,
        );
        if (resolvedResults.length > 0) {
          this.searchCache.set(cacheKey, resolvedResults);
          log.info("URL search completed", {
            query: normalizedQuery,
            resultCount: resolvedResults.length,
          });
          return resolvedResults;
        }

        log.warn("URL search resolution returned no results, falling back to keyword search", {
          query: normalizedQuery,
        });
      }

      const keywordResults = await this.searchByKeyword(normalizedQuery, limit);
      this.searchCache.set(cacheKey, keywordResults);
      log.info("Search completed", {
        query: normalizedQuery,
        resultCount: keywordResults.length,
      });
      return keywordResults;
    } catch (error) {
      log.error("Search failed", {
        error: error instanceof Error ? error.message : String(error),
        query: normalizedQuery,
      });
      return [];
    }
  }

  private async searchByKeyword(
    query: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const yt = await getClient();
    const tracks: Track[] = [];
    const musicSearch = await yt.music.search(query, { type: "song" });
    const contents = (musicSearch as { songs?: { contents?: unknown[] } }).songs?.contents || [];

    for (const item of contents) {
      const normalizedTrack = normalizeMusicSearchItem(item as MusicSearchItem);
      if (!normalizedTrack) {
        continue;
      }

      tracks.push(normalizedTrack);
    }

    if (tracks.length === 0) {
      const search = await yt.search(query);
      const videos = (search as { videos?: SearchVideoItem[] }).videos || [];

      for (const video of videos) {
        const normalizedTrack = normalizeSearchVideo(video);
        if (!normalizedTrack) {
          continue;
        }

        tracks.push(normalizedTrack);
      }
    }

    return tracks.slice(0, limit).map(toTrackSearchResult);
  }

  private async resolveUrlSearch(
    parsedUrl: ParsedYouTubeUrl,
    limit: number,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (parsedUrl.videoId) {
      const track = await this.getTrackByVideoId(parsedUrl.videoId);
      if (track) {
        results.push(toTrackSearchResult(track));
      }
    }

    if (parsedUrl.collection) {
      const collection = await this.getCollectionSearchResult(
        parsedUrl.collection,
        parsedUrl.url,
        limit,
      );

      if (collection) {
        results.push(collection);
      }
    }

    return dedupeSearchResults(results);
  }

  private async getTrackByVideoId(videoId: string): Promise<Track | null> {
    try {
      const yt = await getClient();
      const info = await yt.getBasicInfo(videoId);
      return normalizeTrackFromBasicInfo(info, videoId);
    } catch (error) {
      log.warn("Failed to resolve track via youtubei.js, trying yt-dlp metadata fallback", {
        error: error instanceof Error ? error.message : String(error),
        videoId,
      });

      try {
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const metadata = await this.getYtDlpMetadata(youtubeUrl, {
          noPlaylist: true,
        });
        return normalizeTrackFromYtDlpEntry(metadata);
      } catch (fallbackError) {
        log.error("Failed to resolve track metadata", {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          videoId,
        });
        return null;
      }
    }
  }

  private async getCollectionSearchResult(
    collection: ParsedYouTubeCollection,
    url: string,
    limit: number,
  ): Promise<CollectionSearchResult | null> {
    if (collection.kind === "album" && collection.browseId) {
      const album = await this.getAlbum(collection.browseId);
      if (album && album.tracks.length > 0) {
        const tracks = album.tracks.slice(0, limit);
        return toCollectionSearchResult({
          kind: "album",
          id: collection.id,
          title: album.title,
          artist: album.artist,
          thumbnail: album.thumbnail,
          trackCount: album.tracks.length,
          tracks,
          truncated: album.tracks.length > limit,
          subtitle: album.trackSummary || album.subtitle,
        });
      }
    }

    if (collection.playlistId) {
      const playlistResult = await this.getPlaylistSearchResult(
        collection.playlistId,
        collection.kind,
        limit,
      );

      if (playlistResult) {
        return playlistResult;
      }
    }

    return this.getCollectionSearchResultViaYtDlp(url, collection.kind, limit);
  }

  private async getPlaylistSearchResult(
    playlistId: string,
    kind: SearchCollectionKind,
    limit: number,
  ): Promise<CollectionSearchResult | null> {
    try {
      const yt = await getClient();
      const playlist = await yt.getPlaylist(playlistId);
      const info = playlist.info as {
        title?: unknown;
        author?: unknown;
        thumbnails?: Array<{ url?: string | null }>;
        total_items?: string | number;
        subtitle?: unknown;
      };
      const title = getHeaderText(info.title) || "Unknown Playlist";
      const fallbackAlbum =
        kind === "album"
          ? {
              id: playlistId,
              name: title,
            }
          : undefined;
      const tracks = playlist.items
        .map((item) => normalizePlaylistTrack(item as unknown as {
          id?: string;
          title?: unknown;
          author?: unknown;
          thumbnails?: Array<{ url?: string | null }>;
          duration?: { seconds?: number };
          is_playable?: boolean;
        }, fallbackAlbum))
        .filter((track): track is Track => Boolean(track));

      if (tracks.length === 0) {
        return null;
      }

      const totalCount = parseCountValue(info.total_items) ?? tracks.length;
      const limitedTracks = tracks.slice(0, limit);
      const truncated =
        playlist.has_continuation || totalCount > limit || tracks.length > limit;

      return toCollectionSearchResult({
        kind,
        id: playlistId,
        title,
        artist: resolveCollectionArtist({
          kind,
          author: info.author,
          subtitle: info.subtitle,
          fallbackTrackArtist: limitedTracks[0]?.artist,
        }),
        thumbnail: getThumbnailFromList(info.thumbnails, limitedTracks[0]?.thumbnail),
        trackCount: Math.max(totalCount, limitedTracks.length),
        tracks: limitedTracks,
        truncated,
        subtitle: getHeaderText(info.subtitle),
      });
    } catch (error) {
      log.warn("Failed to resolve collection via youtubei.js playlist API", {
        error: error instanceof Error ? error.message : String(error),
        kind,
        playlistId,
      });
      return null;
    }
  }

  private async getCollectionSearchResultViaYtDlp(
    url: string,
    kind: SearchCollectionKind,
    limit: number,
  ): Promise<CollectionSearchResult | null> {
    try {
      const metadata = await this.getYtDlpMetadata(url, {
        flatPlaylist: true,
        maxPlaylistItems: limit,
      });
      const title = metadata.title?.trim() || "Unknown Collection";
      const collectionId = metadata.id?.trim() || url;
      const fallbackAlbum =
        kind === "album"
          ? {
              id: collectionId,
              name: title,
            }
          : undefined;
      const tracks = (metadata.entries || [])
        .map((entry) => (entry ? normalizeTrackFromYtDlpEntry(entry, fallbackAlbum) : null))
        .filter((track): track is Track => Boolean(track));

      if (tracks.length === 0) {
        return null;
      }

      const totalCount = parseCountValue(metadata.playlist_count) ?? tracks.length;
      return toCollectionSearchResult({
        kind,
        id: collectionId,
        title,
        artist: resolveCollectionArtist({
          kind,
          metadataArtist: metadata.artist,
          metadataUploader: metadata.uploader,
          metadataChannel: metadata.channel,
          metadataCreator: metadata.creator,
          metadataPlaylistUploader: metadata.playlist_uploader,
          fallbackTrackArtist: tracks[0]?.artist,
        }),
        thumbnail:
          metadata.thumbnail?.trim() ||
          getThumbnailFromList(metadata.thumbnails, tracks[0]?.thumbnail),
        trackCount: Math.max(totalCount, tracks.length),
        tracks,
        truncated: totalCount > tracks.length,
        subtitle: kind === "album" ? metadata.album?.trim() : undefined,
      });
    } catch (error) {
      log.error("Failed to resolve collection metadata via yt-dlp", {
        error: error instanceof Error ? error.message : String(error),
        kind,
        url,
      });
      return null;
    }
  }

  async getLyrics(
    trackName: string,
    artistName: string,
    duration?: number,
  ): Promise<LyricLine[]> {
    const cacheKey = `${trackName}::${artistName}`;

    if (this.lyricsCache.has(cacheKey)) {
      return this.lyricsCache.get(cacheKey)!;
    }

    try {
      const params = new URLSearchParams({
        track_name: trackName,
        artist_name: artistName,
        ...(duration ? { duration: String(Math.round(duration)) } : {}),
      });

      const response = await fetch(
        `https://lrclib.net/api/get?${params.toString()}`,
      );

      if (!response.ok) {
        if (response.status === 404) {
          log.debug("No lyrics found", { trackName, artistName });
          this.lyricsCache.set(cacheKey, []);
          return [];
        }
        throw new Error(`LRCLIB API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        syncedLyrics?: string;
        plainLyrics?: string;
      };

      const lyrics = data.syncedLyrics ? parseLrc(data.syncedLyrics) : [];

      this.lyricsCache.set(cacheKey, lyrics);
      log.info("Lyrics loaded", { trackName, syncedLines: lyrics.length });
      return lyrics;
    } catch (error) {
      log.error("Failed to fetch lyrics", {
        error: error instanceof Error ? error.message : String(error),
        trackName,
      });
      this.lyricsCache.set(cacheKey, []);
      return [];
    }
  }

  async getAlbum(albumId: string): Promise<AlbumDetails | null> {
    try {
      const yt = await getClient();
      const album = await yt.music.getAlbum(albumId);
      const title = getHeaderText(album.header?.title) || "Unknown Album";
      const headerArtistReference = getAlbumHeaderArtistReference(album.header);
      const headerArtist = headerArtistReference.name;
      const albumThumbnail = getHeaderThumbnailUrl(album.header);
      const tracks: Track[] = [];

      for (const item of album.contents as MusicSearchItem[]) {
        const videoId = item.id?.trim();

        if (!videoId) {
          continue;
        }

        const normalizedTrack: Track = {
          videoId,
          title: getHeaderText(item.title) || "Unknown",
          artist: getItemArtistName(item.artists, headerArtist || "Unknown"),
          artistId: headerArtistReference.id,
          duration: getDurationSeconds(item.duration),
          thumbnail:
            albumThumbnail ||
            getThumbnailUrl(item.thumbnail) ||
            `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          album: getAlbumSummary(item.album) ?? {
            id: albumId,
            name: title,
          },
        };

        tracks.push(normalizedTrack);
      }

      const albumArtist =
        headerArtist ||
        tracks.find((track) => track.artist !== "Unknown")?.artist ||
        "Unknown";

      return {
        id: albumId,
        title,
        artist: albumArtist,
        artistId: headerArtistReference.id,
        subtitle: getHeaderText(album.header?.subtitle),
        trackSummary: getHeaderText(album.header?.second_subtitle),
        thumbnail: albumThumbnail || tracks[0]?.thumbnail,
        tracks,
      };
    } catch (error) {
      log.error("Failed to get album", {
        error: error instanceof Error ? error.message : String(error),
        albumId,
      });
      return null;
    }
  }

  async getArtistDetails(artistId: string): Promise<ArtistDetails | null> {
    try {
      const yt = await getClient();
      const artist = await yt.music.getArtist(artistId);
      const artistHeader = artist.header as {
        thumbnail?: ThumbnailLike;
        thumbnails?: Array<{ url?: string | null }>;
        description?: unknown;
        subscription_button?: {
          subscribe_accessibility_label?: string;
        };
      } | null;
      const name = getHeaderText(artist.header?.title) || "Unknown Artist";
      const fallbackArtist = {
        id: artistId,
        name,
      };
      const sections = (artist.sections || [])
        .map((section: any, index: number) =>
          normalizeArtistSection(section, index, fallbackArtist),
        )
        .filter((section: ArtistSection | null): section is ArtistSection =>
          Boolean(section),
        );
      const heroImage =
        getHeaderThumbnailUrl(artistHeader) ||
        getThumbnailFromList(artistHeader?.thumbnail);
      const thumbnail =
        getThumbnailFromList(artistHeader?.thumbnail, heroImage) ||
        getThumbnailFromList(artistHeader?.thumbnails, heroImage) ||
        heroImage;
      const subscriptionLabel =
        artistHeader?.subscription_button?.subscribe_accessibility_label;
      const subscriberCount = subscriptionLabel
        ?.replace(/^.*?(\d[\d.,萬KMB\s]*)$/, "$1")
        ?.trim();

      return {
        id: artistId,
        name,
        description: getHeaderText(artistHeader?.description),
        subscriberCount:
          subscriberCount && subscriberCount !== subscriptionLabel
            ? subscriberCount
            : undefined,
        thumbnail,
        heroImage,
        sections,
      };
    } catch (error) {
      log.error("Failed to get artist details", {
        error: error instanceof Error ? error.message : String(error),
        artistId,
      });
      return null;
    }
  }

  async getPlaylistDetails(
    playlistId: string,
    limit: number = 200,
  ): Promise<PlaylistDetails | null> {
    try {
      const yt = await getClient();
      const playlist = await yt.getPlaylist(playlistId);
      const info = playlist.info as {
        title?: unknown;
        author?: unknown;
        thumbnails?: Array<{ url?: string | null }>;
        total_items?: string | number;
        subtitle?: unknown;
      };
      const title = getHeaderText(info.title) || "Unknown Playlist";
      const authorReference = getArtistReferenceFromEntity(info.author);
      const tracks = playlist.items
        .map((item) =>
          normalizePlaylistTrack(
            item as unknown as {
              id?: string;
              title?: unknown;
              author?: unknown;
              thumbnails?: Array<{ url?: string | null }>;
              duration?: { seconds?: number };
              is_playable?: boolean;
            },
          ),
        )
        .filter((track): track is Track => Boolean(track));

      if (tracks.length === 0) {
        return null;
      }

      const totalCount = parseCountValue(info.total_items) ?? tracks.length;
      const limitedTracks = tracks.slice(0, limit);
      const resolvedCount = Math.max(totalCount, limitedTracks.length);

      return {
        id: playlistId,
        title,
        artist: resolveCollectionArtist({
          kind: "playlist",
          author: info.author,
          subtitle: info.subtitle,
          fallbackTrackArtist: limitedTracks[0]?.artist,
        }),
        artistId: authorReference.id,
        subtitle: getHeaderText(info.subtitle),
        trackSummary: `${resolvedCount} 首歌曲`,
        thumbnail: getThumbnailFromList(
          info.thumbnails,
          limitedTracks[0]?.thumbnail,
        ),
        tracks: limitedTracks,
        truncated:
          playlist.has_continuation ||
          totalCount > limit ||
          tracks.length > limit,
      };
    } catch (error) {
      log.error("Failed to get playlist details", {
        error: error instanceof Error ? error.message : String(error),
        playlistId,
      });
      return null;
    }
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    try {
      const yt = await getClient();
      const playlist = await yt.getPlaylist(playlistId);
      const tracks = playlist.items
        .map((item) =>
          normalizePlaylistTrack(
            item as unknown as {
              id?: string;
              title?: unknown;
              author?: unknown;
              thumbnails?: Array<{ url?: string | null }>;
              duration?: { seconds?: number };
              is_playable?: boolean;
            },
          ),
        )
        .filter((track): track is Track => Boolean(track));

      if (tracks.length > 0) {
        return tracks;
      }
    } catch (error) {
      log.warn("Failed to resolve playlist via youtubei.js, trying yt-dlp metadata fallback", {
        error: error instanceof Error ? error.message : String(error),
        playlistId,
      });
    }

    try {
      const normalizedPlaylistId = playlistId.replace(/^VL/, "");
      const metadata = await this.getYtDlpMetadata(
        `https://music.youtube.com/playlist?list=${normalizedPlaylistId}`,
        {
          flatPlaylist: true,
          maxPlaylistItems: 200,
        },
      );

      return (metadata.entries || [])
        .map((entry) =>
          entry ? normalizeTrackFromYtDlpEntry(entry) : null,
        )
        .filter((track): track is Track => Boolean(track));
    } catch (fallbackError) {
      log.error("Failed to resolve playlist metadata", {
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
        playlistId,
      });
      return [];
    }
  }

  /**
   * 獲取直接串流 URL
   *
   * 注意：由於 YouTube API 問題 (GitHub Issue #1123)，目前無法獲取直接 URL。
   * 此方法會嘗試提取，失敗後由 queue.service.ts 的 fallback 機制處理（使用 yt-dlp）。
   *
   * @see https://github.com/LuanRT/YouTube.js/issues/1123
   */
  async getStreamUrl(videoId: string): Promise<StreamUrlResult> {
    const cachedEntry = this.streamUrlCache.get(videoId);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return {
        ...cachedEntry.result,
      };
    }

    if (cachedEntry) {
      this.streamUrlCache.delete(videoId);
    }

    const inFlight = this.streamUrlInFlight.get(videoId);
    if (inFlight) {
      return inFlight.then((result) => ({ ...result }));
    }

    const request = this.extractStreamUrl(videoId)
      .then((result) => {
        this.streamUrlCache.set(videoId, {
          result,
          expiresAt: Date.now() + STREAM_URL_CACHE_TTL_MS,
        });
        return result;
      })
      .finally(() => {
        this.streamUrlInFlight.delete(videoId);
      });

    this.streamUrlInFlight.set(videoId, request);
    return request.then((result) => ({ ...result }));
  }

  private async extractStreamUrl(videoId: string): Promise<StreamUrlResult> {
    log.info("Attempting stream URL extraction", { videoId });

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      const yt = await getClient();

      // 嘗試 getStreamingData（應該返回已解密的 URL）
      try {
        const format = await yt.getStreamingData(videoId, {
          type: "audio",
          quality: "best",
        });

        const formatAny = format as any;
        if (formatAny?.url && formatAny.url.length > 0) {
          log.info("Stream URL obtained", {
            bitrate: formatAny.bitrate,
            urlLength: formatAny.url.length,
            source: "youtubei",
          });
          return {
            url: formatAny.url,
            source: "youtubei",
            bitrate: formatAny.bitrate,
          };
        }

        log.warn("youtubei.js getStreamingData returned no direct URL", {
          videoId,
          hasFormat: Boolean(formatAny),
          hasCipher: Boolean(formatAny?.cipher || formatAny?.signature_cipher),
          itag: formatAny?.itag,
          mimeType: formatAny?.mime_type ?? formatAny?.mimeType,
        });
      } catch (e) {
        log.warn("youtubei.js getStreamingData failed", {
          error: e instanceof Error ? e.message : String(e),
          errorName: e instanceof Error ? e.name : typeof e,
          videoId,
        });
      }

      // Fallback: getInfo + chooseFormat
      const info = await yt.getInfo(videoId);
      const format = info.chooseFormat({ type: "audio", quality: "best" });

      if (format?.url) {
        const url = yt.session?.player?.decipher
          ? await yt.session.player.decipher(format.url)
          : format.url;

        if (url && url.length > 0) {
          log.info("Stream URL obtained via chooseFormat", {
            bitrate: format.bitrate,
            source: "youtubei",
          });
          return {
            url,
            source: "youtubei",
            bitrate: format.bitrate,
          };
        }
      }

      log.warn("youtubei.js chooseFormat returned no direct URL", {
        videoId,
        hasFormat: Boolean(format),
        hasCipher: Boolean(
          (format as any)?.cipher || (format as any)?.signature_cipher,
        ),
        itag: format?.itag,
        mimeType: (format as any)?.mime_type ?? (format as any)?.mimeType,
      });
      throw new Error("No suitable audio stream found");
    } catch (error) {
      log.warn("Primary stream extraction failed, trying yt-dlp CLI fallback", {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : typeof error,
        videoId,
      });

      const fallbackUrl = await this.getStreamUrlViaYtDlp(youtubeUrl);
      return {
        url: fallbackUrl,
        source: "yt-dlp",
      };
    }
  }

  private async getStreamUrlViaYtDlp(url: string): Promise<string> {
    const { stdout } = await this.runYtDlpCommand(getYtDlpCliArgs(url));
    const streamUrl = parseYtDlpStreamUrlOutput(stdout);

    log.info("Stream URL obtained via yt-dlp CLI", {
      source: "yt-dlp",
      urlLength: streamUrl.length,
      lineCount: stdout.split("\n").filter((line) => line.trim()).length,
    });

    return streamUrl;
  }

  private async getYtDlpMetadata(
    url: string,
    options: {
      flatPlaylist?: boolean;
      maxPlaylistItems?: number;
      noPlaylist?: boolean;
    } = {},
  ): Promise<YtDlpMetadata> {
    const { stdout } = await this.runYtDlpCommand(getYtDlpMetadataArgs(url, options));

    try {
      return JSON.parse(stdout) as YtDlpMetadata;
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `yt-dlp metadata JSON parse failed: ${error.message}`
          : "yt-dlp metadata JSON parse failed",
      );
    }
  }

  private async runYtDlpCommand(
    args: string[],
  ): Promise<YtDlpCommandResult> {
    return new Promise<YtDlpCommandResult>((resolve, reject) => {
      const executable = getYtDlpExecutable();
      const timeoutMs = getYtDlpCommandTimeoutMs();
      const child = spawn(executable, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      const finishWithError = (error: YtDlpCommandError) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        const hint = getYtDlpFailureHint(error.message);
        if (hint) {
          error.message = `${error.message} ${hint}`;
        }

        log.warn("yt-dlp command failed", {
          executable,
          args,
          exitCode: error.details.exitCode,
          signal: error.details.signal,
          timedOut: error.details.timedOut,
          stderr: error.details.stderr,
          stdout: error.details.stdout,
          error: error.message,
        });
        reject(error);
      };

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        finishWithError(
          new YtDlpCommandError(`Failed to start yt-dlp: ${error.message}`, {
            executable,
            args,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            timedOut,
            cause: error,
          }),
        );
      });

      child.on("exit", (code, signal) => {
        if (settled) {
          return;
        }
        clearTimeout(timeout);

        if (code !== 0) {
          const stderrText = stderr.trim();
          const stdoutText = stdout.trim();
          const message = timedOut
            ? `yt-dlp timed out after ${timeoutMs}ms`
            : stderrText ||
              stdoutText ||
              `yt-dlp exited with code ${code ?? "unknown"}`;
          finishWithError(
            new YtDlpCommandError(message, {
              executable,
              args,
              exitCode: code,
              signal,
              stdout: stdoutText,
              stderr: stderrText,
              timedOut,
            }),
          );
          return;
        }

        settled = true;
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  }

  /**
   * 獲取混合播放清單（類似 YouTube Music 的 Mix/電台功能）
   */
  async getMixTracks(videoId: string, limit: number = 15): Promise<Track[]> {
    log.info("Getting mix tracks", { videoId, limit });

    try {
      const yt = await getClient();
      const panel = await yt.music.getUpNext(videoId, true);
      const tracks = normalizeMixTracks(panel.contents || [], videoId, limit);

      log.info("Mix tracks fetched", { count: tracks.length });
      return tracks;
    } catch (error) {
      log.error("Failed to get mix tracks", { error });
      return [];
    }
  }
}

// 單例模式
let musicServiceInstance: MusicService | null = null;

export function getMusicService(): MusicService {
  if (!musicServiceInstance) {
    musicServiceInstance = new MusicService();
  }
  return musicServiceInstance;
}

export function __resetMusicServiceForTests(): void {
  musicServiceInstance = null;
  ytClient = null;
}

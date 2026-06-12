export type QueueOrigin = "manual" | "mix" | "radio" | "playlist";

export interface TrackRequester {
  profileId: string;
  profileName: string;
}

export type DiscoverMarketCode =
  | "TW"
  | "US"
  | "JP"
  | "KR"
  | "GB"
  | "DE"
  | "BR"
  | "MX";

export type DiscoverCollectionKind = "album" | "playlist";
export type ReleaseNotesSectionCategory = "added" | "changed" | "fixed";
export type ReleaseNotesStatus = "released" | "preview";
export type ReleaseNotesSource = "github" | "fallback" | "hybrid";

export interface TrackAlbum {
  id: string;
  name: string;
}

export type SearchCollectionKind = "album" | "playlist" | "mix";

// 歌曲資訊
export interface Track {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string;
  duration: number; // 秒
  thumbnail?: string;
  album?: TrackAlbum;
  requestedBy?: TrackRequester;
  queueOrigin?: QueueOrigin;
  radioGenerated?: boolean;
}

export interface AlbumDetails {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  subtitle?: string;
  trackSummary?: string;
  thumbnail?: string;
  tracks: Track[];
}

export interface PlaylistDetails {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  subtitle?: string;
  trackSummary?: string;
  thumbnail?: string;
  tracks: Track[];
  truncated?: boolean;
}

export interface ArtistSection {
  id: string;
  title: string;
  subtitle?: string;
  items: DiscoverItem[];
}

export interface ArtistDetails {
  id: string;
  name: string;
  description?: string;
  subscriberCount?: string;
  thumbnail?: string;
  heroImage?: string;
  sections: ArtistSection[];
}

export interface TrackSearchResult {
  kind: "track";
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration: number;
  track: Track;
}

export interface CollectionSearchResult {
  kind: SearchCollectionKind;
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  trackCount: number;
  tracks: Track[];
  truncated: boolean;
  subtitle?: string;
}

export type SearchResult = TrackSearchResult | CollectionSearchResult;

export interface DiscoverMarket {
  code: DiscoverMarketCode;
  label: string;
  lang: string;
}

export interface DiscoverMood {
  key: string;
  label: string;
}

export type DiscoverTrackPresentation = "song" | "video";

export interface DiscoverTrackItem {
  kind: "track";
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  thumbnail?: string;
  duration: number;
  presentation: DiscoverTrackPresentation;
  track: Track;
}

export interface DiscoverCollectionItem {
  kind: DiscoverCollectionKind;
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  thumbnail?: string;
  trackCount?: number;
  subtitle?: string;
}

export type DiscoverItem = DiscoverTrackItem | DiscoverCollectionItem;

export interface DiscoverSection {
  id: string;
  title: string;
  subtitle?: string;
  origin?: "personal" | "market";
  items: DiscoverItem[];
}

export interface TopRequestedEntry {
  rank: number;
  requestCount: number;
  lastRequestedAt: string;
  track: Track;
}

export interface DiscoverMarketsResponse {
  markets: DiscoverMarket[];
  defaultMarket: DiscoverMarketCode;
  topRequested: TopRequestedEntry[];
}

export interface DiscoverFeedResponse {
  market: DiscoverMarketCode;
  moods: DiscoverMood[];
  selectedMood: DiscoverMood | null;
  sections: DiscoverSection[];
  warnings: string[];
  fetchedAt: string;
}

export interface ReleaseNotesSection {
  category: ReleaseNotesSectionCategory;
  title: string;
  description?: string;
  items: string[];
}

export interface ReleaseNotesEntry {
  version: string;
  title: string;
  publishedAt: string;
  status: ReleaseNotesStatus;
  summary?: string;
  sections: ReleaseNotesSection[];
}

export interface ReleaseNotesRepositoryInfo {
  owner: string;
  name: string;
  url: string;
}

export interface ReleaseNotesResponse {
  currentVersion: string;
  currentRelease: ReleaseNotesEntry | null;
  releases: ReleaseNotesEntry[];
  source: ReleaseNotesSource;
  fetchedAt: string;
  warnings: string[];
  repository: ReleaseNotesRepositoryInfo;
}

// 歌詞行
export interface LyricLine {
  text: string;
  time: number; // 秒
}

export interface PlaybackSettings {
  crossfadeEnabled: boolean;
  crossfadeDurationSeconds: number;
  volumeNormalizationEnabled: boolean;
}

// 播放狀態
export interface PlaybackState {
  isPlaying: boolean;
  currentTrack: Track | null;
  position: number; // 當前播放位置（秒）
  duration: number; // 總時長（秒）
  volume: number; // 0-100
  queue: Track[];
  radioEnabled: boolean;
  lastPlayedTrack: Track | null;
  playbackSettings: PlaybackSettings;
}

export interface PlaybackProgress {
  trackId: string | null;
  position: number; // 當前播放位置（秒）
  duration: number; // 總時長（秒）
  isPlaying: boolean;
}

// WebSocket 訊息類型
export type WSMessage =
  | { type: "track_loading"; track: Track | null; message?: string }
  | { type: "track_ready"; track: Track }
  | { type: "now_playing"; track: Track; position: number; duration: number }
  | { type: "queue_updated"; queue: Track[] }
  | { type: "lyrics"; lyrics: LyricLine[] }
  | { type: "track_ended" }
  | { type: "playback_state"; state: PlaybackState }
  | { type: "playback_progress"; progress: PlaybackProgress }
  | { type: "play_error"; error: string; track: Track | null }
  | { type: "play" }
  | { type: "pause" }
  | { type: "skip" }
  | { type: "volume"; value: number }
  | { type: "seek"; value: number };

// API 回應格式
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// 串流 URL 結果
export interface StreamUrlResult {
  url: string;
  source: "youtubei" | "invidious" | "yt-dlp";
  bitrate?: number;
}

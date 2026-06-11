import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Heart, Loader2, PlayCircle, Radio } from "lucide-react";
import { OpenAlbumButton } from "@/components/album/OpenAlbumButton";
import { OpenArtistButton } from "@/components/artist/OpenArtistButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAlbumDialogStore } from "@/stores/albumDialogStore";
import { useArtistDialogStore } from "@/stores/artistDialogStore";
import {
  ThumbnailQuality,
  type ThumbnailQuality as ThumbnailQualityType,
  getOptimizedThumbnailCandidates,
} from "@/utils/thumbnail";
import { formatTime } from "@/utils/format";
import type { DiscoverTrackItem, Track } from "@/types";

type MusicVideoHeroRailProps = {
  title: string;
  subtitle?: string;
  items: DiscoverTrackItem[];
  onQueueTrack: (track: Track) => Promise<void>;
  onCreateMix: (track: Track) => Promise<void>;
  onToggleFavorite: (track: Track) => Promise<void>;
  pendingTrackId: string | null;
  creatingMixId: string | null;
  favoriteTrackIds: ReadonlySet<string>;
  favoriteDisabled: boolean;
};

type Destination = {
  label: string | null;
  onOpen: (() => void) | null;
};

function getDisplayDuration(item: DiscoverTrackItem): number {
  return item.duration > 0 ? item.duration : item.track.duration > 0 ? item.track.duration : 0;
}

function getTrackDestination(
  item: DiscoverTrackItem,
  openAlbum: (album: Track["album"]) => void,
  openArtist: (artist: { id: string; name: string }) => void,
): Destination {
  const album = item.track.album;
  const artistId = item.artistId || item.track.artistId;

  if (album?.id && album.name) {
    return {
      label: "展開專輯",
      onOpen: () => openAlbum(album),
    };
  }

  if (artistId?.trim() && item.artist.trim()) {
    return {
      label: "探索歌手",
      onOpen: () =>
        openArtist({
          id: artistId,
          name: item.artist,
        }),
    };
  }

  return {
    label: null,
    onOpen: null,
  };
}

function MediaArtwork({
  item,
  className,
  preferredQuality = ThumbnailQuality.HIGH,
}: {
  item: DiscoverTrackItem;
  className?: string;
  preferredQuality?: ThumbnailQualityType;
}) {
  const imageSrc = item.thumbnail || item.track.thumbnail;
  const [hasError, setHasError] = useState(false);
  const [failedCandidates, setFailedCandidates] = useState<string[]>([]);
  const candidateSources = useMemo(
    () =>
      imageSrc
        ? getOptimizedThumbnailCandidates(imageSrc, preferredQuality)
        : [],
    [imageSrc, preferredQuality],
  );
  const optimizedSrc = useMemo(
    () =>
      candidateSources.find((candidate) => !failedCandidates.includes(candidate)) ||
      imageSrc,
    [candidateSources, failedCandidates, imageSrc],
  );

  useEffect(() => {
    setHasError(false);
    setFailedCandidates([]);
  }, [candidateSources, imageSrc]);

  if (optimizedSrc && !hasError) {
    return (
      <img
        src={optimizedSrc}
        alt={item.title}
        className={cn("discover-artwork-media h-full w-full object-cover", className)}
        decoding="async"
        loading="lazy"
        draggable={false}
        onError={() => {
          if (candidateSources.length > 0 && !failedCandidates.includes(optimizedSrc)) {
            setFailedCandidates((previous) => [...previous, optimizedSrc]);
            return;
          }

          setHasError(true);
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "h-full w-full bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.2),_transparent_38%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(15,23,42,0.78)_46%,_rgba(151,54,76,0.78)_100%)]",
        className,
      )}
    />
  );
}

function FeaturedVideoCard({
  item,
  onQueueTrack,
  onCreateMix,
  onToggleFavorite,
  isPending,
  isCreatingMix,
  isFavorite,
  favoriteDisabled,
}: {
  item: DiscoverTrackItem;
  onQueueTrack: (track: Track) => Promise<void>;
  onCreateMix: (track: Track) => Promise<void>;
  onToggleFavorite: (track: Track) => Promise<void>;
  isPending: boolean;
  isCreatingMix: boolean;
  isFavorite: boolean;
  favoriteDisabled: boolean;
}) {
  const openAlbum = useAlbumDialogStore((state) => state.openAlbum);
  const openArtist = useArtistDialogStore((state) => state.openArtist);
  const destination = getTrackDestination(item, openAlbum, openArtist);
  const duration = getDisplayDuration(item);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border p-0">
      <button
        type="button"
        onClick={() => destination.onOpen?.()}
        disabled={!destination.onOpen}
        className={cn(
          "group relative block min-h-0 flex-1 overflow-hidden text-left",
          destination.onOpen ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="discover-rail-card-media relative h-full min-h-[220px] overflow-hidden bg-[var(--surface-subtle)] aspect-[16/9] sm:min-h-[280px] lg:min-h-[320px] xl:aspect-auto">
          <MediaArtwork
            item={item}
            preferredQuality={ThumbnailQuality.MAXRES}
            className={cn(
              "transition-transform duration-500",
              destination.onOpen && "group-hover:scale-[1.03]",
            )}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(9,14,24,0.10)_0%,_rgba(9,14,24,0.28)_34%,_rgba(9,14,24,0.82)_100%)]" />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 lg:p-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-black/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90 backdrop-blur-md">
              Music Video
            </span>
            <span className="rounded-full border border-white/14 bg-black/25 px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur-md">
              {formatTime(duration)}
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-4 lg:p-5">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/14 bg-white/12 text-white shadow-[0_18px_38px_-24px_rgba(0,0,0,0.75)] backdrop-blur-sm">
              <PlayCircle className="h-6 w-6 fill-white/90 text-white" />
            </div>
            <div className="mt-4 max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Featured Visual
              </p>
              <h3 className="mt-2 line-clamp-2 text-[1.35rem] font-semibold leading-tight tracking-tight text-white sm:text-[1.55rem] lg:text-[2.05rem]">
                {item.title}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/82 lg:text-base">
                {item.artist}
              </p>
            </div>

            {destination.label ? (
              <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/16 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/92 backdrop-blur-sm">
                {destination.label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </div>
            ) : null}
          </div>
        </div>
      </button>

      <div className="space-y-3 border-t border-[color:var(--surface-border)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.9),_rgba(255,255,255,0.74))] p-4 lg:p-5 dark:bg-[linear-gradient(180deg,_rgba(14,18,28,0.92),_rgba(14,18,28,0.82))]">
        <div className="flex flex-wrap items-center gap-2">
          {item.track.album ? (
            <OpenAlbumButton
              album={item.track.album}
              trackTitle={item.track.title}
              className="rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              labelClassName="text-xs"
            />
          ) : null}
          <OpenArtistButton
            artistId={item.artistId || item.track.artistId}
            artistName={item.artist}
            className="rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            labelClassName="text-xs"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Button
            type="button"
            onClick={() => {
              void onQueueTrack(item.track);
            }}
            disabled={isPending || isCreatingMix}
            className="rounded-[18px]"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                加入中
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4" />
                加入佇列
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onCreateMix(item.track);
            }}
            disabled={isPending || isCreatingMix}
            className="rounded-[18px]"
          >
            {isCreatingMix ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                建立中
              </>
            ) : (
              <>
                <Radio className="h-4 w-4" />
                建立 Mix
              </>
            )}
          </Button>
          <Button
            type="button"
            variant={isFavorite ? "default" : "ghost"}
            onClick={() => {
              void onToggleFavorite(item.track);
            }}
            disabled={favoriteDisabled}
            className="rounded-[18px] px-4 sm:px-5"
          >
            <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
            {isFavorite ? "已收藏" : "收藏"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SupportingVideoCard({
  item,
  onQueueTrack,
  onCreateMix,
  onToggleFavorite,
  isPending,
  isCreatingMix,
  isFavorite,
  favoriteDisabled,
}: {
  item: DiscoverTrackItem;
  onQueueTrack: (track: Track) => Promise<void>;
  onCreateMix: (track: Track) => Promise<void>;
  onToggleFavorite: (track: Track) => Promise<void>;
  isPending: boolean;
  isCreatingMix: boolean;
  isFavorite: boolean;
  favoriteDisabled: boolean;
}) {
  const openAlbum = useAlbumDialogStore((state) => state.openAlbum);
  const openArtist = useArtistDialogStore((state) => state.openArtist);
  const destination = getTrackDestination(item, openAlbum, openArtist);
  const duration = getDisplayDuration(item);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border p-0">
      <button
        type="button"
        onClick={() => destination.onOpen?.()}
        disabled={!destination.onOpen}
        className={cn(
          "group block min-h-0 flex-1 text-left",
          destination.onOpen ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="discover-rail-card-media relative h-full min-h-[176px] overflow-hidden aspect-[16/9] xl:aspect-auto">
          <MediaArtwork
            item={item}
            className={cn(
              "transition-transform duration-500",
              destination.onOpen && "group-hover:scale-[1.04]",
            )}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(9,14,24,0.04)_0%,_rgba(9,14,24,0.22)_46%,_rgba(9,14,24,0.76)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/85">
              <span className="rounded-full border border-white/14 bg-black/25 px-2.5 py-1 backdrop-blur-sm">
                Video
              </span>
              <span>{formatTime(duration)}</span>
            </div>
            <h3 className="mt-3 line-clamp-2 text-lg font-semibold leading-6 text-white">
              {item.title}
            </h3>
            <p className="mt-1 line-clamp-1 text-sm text-white/76">{item.artist}</p>
          </div>
        </div>
      </button>

      <div className="space-y-3 border-t border-[color:var(--surface-border)]/75 bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(255,255,255,0.8))] p-4 dark:bg-[linear-gradient(180deg,_rgba(14,18,28,0.92),_rgba(14,18,28,0.84))]">
        <div className="flex flex-wrap items-center gap-2">
          {item.track.album ? (
            <OpenAlbumButton
              album={item.track.album}
              trackTitle={item.track.title}
              className="rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              labelClassName="text-[11px]"
            />
          ) : null}
          <OpenArtistButton
            artistId={item.artistId || item.track.artistId}
            artistName={item.artist}
            className="rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            labelClassName="text-[11px]"
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <Button
            type="button"
            onClick={() => {
              void onQueueTrack(item.track);
            }}
            disabled={isPending || isCreatingMix}
            className="rounded-[16px]"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            {isPending ? "加入中" : "加入"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onCreateMix(item.track);
            }}
            disabled={isPending || isCreatingMix}
            className="rounded-[16px]"
          >
            {isCreatingMix ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Radio className="h-4 w-4" />
            )}
            {isCreatingMix ? "建立中" : "Mix"}
          </Button>
          <Button
            type="button"
            variant={isFavorite ? "default" : "ghost"}
            onClick={() => {
              void onToggleFavorite(item.track);
            }}
            disabled={favoriteDisabled}
            className="rounded-[16px] px-3"
          >
            <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CompactVideoCard({
  item,
  onQueueTrack,
  isPending,
}: {
  item: DiscoverTrackItem;
  onQueueTrack: (track: Track) => Promise<void>;
  isPending: boolean;
}) {
  const openAlbum = useAlbumDialogStore((state) => state.openAlbum);
  const openArtist = useArtistDialogStore((state) => state.openArtist);
  const destination = getTrackDestination(item, openAlbum, openArtist);
  const duration = getDisplayDuration(item);

  return (
    <Card className="w-[216px] shrink-0 overflow-hidden rounded-[26px] border p-0 sm:w-[224px]">
      <button
        type="button"
        onClick={() => destination.onOpen?.()}
        disabled={!destination.onOpen}
        className={cn(
          "group block w-full text-left",
          destination.onOpen ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="discover-rail-card-media relative aspect-[16/9] overflow-hidden">
          <MediaArtwork
            item={item}
            className={cn(
              "transition-transform duration-500",
              destination.onOpen && "group-hover:scale-[1.05]",
            )}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(9,14,24,0.04)_0%,_rgba(9,14,24,0.14)_35%,_rgba(9,14,24,0.72)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="line-clamp-2 text-sm font-semibold leading-5 text-white">
              {item.title}
            </p>
          </div>
        </div>
      </button>

      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--surface-border)]/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(255,255,255,0.8))] p-4 dark:bg-[linear-gradient(180deg,_rgba(14,18,28,0.92),_rgba(14,18,28,0.84))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">
            {item.artist}
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {formatTime(duration)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void onQueueTrack(item.track);
          }}
          disabled={isPending}
          className="rounded-full px-3"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {isPending ? "加入中" : "加入"}
        </Button>
      </div>
    </Card>
  );
}

export const MusicVideoHeroRail = ({
  title,
  subtitle,
  items,
  onQueueTrack,
  onCreateMix,
  onToggleFavorite,
  pendingTrackId,
  creatingMixId,
  favoriteTrackIds,
  favoriteDisabled,
}: MusicVideoHeroRailProps) => {
  const [featuredItem, ...remainingItems] = items;
  const supportingItems = remainingItems.slice(0, 2);
  const overflowItems = remainingItems.slice(2);
  const hasBalancedDesktopGrid = supportingItems.length === 2;

  if (!featuredItem) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] text-[var(--accent)]">
              <PlayCircle className="h-4 w-4" />
            </span>
            <span>{title}</span>
          </div>
          <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
            {subtitle || "用更大的畫面先看封面與視覺氛圍，再決定要不要把這支 MV 放進你的播放流程。"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.16fr)_minmax(300px,340px)] xl:items-stretch">
        <FeaturedVideoCard
          item={featuredItem}
          onQueueTrack={onQueueTrack}
          onCreateMix={onCreateMix}
          onToggleFavorite={onToggleFavorite}
          isPending={pendingTrackId === featuredItem.track.videoId}
          isCreatingMix={creatingMixId === featuredItem.track.videoId}
          isFavorite={favoriteTrackIds.has(featuredItem.track.videoId)}
          favoriteDisabled={favoriteDisabled}
        />

        {supportingItems.length > 0 ? (
          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2 xl:grid-cols-1",
              hasBalancedDesktopGrid
                ? "xl:h-full xl:grid-rows-2"
                : "xl:self-start",
            )}
          >
            {supportingItems.map((item) => (
              <SupportingVideoCard
                key={item.track.videoId}
                item={item}
                onQueueTrack={onQueueTrack}
                onCreateMix={onCreateMix}
                onToggleFavorite={onToggleFavorite}
                isPending={pendingTrackId === item.track.videoId}
                isCreatingMix={creatingMixId === item.track.videoId}
                isFavorite={favoriteTrackIds.has(item.track.videoId)}
                favoriteDisabled={favoriteDisabled}
              />
            ))}
          </div>
        ) : null}
      </div>

      {overflowItems.length > 0 ? (
        <div className="-mx-3 overflow-visible px-3 pt-4 pb-10">
          <div className="overflow-x-auto overflow-y-hidden pt-1 pb-6">
            <div className="flex min-w-full gap-4 px-px">
              {overflowItems.map((item) => (
                <CompactVideoCard
                  key={item.track.videoId}
                  item={item}
                  onQueueTrack={onQueueTrack}
                  isPending={pendingTrackId === item.track.videoId}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

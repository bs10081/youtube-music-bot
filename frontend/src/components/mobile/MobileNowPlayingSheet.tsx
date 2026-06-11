import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { AnimatedAvatar } from "@/components/ui/animated-avatar";
import { useToast } from "@/components/ui/toast";
import { ProgressBar } from "@/components/player/ProgressBar";
import { PlaybackControls } from "@/components/player/PlaybackControls";
import { VolumeControl } from "@/components/player/VolumeControl";
import { CrossfadeControl } from "@/components/player/CrossfadeControl";
import { VolumeNormalizationControl } from "@/components/player/VolumeNormalizationControl";
import { LyricsDisplay } from "@/components/lyrics/LyricsDisplay";
import { QueueSection } from "@/components/queue/QueueSection";
import { useAppUiStore } from "@/stores/appUiStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { Heart, Library, Music4 } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY_FAVORITES: Array<{ videoId: string }> = [];

export const MobileNowPlayingSheet = () => {
  const isOpen = useAppUiStore((state) => state.isMobileNowPlayingOpen);
  const setOpen = useAppUiStore((state) => state.setMobileNowPlayingOpen);
  const mobileNowPlayingView = useAppUiStore(
    (state) => state.mobileNowPlayingView,
  );
  const setMobileNowPlayingView = useAppUiStore(
    (state) => state.setMobileNowPlayingView,
  );
  const currentTrack = usePlayerStore((state) => state.playbackState.currentTrack);
  const isPlaying = usePlayerStore((state) => state.playbackState.isPlaying);
  const libraryReady = useLibraryStore((state) => state.ready);
  const favorites = useLibraryStore(
    (state) => state.snapshot?.favorites ?? EMPTY_FAVORITES,
  );
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const openPlaylistPicker = useLibraryStore((state) => state.openPlaylistPicker);
  const { showToast } = useToast();

  const isFavorite = currentTrack
    ? favorites.some((favorite) => favorite.videoId === currentTrack.videoId)
    : false;
  const requesterLabel = currentTrack?.requestedBy?.profileName?.trim() || null;

  const handleFavorite = async () => {
    if (!currentTrack || !libraryReady) {
      showToast({ message: "媒體庫正在初始化", type: "info" });
      return;
    }

    try {
      await toggleFavorite(currentTrack);
      showToast({
        message: isFavorite ? "已移除收藏" : "已加入收藏",
        type: "success",
      });
    } catch {
      showToast({ message: "收藏更新失敗", type: "error" });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent
        variant="bottom-sheet"
        className="lg:hidden border-0 bg-transparent p-0 shadow-none"
      >
        <div className="surface-card-strong flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-[34px] border border-b-0 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-28px_80px_-42px_var(--accent-glow)]">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-[var(--surface-border)]" />
          <div className="surface-subtle mb-3 rounded-[22px] border p-1">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "player", label: "播放器" },
                { id: "lyrics", label: "歌詞" },
                { id: "queue", label: "佇列" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setMobileNowPlayingView(
                      tab.id as "player" | "lyrics" | "queue",
                    )
                  }
                  className={cn(
                    "h-10 rounded-[16px] text-[0.95rem] font-semibold transition-all",
                    mobileNowPlayingView === tab.id
                      ? "bg-[var(--surface-elevated)] text-[var(--accent)] shadow-[0_14px_28px_-24px_var(--accent-glow)]"
                      : "text-[var(--text-secondary)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {!currentTrack ? (
            <div className="flex flex-1 min-h-[480px] flex-col items-center justify-center gap-5 px-5 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-[28px] border border-[color:var(--dynamic-ring)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <Music4 className="h-10 w-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
                  還沒有正在播放的歌曲
                </h2>
                <p className="text-base leading-7 text-[var(--text-secondary)]">
                  先從搜尋頁加入一首歌，播放器、歌詞和佇列就會一起展開。
                </p>
              </div>
            </div>
          ) : mobileNowPlayingView === "player" ? (
            <ScrollArea className="flex-1 min-h-0" maxHeight="100%">
              <div className="space-y-5 pb-4">
                <div className="flex flex-col items-center gap-4 px-2 pt-1 text-center">
                  <div className="relative">
                    <div className="absolute inset-5 rounded-[34px] bg-[var(--accent-soft)] blur-3xl opacity-85" />
                    <AnimatedAvatar
                      src={currentTrack.thumbnail}
                      alt={currentTrack.title}
                      size="lg"
                      thumbnailQuality="maxresdefault"
                      className="relative h-52 w-52 rounded-[30px] border border-[color:var(--dynamic-ring)] shadow-[0_28px_54px_-26px_rgba(15,23,42,0.55)]"
                    />
                  </div>

                  <div className="space-y-3">
                    <span className="inline-flex rounded-full border border-[color:var(--dynamic-ring)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-primary)]">
                      {isPlaying ? "Now Playing" : "Paused"}
                    </span>
                    <div className="space-y-2">
                      <h2
                        className="line-clamp-2 text-[2.1rem] font-semibold leading-tight tracking-tight text-[var(--text-primary)]"
                        title={currentTrack.title}
                      >
                        {currentTrack.title}
                      </h2>
                      <p
                        className="line-clamp-1 text-xl text-[var(--text-secondary)]"
                        title={currentTrack.artist}
                      >
                        {currentTrack.artist}
                      </p>
                      {requesterLabel ? (
                        <p
                          className="line-clamp-1 text-sm text-[var(--text-muted)]"
                          title={`點歌者：${requesterLabel}`}
                        >
                          點歌者：{requesterLabel}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className={cn(
                      "h-[52px] rounded-[20px] text-base",
                      isFavorite &&
                        "border-[color:var(--dynamic-ring)] bg-[var(--accent-soft)] text-[var(--accent)]",
                    )}
                    onClick={() => void handleFavorite()}
                  >
                    <Heart
                      className="h-4 w-4"
                      fill={isFavorite ? "currentColor" : "none"}
                    />
                    {isFavorite ? "已收藏" : "收藏"}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-[52px] rounded-[20px] text-base"
                    onClick={() => openPlaylistPicker(currentTrack)}
                  >
                    <Library className="h-4 w-4" />
                    加入歌單
                  </Button>
                </div>

                <div className="surface-subtle rounded-[28px] border px-4 py-4">
                  <ProgressBar />
                </div>

                <div className="surface-subtle rounded-[30px] border px-4 py-4">
                  <div className="flex justify-center">
                    <PlaybackControls />
                  </div>
                </div>

                <CrossfadeControl compact />

                <VolumeNormalizationControl compact />

                <VolumeControl className="max-w-none" />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 min-h-0 flex-col gap-3 pb-1">
              <div className="surface-subtle flex items-center gap-3 rounded-[22px] border px-3.5 py-3">
                <AnimatedAvatar
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  size="md"
                  className="h-14 w-14 rounded-[18px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    {mobileNowPlayingView === "lyrics" ? "Lyrics View" : "Queue View"}
                  </p>
                  <p
                    className="truncate text-[1rem] font-semibold text-[var(--text-primary)]"
                    title={currentTrack.title}
                  >
                    {currentTrack.title}
                  </p>
                  <p
                    className="truncate text-sm text-[var(--text-secondary)]"
                    title={currentTrack.artist}
                  >
                    {currentTrack.artist}
                  </p>
                  {requesterLabel ? (
                    <p
                      className="truncate text-xs text-[var(--text-muted)]"
                      title={`點歌者：${requesterLabel}`}
                    >
                      點歌者：{requesterLabel}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="surface-subtle min-h-0 flex-1 overflow-hidden rounded-[28px] border px-3 py-3">
                {mobileNowPlayingView === "lyrics" ? (
                  <LyricsDisplay mobile className="h-full" isVisible />
                ) : (
                  <QueueSection mobile className="h-full" />
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

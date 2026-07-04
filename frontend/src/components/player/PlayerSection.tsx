import { Card } from "@/components/ui/card";
import { NowPlaying } from "./NowPlaying";
import { ProgressBar } from "./ProgressBar";
import { PlaybackControls } from "./PlaybackControls";
import { VolumeControl } from "./VolumeControl";
import { CrossfadeControl } from "./CrossfadeControl";
import { VolumeNormalizationControl } from "./VolumeNormalizationControl";
import { FoliaBridgeControl } from "./FoliaBridgeControl";
import { usePlayerStore } from "@/stores/playerStore";
import { cn } from "@/lib/utils";
import { OpenAlbumButton } from "@/components/album/OpenAlbumButton";
import { Avatar } from "@/components/ui/avatar";
import { formatTime } from "@/utils/format";
import { RadioToggleButton } from "./RadioToggleButton";
import type { PlayerIdleContext, PlayerIdleVariant } from "./NowPlaying";

interface PlayerSectionProps {
  onSearchClick?: () => void;
  sidebarMode?: boolean;
  idleVariant?: PlayerIdleVariant;
  idleContext?: PlayerIdleContext;
}

export const PlayerSection = ({
  onSearchClick,
  sidebarMode = false,
  idleVariant = "hero",
  idleContext = "default",
}: PlayerSectionProps) => {
  const currentTrack = usePlayerStore((state) => state.playbackState.currentTrack);
  const nextTrack = usePlayerStore((state) => state.playbackState.queue[0] ?? null);
  const queueLength = usePlayerStore((state) => state.playbackState.queue.length);
  const isPlaybackIdle = !currentTrack && queueLength === 0;
  const isHeroIdle = isPlaybackIdle && idleVariant === "hero";
  const isSidebarShell = sidebarMode && !isHeroIdle;

  return (
    <Card
      className={cn(
        "desktop-player-shell surface-card-strong min-h-0 overflow-hidden p-0",
        isHeroIdle ? "mx-auto w-full max-w-[920px]" : "h-full w-full",
      )}
    >
      <div
        className={cn(
          "relative z-10 flex h-full min-h-0 flex-col overflow-y-auto",
          !isPlaybackIdle && "desktop-scrollbar",
          isHeroIdle
            ? "min-h-[620px] px-8 py-12 lg:px-12 lg:py-14"
            : isSidebarShell
              ? "p-5 xl:p-6"
              : "p-5 lg:p-6 xl:p-8",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full min-h-0 flex-col",
            isHeroIdle
              ? "max-w-[760px] justify-center gap-10"
              : isSidebarShell
                ? "max-w-none gap-4 xl:gap-5"
                : "max-w-[760px] gap-4 lg:gap-5 xl:gap-6",
          )}
        >
          {/* 當前播放資訊 */}
          <NowPlaying
            onSearchClick={onSearchClick}
            idleVariant={isPlaybackIdle ? idleVariant : null}
            idleContext={idleContext}
            compact={!isHeroIdle}
            sidebarMode={isSidebarShell}
          />

          {!isPlaybackIdle ? (
            <div
              className={cn(
                "flex flex-col",
                isSidebarShell ? "gap-4 pb-5 xl:pb-6" : "gap-5 pb-6 xl:gap-6 xl:pb-8",
              )}
            >
              {/* 播放進度條 */}
              <ProgressBar />

              {/* 播放控制與音量 */}
              <div
                className={cn(
                  "flex flex-col border-t border-[color:var(--surface-border)]",
                  isSidebarShell ? "gap-4 pt-4" : "gap-4 pt-5 xl:gap-5 xl:pt-6",
                )}
              >
                <div
                  className={cn(
                    "surface-subtle rounded-[var(--app-radius-xl)] border border-[color:var(--dynamic-ring)]",
                    isSidebarShell ? "p-4" : "p-4 xl:p-5",
                  )}
                >
                  <div className="space-y-4">
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        播放控制
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-3 xl:gap-4">
                        <PlaybackControls showRadioToggle={false} />
                        <RadioToggleButton compact className="h-[52px] px-5" />
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        音量
                      </p>
                      <VolumeControl
                        className={cn(
                          "h-[56px] max-w-none",
                          isSidebarShell ? "min-w-0 w-full" : "xl:min-w-[300px]",
                        )}
                      />
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        Crossfade
                      </p>
                      <CrossfadeControl />
                    </div>

                    <VolumeNormalizationControl compact />

                    <FoliaBridgeControl compact />
                  </div>
                </div>
                <div
                  className={cn(
                    "surface-subtle rounded-[var(--app-radius-lg)] border border-[color:var(--dynamic-ring)]",
                    "p-4",
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    即將播放
                  </p>
                  {nextTrack ? (
                    <div className="mt-3 flex min-w-0 items-center gap-3 xl:gap-4">
                      <Avatar
                        src={nextTrack.thumbnail}
                        alt={nextTrack.title}
                        size="md"
                        thumbnailQuality="sddefault"
                        className="rounded-[var(--app-radius-md)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-base font-semibold text-[var(--text-primary)]"
                          title={nextTrack.title}
                        >
                          {nextTrack.title}
                        </p>
                        <p
                          className="truncate text-sm text-[var(--text-secondary)]"
                          title={nextTrack.artist}
                        >
                          {nextTrack.artist}
                        </p>
                        <OpenAlbumButton
                          album={nextTrack.album}
                          trackTitle={nextTrack.title}
                          className="mt-1"
                        />
                        {nextTrack.requestedBy?.profileName?.trim() ? (
                          <p
                            className="mt-1 truncate text-xs text-[var(--text-muted)]"
                            title={`點歌者：${nextTrack.requestedBy.profileName}`}
                          >
                            點歌者：{nextTrack.requestedBy.profileName}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-[var(--app-radius-sm)] border border-[color:var(--dynamic-ring)] bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
                        {formatTime(nextTrack.duration)}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">
                      目前沒有下一首歌曲。建立 Mix 或加入佇列，音樂就能繼續播放。
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

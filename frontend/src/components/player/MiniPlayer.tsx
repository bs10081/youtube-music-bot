import { useState } from "react";
import { AnimatedAvatar } from "@/components/ui/animated-avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePlayerStore } from "@/stores/playerStore";
import { useAppUiStore } from "@/stores/appUiStore";
import { api } from "@/services/api";
import { RadioToggleButton } from "./RadioToggleButton";
import { Music2, Pause, Play, SkipForward } from "lucide-react";

export const MiniPlayer = () => {
  const currentTrack = usePlayerStore(
    (state) => state.playbackState.currentTrack,
  );
  const isPlaying = usePlayerStore((state) => state.playbackState.isPlaying);
  const position = usePlayerStore((state) => state.playbackState.position);
  const duration = usePlayerStore((state) => state.playbackState.duration);
  const nextTrack = usePlayerStore((state) => state.playbackState.queue[0] ?? null);
  const radioEnabled = usePlayerStore((state) => state.playbackState.radioEnabled);
  const isLoadingTrack = usePlayerStore((state) => state.isLoadingTrack);
  const setLoadingTrack = usePlayerStore((state) => state.setLoadingTrack);
  const setMobileNowPlayingOpen = useAppUiStore(
    (state) => state.setMobileNowPlayingOpen,
  );
  const setMobileNowPlayingView = useAppUiStore(
    (state) => state.setMobileNowPlayingView,
  );
  const [isLoading, setIsLoading] = useState(false);

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoading(true);
    try {
      if (isPlaying) {
        await api.pause();
      } else {
        await api.play();
      }
    } catch (error) {
      console.error("播放/暫停失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || isLoadingTrack) {
      return;
    }

    const shouldShowLoading = radioEnabled || nextTrack !== null;
    if (shouldShowLoading) {
      setLoadingTrack(
        true,
        nextTrack
          ? `正在載入「${nextTrack.title}」...`
          : "正在準備下一首...",
      );
    }

    setIsLoading(true);
    try {
      await api.skip();
    } catch (error) {
      if (shouldShowLoading) {
        setLoadingTrack(false);
      }
      console.error("跳過失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 計算進度百分比
  const progress =
    !isLoadingTrack && duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div
      className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 px-3 lg:hidden"
    >
      <div
        className="surface-card overflow-hidden rounded-[var(--app-radius-xl)] border bg-[var(--surface-elevated)]/95 transition-colors"
        onClick={() => {
          if (currentTrack) {
            setMobileNowPlayingView("player");
            setMobileNowPlayingOpen(true);
          }
        }}
      >
        <div className="h-1 bg-[var(--surface-border)]">
          {isLoadingTrack ? (
            <div
              key="loading-bar"
              className="h-full w-full animate-pulse bg-[var(--accent)]/60"
            />
          ) : (
            <div
              key="progress-bar"
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>

        <div className="relative flex items-center gap-3 p-3">
          {currentTrack ? (
            <>
              <AnimatedAvatar
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                size="sm"
                className="rounded-[var(--app-radius-md)]"
              />

              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-semibold text-[var(--text-primary)]"
                  title={currentTrack.title}
                >
                  {currentTrack.title}
                </p>
                <p
                  className="truncate text-xs text-[var(--text-secondary)]"
                  title={currentTrack.artist}
                >
                  {currentTrack.artist}
                </p>
                {currentTrack.requestedBy?.profileName?.trim() ? (
                  <p
                    className="truncate text-[11px] text-[var(--text-muted)]"
                    title={`點歌者：${currentTrack.requestedBy.profileName}`}
                  >
                    點歌者：{currentTrack.requestedBy.profileName}
                  </p>
                ) : null}
              </div>

              <RadioToggleButton indicatorOnly className="hidden sm:inline-flex" />

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePlayPause}
                  disabled={isLoading || isLoadingTrack}
                  title={isPlaying ? "暫停" : "播放"}
                  className="h-9 w-9 rounded-full px-0"
                >
                  {isLoading || isLoadingTrack ? (
                    <Spinner size="sm" />
                  ) : isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  disabled={isLoading || isLoadingTrack}
                  title="下一首"
                  className="h-9 w-9 rounded-full px-0"
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--app-radius-md)] bg-[var(--surface-muted)]">
                <Music2 className="h-5 w-5 text-[var(--text-muted)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-secondary)]">
                  尚無播放歌曲
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  搜尋並加入歌曲開始播放
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

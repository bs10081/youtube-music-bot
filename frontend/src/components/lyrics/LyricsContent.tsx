import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Empty } from "@/components/ui/empty";
import { usePlayerStore } from "@/stores/playerStore";
import { useLyricSync } from "@/hooks/useLyricSync";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/utils/format";
import { Play } from "lucide-react";
import {
  calculateLyricScrollTop,
  isLyricScrollAligned,
} from "@/utils/lyricsAlignment";

const ENTRY_ALIGNMENT_DELAY_MS = 16;
const ENTRY_ALIGNMENT_DURATION_MS = 1200;
const PLAYBACK_ALIGNMENT_DURATION_MS = 420;
const LAYOUT_ALIGNMENT_DELAY_MS = 40;
const LAYOUT_ALIGNMENT_DURATION_MS = 720;
const MANUAL_RESUME_DELAY_MS = 1400;
const MANUAL_LEAVE_RESUME_DELAY_MS = 220;
const MANUAL_RESUME_DURATION_MS = 560;

interface LyricsContentProps {
  className?: string;
  /**
   * 變體樣式
   * - `default`: 預設模式（淺色背景）
   * - `dark`: 深色背景模式（全螢幕播放器使用）
   */
  variant?: "default" | "dark";
  isVisible?: boolean;
}

export const LyricsContent = ({
  className,
  variant = "default",
  isVisible = true,
}: LyricsContentProps) => {
  const lyrics = usePlayerStore((state) => state.lyrics);
  const currentTrack = usePlayerStore(
    (state) => state.playbackState.currentTrack,
  );
  const isPlaying = usePlayerStore((state) => state.playbackState.isPlaying);
  const updatePlaybackState = usePlayerStore(
    (state) => state.updatePlaybackState,
  );
  const { currentIndex } = useLyricSync();
  const { showToast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const alignmentFrameRef = useRef<number | null>(null);
  const alignmentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignmentDeadlineRef = useRef(0);
  const lastAlignmentFrameTimeRef = useRef<number | null>(null);
  const suppressScrollEventsUntilRef = useRef(0);
  const isHoveringLyricsRef = useRef(false);
  const isManualScrollModeRef = useRef(false);
  const hasVisibleViewportRef = useRef(false);
  const entryAlignmentPendingRef = useRef(true);
  const previousTrackIdRef = useRef<string | null>(null);
  const previousIndexRef = useRef(-1);
  const previousLyricsKeyRef = useRef("");
  const previousLayoutVersionRef = useRef(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [manualFocusIndex, setManualFocusIndex] = useState<number | null>(null);
  const hasLyrics = lyrics.length > 0;
  const lyricsKey = `${currentTrack?.videoId ?? "no-track"}::${lyrics.length}::${
    lyrics[0]?.time ?? -1
  }::${lyrics[lyrics.length - 1]?.time ?? -1}`;

  // 根據 variant 決定顏色樣式
  const colorStyles = {
    default: {
      active:
        "text-3xl font-semibold text-[var(--text-primary)] tracking-tight",
      nearby: "text-lg text-[var(--text-secondary)]",
      distant: "text-base text-[var(--text-muted)]",
    },
    dark: {
      active: "text-3xl font-semibold text-white tracking-tight",
      nearby: "text-lg text-white/80",
      distant: "text-base text-white/42",
    },
  };

  const handleSeekToLyric = async (time: number) => {
    if (!currentTrack || !Number.isFinite(time) || time < 0) {
      return;
    }

    clearManualResumeTimer();
    isManualScrollModeRef.current = false;

    try {
      if (!isPlaying) {
        const playResponse = await api.play();
        if (!playResponse.success) {
          showToast({ message: playResponse.error || "恢復播放失敗", type: "error" });
          return;
        }
      }

      updatePlaybackState({
        position: time,
        isPlaying: true,
      });

      const response = await api.seek(time);
      if (!response.success) {
        showToast({ message: response.error || "歌詞跳轉失敗", type: "error" });
      }
    } catch (error) {
      showToast({ message: "歌詞跳轉失敗", type: "error" });
    }
  };

  const getTargetScrollTop = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    const fallbackLine =
      currentIndex < 0
        ? contentRef.current?.querySelector<HTMLDivElement>(
            '[data-lyric-index="0"]',
          ) ?? null
        : null;
    const activeLine = activeRef.current ?? fallbackLine;

    if (!scrollArea || !activeLine || scrollArea.clientHeight <= 0) {
      return null;
    }

    const viewportHeight = scrollArea.clientHeight;
    const offsetTop = activeLine.offsetTop;

    return calculateLyricScrollTop({
      activeOffsetTop: offsetTop,
      activeHeight: activeLine.offsetHeight,
      viewportHeight,
      scrollHeight: scrollArea.scrollHeight,
    });
  }, [currentIndex]);

  const stopAlignmentSession = useCallback(() => {
    if (alignmentFrameRef.current !== null) {
      window.cancelAnimationFrame(alignmentFrameRef.current);
      alignmentFrameRef.current = null;
    }

    if (alignmentTimeoutRef.current) {
      clearTimeout(alignmentTimeoutRef.current);
      alignmentTimeoutRef.current = null;
    }
  }, []);

  const clearManualResumeTimer = useCallback(() => {
    if (manualResumeTimeoutRef.current) {
      clearTimeout(manualResumeTimeoutRef.current);
      manualResumeTimeoutRef.current = null;
    }
  }, []);

  const updateManualFocusIndex = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    const content = contentRef.current;

    if (!scrollArea || !content || scrollArea.clientHeight <= 0) {
      setManualFocusIndex(null);
      return;
    }

    const lyricLines =
      content.querySelectorAll<HTMLDivElement>("[data-lyric-index]");
    if (lyricLines.length === 0) {
      setManualFocusIndex(null);
      return;
    }

    const viewportCenter = scrollArea.scrollTop + scrollArea.clientHeight / 2;
    let nextFocusIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    lyricLines.forEach((line) => {
      const lineIndex = Number(line.dataset.lyricIndex);
      if (!Number.isFinite(lineIndex)) {
        return;
      }

      const lineCenter = line.offsetTop + line.offsetHeight / 2;
      const distance = Math.abs(lineCenter - viewportCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        nextFocusIndex = lineIndex;
      }
    });

    setManualFocusIndex((currentIndex) =>
      currentIndex === nextFocusIndex ? currentIndex : nextFocusIndex,
    );
  }, []);

  const startAlignmentSession = useCallback(
    ({
      delay = 0,
      duration = 900,
      initialBehavior = "auto",
      ignoreHover = false,
    }: {
      delay?: number;
      duration?: number;
      initialBehavior?: ScrollBehavior;
      ignoreHover?: boolean;
    } = {}) => {
      if (!isVisible || !hasLyrics) {
        return;
      }

      stopAlignmentSession();

      alignmentTimeoutRef.current = setTimeout(() => {
        alignmentDeadlineRef.current = performance.now() + duration;
        lastAlignmentFrameTimeRef.current = null;
        let hasStartedMotion = false;

        const step = (now: number) => {
          if (!isVisible || !hasLyrics) {
            stopAlignmentSession();
            return;
          }

          if (!ignoreHover && isHoveringLyricsRef.current) {
            stopAlignmentSession();
            return;
          }

          const scrollArea = scrollAreaRef.current;
          const targetScrollTop = getTargetScrollTop();

          if (!scrollArea || targetScrollTop === null) {
            alignmentFrameRef.current = window.requestAnimationFrame(step);
            return;
          }

          if (!hasVisibleViewportRef.current && scrollArea.clientHeight > 0) {
            hasVisibleViewportRef.current = true;
          }

          if (!hasVisibleViewportRef.current) {
            alignmentFrameRef.current = window.requestAnimationFrame(step);
            return;
          }

          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            suppressScrollEventsUntilRef.current = performance.now() + 120;
            scrollArea.scrollTop = targetScrollTop;
            stopAlignmentSession();
            return;
          }

          if (isLyricScrollAligned(scrollArea.scrollTop, targetScrollTop)) {
            stopAlignmentSession();
            return;
          }

          const previousFrameTime = lastAlignmentFrameTimeRef.current ?? now;
          const frameDeltaMs = Math.min(32, Math.max(8, now - previousFrameTime));
          lastAlignmentFrameTimeRef.current = now;

          const distanceToTarget = targetScrollTop - scrollArea.scrollTop;
          const responsiveness = initialBehavior === "auto" ? 13 : 9;
          const easingFactor =
            1 - Math.exp((-frameDeltaMs / 1000) * responsiveness);
          const nextScrollTop =
            scrollArea.scrollTop + distanceToTarget * easingFactor;

          hasStartedMotion = true;
          suppressScrollEventsUntilRef.current = performance.now() + 120;
          scrollArea.scrollTop = nextScrollTop;

          if (
            performance.now() < alignmentDeadlineRef.current ||
            (hasStartedMotion &&
              !isLyricScrollAligned(scrollArea.scrollTop, targetScrollTop, 1.5))
          ) {
            alignmentFrameRef.current = window.requestAnimationFrame(step);
          } else {
            stopAlignmentSession();
          }
        };

        alignmentFrameRef.current = window.requestAnimationFrame(step);
      }, delay);
    },
    [
      hasLyrics,
      currentIndex,
      getTargetScrollTop,
      isVisible,
      stopAlignmentSession,
    ],
  );

  const resumeAutomaticFocus = useCallback(
    (duration = MANUAL_RESUME_DURATION_MS) => {
      clearManualResumeTimer();
      isManualScrollModeRef.current = false;
      setManualFocusIndex(null);

      if (!hasLyrics || !isVisible) {
        return;
      }

      startAlignmentSession({
        delay: 0,
        duration,
        initialBehavior: "smooth",
        ignoreHover: true,
      });
    },
    [clearManualResumeTimer, hasLyrics, isVisible, startAlignmentSession],
  );

  const scheduleManualResume = useCallback(
    (delay = MANUAL_RESUME_DELAY_MS) => {
      clearManualResumeTimer();
      manualResumeTimeoutRef.current = setTimeout(() => {
        resumeAutomaticFocus();
      }, delay);
    },
    [clearManualResumeTimer, resumeAutomaticFocus],
  );

  const registerManualScrollIntent = useCallback(() => {
    if (!isVisible || !hasLyrics) {
      return;
    }

    stopAlignmentSession();
    isManualScrollModeRef.current = true;
    updateManualFocusIndex();
    scheduleManualResume();
  }, [
    hasLyrics,
    isVisible,
    scheduleManualResume,
    stopAlignmentSession,
    updateManualFocusIndex,
  ]);

  const scheduleAlignment = useCallback(
    (
      reason:
        | "entry"
        | "playback"
        | "layout"
        | "track"
        | "visibility"
        | "focus"
        | "manual_resume",
    ) => {
      if (!hasLyrics || !isVisible) {
        return;
      }

      if (
        isManualScrollModeRef.current &&
        reason !== "entry" &&
        reason !== "track" &&
        reason !== "visibility" &&
        reason !== "manual_resume"
      ) {
        return;
      }

      if (
        isHoveringLyricsRef.current &&
        reason !== "entry" &&
        reason !== "track" &&
        reason !== "visibility" &&
        reason !== "manual_resume"
      ) {
        return;
      }

      if (reason === "entry" || reason === "track" || reason === "visibility") {
        startAlignmentSession({
          delay: ENTRY_ALIGNMENT_DELAY_MS,
          duration: ENTRY_ALIGNMENT_DURATION_MS,
          initialBehavior: "auto",
          ignoreHover: true,
        });
        return;
      }

      if (reason === "layout") {
        startAlignmentSession({
          delay: LAYOUT_ALIGNMENT_DELAY_MS,
          duration: LAYOUT_ALIGNMENT_DURATION_MS,
          initialBehavior: "auto",
        });
        return;
      }

      if (reason === "manual_resume") {
        resumeAutomaticFocus();
        return;
      }

      startAlignmentSession({
        delay: 0,
        duration: reason === "focus" ? 1000 : PLAYBACK_ALIGNMENT_DURATION_MS,
        initialBehavior: "smooth",
      });
    },
    [hasLyrics, isVisible, resumeAutomaticFocus, startAlignmentSession],
  );

  useEffect(() => {
    if (!isVisible || !hasLyrics) {
      stopAlignmentSession();
      clearManualResumeTimer();
      isManualScrollModeRef.current = false;
      setManualFocusIndex(null);
      entryAlignmentPendingRef.current = true;
      previousTrackIdRef.current = currentTrack?.videoId ?? null;
      previousIndexRef.current = currentIndex;
      previousLyricsKeyRef.current = lyricsKey;
      previousLayoutVersionRef.current = layoutVersion;
      return;
    }

    const previousTrackId = previousTrackIdRef.current;
    const previousIndex = previousIndexRef.current;
    const previousLyricsKey = previousLyricsKeyRef.current;
    const previousLayoutVersion = previousLayoutVersionRef.current;
    const currentTrackId = currentTrack?.videoId ?? null;

    if (entryAlignmentPendingRef.current) {
      setManualFocusIndex(null);
      scheduleAlignment("entry");
      entryAlignmentPendingRef.current = false;
    } else if (currentTrackId && currentTrackId !== previousTrackId) {
      clearManualResumeTimer();
      isManualScrollModeRef.current = false;
      setManualFocusIndex(null);
      scheduleAlignment("track");
    } else if (lyrics.length > 0 && lyricsKey !== previousLyricsKey) {
      clearManualResumeTimer();
      isManualScrollModeRef.current = false;
      setManualFocusIndex(null);
      scheduleAlignment("entry");
    } else if (layoutVersion !== previousLayoutVersion) {
      if (isManualScrollModeRef.current) {
        updateManualFocusIndex();
      }
      scheduleAlignment("layout");
    } else if (currentIndex !== previousIndex) {
      scheduleAlignment("playback");
    }

    previousTrackIdRef.current = currentTrackId;
    previousIndexRef.current = currentIndex;
    previousLyricsKeyRef.current = lyricsKey;
    previousLayoutVersionRef.current = layoutVersion;
  }, [
    clearManualResumeTimer,
    hasLyrics,
    currentIndex,
    currentTrack?.videoId,
    isVisible,
    layoutVersion,
    lyrics.length,
    lyricsKey,
    scheduleAlignment,
    stopAlignmentSession,
    updateManualFocusIndex,
  ]);

  // 使用 ResizeObserver 監聽容器大小變化，動態設置佔位元素高度
  useLayoutEffect(() => {
    if (!hasLyrics) {
      hasVisibleViewportRef.current = false;
      setContainerHeight((currentHeight) => {
        if (currentHeight === 0) {
          return currentHeight;
        }

        setLayoutVersion((value) => value + 1);
        return 0;
      });
      return;
    }

    const scrollArea = scrollAreaRef.current;
    const content = contentRef.current;
    if (!scrollArea || !content) return;

    const syncLayout = () => {
      const nextHeight = scrollArea.clientHeight;
      hasVisibleViewportRef.current = nextHeight > 0;
      setContainerHeight((currentHeight) => {
        if (currentHeight === nextHeight) {
          return currentHeight;
        }

        setLayoutVersion((value) => value + 1);
        return nextHeight;
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      syncLayout();
    });

    syncLayout();
    const layoutFrameId = window.requestAnimationFrame(syncLayout);
    const layoutTimeoutId = window.setTimeout(syncLayout, 80);
    resizeObserver.observe(scrollArea);
    resizeObserver.observe(content);

    return () => {
      window.cancelAnimationFrame(layoutFrameId);
      window.clearTimeout(layoutTimeoutId);
      resizeObserver.disconnect();
    };
  }, [hasLyrics, lyricsKey]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    const handleMouseEnter = () => {
      isHoveringLyricsRef.current = true;
      stopAlignmentSession();
    };

    const handleMouseLeave = () => {
      isHoveringLyricsRef.current = false;
      if (isManualScrollModeRef.current) {
        scheduleManualResume(MANUAL_LEAVE_RESUME_DELAY_MS);
      } else if (hasLyrics) {
        scheduleAlignment("manual_resume");
      }
    };

    const handleWheel = () => {
      registerManualScrollIntent();
    };

    const handleTouchStart = () => {
      registerManualScrollIntent();
    };

    const handleTouchMove = () => {
      registerManualScrollIntent();
    };

    const handleScroll = () => {
      if (performance.now() < suppressScrollEventsUntilRef.current) {
        return;
      }

      registerManualScrollIntent();
    };

    scrollArea.addEventListener("mouseenter", handleMouseEnter);
    scrollArea.addEventListener("mouseleave", handleMouseLeave);
    scrollArea.addEventListener("wheel", handleWheel, { passive: true });
    scrollArea.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollArea.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollArea.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollArea.removeEventListener("mouseenter", handleMouseEnter);
      scrollArea.removeEventListener("mouseleave", handleMouseLeave);
      scrollArea.removeEventListener("wheel", handleWheel);
      scrollArea.removeEventListener("touchstart", handleTouchStart);
      scrollArea.removeEventListener("touchmove", handleTouchMove);
      scrollArea.removeEventListener("scroll", handleScroll);
    };
  }, [
    hasLyrics,
    registerManualScrollIntent,
    scheduleAlignment,
    scheduleManualResume,
    stopAlignmentSession,
  ]);

  useEffect(() => {
    const handleVisibilityReset = () => {
      if (document.visibilityState === "visible" && hasLyrics && isVisible) {
        scheduleAlignment("visibility");
      }
    };

    const handleWindowFocus = () => {
      if (hasLyrics && isVisible) {
        scheduleAlignment("focus");
      }
    };

    const handlePageShow = () => {
      if (hasLyrics && isVisible) {
        scheduleAlignment("focus");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityReset);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityReset);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pageshow", handlePageShow);

      clearManualResumeTimer();
      stopAlignmentSession();
    };
  }, [
    clearManualResumeTimer,
    hasLyrics,
    isVisible,
    scheduleAlignment,
    stopAlignmentSession,
  ]);

  if (lyrics.length === 0) {
    return <Empty title="沒有歌詞" description="此歌曲沒有可用的歌詞" />;
  }

  // 佔位元素高度為容器高度的一半，使歌詞可以置中顯示
  const spacerHeight = containerHeight / 2;
  const isManualReadableMode = manualFocusIndex !== null;
  const visualFocusIndex = isManualReadableMode ? manualFocusIndex : currentIndex;

  return (
    <div className={cn("relative h-full min-h-0", className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-[linear-gradient(180deg,var(--surface-elevated)_0%,transparent_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-[linear-gradient(0deg,var(--surface-elevated)_0%,transparent_100%)]" />
      <ScrollArea
        ref={scrollAreaRef}
        className="desktop-scrollbar h-full min-h-0 w-full"
        maxHeight="100%"
      >
      <div ref={contentRef} className="relative space-y-3 px-4 py-10 lg:px-6">
        <div style={{ height: spacerHeight }} />
        {lyrics.map((line, index) => {
          const distance =
            visualFocusIndex < 0 ? 0 : Math.abs(index - visualFocusIndex);
          const isActive = index === currentIndex;
          const isNearby = distance <= (isManualReadableMode ? 2 : 1);
          const opacity = isManualReadableMode
            ? visualFocusIndex < 0
              ? 1
              : distance === 0
                ? 1
                : distance === 1
                  ? 0.94
                  : distance === 2
                    ? 0.84
                    : Math.max(0.36, 0.74 - (distance - 2) * 0.08)
            : currentIndex < 0
              ? 1
              : Math.max(0.18, 1 - distance * 0.145);
          const scale = isManualReadableMode
            ? distance === 0
              ? 1.02
              : distance <= 2
                ? 1
                : Math.max(0.965, 1 - distance * 0.01)
            : isActive
              ? 1.028
              : Math.max(0.94, 1 - distance * 0.018);
          const blur = isManualReadableMode
            ? distance <= 2
              ? 0
              : Math.min(0.7, Math.max(0, distance - 2) * 0.14)
            : isActive || isNearby
              ? 0
              : Math.min(1.6, Math.max(0, distance - 1) * 0.36);
          const translateY = isManualReadableMode
            ? distance === 0
              ? 0
              : Math.min(6, distance * 0.85)
            : isActive
              ? 0
              : Math.min(10, distance * 1.6);
          const backgroundMix = isManualReadableMode
            ? distance === 0
              ? "color-mix(in srgb, var(--surface-elevated) 64%, var(--accent-soft) 36%)"
              : distance <= 2
                ? "color-mix(in srgb, var(--surface-elevated) 82%, var(--accent-soft) 18%)"
                : "transparent"
            : isActive
              ? "color-mix(in srgb, var(--surface-elevated) 66%, var(--accent-soft) 34%)"
              : isNearby
                ? "color-mix(in srgb, var(--surface-elevated) 76%, var(--accent-soft) 18%)"
                : "transparent";

          return (
            <div
              key={index}
              ref={isActive ? activeRef : null}
              data-lyric-index={index}
              style={{
                opacity,
                transform: `translateY(${translateY}px) scale(${scale})`,
                filter: `blur(${blur}px)`,
                background: backgroundMix,
              }}
              className={cn(
                "group/lyric relative rounded-[24px] px-14 transition-[opacity,transform,filter,background,box-shadow] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform,filter]",
                "hover:bg-[color:color-mix(in_srgb,var(--surface-elevated)_78%,var(--accent-soft)_22%)]",
                isActive &&
                  "shadow-[0_18px_30px_-28px_var(--accent-glow)]",
              )}
            >
            <button
              type="button"
              onClick={() => void handleSeekToLyric(line.time)}
              title={`從 ${formatTime(line.time)} 開始播放`}
              aria-label={`跳轉到 ${formatTime(line.time)}：${line.text}`}
              className={cn(
                "absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border transition-all",
                "border-[color:var(--surface-border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
                "hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0",
                "opacity-0 lg:group-hover/lyric:opacity-100 lg:group-focus-within/lyric:opacity-100",
              )}
            >
              <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
            </button>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => void handleSeekToLyric(line.time)}
                className={cn(
                  "w-full cursor-pointer px-2 py-3 text-center leading-relaxed transition-[color,opacity,transform,text-shadow] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                  "rounded-[20px]",
                  "hover:text-[var(--text-primary)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0",
                  isActive
                    ? colorStyles[variant].active
                    : isNearby
                      ? colorStyles[variant].nearby
                      : colorStyles[variant].distant,
                )}
                style={{
                  textShadow: isActive
                    ? "0 10px 28px color-mix(in srgb, var(--accent-glow) 38%, transparent)"
                    : "none",
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void handleSeekToLyric(line.time);
                  }
                }}
              >
                {line.text}
              </button>
            </div>
          </div>
          );
        })}

        {/* 上下佔位元素，使第一行與最後一行都能滾動到中央 */}
        <div style={{ height: spacerHeight }} />
      </div>
      </ScrollArea>
    </div>
  );
};

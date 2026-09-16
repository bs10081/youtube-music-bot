import { Slider } from "@/components/ui/slider";
import { TimeDisplay } from "./TimeDisplay";
import { usePlayerStore } from "@/stores/playerStore";
import { api } from "@/services/api";
import { throttle } from "@/utils/format";
import { useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";

export const ProgressBar = () => {
  // 分別選擇以避免創建新對象
  const position = usePlayerStore((state) => state.playbackState.position);
  const duration = usePlayerStore((state) => state.playbackState.duration);
  const isLoadingTrack = usePlayerStore((state) => state.isLoadingTrack);
  const loadingMessage = usePlayerStore((state) => state.loadingMessage);

  // 節流 seek 請求，避免過於頻繁
  const handleSeek = useMemo(
    () =>
      throttle((value: number[]) => {
        const newPosition = value[0];
        api.seek(newPosition);
      }, 500),
    [],
  );

  // 載入中時顯示載入動畫
  if (isLoadingTrack) {
    return (
      <div className="space-y-3">
        <div className="flex h-5 items-center justify-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-[var(--text-secondary)]">
            {loadingMessage || "正在載入..."}
          </span>
        </div>
        {/* 顯示載入進度條動畫 */}
        <div className="overflow-hidden rounded-full bg-[var(--surface-border)]">
          <div className="h-2.5 w-full animate-pulse rounded-full bg-[var(--accent)]/60" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Slider
        aria-label="播放進度"
        value={[position]}
        max={duration || 100}
        step={1}
        onValueChange={handleSeek}
        disabled={!duration}
      />
      <TimeDisplay current={position} total={duration} />
    </div>
  );
};

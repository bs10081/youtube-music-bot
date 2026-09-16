import { Slider } from "@/components/ui/slider";
import { usePlayerStore } from "@/stores/playerStore";
import { api } from "@/services/api";
import { debounce, throttle } from "@/utils/format";
import { useEffect, useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VolumeControlProps {
  className?: string;
}

export const VolumeControl = ({ className }: VolumeControlProps) => {
  const volume = usePlayerStore((state) => state.playbackState.volume);
  const [displayVolume, setDisplayVolume] = useState(volume);
  const [isAdjusting, setIsAdjusting] = useState(false);

  // 節流音量調整請求
  const handleVolumeChange = useMemo(
    () =>
      throttle((nextVolume: number) => {
        void api.setVolume(nextVolume);
      }, 300),
    [],
  );

  const commitVolumeChange = useMemo(
    () =>
      debounce((nextVolume: number) => {
        void api.setVolume(nextVolume);
        setIsAdjusting(false);
      }, 120),
    [],
  );

  useEffect(() => {
    if (!isAdjusting) {
      setDisplayVolume(volume);
    }
  }, [isAdjusting, volume]);

  const onSliderChange = (value: number[]) => {
    const nextVolume = value[0] ?? 0;

    setIsAdjusting(true);
    setDisplayVolume(nextVolume);
    handleVolumeChange(nextVolume);
    commitVolumeChange(nextVolume);
  };

  return (
    <div
      className={cn(
        "flex h-[60px] w-full min-w-0 max-w-[360px] items-center gap-4 rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-5",
        className,
      )}
    >
      <Volume2 className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
      <Slider
        aria-label="播放音量"
        className="flex-1"
        value={[displayVolume]}
        max={100}
        step={1}
        onValueChange={onSliderChange}
      />
      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
        {displayVolume}
      </span>
    </div>
  );
};

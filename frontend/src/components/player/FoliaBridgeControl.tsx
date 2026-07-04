import { useEffect, useState } from "react";
import { Cast } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import type { FoliaBridgeStatus } from "@/types";

interface FoliaBridgeControlProps {
  compact?: boolean;
  className?: string;
}

export const FoliaBridgeControl = ({
  compact = false,
  className,
}: FoliaBridgeControlProps) => {
  const [status, setStatus] = useState<FoliaBridgeStatus | null>(null);
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api.getFoliaBridgeStatus().then((response) => {
      if (!cancelled && response.success && response.data) {
        setStatus(response.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async () => {
    if (isSubmitting || !status) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = status.enabled
        ? await api.disableFoliaBridge()
        : await api.enableFoliaBridge();

      if (!response.success || !response.data) {
        showToast({
          message: response.error || "Folia 分享設定更新失敗",
          type: "error",
        });
        return;
      }

      setStatus(response.data);
      showToast({
        message: response.data.enabled
          ? "Folia 歌詞分享已開啟"
          : "Folia 歌詞分享已關閉",
        type: "success",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-[24px] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-4 py-4",
        compact && "rounded-[22px] px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cast className="h-4 w-4 text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Folia 歌詞分享
            </p>
          </div>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            將目前播放的曲目、進度與同步歌詞推送給 Folia 舞台模式（Now
            Playing 來源）。
          </p>
          {status?.enabled ? (
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              {status.wsUrl}
              {status.clients > 0 ? `（已連線 ${status.clients} 個裝置）` : ""}
            </p>
          ) : (
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              開啟後 Folia 會自動連上本機的 Now Playing 服務。
            </p>
          )}
        </div>
        <Button
          type="button"
          variant={status?.enabled ? "default" : "outline"}
          size={compact ? "sm" : "md"}
          onClick={() => void handleToggle()}
          disabled={isSubmitting || !status}
          className={cn(
            "shrink-0 rounded-full px-4",
            compact ? "h-9 text-sm" : "h-10 text-sm",
          )}
        >
          {status?.enabled ? "已開啟" : "已關閉"}
        </Button>
      </div>
    </div>
  );
};

import { useEffect, useState } from "react";
import { Speaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/playerStore";

interface AudioOutputControlProps {
  compact?: boolean;
  className?: string;
}

export const AudioOutputControl = ({
  compact = false,
  className,
}: AudioOutputControlProps) => {
  const status = usePlayerStore((state) => state.audioOutput);
  const setAudioOutput = usePlayerStore((state) => state.setAudioOutput);
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // WS 連線時 server 會推一次 audio_output;這裡補一次 HTTP 撈取,
  // 涵蓋 WS 尚未建立或訊息遺失的情況
  useEffect(() => {
    if (status) {
      return;
    }

    let cancelled = false;

    void api.getAudioOutputs().then((response) => {
      if (!cancelled && response.success && response.data) {
        usePlayerStore.getState().setAudioOutput(response.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [status]);

  const followSystem = status?.mode === "system";

  const submit = async (
    payload: { mode: "system" } | { mode: "manual"; sink: string },
  ) => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await api.setAudioOutput(payload);

      if (!response.success || !response.data) {
        showToast({
          message: response.error || "音訊輸出設定更新失敗",
          type: "error",
        });
        return;
      }

      setAudioOutput(response.data);
      showToast({
        message:
          response.data.mode === "system"
            ? "已切換為跟隨 macOS 系統輸出"
            : `輸出已切換至「${
                response.data.sinks.find((sink) => sink.isDefault)
                  ?.description ?? "所選裝置"
              }」`,
        type: "success",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModeToggle = () => {
    if (!status) {
      return;
    }

    if (followSystem) {
      // 切到手動:以目前的 default sink 為起點
      const initialSink =
        status.defaultSink ?? status.sinks[0]?.name ?? null;
      if (!initialSink) {
        showToast({ message: "找不到可用的輸出裝置", type: "error" });
        return;
      }
      void submit({ mode: "manual", sink: initialSink });
    } else {
      void submit({ mode: "system" });
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
            <Speaker className="h-4 w-4 text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              音訊輸出
            </p>
          </div>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            {status && !status.supported
              ? "目前為原生模式,輸出裝置自動跟隨 macOS 系統設定。"
              : "選擇播放裝置,或跟隨 macOS 系統的音訊輸出設定。"}
          </p>
        </div>
        {(!status || status.supported) && (
          <Button
            type="button"
            variant={followSystem ? "default" : "outline"}
            size={compact ? "sm" : "md"}
            onClick={handleModeToggle}
            disabled={isSubmitting || !status}
            className={cn(
              "shrink-0 rounded-full px-4",
              compact ? "h-9 text-sm" : "h-10 text-sm",
            )}
          >
            {followSystem ? "跟隨系統" : "手動選擇"}
          </Button>
        )}
      </div>
      {status?.supported && (
        <select
          value={status.defaultSink ?? ""}
          onChange={(event) =>
            void submit({ mode: "manual", sink: event.target.value })
          }
          disabled={isSubmitting || followSystem}
          className={cn(
            "w-full rounded-[14px] border border-[color:var(--surface-border)] bg-[var(--surface)] px-3 py-2",
            "text-sm text-[var(--text-primary)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {status.sinks.map((sink) => (
            <option key={sink.name} value={sink.name}>
              {sink.description}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

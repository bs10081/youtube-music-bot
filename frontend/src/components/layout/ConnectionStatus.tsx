import { usePlayerStore } from "@/stores/playerStore";

export const ConnectionStatus = () => {
  const connectionStatus = usePlayerStore((state) => state.connectionStatus);

  const statusConfig = {
    connected: {
      text: "已連線",
      badgeClassName:
        "border border-[color:var(--dynamic-ring)] bg-[color:var(--accent-soft)] text-[var(--accent)] shadow-[0_10px_24px_-18px_var(--accent-glow)]",
      dotClassName: "bg-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]",
    },
    connecting: {
      text: "連線中...",
      badgeClassName:
        "border border-[color:var(--surface-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]",
      dotClassName: "bg-[var(--status-warning-text)] animate-pulse",
    },
    disconnected: {
      text: "未連線",
      badgeClassName:
        "border border-[color:var(--surface-border)] bg-[var(--status-error-bg)] text-[var(--status-error-text)]",
      dotClassName: "bg-[var(--status-error-text)]",
    },
  };

  const config = statusConfig[connectionStatus];

  return (
    <>
      {/* 桌面版：顯示完整狀態 */}
      <div className="hidden h-10 shrink-0 items-center gap-2 rounded-[var(--app-radius-md)] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-secondary)] shadow-[0_14px_32px_-26px_var(--accent-glow)] transition-[border-color,background-color,box-shadow] duration-300 lg:flex">
        <span
          className={`h-2.5 w-2.5 rounded-full transition-colors ${config.dotClassName}`}
        />
        <span className="font-medium">{config.text}</span>
      </div>

      {/* 手機版：僅顯示指示圓點 */}
      <div className="lg:hidden flex items-center" title={config.text}>
        <span
          className={`h-2.5 w-2.5 rounded-full transition-colors ${config.dotClassName}`}
        />
      </div>
    </>
  );
};

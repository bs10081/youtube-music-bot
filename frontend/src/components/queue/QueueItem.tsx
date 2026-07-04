import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { OpenAlbumButton } from "@/components/album/OpenAlbumButton";
import { formatTime } from "@/utils/format";
import type { Track } from "@/types";
import { cn } from "@/lib/utils";
import { GripVertical, Heart, Library } from "lucide-react";
import type { DragEvent, TouchEvent } from "react";

interface QueueItemProps {
  track: Track;
  index: number;
  mobile?: boolean;
  onRemove: (index: number) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  isFavorite?: boolean;
  favoriteDisabled?: boolean;
  isRemoving?: boolean;
  isNext?: boolean;
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (position: "before" | "after") => void;
  onDragEnd: () => void;
  onTouchHandleStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchCancel: () => void;
}

export const QueueItem = ({
  track,
  index,
  mobile = false,
  onRemove,
  onToggleFavorite,
  onAddToPlaylist,
  isFavorite = false,
  favoriteDisabled = false,
  isRemoving,
  isNext = false,
  isDragging = false,
  dropIndicator = null,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onTouchHandleStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
}: QueueItemProps) => {
  const requesterLabel = track.requestedBy?.profileName?.trim() || null;

  return (
    <div
      data-queue-item-index={index}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(dropIndicator ?? "before");
      }}
      onDragOver={onDragOver}
      onTouchMove={mobile ? onTouchMove : undefined}
      onTouchEnd={mobile ? onTouchEnd : undefined}
      onTouchCancel={mobile ? onTouchCancel : undefined}
      className={cn(
        "group cv-auto relative border transition-all",
        mobile ? "rounded-[24px] px-3 py-3" : "rounded-[22px] p-3",
        isNext
          ? "border-[color:var(--surface-border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_84%,var(--accent-soft)_16%)]"
          : "surface-subtle",
        isDragging && "scale-[0.992] opacity-55 shadow-none",
        dropIndicator &&
          "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_76%,var(--accent-soft)_24%)] shadow-[0_14px_28px_-24px_var(--accent-glow)]",
      )}
    >
      {dropIndicator ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-5 h-1 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-soft)_72%,transparent)]",
            dropIndicator === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
          )}
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 gap-3",
          mobile ? "items-start gap-2.5" : "items-center",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center gap-1",
            mobile ? "w-6 pt-3" : "w-12",
          )}
        >
          <div
            draggable={!isRemoving}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onTouchStart={mobile ? onTouchHandleStart : undefined}
            title="拖拽重新排序"
            className={cn(
              "flex cursor-grab items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-secondary)] active:cursor-grabbing",
              mobile ? "h-7 w-7 rounded-lg" : "h-10 w-10 rounded-2xl",
              mobile && "touch-none",
            )}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        </div>
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-1",
            mobile ? "w-4 pt-3" : "w-10",
          )}
        >
          <span
            className={cn(
              "font-medium text-[var(--text-muted)]",
              mobile ? "text-sm" : "text-sm",
            )}
          >
            {index + 1}
          </span>
        </div>
        <Avatar
          src={track.thumbnail}
          alt={track.title}
          size={mobile ? "md" : "sm"}
          className={cn("rounded-2xl", mobile && "h-16 w-16 rounded-[20px]")}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "mb-1 min-w-0 gap-2",
              mobile ? "flex flex-col items-start gap-1.5" : "flex items-center",
            )}
          >
            {isNext ? (
              <span
                className={cn(
                  "rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] font-bold uppercase tracking-[0.16em] text-[var(--accent)]",
                  mobile ? "px-2.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[10px]",
                )}
              >
                Next
              </span>
            ) : null}
            <h4
              className={cn(
                "text-[var(--text-primary)]",
                mobile
                  ? "line-clamp-2 text-[1rem] font-semibold leading-6"
                  : "truncate text-sm font-medium",
              )}
              title={track.title}
            >
              {track.title}
            </h4>
          </div>
          <p
            className={cn(
              "truncate text-[var(--text-secondary)]",
              mobile ? "text-[0.98rem] leading-5" : "text-xs",
            )}
            title={`${track.artist} • ${formatTime(track.duration)}`}
          >
            {track.artist} • {formatTime(track.duration)}
          </p>
          <OpenAlbumButton
            album={track.album}
            trackTitle={track.title}
            className="mt-1"
          />
          {requesterLabel ? (
            <p
              className={cn(
                "mt-1 truncate text-[var(--text-muted)]",
                mobile ? "text-xs leading-5" : "text-[11px]",
              )}
              title={`點歌者：${requesterLabel}`}
            >
              點歌者：{requesterLabel}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "shrink-0",
            mobile ? "flex flex-col gap-1 pt-1" : "grid w-[120px] grid-cols-3 gap-1 justify-items-end",
          )}
        >
          {!mobile ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleFavorite(track)}
              disabled={favoriteDisabled}
              title={isFavorite ? "取消收藏" : "收藏"}
              className={cn(
                "h-9 w-9 rounded-xl px-0 opacity-40 transition-opacity group-hover:opacity-100",
                isFavorite &&
                  "text-[var(--accent)] opacity-100 hover:text-[var(--accent)]",
              )}
            >
              <Heart
                className="h-4 w-4"
                fill={isFavorite ? "currentColor" : "none"}
              />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAddToPlaylist(track)}
            title="加入歌單"
            className={cn(
              mobile
                ? "h-8 w-8 rounded-xl px-0 text-[var(--text-secondary)]"
                : "h-9 w-9 rounded-xl px-0 opacity-40 transition-opacity group-hover:opacity-100",
            )}
          >
            <Library className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(index)}
            disabled={isRemoving}
            title="移除"
            className={cn(
              mobile
                ? "h-8 w-8 rounded-xl px-0 text-[var(--text-secondary)]"
                : "h-9 w-9 rounded-xl px-0 opacity-40 transition-opacity group-hover:opacity-100",
            )}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
};

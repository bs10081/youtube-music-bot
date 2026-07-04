import * as React from "react";
import { cn } from "@/lib/utils";
import {
  ThumbnailQuality,
  type ThumbnailQuality as ThumbnailQualityType,
  getOptimizedThumbnailCandidates,
} from "@/utils/thumbnail";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  thumbnailQuality?: ThumbnailQualityType;
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      className,
      src,
      alt,
      fallback,
      size = "md",
      thumbnailQuality = ThumbnailQuality.HIGH,
      ...props
    },
    ref,
  ) => {
    const [failedCandidates, setFailedCandidates] = React.useState<string[]>([]);
    const candidateSources = React.useMemo(
      () =>
        src ? getOptimizedThumbnailCandidates(src, thumbnailQuality) : [],
      [src, thumbnailQuality],
    );
    const optimizedSrc = React.useMemo(
      () =>
        candidateSources.find((candidate) => !failedCandidates.includes(candidate)),
      [candidateSources, failedCandidates],
    );

    React.useEffect(() => {
      setFailedCandidates([]);
    }, [candidateSources]);

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex shrink-0 overflow-hidden rounded-md",
          size === "sm" && "h-10 w-10",
          size === "md" && "h-12 w-12",
          size === "lg" && "h-16 w-16",
          className
        )}
        {...props}
      >
        {optimizedSrc ? (
          <img
            src={optimizedSrc}
            alt={alt || ""}
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            onError={() => {
              setFailedCandidates((previous) =>
                previous.includes(optimizedSrc)
                  ? previous
                  : [...previous, optimizedSrc],
              );
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gray-200 dark:bg-gray-800">
            {fallback || (
              <svg
                className="h-1/2 w-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            )}
          </div>
        )}
      </div>
    );
  }
);

Avatar.displayName = "Avatar";

export { Avatar };

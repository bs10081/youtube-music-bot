import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  value: number[];
  max: number;
  step?: number;
  onValueChange: (value: number[]) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, max, step = 1, onValueChange, disabled, className, "aria-label": label = "調整數值" }, ref) => {
    const [isDragging, setIsDragging] = React.useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange([Number(e.target.value)]);
    };

    const currentValue = value[0] || 0;
    const percentage = max > 0 ? (currentValue / max) * 100 : 0;

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          className,
        )}
      >
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-border)]">
          <div
            className="absolute h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <input
          type="range"
          aria-label={label}
          min={0}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          disabled={disabled}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className={cn(
            "absolute inset-0 w-full cursor-pointer opacity-0",
            disabled && "cursor-not-allowed",
          )}
        />
        <div
          className={cn(
            "absolute h-4 w-4 rounded-full border-[3px] border-[var(--surface-elevated)] bg-[var(--accent)] shadow-[0_10px_24px_-12px_rgba(15,23,42,0.55)]",
            "transition-all",
            isDragging && "scale-110",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          )}
          style={{
            left: `clamp(8px, ${percentage}%, calc(100% - 8px))`,
            transform: "translateX(-50%)",
          }}
        />
      </div>
    );
  },
);

Slider.displayName = "Slider";

export { Slider };

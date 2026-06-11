import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // 基礎樣式
          "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--app-radius-sm)] font-medium transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0",
          "disabled:pointer-events-none disabled:opacity-50",
          // 尺寸
          size === "sm" && "h-8 px-3 text-sm",
          size === "md" && "h-10 px-4 text-sm",
          size === "lg" && "h-11 px-6 text-base",
          // 變體
          variant === "default" &&
            "bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110 active:translate-y-px",
          variant === "ghost" &&
            "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]",
          variant === "outline" &&
            "border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)]",
          variant === "destructive" &&
            "bg-[#c24141] text-white hover:brightness-110 active:translate-y-px dark:bg-[#ef6767] dark:text-[#160a0a]",
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { Button };

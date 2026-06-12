import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
}

const Empty = React.forwardRef<HTMLDivElement, EmptyProps>(
  ({ className, title = "沒有資料", description, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center py-12 text-center text-[var(--text-secondary)]",
          className
        )}
        {...props}
      >
        <div className="mb-4 rounded-[var(--app-radius-lg)] border border-[color:var(--dynamic-ring)] bg-[var(--surface-subtle)] p-4 text-[var(--accent)] shadow-[0_16px_34px_-28px_var(--accent-glow)]">
          <Inbox className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
            {description}
          </p>
        )}
        {children}
      </div>
    );
  }
);

Empty.displayName = "Empty";

export { Empty };

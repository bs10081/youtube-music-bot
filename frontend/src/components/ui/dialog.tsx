import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Dialog Root
interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  modal?: boolean;
}

const Dialog = ({
  open,
  onOpenChange,
  children,
  modal = true,
}: DialogProps) => {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {children}
    </BaseDialog.Root>
  );
};

// Dialog Trigger
interface DialogTriggerProps {
  children: React.ReactNode;
}

const DialogTrigger = ({ children }: DialogTriggerProps) => {
  return <BaseDialog.Trigger>{children}</BaseDialog.Trigger>;
};

// Dialog Backdrop
interface DialogBackdropProps {
  className?: string;
}

const DialogBackdrop = React.forwardRef<HTMLDivElement, DialogBackdropProps>(
  ({ className }, ref) => {
    return (
      <BaseDialog.Backdrop
        ref={ref}
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
      />
    );
  },
);

DialogBackdrop.displayName = "DialogBackdrop";

// Dialog Content
interface DialogContentProps {
  className?: string;
  children: React.ReactNode;
  variant?: "modal" | "bottom-sheet";
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, variant = "modal" }, ref) => {
    return (
      <BaseDialog.Portal>
        <DialogBackdrop />
        <BaseDialog.Popup
          ref={ref}
          className={cn(
            variant === "bottom-sheet"
              ? [
                  "fixed inset-x-0 bottom-0 z-50 w-full max-w-none overflow-hidden",
                  "data-[state=open]:animate-in data-[state=closed]:animate-out",
                  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                  "data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:slide-in-from-bottom-8",
                ]
              : [
                  "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
                  "w-full max-w-lg max-h-[85vh] overflow-hidden",
                  "surface-card rounded-[var(--app-radius-xl)]",
                  "data-[state=open]:animate-in data-[state=closed]:animate-out",
                  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                  "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
                  "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
                ],
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    );
  },
);

DialogContent.displayName = "DialogContent";

// Dialog Title
interface DialogTitleProps {
  className?: string;
  children: React.ReactNode;
}

const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, children }, ref) => {
    return (
      <BaseDialog.Title
        ref={ref}
        className={cn(
          "text-lg font-semibold leading-none tracking-tight text-[var(--text-primary)]",
          className,
        )}
      >
        {children}
      </BaseDialog.Title>
    );
  },
);

DialogTitle.displayName = "DialogTitle";

// Dialog Description
interface DialogDescriptionProps {
  className?: string;
  children: React.ReactNode;
}

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  DialogDescriptionProps
>(({ className, children }, ref) => {
  return (
    <BaseDialog.Description
      ref={ref}
      className={cn("text-sm text-[var(--text-secondary)]", className)}
    >
      {children}
    </BaseDialog.Description>
  );
});

DialogDescription.displayName = "DialogDescription";

// Dialog Close
interface DialogCloseProps {
  className?: string;
  children?: React.ReactNode;
}

const DialogClose = React.forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ className, children }, ref) => {
    return (
      <BaseDialog.Close
        ref={ref}
        className={cn(
          "absolute right-4 top-4 rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] p-2 text-[var(--text-secondary)] opacity-90 transition-all hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:pointer-events-none",
          className,
        )}
      >
        {children || (
          <span className="h-4 w-4">
            <X className="h-4 w-4" />
            <span className="sr-only">關閉</span>
          </span>
        )}
      </BaseDialog.Close>
    );
  },
);

DialogClose.displayName = "DialogClose";

export {
  Dialog,
  DialogTrigger,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
};

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToastProps {
  message: string;
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
}

interface ToastContextValue {
  showToast: (props: ToastProps) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(
  undefined,
);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = React.useState<
    Array<ToastProps & { id: string }>
  >([]);

  const showToast = React.useCallback((props: ToastProps) => {
    const id = Math.random().toString(36).substring(7);
    const duration = props.duration || 3000;

    setToasts((prev) => [...prev, { ...props, id }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-0 right-0 z-50 flex flex-col gap-2 p-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-[var(--app-radius-md)] border border-[color:var(--surface-border)] px-4 py-3 shadow-[var(--surface-shadow)] backdrop-blur-xl",
              "animate-in slide-in-from-right-full",
              toast.type === "success" &&
                "bg-[var(--surface-overlay)] text-[var(--status-success-text)]",
              toast.type === "error" &&
                "bg-[var(--surface-overlay)] text-[var(--status-error-text)]",
              toast.type === "warning" &&
                "bg-[var(--surface-overlay)] text-[var(--status-warning-text)]",
              (!toast.type || toast.type === "info") &&
                "bg-[var(--surface-overlay)] text-[var(--text-primary)]",
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

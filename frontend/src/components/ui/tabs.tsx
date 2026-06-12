import * as React from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "desktop-segmented relative inline-flex h-14 items-center justify-center overflow-hidden rounded-[var(--app-radius-lg)] p-1 text-[var(--text-muted)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Tab>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Tab
    ref={ref}
    className={cn(
      "relative z-10 inline-flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-[var(--app-radius-md)] px-5 py-3 text-[1rem] font-semibold transition-all",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[selected]:text-[var(--text-primary)] data-[selected]:drop-shadow-[0_1px_0_rgba(255,255,255,0.25)]",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsIndicator = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Indicator
    ref={ref}
    className={cn(
      "desktop-segmented-indicator pointer-events-none absolute left-[var(--active-tab-left)] top-[var(--active-tab-top)] z-0 h-[var(--active-tab-height)] w-[var(--active-tab-width)] rounded-[var(--app-radius-md)] transition-[left,width,height,transform] duration-300",
      className,
    )}
    {...props}
  />
));
TabsIndicator.displayName = "TabsIndicator";

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Panel>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Panel
    ref={ref}
    className={cn(
      "mt-2 ring-offset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsIndicator, TabsContent };

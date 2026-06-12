import { usePlayerStore } from "@/stores/playerStore";
import { Compass, LibraryBig, Search } from "lucide-react";

export const TabBar = () => {
  const activeTab = usePlayerStore((state) => state.mobileActiveTab);
  const setActiveTab = usePlayerStore((state) => state.setMobileActiveTab);

  const tabs = [
    {
      id: "search" as const,
      label: "搜尋",
      icon: <Search className="h-5 w-5" />,
    },
    {
      id: "discover" as const,
      label: "Discover",
      icon: <Compass className="h-5 w-5" />,
    },
    {
      id: "library" as const,
      label: "資料庫",
      icon: <LibraryBig className="h-5 w-5" />,
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
      <div className="surface-card grid min-h-20 grid-cols-3 rounded-[var(--app-radius-xl)] border p-1.5 shadow-[0_22px_44px_-32px_rgba(15,23,42,0.3)]">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex min-h-[70px] flex-col items-center justify-center gap-1 rounded-[var(--app-radius-lg)] transition-all ${
              activeTab === tab.id
                ? "bg-[var(--surface-elevated)] text-[var(--accent)] shadow-[0_14px_28px_-24px_var(--accent-glow)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <div
              className={`transition-transform ${
                activeTab === tab.id ? "scale-110" : "scale-100"
              }`}
            >
              {tab.icon}
            </div>
            <span
              className={`text-xs font-medium ${
                activeTab === tab.id ? "font-semibold" : ""
              }`}
            >
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

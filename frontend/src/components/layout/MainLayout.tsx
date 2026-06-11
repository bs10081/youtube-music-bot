import type { ArtworkThemeState } from "@/hooks/useArtworkTheme";
import { ArtworkThemeBackdrop } from "./ArtworkThemeBackdrop";
import { Header } from "./Header";

interface MainLayoutProps {
  children: React.ReactNode;
  onSearchClick?: () => void;
  artworkTheme: ArtworkThemeState;
}

export const MainLayout = ({
  children,
  onSearchClick,
  artworkTheme,
}: MainLayoutProps) => {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <ArtworkThemeBackdrop theme={artworkTheme} />
      <div className="relative z-10 flex h-screen flex-col overflow-hidden">
        <Header onSearchClick={onSearchClick} />
        <main className="min-h-0 flex-1 overflow-hidden pb-[var(--mobile-bottom-stack)] lg:pb-0">
          {/* 桌面版：有 padding 和 max-width */}
          <div className="mx-auto hidden h-full min-h-0 max-w-[1480px] px-[var(--app-space-edge)] py-4 lg:block xl:py-5">
            {children}
          </div>
          {/* 手機版：內容區避開底部迷你播放器與 TabBar */}
          <div className="h-full lg:hidden">{children}</div>
        </main>
      </div>
    </div>
  );
};

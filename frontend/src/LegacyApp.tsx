import { useState, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLibraryPlaybackSync } from "@/hooks/useLibraryPlaybackSync";
import { useLibrarySync } from "@/hooks/useLibrarySync";
import { useArtworkTheme } from "@/hooks/useArtworkTheme";
import { usePlayerStore } from "@/stores/playerStore";
import { useAppUiStore } from "@/stores/appUiStore";
import { cn } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { LibraryView } from "@/components/library/LibraryView";
import { AlbumDialog } from "@/components/album/AlbumDialog";
import { ArtistDialog } from "@/components/artist/ArtistDialog";
import { PlaylistPickerDialog } from "@/components/library/PlaylistPickerDialog";
import { PlaylistDialog } from "@/components/playlist/PlaylistDialog";
import { SearchModal } from "@/components/search/SearchModal";
import { PlayerSection } from "@/components/player/PlayerSection";
import { MiniPlayer } from "@/components/player/MiniPlayer";
import { MobileNowPlayingSheet } from "@/components/mobile/MobileNowPlayingSheet";
import { TabBar } from "@/components/mobile/TabBar";
import { QueueSection } from "@/components/queue/QueueSection";
import { LyricsDisplay } from "@/components/lyrics/LyricsDisplay";
import { MobileContent } from "@/components/mobile/MobileContent";
import { LibraryContent } from "@/components/mobile/LibraryContent";
import { DiscoverView } from "@/components/discover/DiscoverView";
import { ToastProvider } from "@/components/ui/toast";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsIndicator,
  TabsContent,
} from "@/components/ui/tabs";

function AppContent() {
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [desktopActiveTab, setDesktopActiveTab] = useState("lyrics");
  const desktopMode = useAppUiStore((state) => state.desktopMode);
  const mobileActiveTab = usePlayerStore((state) => state.mobileActiveTab);
  const currentTrack = usePlayerStore((state) => state.playbackState.currentTrack);
  const hasQueuedTracks = usePlayerStore(
    (state) => state.playbackState.queue.length > 0,
  );
  const artworkTheme = useArtworkTheme();
  const isDesktopIdle = !currentTrack && !hasQueuedTracks;

  // 初始化 WebSocket 連接
  useWebSocket();
  useLibraryPlaybackSync();
  useLibrarySync();

  // 穩定的函數引用，避免不必要的事件監聽器重新綁定
  // 只用於桌面版搜尋彈窗
  const handleSearchOpen = useCallback(() => {
    setIsSearchModalOpen(true);
  }, []);

  // 初始化全局快捷鍵
  useKeyboardShortcuts({
    onSearchOpen: handleSearchOpen,
  });

  return (
    <>
      <MainLayout onSearchClick={handleSearchOpen} artworkTheme={artworkTheme}>
        {/* 桌面版：雙欄佈局 */}
        <div
          className={cn(
            "hidden h-full min-h-0 lg:block",
            desktopMode === "player" &&
              !isDesktopIdle &&
              "lg:grid lg:gap-4 lg:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)] xl:gap-6 xl:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.05fr)]",
          )}
        >
          {desktopMode === "library" ? (
            <div className="grid h-full min-h-0 w-full gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:gap-6 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
              <div className="flex h-full min-h-0 flex-col gap-4 xl:gap-6">
                <PlayerSection
                  sidebarMode
                  idleVariant="sidebar"
                  idleContext="library"
                  onSearchClick={handleSearchOpen}
                />
              </div>
              <div className="h-full min-h-0">
                <LibraryView />
              </div>
            </div>
          ) : desktopMode === "discover" ? (
            <div className="grid h-full min-h-0 w-full gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:gap-6 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
              <div className="flex h-full min-h-0 flex-col gap-4 xl:gap-6">
                <PlayerSection
                  sidebarMode
                  idleVariant="sidebar"
                  idleContext="discover"
                  onSearchClick={handleSearchOpen}
                />
              </div>
              <div className="h-full min-h-0">
                <DiscoverView />
              </div>
            </div>
          ) : isDesktopIdle ? (
            <div className="mx-auto flex h-full w-full max-w-[1180px] min-h-0 items-center justify-center">
              <PlayerSection
                idleVariant="hero"
                idleContext="default"
                onSearchClick={handleSearchOpen}
              />
            </div>
          ) : (
            <>
              {/* 左側：播放器 */}
              <div className="flex min-h-0 flex-col gap-4 xl:gap-6">
                <PlayerSection
                  idleContext="default"
                  onSearchClick={handleSearchOpen}
                />
              </div>

              {/* 右側：標籤切換（歌詞/播放佇列） */}
              <div className="flex h-full min-h-0 flex-col gap-4 xl:gap-6">
                <div className="flex-1 min-h-0">
                  <Tabs
                    value={desktopActiveTab}
                    onValueChange={setDesktopActiveTab}
                    className="flex h-full min-h-0 flex-col"
                  >
                    <div className="pb-3 xl:pb-4">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="lyrics">歌詞</TabsTrigger>
                        <TabsTrigger value="queue">播放佇列</TabsTrigger>
                        <TabsIndicator />
                      </TabsList>
                    </div>
                    <TabsContent
                      value="lyrics"
                      className="mt-0 flex-1 min-h-0 overflow-hidden"
                    >
                      <LyricsDisplay isVisible={desktopActiveTab === "lyrics"} />
                    </TabsContent>
                    <TabsContent
                      value="queue"
                      className="mt-0 flex-1 min-h-0 overflow-hidden"
                    >
                      <QueueSection />
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 手機版：根據 TabBar 狀態動態切換內容 */}
        <div className="h-full lg:hidden">
          {mobileActiveTab === "search" && <MobileContent />}
          {mobileActiveTab === "discover" && <DiscoverView isMobile />}
          {mobileActiveTab === "library" && <LibraryContent />}
        </div>
      </MainLayout>

      {/* 手機版底部迷你播放器 */}
      <MiniPlayer />
      <MobileNowPlayingSheet />

      {/* 手機版底部 TabBar */}
      <TabBar />

      {/* 桌面版搜尋彈窗 */}
      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
      />
      <AlbumDialog />
      <ArtistDialog />
      <PlaylistDialog />
      <PlaylistPickerDialog />
    </>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { usePlayerStore } from "@/stores/playerStore";
import { getCurrentRequester, useLibraryStore } from "@/stores/libraryStore";
import { api } from "@/services/api";
import { SearchResultItem } from "@/components/search/SearchResultItem";
import type { CollectionSearchResult, Track } from "@/types";

const EMPTY_FAVORITES: Array<{ videoId: string }> = [];

export const MobileContent = () => {
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [creatingMixId, setCreatingMixId] = useState<string | null>(null);
  const [addingCollectionId, setAddingCollectionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const searchResults = usePlayerStore((state) => state.searchResults);
  const setSearchResults = usePlayerStore((state) => state.setSearchResults);
  const libraryReady = useLibraryStore((state) => state.ready);
  const favorites = useLibraryStore(
    (state) => state.snapshot?.favorites ?? EMPTY_FAVORITES,
  );
  const openPlaylistPicker = useLibraryStore((state) => state.openPlaylistPicker);
  const saveMix = useLibraryStore((state) => state.saveMix);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const currentRequester = useLibraryStore((state) =>
    getCurrentRequester(state.snapshot),
  );
  const { showToast } = useToast();
  const favoriteTrackIds = new Set(
    favorites.map((favorite) => favorite.videoId),
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const response = await api.search(query.trim());
      if (response.success && response.data) {
        setSearchResults(response.data);
        if (response.data.length === 0) {
          showToast({ message: "沒有找到相關內容", type: "info" });
        }
      } else {
        showToast({ message: response.error || "搜尋失敗", type: "error" });
      }
    } catch {
      showToast({ message: "搜尋發生錯誤", type: "error" });
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddToQueue = async (track: Track) => {
    setAddingId(track.videoId);
    try {
      const response = await api.addToQueue(track, currentRequester);
      if (response.success) {
        showToast({ message: "已加入播放佇列", type: "success" });
      } else {
        showToast({ message: response.error || "加入失敗", type: "error" });
      }
    } catch {
      showToast({ message: "加入發生錯誤", type: "error" });
    } finally {
      setAddingId(null);
    }
  };

  const handleAddCollection = async (result: CollectionSearchResult) => {
    setAddingCollectionId(result.id);
    try {
      const response = await api.addTracksToQueue(result.tracks, currentRequester);
      if (response.success && response.data) {
        showToast({
          message: `已加入 ${response.data.count} 首歌曲`,
          type: "success",
        });
      } else {
        showToast({
          message: response.error || "加入整組內容失敗",
          type: "error",
        });
      }
    } catch {
      showToast({ message: "加入整組內容發生錯誤", type: "error" });
    } finally {
      setAddingCollectionId(null);
    }
  };

  const handleCreateMix = async (track: Track) => {
    setCreatingMixId(track.videoId);
    try {
      const response = await api.createMix(track, currentRequester);
      if (response.success && response.data) {
        void saveMix(track, response.data.tracks);
        showToast({
          message: `已建立 Mix，加入 ${response.data.count} 首歌曲`,
          type: "success",
        });
      } else {
        showToast({ message: response.error || "建立 Mix 失敗", type: "error" });
      }
    } catch {
      showToast({ message: "建立 Mix 發生錯誤", type: "error" });
    } finally {
      setCreatingMixId(null);
    }
  };

  const handleAddToPlaylist = (track: Track) => {
    if (!libraryReady) {
      showToast({ message: "媒體庫正在初始化", type: "info" });
      return;
    }

    openPlaylistPicker(track);
  };

  const handleToggleFavorite = async (track: Track) => {
    if (!libraryReady) {
      showToast({ message: "媒體庫正在初始化", type: "info" });
      return;
    }

    const wasFavorite = favoriteTrackIds.has(track.videoId);

    try {
      await toggleFavorite(track);
      showToast({
        message: wasFavorite ? "已移除收藏" : "已加入收藏",
        type: "success",
      });
    } catch {
      showToast({ message: "收藏更新失敗", type: "error" });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:hidden">
      <form onSubmit={handleSearch} className="shrink-0 px-4 py-4">
        <div className="surface-card relative rounded-[28px] border p-3">
          <Input
            ref={inputRef}
            type="text"
            placeholder="搜尋歌曲、藝人或貼上 YouTube 連結..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isSearching}
            className="h-14 rounded-[20px] border-0 bg-[var(--surface-subtle)] pl-12 pr-24 text-base"
          />
          <div className="absolute left-7 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          {query.trim() && (
            <Button
              type="submit"
              disabled={isSearching}
              className="absolute right-5 top-1/2 h-9 -translate-y-1/2 rounded-[14px] px-4 text-sm shadow-[0_18px_30px_-20px_var(--accent-glow)]"
            >
              {isSearching ? <Spinner size="sm" /> : "搜尋"}
            </Button>
          )}
        </div>
      </form>

      <ScrollArea className="min-h-0 flex-1 px-4" maxHeight="none">
        {isSearching ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="space-y-3 pb-6">
            {searchResults.map((result) => (
              <SearchResultItem
                key={`${result.kind}:${result.id}`}
                result={result}
                onAdd={handleAddToQueue}
                onCreateMix={handleCreateMix}
                onAddToPlaylist={handleAddToPlaylist}
                onToggleFavorite={handleToggleFavorite}
                onAddCollection={handleAddCollection}
                favoriteTrackIds={favoriteTrackIds}
                favoriteDisabled={!libraryReady}
                isAdding={result.kind === "track" && addingId === result.id}
                isCreatingMix={
                  result.kind === "track" && creatingMixId === result.id
                }
                isCollectionPending={
                  result.kind !== "track" && addingCollectionId === result.id
                }
                pendingTrackId={addingId}
              />
            ))}
          </div>
        ) : (
          <Empty
            title="尚無搜尋結果"
            description="輸入關鍵字或貼上 YouTube 連結開始搜尋"
          />
        )}
      </ScrollArea>
    </div>
  );
};

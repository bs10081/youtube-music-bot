import { useState } from "react";
import { SearchInput } from "./SearchInput";
import { SearchResultItem } from "./SearchResultItem";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { usePlayerStore } from "@/stores/playerStore";
import { getCurrentRequester, useLibraryStore } from "@/stores/libraryStore";
import { api } from "@/services/api";
import type { CollectionSearchResult, Track } from "@/types";

const EMPTY_FAVORITES: Array<{ videoId: string }> = [];

export const SearchSection = () => {
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [creatingMixId, setCreatingMixId] = useState<string | null>(null);
  const [addingCollectionId, setAddingCollectionId] = useState<string | null>(null);

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

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    try {
      const response = await api.search(query);
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
          message: `已創建 Mix，加入 ${response.data.count} 首歌曲`,
          type: "success",
        });
      } else {
        showToast({
          message: response.error || "創建 Mix 失敗",
          type: "error",
        });
      }
    } catch {
      showToast({ message: "創建 Mix 發生錯誤", type: "error" });
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          搜尋音樂
        </h2>
      </div>

      <SearchInput onSearch={handleSearch} isLoading={isSearching} />

      {isSearching ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : searchResults.length > 0 ? (
        <div className="space-y-2">
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
    </div>
  );
};

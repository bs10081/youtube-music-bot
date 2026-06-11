import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useLibraryStore,
  getCurrentDevice,
  getCurrentRequester,
} from "@/stores/libraryStore";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar } from "@/components/ui/avatar";
import { OpenAlbumButton } from "@/components/album/OpenAlbumButton";
import { api } from "@/services/api";
import { formatTime } from "@/utils/format";
import { formatDeviceDetail } from "@/utils/device-info";
import { cn } from "@/lib/utils";
import type {
  HistoryEntry,
  PairedDevice,
  Playlist,
  PlaylistTrackEntry,
  SavedMix,
} from "@/types/library";
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  Heart,
  ListMusic,
  Music4,
  Plus,
  Radio,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface LibraryViewProps {
  isMobile?: boolean;
}

type LibrarySection = "playlists" | "favorites" | "history";

export const LibraryView = ({ isMobile = false }: LibraryViewProps) => {
  const snapshot = useLibraryStore((state) => state.snapshot);
  const ready = useLibraryStore((state) => state.ready);
  const selectedPlaylistId = useLibraryStore((state) => state.selectedPlaylistId);
  const syncStatus = useLibraryStore((state) => state.syncStatus);
  const syncPairCode = useLibraryStore((state) => state.syncPairCode);
  const syncError = useLibraryStore((state) => state.syncError);
  const selectPlaylist = useLibraryStore((state) => state.selectPlaylist);
  const applySyncSession = useLibraryStore((state) => state.applySyncSession);
  const updatePairedDevices = useLibraryStore((state) => state.updatePairedDevices);
  const updateProfileName = useLibraryStore((state) => state.updateProfileName);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const renamePlaylist = useLibraryStore((state) => state.renamePlaylist);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const removeTrackFromPlaylist = useLibraryStore((state) => state.removeTrackFromPlaylist);
  const reorderPlaylistTracks = useLibraryStore((state) => state.reorderPlaylistTracks);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const openPlaylistPicker = useLibraryStore((state) => state.openPlaylistPicker);
  const deleteSavedMix = useLibraryStore((state) => state.deleteSavedMix);
  const { showToast } = useToast();
  const [playlistName, setPlaylistName] = useState("");
  const [pairCodeInput, setPairCodeInput] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState("未命名使用者");
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<LibrarySection>("playlists");
  const [sectionSearch, setSectionSearch] = useState<Record<LibrarySection, string>>({
    playlists: "",
    favorites: "",
    history: "",
  });

  const selectedPlaylist = useMemo(
    () => snapshot?.playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [selectedPlaylistId, snapshot?.playlists],
  );
  const currentDevice = getCurrentDevice(snapshot ?? null);
  const currentRequester = getCurrentRequester(snapshot ?? null);
  const favoriteTrackIds = useMemo(
    () => new Set(snapshot?.favorites.map((favorite) => favorite.videoId) ?? []),
    [snapshot?.favorites],
  );
  const normalizedQuery = sectionSearch[activeSection].trim().toLowerCase();
  const filteredPlaylists = useMemo(() => {
    const playlists = snapshot?.playlists ?? [];

    if (!normalizedQuery) {
      return playlists;
    }

    return playlists.filter((playlist) =>
      playlist.name.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, snapshot?.playlists]);
  const filteredFavorites = useMemo(() => {
    const favorites = snapshot?.favorites ?? [];

    if (!normalizedQuery) {
      return favorites.map((favorite) => favorite.track);
    }

    return favorites
      .map((favorite) => favorite.track)
      .filter((track) =>
        `${track.title} ${track.artist}`.toLowerCase().includes(normalizedQuery),
      );
  }, [normalizedQuery, snapshot?.favorites]);
  const filteredHistory = useMemo(() => {
    const history = snapshot?.history ?? [];

    if (!normalizedQuery) {
      return history;
    }

    return history.filter((entry) =>
      `${entry.track.title} ${entry.track.artist}`.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, snapshot?.history]);
  const snapshotProfileName = snapshot?.profileName;

  useEffect(() => {
    if (snapshotProfileName == null) {
      return;
    }

    setProfileNameInput(snapshotProfileName);
  }, [snapshotProfileName]);

  if (!ready || !snapshot) {
    return (
      <Card className="surface-card flex h-full items-center justify-center rounded-[32px] p-8">
        <p className="text-sm text-[var(--text-secondary)]">正在載入媒體庫…</p>
      </Card>
    );
  }

  const handleCreatePlaylist = async () => {
    const playlist = await createPlaylist(playlistName);
    setPlaylistName("");
    showToast({ message: `已建立「${playlist.name}」`, type: "success" });
  };

  const handlePlayPlaylist = async (playlist: Playlist) => {
    const response = await api.playPlaylist(
      playlist.id,
      playlist.tracks.map((entry) => entry.track),
      currentRequester,
    );

    if (response.success) {
      showToast({ message: `開始播放「${playlist.name}」`, type: "success" });
      return;
    }

    showToast({ message: response.error || "播放歌單失敗", type: "error" });
  };

  const handleQueuePlaylist = async (playlist: Playlist) => {
    const response = await api.queuePlaylist(
      playlist.id,
      playlist.tracks.map((entry) => entry.track),
      currentRequester,
    );

    if (response.success) {
      showToast({ message: `已追加「${playlist.name}」`, type: "success" });
      return;
    }

    showToast({ message: response.error || "加入歌單失敗", type: "error" });
  };

  const handleReplayMix = async (savedMix: SavedMix) => {
    const response = await api.createMix(savedMix.seedTrack, currentRequester);

    if (response.success) {
      showToast({ message: "已重新啟動 Mix", type: "success" });
      return;
    }

    showToast({ message: response.error || "重播 Mix 失敗", type: "error" });
  };

  const handleAddTrackToQueue = async (track: PlaylistTrackEntry["track"]) => {
    const response = await api.addToQueue(track, currentRequester);

    if (response.success) {
      showToast({ message: `已加入播放佇列：${track.title}`, type: "success" });
      return;
    }

    showToast({ message: response.error || "加入播放佇列失敗", type: "error" });
  };

  const handlePairDevice = async () => {
    if (!snapshot || !currentDevice || !pairCodeInput.trim()) {
      return;
    }

    setIsPairing(true);
    try {
      const response = await api.pairSyncSession({
        pairCode: pairCodeInput.trim().toUpperCase(),
        profileId: snapshot.profileId,
        device: {
          id: currentDevice.id,
          name: currentDevice.displayName,
          kind: currentDevice.kind,
          reportedName: currentDevice.reportedName,
          metadata: currentDevice.metadata,
        },
      });

      if (!response.success || !response.data) {
        showToast({ message: response.error || "配對失敗", type: "error" });
        return;
      }

      await applySyncSession({
        ...response.data,
        pairCode: response.data.pairCode,
        profileName:
          String((response.data as { profileName?: unknown }).profileName ?? "").trim() ||
          snapshot.profileName,
      });
      setPairCodeInput("");
      showToast({ message: "裝置已加入同步 session", type: "success" });
    } finally {
      setIsPairing(false);
    }
  };

  const handleSaveProfileName = async () => {
    if (!snapshot) {
      return;
    }

    const nextName = profileNameInput.trim() || snapshot.profileName;
    if (nextName === snapshot.profileName) {
      return;
    }

    setIsSavingProfileName(true);
    try {
      if (!snapshot.syncSessionId) {
        await updateProfileName(nextName);
        showToast({ message: "已更新使用者名稱", type: "success" });
        return;
      }

      const response = await api.updateSyncProfileName(
        snapshot.syncSessionId,
        nextName,
      );
      if (!response.success) {
        showToast({ message: response.error || "更新使用者名稱失敗", type: "error" });
        return;
      }

      await updateProfileName(response.data?.profileName ?? nextName);
      showToast({ message: "已更新使用者名稱", type: "success" });
    } finally {
      setIsSavingProfileName(false);
    }
  };

  const handleRenameDevice = async (deviceId: string, name: string) => {
    if (!snapshot?.syncSessionId) {
      return;
    }

    const nextName = name.trim();
    if (!nextName) {
      showToast({ message: "請輸入裝置名稱", type: "error" });
      return;
    }

    setRenamingDeviceId(deviceId);
    try {
      const response = await api.renameSyncDevice(
        snapshot.syncSessionId,
        deviceId,
        nextName,
      );
      if (!response.success) {
        showToast({ message: response.error || "裝置重新命名失敗", type: "error" });
        return;
      }

      if (response.data && Array.isArray(response.data.devices)) {
        await updatePairedDevices(response.data.devices);
      }
      showToast({ message: "裝置名稱已更新", type: "success" });
    } finally {
      setRenamingDeviceId(null);
    }
  };

  const handleRemoveDevice = async (deviceId: string) => {
    if (!snapshot?.syncSessionId) {
      return;
    }

    const response = await api.removeSyncDevice(snapshot.syncSessionId, deviceId);

    if (response.success) {
      showToast({ message: "已移除同步裝置", type: "success" });
      return;
    }

    showToast({ message: response.error || "移除裝置失敗", type: "error" });
  };

  const content = selectedPlaylist ? (
    <PlaylistDetail
      playlist={selectedPlaylist}
      draggingIndex={draggingIndex}
      onBack={() => selectPlaylist(null)}
      onQueue={() => handleQueuePlaylist(selectedPlaylist)}
      onPlay={() => handlePlayPlaylist(selectedPlaylist)}
      onRename={async (name) => {
        await renamePlaylist(selectedPlaylist.id, name);
        setEditingPlaylistId(null);
        showToast({ message: "歌單名稱已更新", type: "success" });
      }}
      onDelete={async () => {
        await deletePlaylist(selectedPlaylist.id);
        showToast({ message: "歌單已刪除", type: "success" });
      }}
      onRemoveTrack={async (entryId) => {
        await removeTrackFromPlaylist(selectedPlaylist.id, entryId);
      }}
      onDragStart={setDraggingIndex}
      onDragEnd={() => setDraggingIndex(null)}
      onDropTrack={async (fromIndex, toIndex) => {
        await reorderPlaylistTracks(selectedPlaylist.id, fromIndex, toIndex);
      }}
      onQueueTrack={(track) => void handleAddTrackToQueue(track)}
      isEditing={editingPlaylistId === selectedPlaylist.id}
      onEditingChange={(isEditing) =>
        setEditingPlaylistId(isEditing ? selectedPlaylist.id : null)
      }
    />
  ) : (
    isMobile ? (
      <MobileLibraryHome
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        searchValue={sectionSearch[activeSection]}
        onSearchChange={(value) =>
          setSectionSearch((current) => ({ ...current, [activeSection]: value }))
        }
        playlistName={playlistName}
        onPlaylistNameChange={setPlaylistName}
        onCreatePlaylist={() => void handleCreatePlaylist()}
        playlists={filteredPlaylists}
        favoriteTracks={filteredFavorites}
        historyEntries={filteredHistory}
        favoriteTrackIds={favoriteTrackIds}
        savedMixes={snapshot.savedMixes}
        pairedDevices={snapshot.pairedDevices}
        profileName={snapshot.profileName}
        profileNameInput={profileNameInput}
        onProfileNameInputChange={setProfileNameInput}
        onSaveProfileName={() => void handleSaveProfileName()}
        isSavingProfileName={isSavingProfileName}
        syncPairCode={syncPairCode}
        syncStatus={syncStatus}
        syncError={syncError}
        pairCodeInput={pairCodeInput}
        onPairCodeInputChange={setPairCodeInput}
        isPairing={isPairing}
        onPairDevice={() => void handlePairDevice()}
        onOpenPlaylist={(playlistId) => selectPlaylist(playlistId)}
        onTrackQueue={(track) => void handleAddTrackToQueue(track)}
        onTrackPlaylist={(track) => openPlaylistPicker(track)}
        onTrackFavorite={(track) => void toggleFavorite(track)}
        onReplayMix={(savedMix) => void handleReplayMix(savedMix)}
        onDeleteMix={async (mixId) => {
          await deleteSavedMix(mixId);
          showToast({ message: "已從媒體庫移除 Mix", type: "success" });
        }}
        onRemoveDevice={(deviceId) => void handleRemoveDevice(deviceId)}
        onRenameDevice={(deviceId, name) => void handleRenameDevice(deviceId, name)}
        renamingDeviceId={renamingDeviceId}
        currentDeviceId={currentDevice?.id ?? null}
      />
    ) : (
      <DesktopLibraryHome
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        searchValue={sectionSearch[activeSection]}
        onSearchChange={(value) =>
          setSectionSearch((current) => ({ ...current, [activeSection]: value }))
        }
        playlistName={playlistName}
        onPlaylistNameChange={setPlaylistName}
        onCreatePlaylist={() => void handleCreatePlaylist()}
        playlists={filteredPlaylists}
        favoriteTracks={filteredFavorites}
        historyEntries={filteredHistory}
        favoriteTrackIds={favoriteTrackIds}
        savedMixes={snapshot.savedMixes}
        pairedDevices={snapshot.pairedDevices}
        profileName={snapshot.profileName}
        profileNameInput={profileNameInput}
        onProfileNameInputChange={setProfileNameInput}
        onSaveProfileName={() => void handleSaveProfileName()}
        isSavingProfileName={isSavingProfileName}
        syncPairCode={syncPairCode}
        syncStatus={syncStatus}
        syncError={syncError}
        pairCodeInput={pairCodeInput}
        onPairCodeInputChange={setPairCodeInput}
        isPairing={isPairing}
        onPairDevice={() => void handlePairDevice()}
        onOpenPlaylist={(playlistId) => selectPlaylist(playlistId)}
        onTrackQueue={(track) => void handleAddTrackToQueue(track)}
        onTrackPlaylist={(track) => openPlaylistPicker(track)}
        onTrackFavorite={(track) => void toggleFavorite(track)}
        onReplayMix={(savedMix) => void handleReplayMix(savedMix)}
        onDeleteMix={async (mixId) => {
          await deleteSavedMix(mixId);
          showToast({ message: "已從媒體庫移除 Mix", type: "success" });
        }}
        onRemoveDevice={(deviceId) => void handleRemoveDevice(deviceId)}
        onRenameDevice={(deviceId, name) => void handleRenameDevice(deviceId, name)}
        renamingDeviceId={renamingDeviceId}
        currentDeviceId={currentDevice?.id ?? null}
        counts={{
          playlists: snapshot.playlists.length,
          favorites: snapshot.favorites.length,
          history: snapshot.history.length,
          mixes: snapshot.savedMixes.length,
        }}
      />
    )
  );

  const contentClassName = isMobile
    ? "h-full w-full px-4 pb-6 pt-4"
    : "h-full w-full";

  return (
    <Card className="surface-card h-full min-h-0 w-full overflow-hidden rounded-[32px] p-0">
      <ScrollArea className={contentClassName} maxHeight="100%">
        <div
          className={cn(
            "w-full",
            isMobile ? "space-y-6 pb-8" : "space-y-7 p-6 xl:space-y-8 xl:p-8",
          )}
        >
          {content}
        </div>
      </ScrollArea>
    </Card>
  );
};

interface LibraryHomeBaseProps {
  activeSection: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  playlistName: string;
  onPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  playlists: Playlist[];
  favoriteTracks: PlaylistTrackEntry["track"][];
  historyEntries: HistoryEntry[];
  favoriteTrackIds: Set<string>;
  savedMixes: SavedMix[];
  pairedDevices: PairedDevice[];
  profileName: string;
  profileNameInput: string;
  onProfileNameInputChange: (value: string) => void;
  onSaveProfileName: () => void;
  isSavingProfileName: boolean;
  syncPairCode: string | null;
  syncStatus: "idle" | "connecting" | "connected" | "error";
  syncError: string | null;
  pairCodeInput: string;
  onPairCodeInputChange: (value: string) => void;
  isPairing: boolean;
  onPairDevice: () => void;
  onOpenPlaylist: (playlistId: string) => void;
  onTrackQueue: (track: PlaylistTrackEntry["track"]) => void;
  onTrackPlaylist: (track: PlaylistTrackEntry["track"]) => void;
  onTrackFavorite: (track: PlaylistTrackEntry["track"]) => void;
  onReplayMix: (savedMix: SavedMix) => void;
  onDeleteMix: (mixId: string) => void | Promise<void>;
  onRemoveDevice: (deviceId: string) => void;
  onRenameDevice: (deviceId: string, name: string) => void;
  renamingDeviceId: string | null;
  currentDeviceId: string | null;
}

interface DesktopLibraryHomeProps extends LibraryHomeBaseProps {
  counts: {
    playlists: number;
    favorites: number;
    history: number;
    mixes: number;
  };
}

const DesktopLibraryHome = ({
  activeSection,
  onSectionChange,
  searchValue,
  onSearchChange,
  playlistName,
  onPlaylistNameChange,
  onCreatePlaylist,
  playlists,
  favoriteTracks,
  historyEntries,
  favoriteTrackIds,
  savedMixes,
  pairedDevices,
  profileName,
  profileNameInput,
  onProfileNameInputChange,
  onSaveProfileName,
  isSavingProfileName,
  syncPairCode,
  syncStatus,
  syncError,
  pairCodeInput,
  onPairCodeInputChange,
  isPairing,
  onPairDevice,
  onOpenPlaylist,
  onTrackQueue,
  onTrackPlaylist,
  onTrackFavorite,
  onReplayMix,
  onDeleteMix,
  onRemoveDevice,
  onRenameDevice,
  renamingDeviceId,
  currentDeviceId,
  counts,
}: DesktopLibraryHomeProps) => (
  <div className="space-y-6">
    <Card className="surface-card rounded-[34px] p-6 xl:p-7">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-[42rem] space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
              Library
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
              收藏、歌單與歷史整理在同一個工作區
            </h2>
            <p className="text-sm leading-7 text-[var(--text-secondary)]">
              透過分頁滑塊快速切換自定歌單、收藏歌曲與播放歷史，每一區都能獨立搜尋與捲動。
            </p>
          </div>
          <LibrarySearchField
            value={searchValue}
            onChange={onSearchChange}
            placeholder={getSectionSearchPlaceholder(activeSection)}
            className="w-full xl:max-w-[340px]"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <LibraryMetricPill
            icon={<ListMusic className="h-4 w-4" />}
            label="自定歌單"
            value={counts.playlists}
          />
          <LibraryMetricPill
            icon={<Heart className="h-4 w-4" />}
            label="收藏歌曲"
            value={counts.favorites}
          />
          <LibraryMetricPill
            icon={<Clock3 className="h-4 w-4" />}
            label="播放歷史"
            value={counts.history}
          />
          <LibraryMetricPill
            icon={<Sparkles className="h-4 w-4" />}
            label="已儲存 Mix"
            value={counts.mixes}
          />
        </div>

        <Tabs
          value={activeSection}
          onValueChange={(value) => onSectionChange(value as LibrarySection)}
          className="space-y-5"
        >
          <LibrarySectionTabs />
          <TabsContent value="playlists" className="mt-0">
            <PlaylistBrowser
              isMobile={false}
              playlistName={playlistName}
              onPlaylistNameChange={onPlaylistNameChange}
              onCreatePlaylist={onCreatePlaylist}
              playlists={playlists}
              onOpenPlaylist={onOpenPlaylist}
            />
          </TabsContent>
          <TabsContent value="favorites" className="mt-0">
            <TrackBrowser
              isMobile={false}
              emptyTitle="還沒有收藏歌曲"
              emptyDescription="先把喜歡的歌加入收藏，這裡就會累積成自己的常聽清單。"
              tracks={favoriteTracks}
              getActionLabel={() => "移除收藏"}
              isActionActive={() => true}
              onAction={onTrackFavorite}
              onQueueAction={onTrackQueue}
              onPlaylistAction={onTrackPlaylist}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <TrackBrowser
              isMobile={false}
              emptyTitle="還沒有播放歷史"
              emptyDescription="開始播放幾首歌後，最近聽過的內容就會出現在這裡。"
              tracks={historyEntries.map((entry) => entry.track)}
              getActionLabel={(track) =>
                favoriteTrackIds.has(track.videoId) ? "取消收藏" : "收藏"
              }
              isActionActive={(track) => favoriteTrackIds.has(track.videoId)}
              onAction={onTrackFavorite}
              onQueueAction={onTrackQueue}
              onPlaylistAction={onTrackPlaylist}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Card>

    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.85fr)]">
      <SavedMixPanel
        savedMixes={savedMixes}
        onReplayMix={onReplayMix}
        onDeleteMix={onDeleteMix}
      />
      <DevicesPanel
        pairedDevices={pairedDevices}
        profileName={profileName}
        profileNameInput={profileNameInput}
        onProfileNameInputChange={onProfileNameInputChange}
        onSaveProfileName={onSaveProfileName}
        isSavingProfileName={isSavingProfileName}
        syncPairCode={syncPairCode}
        syncStatus={syncStatus}
        syncError={syncError}
        pairCodeInput={pairCodeInput}
        onPairCodeInputChange={onPairCodeInputChange}
        isPairing={isPairing}
        onPairDevice={onPairDevice}
        onRemoveDevice={onRemoveDevice}
        onRenameDevice={onRenameDevice}
        renamingDeviceId={renamingDeviceId}
        currentDeviceId={currentDeviceId}
      />
    </div>
  </div>
);

const MobileLibraryHome = ({
  activeSection,
  onSectionChange,
  searchValue,
  onSearchChange,
  playlistName,
  onPlaylistNameChange,
  onCreatePlaylist,
  playlists,
  favoriteTracks,
  historyEntries,
  favoriteTrackIds,
  savedMixes,
  pairedDevices,
  profileName,
  profileNameInput,
  onProfileNameInputChange,
  onSaveProfileName,
  isSavingProfileName,
  syncPairCode,
  syncStatus,
  syncError,
  pairCodeInput,
  onPairCodeInputChange,
  isPairing,
  onPairDevice,
  onOpenPlaylist,
  onTrackQueue,
  onTrackPlaylist,
  onTrackFavorite,
  onReplayMix,
  onDeleteMix,
  onRemoveDevice,
  onRenameDevice,
  renamingDeviceId,
  currentDeviceId,
}: LibraryHomeBaseProps) => (
  <div className="space-y-5">
    <Card className="surface-card rounded-[32px] p-4">
      <div className="space-y-4">
        <div className="space-y-2 px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Library
          </p>
          <h2 className="text-[2rem] font-semibold tracking-tight text-[var(--text-primary)]">
            你的音樂資料庫
          </h2>
          <p className="text-sm leading-7 text-[var(--text-secondary)]">
            用滑塊切換歌單、收藏與歷史，並在每個分頁裡直接搜尋與捲動。
          </p>
        </div>

        <Tabs
          value={activeSection}
          onValueChange={(value) => onSectionChange(value as LibrarySection)}
          className="space-y-4"
        >
          <LibrarySectionTabs mobile />
          <LibrarySearchField
            value={searchValue}
            onChange={onSearchChange}
            placeholder={getSectionSearchPlaceholder(activeSection)}
          />
          <TabsContent value="playlists" className="mt-0">
            <PlaylistBrowser
              isMobile
              playlistName={playlistName}
              onPlaylistNameChange={onPlaylistNameChange}
              onCreatePlaylist={onCreatePlaylist}
              playlists={playlists}
              onOpenPlaylist={onOpenPlaylist}
            />
          </TabsContent>
          <TabsContent value="favorites" className="mt-0">
            <TrackBrowser
              isMobile
              emptyTitle="還沒有收藏歌曲"
              emptyDescription="先把喜歡的歌加入收藏，這裡就會累積成自己的常聽清單。"
              tracks={favoriteTracks}
              getActionLabel={() => "移除收藏"}
              isActionActive={() => true}
              onAction={onTrackFavorite}
              onQueueAction={onTrackQueue}
              onPlaylistAction={onTrackPlaylist}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <TrackBrowser
              isMobile
              emptyTitle="還沒有播放歷史"
              emptyDescription="開始播放幾首歌後，最近聽過的內容就會出現在這裡。"
              tracks={historyEntries.map((entry) => entry.track)}
              getActionLabel={(track) =>
                favoriteTrackIds.has(track.videoId) ? "取消收藏" : "收藏"
              }
              isActionActive={(track) => favoriteTrackIds.has(track.videoId)}
              onAction={onTrackFavorite}
              onQueueAction={onTrackQueue}
              onPlaylistAction={onTrackPlaylist}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Card>

    <SavedMixPanel
      mobile
      savedMixes={savedMixes}
      onReplayMix={onReplayMix}
      onDeleteMix={onDeleteMix}
    />
    <DevicesPanel
      mobile
      pairedDevices={pairedDevices}
      profileName={profileName}
      profileNameInput={profileNameInput}
      onProfileNameInputChange={onProfileNameInputChange}
      onSaveProfileName={onSaveProfileName}
      isSavingProfileName={isSavingProfileName}
      syncPairCode={syncPairCode}
      syncStatus={syncStatus}
      syncError={syncError}
      pairCodeInput={pairCodeInput}
      onPairCodeInputChange={onPairCodeInputChange}
      isPairing={isPairing}
      onPairDevice={onPairDevice}
      onRemoveDevice={onRemoveDevice}
      onRenameDevice={onRenameDevice}
      renamingDeviceId={renamingDeviceId}
      currentDeviceId={currentDeviceId}
    />
  </div>
);

const LibrarySectionTabs = ({ mobile = false }: { mobile?: boolean }) => (
  <TabsList className={cn("grid w-full grid-cols-3", mobile ? "h-14 rounded-[26px]" : "max-w-[760px]")}>
    <TabsTrigger value="playlists" className={cn(mobile && "text-sm")}>
      自定歌單
    </TabsTrigger>
    <TabsTrigger value="favorites" className={cn(mobile && "text-sm")}>
      收藏歌曲
    </TabsTrigger>
    <TabsTrigger value="history" className={cn(mobile && "text-sm")}>
      歷史記錄
    </TabsTrigger>
    <TabsIndicator className={cn(mobile && "rounded-[20px]")} />
  </TabsList>
);

const LibrarySearchField = ({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) => (
  <label
    className={cn(
      "surface-subtle flex h-12 items-center gap-3 rounded-[20px] border px-4",
      className,
    )}
  >
    <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-full w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
    />
  </label>
);

const LibraryMetricPill = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) => (
  <div className="surface-subtle flex items-center gap-4 rounded-[22px] border px-4 py-3">
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
        {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
      {value}
      </p>
    </div>
  </div>
);

const PlaylistBrowser = ({
  isMobile,
  playlistName,
  onPlaylistNameChange,
  onCreatePlaylist,
  playlists,
  onOpenPlaylist,
}: {
  isMobile: boolean;
  playlistName: string;
  onPlaylistNameChange: (value: string) => void;
  onCreatePlaylist: () => void;
  playlists: Playlist[];
  onOpenPlaylist: (playlistId: string) => void;
}) => (
  <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "xl:grid-cols-[320px_minmax(0,1fr)]")}>
    <Card className="surface-subtle rounded-[28px] border p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        建立新歌單
      </p>
      <div className="mt-3 space-y-3">
        <input
          value={playlistName}
          onChange={(event) => onPlaylistNameChange(event.target.value)}
          placeholder="例如：深夜放鬆、開車、工作中"
          className="h-12 w-full rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-4 text-sm text-[var(--text-primary)] outline-none"
        />
        <Button
          className="h-12 w-full rounded-2xl"
          onClick={onCreatePlaylist}
          disabled={!playlistName.trim()}
        >
          <Plus className="h-4 w-4" />
          建立歌單
        </Button>
      </div>
    </Card>

    <Card className="surface-subtle rounded-[28px] border p-3">
      <ScrollArea
        className="w-full"
        maxHeight={isMobile ? "42vh" : "50vh"}
      >
        <div className="grid gap-3">
          {playlists.length === 0 ? (
            <Empty
              title="尚未建立歌單"
              description="建立第一張歌單後，就能從這裡打開、整理與播放。"
            />
          ) : (
            playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="surface-card grid items-center gap-4 rounded-[24px] border px-4 py-4 text-left transition-transform hover:-translate-y-0.5 md:grid-cols-[minmax(0,1fr)_auto]"
                onClick={() => onOpenPlaylist(playlist.id)}
              >
                <div className="min-w-0">
                  <p
                    className="truncate text-base font-semibold text-[var(--text-primary)]"
                    title={playlist.name}
                  >
                    {playlist.name}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {playlist.tracks.length} 首歌曲
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--accent)]">
                  打開
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  </div>
);

const TrackBrowser = ({
  isMobile,
  emptyTitle,
  emptyDescription,
  tracks,
  getActionLabel,
  isActionActive,
  onAction,
  onQueueAction,
  onPlaylistAction,
}: {
  isMobile: boolean;
  emptyTitle: string;
  emptyDescription: string;
  tracks: PlaylistTrackEntry["track"][];
  getActionLabel: (track: PlaylistTrackEntry["track"]) => string;
  isActionActive?: (track: PlaylistTrackEntry["track"]) => boolean;
  onAction: (track: PlaylistTrackEntry["track"]) => void;
  onQueueAction: (track: PlaylistTrackEntry["track"]) => void;
  onPlaylistAction: (track: PlaylistTrackEntry["track"]) => void;
}) => (
  <Card className="surface-subtle rounded-[28px] border p-3">
    <ScrollArea className="w-full" maxHeight={isMobile ? "42vh" : "50vh"}>
      <div className="grid gap-3">
        {tracks.length === 0 ? (
          <Empty title={emptyTitle} description={emptyDescription} />
        ) : (
          tracks.map((track) => (
            <div
              key={`${track.videoId}-${track.title}`}
              className={cn(
                "surface-card gap-4 rounded-[24px] border",
                isMobile
                  ? "flex flex-col px-4 py-4"
                  : "grid items-center px-4 py-4 md:grid-cols-[minmax(0,1fr)_132px]",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar
                  src={track.thumbnail}
                  alt={track.title}
                  size="md"
                  className="rounded-2xl"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "font-semibold text-[var(--text-primary)]",
                      isMobile ? "line-clamp-2 text-base leading-6" : "truncate text-base",
                    )}
                    title={track.title}
                  >
                    {track.title}
                  </p>
                  <p
                    className="truncate text-sm text-[var(--text-secondary)]"
                    title={`${track.artist} · ${formatTime(track.duration)}`}
                  >
                    {track.artist} · {formatTime(track.duration)}
                  </p>
                  <OpenAlbumButton
                    album={track.album}
                    trackTitle={track.title}
                    className="mt-1"
                  />
                </div>
              </div>
              <div
                className={cn(
                  "shrink-0 gap-2",
                  isMobile
                    ? "flex w-full flex-wrap"
                    : "grid w-[132px] grid-cols-3 justify-self-end",
                )}
              >
                <Button
                  variant="outline"
                  className={cn(
                    "rounded-2xl",
                    isMobile ? "px-3" : "h-10 w-10 rounded-[18px] px-0",
                  )}
                  onClick={() => onQueueAction(track)}
                  aria-label={`加入播放佇列：${track.title}`}
                  title="加入播放佇列"
                >
                  <Plus className="h-4 w-4" />
                  {isMobile ? <span>加入佇列</span> : null}
                </Button>
                <Button
                  variant="outline"
                  className={cn(
                    "rounded-2xl",
                    isMobile ? undefined : "h-10 w-10 rounded-[18px] px-0",
                  )}
                  onClick={() => onPlaylistAction(track)}
                  aria-label={`加入歌單：${track.title}`}
                  title="加入歌單"
                >
                  <ListMusic className="h-4 w-4" />
                  {isMobile ? <span>加入歌單</span> : null}
                </Button>
                <Button
                  variant={isMobile ? "default" : "outline"}
                  className={cn(
                    "rounded-2xl",
                    !isMobile && "h-10 w-10 rounded-[18px] px-0",
                    isActionActive?.(track) &&
                      !isMobile &&
                      "border-[color:var(--dynamic-ring)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft)]",
                  )}
                  onClick={() => onAction(track)}
                  aria-label={`${getActionLabel(track)}：${track.title}`}
                  title={getActionLabel(track)}
                >
                  <Heart
                    className="h-4 w-4"
                    fill={isActionActive?.(track) ? "currentColor" : "none"}
                  />
                  {isMobile ? <span>{getActionLabel(track)}</span> : null}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  </Card>
);

const SavedMixPanel = ({
  savedMixes,
  onReplayMix,
  onDeleteMix,
  mobile = false,
}: {
  savedMixes: SavedMix[];
  onReplayMix: (savedMix: SavedMix) => void;
  onDeleteMix: (mixId: string) => void | Promise<void>;
  mobile?: boolean;
}) => (
  <Card
    className={cn(
      "surface-card rounded-[30px] p-5",
      !mobile && "flex min-h-0 flex-col",
    )}
  >
    <div className="mb-4 shrink-0">
      <h3 className="text-xl font-semibold text-[var(--text-primary)]">已儲存 Mix</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        把喜歡的推薦組合留在這裡，之後可以快速重播。
      </p>
    </div>
    <ScrollArea
      className={cn("w-full", !mobile && "min-h-0 pr-1")}
      maxHeight={mobile ? "34vh" : "42vh"}
    >
      <div className="grid gap-3">
        {savedMixes.length === 0 ? (
          <Empty title="尚未儲存 Mix" description="從搜尋建立 Mix 後，會自動保存在這裡。" />
        ) : (
          savedMixes.map((savedMix) => (
            <div
              key={savedMix.id}
              className="surface-subtle flex flex-col gap-4 rounded-[24px] border px-4 py-4"
            >
              <div className="min-w-0">
                <p className="text-base font-semibold text-[var(--text-primary)]">
                  {savedMix.seedTrack.title}
                </p>
                <p className="mt-1 truncate text-sm text-[var(--text-secondary)]">
                  {savedMix.seedTrack.artist} · {savedMix.tracks.length} 首
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => onReplayMix(savedMix)}
                >
                  <Radio className="h-4 w-4" />
                  重播 Mix
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl text-red-500"
                  onClick={() => void onDeleteMix(savedMix.id)}
                >
                  <Trash2 className="h-4 w-4" />
                  刪除
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  </Card>
);

const DevicesPanel = ({
  pairedDevices,
  profileName,
  profileNameInput,
  onProfileNameInputChange,
  onSaveProfileName,
  isSavingProfileName,
  syncPairCode,
  syncStatus,
  syncError,
  pairCodeInput,
  onPairCodeInputChange,
  isPairing,
  onPairDevice,
  onRemoveDevice,
  onRenameDevice,
  renamingDeviceId,
  currentDeviceId,
  mobile = false,
}: {
  pairedDevices: PairedDevice[];
  profileName: string;
  profileNameInput: string;
  onProfileNameInputChange: (value: string) => void;
  onSaveProfileName: () => void;
  isSavingProfileName: boolean;
  syncPairCode: string | null;
  syncStatus: "idle" | "connecting" | "connected" | "error";
  syncError: string | null;
  pairCodeInput: string;
  onPairCodeInputChange: (value: string) => void;
  isPairing: boolean;
  onPairDevice: () => void;
  onRemoveDevice: (deviceId: string) => void;
  onRenameDevice: (deviceId: string, name: string) => void;
  renamingDeviceId: string | null;
  currentDeviceId: string | null;
  mobile?: boolean;
}) => {
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceNameInput, setDeviceNameInput] = useState("");

  return (
    <Card className="surface-card rounded-[30px] p-5">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-[var(--text-primary)]">已配對裝置</h3>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          使用配對碼連接不同裝置，讓收藏、歷史、Mix 和歌單一起同步。
        </p>
      </div>
      <div className="mb-5 grid gap-3">
        <div className="surface-subtle min-w-0 rounded-[24px] border px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            使用者名稱
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            這個名稱會用在多裝置同步與點歌者顯示。
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={profileNameInput}
              onChange={(event) => onProfileNameInputChange(event.target.value)}
              placeholder="輸入使用者名稱"
              className="h-11 w-full min-w-0 rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-4 text-sm text-[var(--text-primary)] outline-none"
            />
            <Button
              className="h-11 shrink-0 rounded-2xl px-4"
              onClick={onSaveProfileName}
              disabled={isSavingProfileName || profileNameInput.trim().length === 0}
            >
              儲存
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">目前：{profileName}</p>
        </div>
        <div className="surface-subtle min-w-0 rounded-[24px] border px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            配對碼
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[0.28em] text-[var(--text-primary)]">
            {syncPairCode ?? "------"}
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {syncStatus === "connected"
              ? "目前同步已連線，其他裝置輸入這組代碼即可加入。"
              : syncStatus === "connecting"
                ? "正在建立同步連線..."
                : "同步尚未就緒，系統會自動重試。"}
          </p>
          {syncError ? <p className="mt-2 text-sm text-red-500">{syncError}</p> : null}
        </div>
        <div className="min-w-0 grid gap-3">
          <input
            value={pairCodeInput}
            onChange={(event) => onPairCodeInputChange(event.target.value.toUpperCase())}
            placeholder="輸入配對碼"
            className="h-12 w-full min-w-0 rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-4 text-sm tracking-[0.22em] text-[var(--text-primary)] uppercase outline-none"
          />
          <Button
            className="h-12 w-full rounded-2xl px-5"
            disabled={isPairing || pairCodeInput.trim().length < 6}
            onClick={onPairDevice}
          >
            連接裝置
          </Button>
        </div>
      </div>
      <ScrollArea className="w-full" maxHeight={mobile ? "28vh" : "30vh"}>
        <div className="grid gap-3">
          {pairedDevices.map((device) => {
            const detail = formatDeviceDetail(device.metadata, device.kind);
            const isEditing = editingDeviceId === device.id;

            return (
              <div
                key={device.id}
                className="surface-subtle rounded-[24px] border px-4 py-4"
              >
                <div className="min-w-0">
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={deviceNameInput}
                        onChange={(event) => setDeviceNameInput(event.target.value)}
                        placeholder="輸入裝置名稱"
                        className="h-10 w-full min-w-0 rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="h-10 rounded-2xl px-3"
                          disabled={
                            renamingDeviceId === device.id || deviceNameInput.trim().length === 0
                          }
                          onClick={() => {
                            onRenameDevice(device.id, deviceNameInput);
                            setEditingDeviceId(null);
                            setDeviceNameInput("");
                          }}
                        >
                          儲存
                        </Button>
                        <Button
                          variant="outline"
                          className="h-10 rounded-2xl px-3"
                          onClick={() => {
                            setEditingDeviceId(null);
                            setDeviceNameInput("");
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-[var(--text-primary)]">
                        {device.displayName}
                      </p>
                      <p className="mt-1 break-words text-sm text-[var(--text-secondary)]">
                        {detail} · {device.connected ? "已連線" : "離線"}
                        {device.lastSeenAt
                          ? ` · ${new Date(device.lastSeenAt).toLocaleString()}`
                          : ""}
                      </p>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {device.id === currentDeviceId ? (
                    <span className="rounded-full border border-[color:var(--dynamic-ring)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                      本機
                    </span>
                  ) : null}
                  {!isEditing ? (
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => {
                        setEditingDeviceId(device.id);
                        setDeviceNameInput(device.customName ?? device.displayName);
                      }}
                    >
                      重新命名
                    </Button>
                  ) : null}
                  {!device.isCurrentDevice ? (
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => onRemoveDevice(device.id)}
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
};

function getSectionSearchPlaceholder(section: LibrarySection) {
  if (section === "playlists") {
    return "搜尋歌單名稱";
  }

  if (section === "favorites") {
    return "搜尋收藏歌曲或歌手";
  }

  return "搜尋歷史歌曲或歌手";
}

interface PlaylistDetailProps {
  playlist: Playlist;
  draggingIndex: number | null;
  isEditing: boolean;
  onBack: () => void;
  onPlay: () => void;
  onQueue: () => void;
  onDelete: () => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onRemoveTrack: (entryId: string) => Promise<void>;
  onDropTrack: (fromIndex: number, toIndex: number) => Promise<void>;
  onDragStart: (index: number | null) => void;
  onDragEnd: () => void;
  onQueueTrack: (track: PlaylistTrackEntry["track"]) => void;
  onEditingChange: (isEditing: boolean) => void;
}

const PlaylistDetail = ({
  playlist,
  draggingIndex,
  isEditing,
  onBack,
  onPlay,
  onQueue,
  onDelete,
  onRename,
  onRemoveTrack,
  onDropTrack,
  onDragStart,
  onDragEnd,
  onQueueTrack,
  onEditingChange,
}: PlaylistDetailProps) => {
  const [draftName, setDraftName] = useState(playlist.name);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            返回歌單列表
          </button>
          {isEditing ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                className="h-12 rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] px-4 text-sm text-[var(--text-primary)] outline-none"
              />
              <Button className="rounded-2xl" onClick={() => void onRename(draftName)}>
                儲存名稱
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
                {playlist.name}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                共 {playlist.tracks.length} 首歌曲，可拖曳調整順序。
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <Button className="rounded-2xl" onClick={onPlay}>
            <Music4 className="h-4 w-4" />
            播放歌單
          </Button>
          <Button variant="outline" className="rounded-2xl" onClick={onQueue}>
            <Plus className="h-4 w-4" />
            加入佇列
          </Button>
          <Button variant="outline" className="rounded-2xl" onClick={() => onEditingChange(!isEditing)}>
            {isEditing ? "取消編輯" : "重新命名"}
          </Button>
          <Button variant="outline" className="rounded-2xl text-red-500" onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4" />
            刪除
          </Button>
        </div>
      </div>

      {playlist.tracks.length === 0 ? (
        <Empty title="歌單目前是空的" description="從搜尋、目前播放或佇列把想聽的歌加入進來。" />
      ) : (
        <div className="grid gap-3">
          {playlist.tracks.map((entry, index) => (
            <div
              key={entry.id}
              draggable
              onDragStart={() => onDragStart(index)}
              onDragEnd={onDragEnd}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingIndex === null) {
                  return;
                }

                void onDropTrack(draggingIndex, index);
                onDragEnd();
              }}
              className="surface-subtle grid gap-4 rounded-[24px] border px-4 py-4 md:grid-cols-[auto_auto_minmax(0,1fr)_88px]"
            >
              <button
                type="button"
                className="self-center text-sm font-semibold text-[var(--text-muted)]"
                aria-label="拖曳排序"
              >
                ≡
              </button>
              <Avatar src={entry.track.thumbnail} alt={entry.track.title} size="md" className="rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-base font-semibold text-[var(--text-primary)]"
                  title={entry.track.title}
                >
                  {entry.track.title}
                </p>
                <p
                  className="truncate text-sm text-[var(--text-secondary)]"
                  title={`${entry.track.artist} · ${formatTime(entry.track.duration)}`}
                >
                  {entry.track.artist} · {formatTime(entry.track.duration)}
                </p>
                <OpenAlbumButton
                  album={entry.track.album}
                  trackTitle={entry.track.title}
                  className="mt-1"
                />
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 md:w-[88px] md:justify-self-end">
                <Button
                  variant="outline"
                  className="rounded-2xl px-0"
                  onClick={() => onQueueTrack(entry.track)}
                  aria-label={`加入播放佇列：${entry.track.title}`}
                  title="加入播放佇列"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl px-0"
                  onClick={() => void onRemoveTrack(entry.id)}
                  aria-label={`從歌單移除：${entry.track.title}`}
                  title="從歌單移除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

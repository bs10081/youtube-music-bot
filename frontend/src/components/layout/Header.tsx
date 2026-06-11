import { useEffect, useMemo, useState } from "react";
import { ConnectionStatus } from "./ConnectionStatus";
import {
  AlertTriangle,
  Bug,
  CalendarDays,
  Compass,
  Disc3,
  Github,
  History,
  LibraryBig,
  Loader2,
  ListFilter,
  Music2,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useAppUiStore } from "@/stores/appUiStore";
import { api, type SystemInfoResponse } from "@/services/api";
import { frontendAppMetadata } from "@/lib/app-metadata";
import {
  hasSeenReleaseNotes,
  markReleaseNotesAsSeen,
} from "@/lib/release-notes-storage";
import {
  type ReleaseNotesEntry,
  type ReleaseNotesResponse,
  type ReleaseNotesSectionCategory,
  type ReleaseNotesStatus,
  type ReleaseNotesSource,
} from "@/types";
import { getVersionBadgeVariant } from "@/utils/version";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ReleaseNotesFilter = "all" | ReleaseNotesSectionCategory;

const releaseNotesSectionOrder: ReleaseNotesSectionCategory[] = [
  "added",
  "changed",
  "fixed",
];

const releaseNotesSectionMeta: Record<
  ReleaseNotesSectionCategory,
  {
    label: string;
    icon: typeof Sparkles;
    panelClassName: string;
    badgeClassName: string;
    filterActiveClassName: string;
    dotClassName: string;
  }
> = {
  added: {
    label: "全新功能",
    icon: Sparkles,
    panelClassName:
      "border-[#d4ebdc] bg-[linear-gradient(135deg,rgba(247,255,250,0.98),rgba(231,248,238,0.98))] text-[#177a58] shadow-[0_16px_30px_-24px_rgba(23,122,88,0.55)]",
    badgeClassName:
      "border border-[#d4ebdc] bg-[#eef9f2] text-[#156c4f]",
    filterActiveClassName:
      "border-[#bfdfcb] bg-[#e8f7ee] text-[#156c4f]",
    dotClassName: "bg-[#20996b]",
  },
  changed: {
    label: "功能增強",
    icon: SlidersHorizontal,
    panelClassName:
      "border-[#d8e4f7] bg-[linear-gradient(135deg,rgba(248,251,255,0.98),rgba(232,240,255,0.98))] text-[#265fae] shadow-[0_16px_30px_-24px_rgba(38,95,174,0.5)]",
    badgeClassName:
      "border border-[#d8e4f7] bg-[#edf4ff] text-[#245496]",
    filterActiveClassName:
      "border-[#bfd3f3] bg-[#e8f0ff] text-[#245496]",
    dotClassName: "bg-[#3477d7]",
  },
  fixed: {
    label: "問題修復",
    icon: Bug,
    panelClassName:
      "border-[#f1d5ca] bg-[linear-gradient(135deg,rgba(255,248,245,0.98),rgba(255,233,226,0.98))] text-[#c35f3d] shadow-[0_16px_30px_-24px_rgba(195,95,61,0.48)]",
    badgeClassName:
      "border border-[#f1d5ca] bg-[#fff0ea] text-[#ae5638]",
    filterActiveClassName:
      "border-[#ebc2b3] bg-[#ffece4] text-[#ae5638]",
    dotClassName: "bg-[#d96e48]",
  },
};

interface HeaderProps {
  onSearchClick?: () => void;
}

function parseLocalDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function formatReleaseDate(value: string): string {
  const date = parseLocalDate(value);

  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getReleaseStatusLabel(status: ReleaseNotesStatus): string {
  return status === "preview" ? "開發版" : "已發布";
}

function getReleaseSourceLabel(source: ReleaseNotesSource): string {
  switch (source) {
    case "github":
      return "GitHub Releases";
    case "hybrid":
      return "GitHub + 本機 fallback";
    case "fallback":
    default:
      return "本機 fallback";
  }
}

function countReleaseItems(entry: ReleaseNotesEntry): number {
  return entry.sections.reduce((count, section) => count + section.items.length, 0);
}

export const Header = ({ onSearchClick }: HeaderProps) => {
  const desktopMode = useAppUiStore((state) => state.desktopMode);
  const setDesktopMode = useAppUiStore((state) => state.setDesktopMode);
  const [backendInfo, setBackendInfo] = useState<SystemInfoResponse | null>(null);
  const [releaseNotesData, setReleaseNotesData] =
    useState<ReleaseNotesResponse | null>(null);
  const [isReleaseNotesLoading, setIsReleaseNotesLoading] = useState(false);
  const [releaseNotesError, setReleaseNotesError] = useState<string | null>(null);
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [hasUnseenReleaseNotes, setHasUnseenReleaseNotes] = useState(false);
  const [selectedReleaseVersion, setSelectedReleaseVersion] = useState(
    frontendAppMetadata.appVersion,
  );
  const [activeReleaseCategory, setActiveReleaseCategory] =
    useState<ReleaseNotesFilter>("all");
  const desktopModes = [
    {
      id: "player" as const,
      label: "播放中",
      icon: Disc3,
    },
    {
      id: "discover" as const,
      label: "Discover",
      icon: Compass,
    },
    {
      id: "library" as const,
      label: "媒體庫",
      icon: LibraryBig,
    },
  ];
  const currentReleaseNotes = releaseNotesData?.currentRelease ?? null;
  const releaseHistory = releaseNotesData?.releases ?? [];

  const selectedReleaseNotes = useMemo(
    () =>
      releaseHistory.find((entry) => entry.version === selectedReleaseVersion) ??
      currentReleaseNotes ??
      releaseHistory[0] ??
      null,
    [currentReleaseNotes, releaseHistory, selectedReleaseVersion],
  );

  const availableCategories = useMemo(() => {
    if (!selectedReleaseNotes) {
      return [];
    }

    return releaseNotesSectionOrder.filter((category) =>
      selectedReleaseNotes.sections.some((section) => section.category === category),
    );
  }, [selectedReleaseNotes]);

  const filteredSections = useMemo(() => {
    if (!selectedReleaseNotes) {
      return [];
    }

    if (activeReleaseCategory === "all") {
      return selectedReleaseNotes.sections;
    }

    return selectedReleaseNotes.sections.filter(
      (section) => section.category === activeReleaseCategory,
    );
  }, [activeReleaseCategory, selectedReleaseNotes]);

  const versionBadgeVariant = getVersionBadgeVariant(
    frontendAppMetadata.buildVersion,
    backendInfo?.buildVersion,
  );
  const versionTooltip = [
    `Frontend ${frontendAppMetadata.buildVersion}`,
    `Backend ${backendInfo?.buildVersion ?? "loading..."}`,
  ].join(" | ");
  const selectedReleaseItemsCount = selectedReleaseNotes
    ? countReleaseItems(selectedReleaseNotes)
    : 0;
  const releaseNotesWarnings = releaseNotesData?.warnings ?? [];
  const releaseNotesSource = releaseNotesData?.source ?? "fallback";

  function openReleaseNotesDialog(
    version =
      currentReleaseNotes?.version ??
      releaseHistory[0]?.version ??
      frontendAppMetadata.appVersion,
  ) {
    setSelectedReleaseVersion(version);
    setActiveReleaseCategory("all");
    if (currentReleaseNotes?.version) {
      markReleaseNotesAsSeen(currentReleaseNotes.version);
      setHasUnseenReleaseNotes(false);
    }
    setIsVersionDialogOpen(true);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSystemInfo() {
      const response = await api.getSystemInfo();
      if (!cancelled && response.success && response.data) {
        setBackendInfo(response.data);
      }
    }

    void loadSystemInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReleaseNotes() {
      setIsReleaseNotesLoading(true);
      setReleaseNotesError(null);

      const response = await api.getReleaseNotes();

      if (cancelled) {
        return;
      }

      if (!response.success || !response.data) {
        setReleaseNotesData(null);
        setReleaseNotesError(response.error || "無法載入版本說明");
        setIsReleaseNotesLoading(false);
        return;
      }

      const releaseNotesPayload = response.data;

      setReleaseNotesData(releaseNotesPayload);
      setSelectedReleaseVersion((currentVersion) => {
        if (
          releaseNotesPayload.releases.some(
            (entry) => entry.version === currentVersion,
          )
        ) {
          return currentVersion;
        }

        return (
          releaseNotesPayload.currentRelease?.version ??
          releaseNotesPayload.releases[0]?.version ??
          frontendAppMetadata.appVersion
        );
      });
      setIsReleaseNotesLoading(false);
    }

    void loadReleaseNotes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentReleaseNotes) {
      return;
    }

    setHasUnseenReleaseNotes(!hasSeenReleaseNotes(currentReleaseNotes.version));
  }, [currentReleaseNotes]);

  const renderVersionBadgeButton = (className?: string) => (
    <button
      type="button"
      onClick={() => openReleaseNotesDialog()}
      className={className}
      title={versionTooltip}
      aria-label="查看版本資訊"
    >
      <Badge
        variant={versionBadgeVariant}
        className={cn(
          "gap-1.5 border border-transparent",
          hasUnseenReleaseNotes &&
            "border-[color:var(--dynamic-ring)] shadow-[0_12px_26px_-20px_var(--accent-glow)]",
        )}
      >
        v{frontendAppMetadata.appVersion}
        {hasUnseenReleaseNotes ? (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        ) : null}
      </Badge>
    </button>
  );

  return (
    <>
      <header className="border-b border-[color:var(--surface-border)] bg-[color:var(--surface-overlay)] px-4 py-2.5 backdrop-blur-xl lg:px-5 lg:py-3">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] border border-[color:var(--surface-border)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm">
              <Music2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-tight text-[var(--text-primary)] lg:text-2xl">
                  <span className="hidden sm:inline">YouTube Music Bot</span>
                </h1>
                {renderVersionBadgeButton("hidden sm:inline-flex")}
              </div>
              <p className="hidden text-xs text-[var(--text-secondary)] xl:block">
                Desktop jukebox with synced lyrics and live queue
              </p>
            </div>
          </div>

          <div className="hidden w-[352px] shrink-0 grid-cols-3 items-center rounded-[var(--app-radius-lg)] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] p-1 lg:grid xl:w-[392px]">
            {desktopModes.map((mode) => {
              const Icon = mode.icon;

              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setDesktopMode(mode.id)}
                  className={cn(
                    "inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-[var(--app-radius-md)] px-3 text-sm font-semibold leading-none transition-colors xl:h-11 xl:px-4",
                    desktopMode === mode.id
                      ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[0_12px_24px_-20px_var(--accent-glow)]"
                      : "text-[var(--text-secondary)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate leading-none">{mode.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 lg:min-w-0 lg:flex-1 lg:justify-end">
            <button
              type="button"
              onClick={onSearchClick}
              className="desktop-command-button hidden min-w-[220px] max-w-[260px] flex-1 items-center justify-between rounded-[var(--app-radius-lg)] border px-3 py-2.5 text-left transition-transform duration-200 hover:-translate-y-0.5 lg:flex xl:min-w-[260px] xl:px-4"
            >
              <span className="flex items-center gap-3 text-[var(--text-primary)]">
                <Search className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="font-medium">搜尋音樂</span>
              </span>
              <kbd className="inline-flex h-7 select-none items-center gap-1 rounded-xl border border-[color:var(--surface-border)] bg-[var(--surface-muted)] px-2.5 font-mono text-xs text-[var(--text-secondary)]">
                <span className="text-[0.65rem]">⌘</span>K
              </kbd>
            </button>

            <a
              href="https://github.com/bs10081/youtube-music-bot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              aria-label="前往 GitHub 專案"
            >
              <Github className="h-5 w-5" />
            </a>

            <ConnectionStatus />

            {renderVersionBadgeButton("sm:hidden")}
          </div>
        </div>
      </header>

      <Dialog open={isVersionDialogOpen} onOpenChange={setIsVersionDialogOpen}>
        <DialogContent className="flex max-h-[min(90vh,840px)] w-[calc(100vw-2rem)] max-w-5xl flex-col p-0">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-[color:var(--surface-border)] p-6 pb-4">
              <div className="min-w-0 flex-1 space-y-2">
                <DialogTitle className="leading-snug">
                  版本更新與建置資訊
                </DialogTitle>
                <DialogDescription className="leading-relaxed">
                  可從標頭版本號隨時重新開啟，瀏覽版本歷史、依類型篩選更新內容，並查看目前建置資訊。
                </DialogDescription>
              </div>
              <DialogClose className="static right-auto top-auto shrink-0 self-start" />
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="px-6 pb-6 pt-4">
                <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <aside className="space-y-4">
                    <div className="surface-subtle rounded-[28px] border border-[color:var(--surface-border)] p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        <History className="h-4 w-4 text-[var(--accent)]" />
                        <span>版本歷史</span>
                      </div>
                      <ScrollArea className="mt-4 pr-1 lg:max-h-[390px]">
                        <div className="space-y-2">
                          {isReleaseNotesLoading && releaseHistory.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-[22px] border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
                              正在載入 GitHub 版本歷史...
                            </div>
                          ) : null}

                          {!isReleaseNotesLoading &&
                          releaseHistory.length === 0 &&
                          releaseNotesError ? (
                            <div className="rounded-[22px] border border-[#f1d5ca] bg-[#fff4ef] px-4 py-3 text-sm leading-6 text-[#a95536]">
                              {releaseNotesError}
                            </div>
                          ) : null}

                          {releaseHistory.map((entry) => {
                            const isActive = entry.version === selectedReleaseNotes?.version;
                            const isCurrent = entry.version === currentReleaseNotes?.version;

                            return (
                              <button
                                key={entry.version}
                                type="button"
                                onClick={() => {
                                  setSelectedReleaseVersion(entry.version);
                                  setActiveReleaseCategory("all");
                                }}
                                className={cn(
                                  "w-full rounded-[22px] border px-4 py-3 text-left transition-all",
                                  isActive
                                    ? "border-[var(--accent)]/20 bg-[var(--surface-elevated)] shadow-[0_18px_38px_-30px_var(--accent-glow)]"
                                    : "border-[color:var(--surface-border)] bg-[var(--surface-subtle)]/70 hover:bg-[var(--surface-muted)]",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                                    v{entry.version}
                                  </p>
                                  {isCurrent ? (
                                    <span className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">
                                      目前版本
                                    </span>
                                  ) : null}
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold",
                                      entry.status === "preview"
                                        ? "border-[#d4ebdc] bg-[#eef9f2] text-[#156c4f]"
                                        : "border-[color:var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
                                    )}
                                  >
                                    {getReleaseStatusLabel(entry.status)}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm font-medium leading-6 text-[var(--text-primary)]">
                                  {entry.title}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                                  <span className="inline-flex items-center gap-1.5">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {formatReleaseDate(entry.publishedAt)}
                                  </span>
                                  <span>{countReleaseItems(entry)} 條更新</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>

                    <div className="surface-subtle rounded-[28px] border border-[color:var(--surface-border)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Build Info
                      </p>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-[20px] border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Frontend
                          </p>
                          <p className="mt-2 break-all font-mono text-sm text-[var(--text-primary)]">
                            {frontendAppMetadata.buildVersion}
                          </p>
                        </div>
                        <div className="rounded-[20px] border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Backend
                          </p>
                          <p className="mt-2 break-all font-mono text-sm text-[var(--text-primary)]">
                            {backendInfo?.buildVersion ?? "loading..."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </aside>

                  <div className="space-y-4">
                    {isReleaseNotesLoading && !selectedReleaseNotes ? (
                      <div className="flex items-center gap-3 rounded-[28px] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)]/80 p-6 text-sm text-[var(--text-secondary)]">
                        <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
                        正在同步 GitHub 版本說明...
                      </div>
                    ) : null}

                    {!isReleaseNotesLoading && !selectedReleaseNotes && releaseNotesError ? (
                      <div className="rounded-[28px] border border-[#f1d5ca] bg-[#fff4ef] p-6 text-sm leading-7 text-[#a95536]">
                        {releaseNotesError}
                      </div>
                    ) : null}

                    {selectedReleaseNotes ? (
                      <>
                        <div className="surface-card-strong rounded-[30px] border border-[color:var(--surface-border)] p-5 lg:p-6">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                Release Notes
                              </p>
                              <h3 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                                v{selectedReleaseNotes.version} · {selectedReleaseNotes.title}
                              </h3>
                              {selectedReleaseNotes.summary ? (
                                <p className="max-w-3xl text-sm leading-7 text-[var(--text-secondary)]">
                                  {selectedReleaseNotes.summary}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2 text-xs font-semibold">
                              <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[var(--text-secondary)]">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {formatReleaseDate(selectedReleaseNotes.publishedAt)}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-3 py-1.5",
                                  selectedReleaseNotes.status === "preview"
                                    ? "border-[#d4ebdc] bg-[#eef9f2] text-[#156c4f]"
                                    : "border-[color:var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
                                )}
                              >
                                {getReleaseStatusLabel(selectedReleaseNotes.status)}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[var(--text-secondary)]">
                                {selectedReleaseNotes.sections.length} 個分類
                              </span>
                              <span className="inline-flex items-center rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[var(--text-secondary)]">
                                {selectedReleaseItemsCount} 條更新
                              </span>
                              <span className="inline-flex items-center rounded-full border border-[color:var(--surface-border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[var(--text-secondary)]">
                                {getReleaseSourceLabel(releaseNotesSource)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {releaseNotesWarnings.length > 0 ? (
                          <div className="space-y-2">
                            {releaseNotesWarnings.map((warning) => (
                              <div
                                key={warning}
                                className="flex items-start gap-3 rounded-[24px] border border-[#f6dfb1] bg-[#fff8e8] px-4 py-3 text-sm leading-6 text-[#916000]"
                              >
                                <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="rounded-[28px] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)]/80 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                              <ListFilter className="h-4 w-4 text-[var(--accent)]" />
                              <span>分類篩選</span>
                            </div>
                            <p className="text-xs text-[var(--text-muted)]">
                              只看你現在最想關注的更新類型
                            </p>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveReleaseCategory("all")}
                              aria-pressed={activeReleaseCategory === "all"}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors",
                                activeReleaseCategory === "all"
                                  ? "border-[var(--accent)]/20 bg-[var(--surface-elevated)] text-[var(--text-primary)]"
                                  : "border-[color:var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                              )}
                            >
                              全部
                              <span className="text-xs text-[var(--text-muted)]">
                                {selectedReleaseNotes.sections.length}
                              </span>
                            </button>

                            {availableCategories.map((category) => {
                              const meta = releaseNotesSectionMeta[category];
                              const Icon = meta.icon;
                              const matchingSections = selectedReleaseNotes.sections.filter(
                                (section) => section.category === category,
                              );
                              const matchingItemsCount = matchingSections.reduce(
                                (count, section) => count + section.items.length,
                                0,
                              );

                              return (
                                <button
                                  key={category}
                                  type="button"
                                  onClick={() => setActiveReleaseCategory(category)}
                                  aria-pressed={activeReleaseCategory === category}
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors",
                                    activeReleaseCategory === category
                                      ? meta.filterActiveClassName
                                      : "border-[color:var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                                  )}
                                >
                                  <Icon className="h-4 w-4" />
                                  {meta.label}
                                  <span className="text-xs opacity-80">
                                    {matchingItemsCount}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {filteredSections.length === 0 ? (
                          <div className="rounded-[28px] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)]/80 p-6 text-sm text-[var(--text-secondary)]">
                            這個分類目前沒有可顯示的更新內容，請切換其他分類看看。
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {filteredSections.map((section) => {
                              const meta = releaseNotesSectionMeta[section.category];
                              const Icon = meta.icon;

                              return (
                                <div
                                  key={`${selectedReleaseNotes.version}:${section.title}`}
                                  className="rounded-[28px] border border-[color:var(--surface-border)] bg-[var(--surface-subtle)]/85 p-5"
                                >
                                  <div className="flex items-start gap-4">
                                    <span
                                      className={cn(
                                        "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] border",
                                        meta.panelClassName,
                                      )}
                                    >
                                      <Icon className="h-5 w-5" />
                                    </span>

                                    <div className="min-w-0 flex-1 space-y-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                                          {section.title}
                                        </h4>
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                            meta.badgeClassName,
                                          )}
                                        >
                                          {meta.label}
                                        </span>
                                      </div>

                                      {section.description ? (
                                        <p className="text-sm leading-7 text-[var(--text-secondary)]">
                                          {section.description}
                                        </p>
                                      ) : null}

                                      <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                                        {section.items.map((item) => (
                                          <li
                                            key={item}
                                            className="flex items-start gap-3 leading-7"
                                          >
                                            <span
                                              className={cn(
                                                "mt-[0.8rem] h-2 w-2 shrink-0 rounded-full",
                                                meta.dotClassName,
                                              )}
                                            />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

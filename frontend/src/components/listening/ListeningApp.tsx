import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Settings2 } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLibraryPlaybackSync } from '@/hooks/useLibraryPlaybackSync';
import { useLibrarySync } from '@/hooks/useLibrarySync';
import { useArtworkTheme } from '@/hooks/useArtworkTheme';
import { usePlayerStore } from '@/stores/playerStore';
import { useAlbumDialogStore } from '@/stores/albumDialogStore';
import { useArtistDialogStore } from '@/stores/artistDialogStore';
import { usePlaylistDialogStore } from '@/stores/playlistDialogStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { ToastProvider } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { ListeningNav, type ListeningView } from './ListeningNav';
import { PlayerDock } from './PlayerDock';
import { GlassSurface } from './GlassSurface';
import { useMediaQuery } from './useMediaQuery';
import { FeatureBoundary } from './FeatureBoundary';
const GalleryView = lazy(() => import('./GalleryView'));
const FocusPlayer = lazy(() => import('./FocusPlayer'));
const Settings = lazy(() => import('./ListeningSettings'));
const LibraryView = lazy(() => import('@/components/library/LibraryView').then(m => ({default:m.LibraryView})));
const SearchSection = lazy(() => import('@/components/search/SearchSection').then(m => ({default:m.SearchSection})));
const QueueSection = lazy(() => import('@/components/queue/QueueSection').then(m => ({default:m.QueueSection})));
const AlbumDialog = lazy(() => import('@/components/album/AlbumDialog').then(m => ({default:m.AlbumDialog})));
const ArtistDialog = lazy(() => import('@/components/artist/ArtistDialog').then(m => ({default:m.ArtistDialog})));
const PlaylistDialog = lazy(() => import('@/components/playlist/PlaylistDialog').then(m => ({default:m.PlaylistDialog})));
const PlaylistPickerDialog = lazy(() => import('@/components/library/PlaylistPickerDialog').then(m => ({default:m.PlaylistPickerDialog})));

const loading = <div className="app-loading" role="status">正在載入…</div>;
function initialView(): ListeningView {
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'player' || value === 'library' || value === 'search' ? value : 'discover';
}
function initialSolid() {
  try { return localStorage.getItem('ymb-material') === 'solid'; } catch { return false; }
}
function ListeningContent() {
  useWebSocket();
  useLibraryPlaybackSync();
  useLibrarySync();
  useArtworkTheme();
  const [view, setView] = useState<ListeningView>(initialView);
  const [solid, setSolid] = useState(initialSolid);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const small = useMediaQuery('(max-width: 767px)');
  const connected = usePlayerStore(s => s.connectionStatus);
  const album = useAlbumDialogStore(s => s.isOpen);
  const artist = useArtistDialogStore(s => s.isOpen);
  const playlist = usePlaylistDialogStore(s => s.isOpen);
  const picker = useLibraryStore(s => !!s.playlistPickerTrack);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useCallback((next: ListeningView) => {
    setView(next);
    const url = new URL(window.location.href); url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
    mainRef.current?.scrollTo({top:0});
  }, []);
  const search = useCallback(() => navigate('search'), [navigate]);
  useKeyboardShortcuts({onSearchOpen:search});
  useEffect(() => {
    document.documentElement.dataset.material = solid ? 'solid' : 'glass';
    try { localStorage.setItem('ymb-material', solid ? 'solid' : 'glass'); } catch { /* Private-mode storage can be unavailable. */ }
  }, [solid]);
  useEffect(() => {
    if (view === 'search') {
      const frame = requestAnimationFrame(() => mainRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [view]);
  return <div className="listening-app">
    <a className="skip-link" href="#listening-main">跳至主要內容</a>
    <header className="listening-header">
      <button className="listening-brand" onClick={()=>navigate('discover')} aria-label="YouTube Music Bot 首頁"><span><Headphones size={23} /></span><div>YMB<span className="brand-caption">YOUR MUSIC, TOGETHER</span></div></button>
      <GlassSurface solid={solid} className="nav-surface"><ListeningNav view={view} onNavigate={navigate} /></GlassSurface>
      <div className="header-status"><ConnectionStatus /><button className="header-settings" aria-label="開啟設定" onClick={()=>setSettingsOpen(true)}><Settings2 size={20}/></button></div>
    </header>
    {connected !== 'connected' && <div className="connection-notice" role="status">{connected === 'connecting' ? '正在連接播放器…' : '與播放器的連線中斷，正在自動重連。'}</div>}
    <main id="listening-main" ref={mainRef} tabIndex={-1} className={`listening-main view-${view}`}>
      <FeatureBoundary key={view}><Suspense fallback={loading}>
        {view === 'discover' && <GalleryView />}
        {view === 'player' && <FocusPlayer onSearch={search} />}
        {view === 'library' && <div className="listening-library"><LibraryView isMobile={small} /></div>}
        {view === 'search' && <div className="listening-search"><span className="eyebrow">FIND YOUR NEXT FAVORITE</span><SearchSection /></div>}
      </Suspense></FeatureBoundary>
    </main>
    <PlayerDock onPlayer={()=>navigate('player')} onQueue={()=>setQueueOpen(true)} onSettings={()=>setSettingsOpen(true)} />
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="listening-dialog"><div className="listening-dialog-header"><DialogTitle>播放與外觀設定</DialogTitle><DialogDescription>調整音訊、動態材質與同步歌詞分享。</DialogDescription><DialogClose /></div><div className="listening-dialog-body"><Suspense fallback={loading}><Settings solid={solid} onSolidChange={setSolid}/></Suspense></div></DialogContent></Dialog>
    <Dialog open={queueOpen} onOpenChange={setQueueOpen}><DialogContent className="listening-dialog queue-dialog"><div className="listening-dialog-header"><DialogTitle>接下來播放</DialogTitle><DialogDescription>與所有連線裝置同步的播放佇列。</DialogDescription><DialogClose /></div><div className="queue-dialog-content"><Suspense fallback={loading}><QueueSection mobile={small}/></Suspense></div></DialogContent></Dialog>
    <Suspense fallback={loading}>{album && <AlbumDialog />}{artist && <ArtistDialog />}{playlist && <PlaylistDialog />}{picker && <PlaylistPickerDialog />}</Suspense>
  </div>;
}
export default function ListeningApp() { return <ToastProvider><ListeningContent /></ToastProvider>; }

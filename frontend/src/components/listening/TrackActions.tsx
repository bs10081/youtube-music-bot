import { Heart, ListPlus } from 'lucide-react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useToast } from '@/components/ui/toast';
import type { Track } from '@/types';
import { useState } from 'react';
export function TrackActions({track}: {track: Track}) {
  const favorite = useLibraryStore(s => s.snapshot?.favorites.some(t => t.videoId === track.videoId) ?? false);
  const ready = useLibraryStore(s => s.ready);
  const [pending, setPending] = useState(false);
  const { showToast } = useToast();
  const toggle = async () => {
    if (!ready || pending) return;
    setPending(true);
    try { await useLibraryStore.getState().toggleFavorite(track); }
    catch { showToast({message:'收藏更新失敗',type:'error'}); }
    finally { setPending(false); }
  };
  return <div className="track-actions">
    <button type="button" aria-label={favorite ? '取消收藏' : '收藏'} aria-pressed={favorite} disabled={!ready || pending} onClick={() => void toggle()}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button>
    <button type="button" aria-label="加入歌單" disabled={!ready} onClick={() => useLibraryStore.getState().openPlaylistPicker(track)}><ListPlus size={18} /></button>
  </div>;
}

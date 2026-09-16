import { useState } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { api } from '@/services/api';
import { usePlayerStore } from '@/stores/playerStore';
import { useToast } from '@/components/ui/toast';

export function Transport() {
  const playing = usePlayerStore(s => s.playbackState.isPlaying);
  const track = usePlayerStore(s => s.playbackState.currentTrack);
  const hasQueue = usePlayerStore(s => s.playbackState.queue.length > 0);
  const loading = usePlayerStore(s => s.isLoadingTrack);
  const hasMedia = !!track || hasQueue;
  const connected = usePlayerStore(s => s.connectionStatus === 'connected');
  const [pending, setPending] = useState(false);
  const { showToast } = useToast();
  const run = async (skip = false) => {
    if (pending || !connected || !hasMedia || loading) return;
    setPending(true);
    try {
      const result = await (skip ? api.skip() : playing ? api.pause() : api.play());
      if (!result.success) showToast({message: result.error || '播放操作失敗', type:'error'});
    } catch { showToast({message:'播放操作失敗',type:'error'}); }
    finally { setPending(false); }
  };
  return <div className="listening-transport">
    <button type="button" className="transport-play" aria-label={playing ? '暫停' : '播放'} disabled={!hasMedia || !connected || pending || loading} onClick={() => void run()}>
      {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
    </button>
    <button type="button" aria-label="下一首" disabled={!hasMedia || !connected || pending || loading} onClick={() => void run(true)}><SkipForward size={20} /></button>
  </div>;
}
